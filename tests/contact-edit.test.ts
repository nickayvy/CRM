// Editing a business's contact details from the dossier: validation, storage,
// edits surviving re-syncs, and the AI dialer calling the edited number.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { getBusiness, upsertBusinessByYelpId } from "@/db/repo/businesses";
import { addBusinessesToCampaign, createCallCampaign } from "@/db/repo/call-campaigns";
import { upsertBusinessByTrustpilotId } from "@/db/repo/discovery";
import { upsertGooglePlace } from "@/db/repo/google";
import { activities } from "@/db/schema";
import { createTestDb } from "@/db/test-utils";
import { dispatchAiCalls } from "@/features/calling/ai";
import type { CallPlacer, OutboundCallInput } from "@/lib/elevenlabs/client";
import { normalizeGooglePlace } from "@/lib/google-places/normalize";
import { insertBusiness, makeBusinessRow, makeTrustpilotRow } from "./helpers/builders";
import { makeGooglePlace } from "./helpers/fake-places";

const auth = vi.hoisted(() => ({ user: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", email: null as string | null } as { id: string; email: string | null } | null }));
vi.mock("@/lib/supabase/server", () => ({
  getUser: async () => auth.user,
  requireUser: async () => {
    if (!auth.user) throw new Error("NEXT_REDIRECT /login");
    return auth.user;
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { updateContactDetailsAction } = await import("@/features/lookup/actions");

let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  globalThis.__db = { db, driver: "pglite", close };
});
afterAll(async () => {
  globalThis.__db = undefined;
  await close();
});
beforeEach(async () => {
  await db.execute(sql`TRUNCATE TABLE ai_calls, call_queue_items, call_campaigns, activities, businesses RESTART IDENTITY CASCADE`);
});

describe("updateContactDetailsAction", () => {
  it("stores a typed phone as E.164, updates digits and display, marks it edited and logs it", async () => {
    const b = await insertBusiness(db, { phone: "+18003836008" });
    const res = await updateContactDetailsAction(b.id, { phone: "(512) 555-0199" });
    expect(res).toEqual({ ok: true, data: { changed: ["phone"] } });
    const after = (await getBusiness(db, b.id))!;
    expect(after.phone).toBe("+15125550199");
    expect(after.phoneDigits).toBe("15125550199");
    expect(after.displayPhone).toBe("(512) 555-0199");
    expect(after.editedFields).toEqual(["phone"]);
    const logged = await db.select().from(activities).where(eq(activities.businessId, b.id));
    expect(logged).toHaveLength(1);
    expect(logged[0].body).toBe("Contact details edited: phone (800) 383-6008 → (512) 555-0199.");
  });

  it("rejects an undialable phone and a bad email with field errors, writing nothing", async () => {
    const b = await insertBusiness(db, { phone: "+18003836008", email: "help@example.com" });
    const res = await updateContactDetailsAction(b.id, { phone: "555-1234", email: "nope" });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(Object.keys(res.fieldErrors ?? {}).sort()).toEqual(["email", "phone"]);
    const after = (await getBusiness(db, b.id))!;
    expect(after.phone).toBe("+18003836008");
    expect(after.editedFields).toEqual([]);
  });

  it("clears a field with an empty string, adds https:// to links, and leaves unsent fields alone", async () => {
    const b = await insertBusiness(db, {
      email: "old@example.com",
      website: "https://example.com",
      socialLinks: { x: "https://x.com/old", instagram: "https://instagram.com/keep" },
    });
    const res = await updateContactDetailsAction(b.id, { email: "", twitter: "x.com/new", facebook: "facebook.com/brand" });
    expect(res.ok).toBe(true);
    const after = (await getBusiness(db, b.id))!;
    expect(after.email).toBeNull();
    expect(after.website).toBe("https://example.com");
    expect(after.socialLinks).toEqual({
      instagram: "https://instagram.com/keep",
      twitter: "https://x.com/new",
      facebook: "https://facebook.com/brand",
    });
    expect([...after.editedFields].sort()).toEqual(["email", "socialLinks"]);
  });

  it("re-qualifies when a phoneless business gets a phone", async () => {
    const b = await insertBusiness(db, { phone: null, phoneDigits: null, displayPhone: null });
    expect(b.phoneDigits).toBeNull();
    await updateContactDetailsAction(b.id, { phone: "713-555-0142" });
    const after = (await getBusiness(db, b.id))!;
    expect(after.rejectionReasons).not.toContain("no_phone");
    expect(after.qualifiedAt).not.toBeNull();
  });

  it("is a no-op when nothing changed", async () => {
    const b = await insertBusiness(db, { phone: "+18003836008" });
    const res = await updateContactDetailsAction(b.id, { phone: "(800) 383-6008" });
    expect(res).toEqual({ ok: true, data: { changed: [] } });
    expect((await getBusiness(db, b.id))!.editedFields).toEqual([]);
  });
});

describe("edited fields survive re-syncs", () => {
  it("a Yelp re-upsert keeps the edited phone and still refreshes other columns", async () => {
    const row = makeBusinessRow({ phone: "+18003836008", reviewCount: 10 });
    const { business: b } = await upsertBusinessByYelpId(db, row);
    await updateContactDetailsAction(b.id, { phone: "(512) 555-0199" });
    await upsertBusinessByYelpId(db, { ...row, reviewCount: 99 });
    const after = (await getBusiness(db, b.id))!;
    expect(after.phone).toBe("+15125550199");
    expect(after.phoneDigits).toBe("15125550199");
    expect(after.reviewCount).toBe(99);
  });

  it("a Trustpilot re-upsert keeps edited email/socials but overwrites the unedited phone", async () => {
    const row = makeTrustpilotRow({ phone: "+18003836008", email: "help@brand.com", socialLinks: { facebook: "https://facebook.com/a" } });
    const { business: b } = await upsertBusinessByTrustpilotId(db, row);
    await updateContactDetailsAction(b.id, { email: "owner@brand.com", facebook: "facebook.com/mine" });
    await upsertBusinessByTrustpilotId(db, { ...row, phone: "+18005550000", phoneDigits: "18005550000", socialLinks: { facebook: "https://facebook.com/b" } });
    const after = (await getBusiness(db, b.id))!;
    expect(after.email).toBe("owner@brand.com");
    expect(after.socialLinks).toEqual({ facebook: "https://facebook.com/mine" });
    expect(after.phone).toBe("+18005550000");
  });

  it("a Google refresh keeps the edited phone", async () => {
    const place = makeGooglePlace();
    const rowOf = () => normalizeGooglePlace(place, { searchCategory: "home_services", searchLocation: "Dallas, TX" });
    const { business: b } = await upsertGooglePlace(db, rowOf());
    await updateContactDetailsAction(b.id, { phone: "+1 214 555 0177" });
    await upsertGooglePlace(db, rowOf());
    expect((await getBusiness(db, b.id))!.phone).toBe("+12145550177");
  });
});

describe("the AI dialer calls the edited number", () => {
  it("dials the new phone for a business that was queued before the edit", async () => {
    const b = await insertBusiness(db, { phone: "+18003836008" });
    const campaign = await createCallCampaign(db, {
      name: "Edit test",
      status: "running",
      mode: "ai",
      timezone: "America/Chicago",
      maxConcurrentAgents: 1,
      script: "Hello",
    });
    await addBusinessesToCampaign(db, campaign.id, [b.id]);
    await updateContactDetailsAction(b.id, { phone: "(512) 555-0199" });

    const calls: OutboundCallInput[] = [];
    const placer: CallPlacer = {
      async placeCall(input) {
        calls.push(input);
        return { conversationId: "conv_1", callSid: "CA1" };
      },
    };
    const r = await dispatchAiCalls(db, campaign.id, placer);
    expect(r.placed).toBe(1);
    expect(calls[0].toNumber).toBe("+15125550199");
  });
});
