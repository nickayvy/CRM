// WP-15: /leads server actions and data functions against an in-memory PGlite.
// The signed-in user is a mocked requireUser() returning a fixed uuid; every
// action must scope by it (AC-15.1..AC-15.4).
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { logActivity } from "@/db/repo/activities";
import { addBusinessesToCampaign, createCallCampaign, getCampaignStats } from "@/db/repo/call-campaigns";
import { createEmailCampaign, listEnrolledBusinessIds } from "@/db/repo/email-campaigns";
import { addLead, getLead, listLeads } from "@/db/repo/leads";
import { type Business, callQueueItems, leads } from "@/db/schema";
import { createTestDb } from "@/db/test-utils";
import { insertBusiness } from "./helpers/builders";

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";

const auth = vi.hoisted(() => ({ userId: "11111111-1111-4111-8111-111111111111" }));
const cookieJar = vi.hoisted(() => new Map<string, string>());

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (k: string) => (cookieJar.has(k) ? { name: k, value: cookieJar.get(k) } : undefined),
    set: (k: string, v: string) => cookieJar.set(k, v),
    delete: (k: string) => cookieJar.delete(k),
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  requireUser: async () => ({ id: auth.userId, email: null }),
  getUser: async () => ({ id: auth.userId, email: null }),
}));

const {
  addLeadAction,
  addLeadsToCallCampaignAction,
  addLeadsToEmailCampaignAction,
  bulkRemoveLeadsAction,
  createCallCampaignForLeadsAction,
  removeLeadAction,
  updateLeadAction,
} = await import("@/features/leads/actions");
const { countLeadCallsSince, getLeadMetrics, listLeadCallHistory, loadLeadsView } = await import("@/features/leads/data");
const { recordOutcomeAction } = await import("@/features/calling/actions");
const { default: LeadsPage } = await import("@/app/leads/page");

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
  await db.execute(
    sql`TRUNCATE TABLE leads, call_queue_items, call_campaigns, email_messages, email_enrollments, email_steps, email_campaigns, activities, businesses RESTART IDENTITY CASCADE`,
  );
  auth.userId = USER_A;
  cookieJar.clear();
});

const as = (userId: string) => {
  auth.userId = userId;
};

async function leadFor(userId: string, b: Business) {
  return (await addLead(db, userId, b.id)).lead;
}

async function emailCampaign(name = "Intro", status: "running" | "completed" = "running") {
  return createEmailCampaign(db, {
    name,
    status,
    fromName: "Alex",
    fromEmail: "alex@example.com",
    dailyCap: 50,
    steps: [{ stepOrder: 1, delayDays: 0, subject: "Hi", body: "Hi" }],
  });
}

describe("AC-15.1 per-user scoping", () => {
  it("each user sees only their own leads in the page data", async () => {
    const [a1, a2, b1] = [await insertBusiness(db, { name: "Alpha" }), await insertBusiness(db, { name: "Bravo" }), await insertBusiness(db, { name: "Charlie" })];
    await leadFor(USER_A, a1);
    await leadFor(USER_A, a2);
    await leadFor(USER_B, b1);
    await leadFor(USER_B, a1);

    const va = await loadLeadsView(db, USER_A);
    const vb = await loadLeadsView(db, USER_B);
    expect(va.leads.map((l) => l.name).sort()).toEqual(["Alpha", "Bravo"]);
    expect(vb.leads.map((l) => l.name).sort()).toEqual(["Alpha", "Charlie"]);
    expect(va.metrics).toMatchObject({ total: 2, queued: 2, success: 0 });
    expect(vb.metrics.total).toBe(2);
  });

  it("the /leads page passes only the signed-in user's leads to the panel", async () => {
    const [a1, b1] = [await insertBusiness(db, { name: "Mine" }), await insertBusiness(db, { name: "Theirs" })];
    await leadFor(USER_A, a1);
    await leadFor(USER_B, b1);

    for (const [user, expected] of [
      [USER_A, ["Mine"]],
      [USER_B, ["Theirs"]],
    ] as const) {
      as(user);
      const el = (await LeadsPage()) as React.ReactElement<{ children: React.ReactNode[] }>;
      const panel = (el.props.children as React.ReactElement<{ leads: { name: string }[] }>[])[1];
      expect(panel.props.leads.map((l) => l.name)).toEqual(expected);
    }
  });

  it("user A cannot update or remove user B's lead", async () => {
    const b = await insertBusiness(db);
    const theirs = await leadFor(USER_B, b);
    as(USER_A);
    const upd = await updateLeadAction(theirs.id, { status: "success", notes: "hijack" });
    expect(upd).toEqual({ ok: false, message: "Lead not found." });
    expect(await removeLeadAction(theirs.id)).toEqual({ ok: false, message: "Lead not found." });
    const still = await getLead(db, USER_B, theirs.id);
    expect(still).toMatchObject({ status: "queued", notes: null });
  });

  it("bulk remove only removes the caller's leads", async () => {
    const [x, y] = [await insertBusiness(db), await insertBusiness(db)];
    const mine = await leadFor(USER_A, x);
    const theirs = await leadFor(USER_B, y);
    const r = await bulkRemoveLeadsAction([mine.id, theirs.id]);
    expect(r).toEqual({ ok: true, data: { removed: 1 } });
    expect(await listLeads(db, USER_A)).toHaveLength(0);
    expect(await listLeads(db, USER_B)).toHaveLength(1);
  });

  it("bulk campaign actions ignore other users' lead ids", async () => {
    const theirs = await leadFor(USER_B, await insertBusiness(db));
    const c = await createCallCampaign(db, { name: "Q", status: "running" });
    const r = await addLeadsToCallCampaignAction(c.id, [theirs.id]);
    expect(r).toEqual({ ok: false, message: "No matching leads." });
    expect((await getCampaignStats(db, c.id)).pending).toBe(0);
  });

  it("addLeadAction adds for the signed-in user only, idempotently", async () => {
    const b = await insertBusiness(db);
    const first = await addLeadAction(b.id);
    const again = await addLeadAction(b.id);
    expect(first).toMatchObject({ ok: true, data: { created: true } });
    expect(again).toMatchObject({ ok: true, data: { created: false } });
    expect(await listLeads(db, USER_A)).toHaveLength(1);
    expect(await listLeads(db, USER_B)).toHaveLength(0);
  });
});

describe("AC-15.2 status, skip, remove and notes persist", () => {
  it("status select and skip persist", async () => {
    const l = await leadFor(USER_A, await insertBusiness(db));
    expect(await updateLeadAction(l.id, { status: "contacted" })).toMatchObject({ ok: true, data: { status: "contacted" } });
    expect((await getLead(db, USER_A, l.id))?.status).toBe("contacted");
    expect(await updateLeadAction(l.id, { status: "skipped" })).toMatchObject({ ok: true });
    expect((await getLead(db, USER_A, l.id))?.status).toBe("skipped");
  });

  it("notes are trimmed, persist, and an empty string clears them", async () => {
    const l = await leadFor(USER_A, await insertBusiness(db));
    expect(await updateLeadAction(l.id, { notes: "  owner is Dana  " })).toMatchObject({ ok: true, data: { notes: "owner is Dana" } });
    expect((await getLead(db, USER_A, l.id))?.notes).toBe("owner is Dana");
    // Notes-only patch leaves status alone.
    expect((await getLead(db, USER_A, l.id))?.status).toBe("queued");
    await updateLeadAction(l.id, { notes: "   " });
    expect((await getLead(db, USER_A, l.id))?.notes).toBeNull();
  });

  it("remove persists", async () => {
    const l = await leadFor(USER_A, await insertBusiness(db));
    expect(await removeLeadAction(l.id)).toEqual({ ok: true, data: null });
    expect(await getLead(db, USER_A, l.id)).toBeNull();
  });

  it("rejects bad input without writing", async () => {
    const l = await leadFor(USER_A, await insertBusiness(db));
    expect((await updateLeadAction("not-a-uuid", { status: "success" })).ok).toBe(false);
    expect((await updateLeadAction(l.id, { status: "calling" as never })).ok).toBe(false);
    expect((await updateLeadAction(l.id, {})).ok).toBe(false);
    expect((await updateLeadAction(l.id, { notes: "x".repeat(5001) })).ok).toBe(false);
    expect((await bulkRemoveLeadsAction([])).ok).toBe(false);
    expect(await getLead(db, USER_A, l.id)).toMatchObject({ status: "queued", notes: null });
  });
});

describe("AC-15.3 bulk add to campaigns", () => {
  it("adding 2 leads grows the call queue by the new, callable businesses", async () => {
    const callable = await insertBusiness(db, { name: "Callable" });
    const alsoCallable = await insertBusiness(db, { name: "Also callable" });
    const noPhone = await insertBusiness(db, { name: "No phone", phone: null, phoneDigits: null });
    const dnc = await insertBusiness(db, { name: "DNC", doNotCall: true });
    const ls = [await leadFor(USER_A, callable), await leadFor(USER_A, alsoCallable), await leadFor(USER_A, noPhone), await leadFor(USER_A, dnc)];
    const c = await createCallCampaign(db, { name: "Houston Q4", status: "running" });
    // One business already in the queue.
    await addBusinessesToCampaign(db, c.id, [alsoCallable.id]);
    const before = (await getCampaignStats(db, c.id)).pending;

    // Select 2: both callable, one already queued → +1.
    const r1 = await addLeadsToCallCampaignAction(c.id, [ls[0].id, ls[1].id]);
    expect(r1).toEqual({ ok: true, data: { added: 1, skipped: 1, campaignName: "Houston Q4" } });
    expect((await getCampaignStats(db, c.id)).pending).toBe(before + 1);

    // The rest: no phone and do-not-call are skipped.
    const r2 = await addLeadsToCallCampaignAction(c.id, [ls[2].id, ls[3].id]);
    expect(r2).toMatchObject({ ok: true, data: { added: 0, skipped: 2 } });
    expect((await getCampaignStats(db, c.id)).pending).toBe(before + 1);
  });

  it("select 2 fresh callable leads → queue grows by 2", async () => {
    const ls = [await leadFor(USER_A, await insertBusiness(db)), await leadFor(USER_A, await insertBusiness(db))];
    const c = await createCallCampaign(db, { name: "Fresh", status: "draft" });
    expect((await getCampaignStats(db, c.id)).pending).toBe(0);
    const r = await addLeadsToCallCampaignAction(c.id, ls.map((l) => l.id));
    expect(r).toMatchObject({ ok: true, data: { added: 2, skipped: 0 } });
    expect((await getCampaignStats(db, c.id)).pending).toBe(2);
  });

  it("rejects a completed or unknown call campaign", async () => {
    const l = await leadFor(USER_A, await insertBusiness(db));
    const done = await createCallCampaign(db, { name: "Done", status: "completed" });
    expect(await addLeadsToCallCampaignAction(done.id, [l.id])).toEqual({ ok: false, message: "That campaign is completed." });
    expect(await addLeadsToCallCampaignAction("33333333-3333-4333-8333-333333333333", [l.id])).toEqual({
      ok: false,
      message: "Campaign not found.",
    });
    expect((await addLeadsToCallCampaignAction(done.id, [])).ok).toBe(false);
  });

  it("email sequence enrolls only leads whose businesses have an owner email", async () => {
    const withEmail = await insertBusiness(db, { ownerEmail: "owner@a.example" });
    const without = await insertBusiness(db, { ownerEmail: null });
    const optedOut = await insertBusiness(db, { ownerEmail: "x@b.example", doNotEmail: true });
    const ls = [await leadFor(USER_A, withEmail), await leadFor(USER_A, without), await leadFor(USER_A, optedOut)];
    const c = await emailCampaign("Intro");
    const r = await addLeadsToEmailCampaignAction(c.id, ls.map((l) => l.id));
    expect(r).toEqual({ ok: true, data: { added: 1, skipped: 2, campaignName: "Intro" } });
    expect(await listEnrolledBusinessIds(db, c.id)).toEqual([withEmail.id]);
  });

  it("rejects a completed email sequence", async () => {
    const l = await leadFor(USER_A, await insertBusiness(db, { ownerEmail: "o@x.example" }));
    const c = await emailCampaign("Old", "completed");
    expect(await addLeadsToEmailCampaignAction(c.id, [l.id])).toEqual({ ok: false, message: "That campaign is completed." });
  });

  it("a call campaign can be created from just a name, and queued leads carry their campaign", async () => {
    expect(await createCallCampaignForLeadsAction("   ")).toEqual({ ok: false, message: "Name the campaign." });
    const created = await createCallCampaignForLeadsAction("  Roofers  ");
    if (!created.ok) throw new Error(created.message);
    expect(created.data.name).toBe("Roofers");
    const queued = await leadFor(USER_A, await insertBusiness(db, { name: "Queued Co", phone: "+17135550111" }));
    const idle = await leadFor(USER_A, await insertBusiness(db, { name: "Idle Co", phone: "+17135550112" }));
    expect(await addLeadsToCallCampaignAction(created.data.id, [queued.id])).toMatchObject({ ok: true, data: { added: 1, campaignName: "Roofers" } });

    const v = await loadLeadsView(db, USER_A);
    expect(v.campaigns.call).toEqual([{ id: created.data.id, name: "Roofers", status: "draft" }]);
    expect(v.leads.find((l) => l.id === queued.id)?.callCampaigns).toEqual([{ id: created.data.id, name: "Roofers" }]);
    expect(v.leads.find((l) => l.id === idle.id)?.callCampaigns).toBeUndefined();
    // Another user's view of the same business does not exist, so nothing leaks.
    expect((await loadLeadsView(db, USER_B)).leads).toEqual([]);
  });

  it("the page's campaign targets exclude completed campaigns", async () => {
    await createCallCampaign(db, { name: "Open call", status: "running" });
    await createCallCampaign(db, { name: "Closed call", status: "completed" });
    await emailCampaign("Open mail");
    await emailCampaign("Closed mail", "completed");
    const v = await loadLeadsView(db, USER_A);
    expect(v.campaigns.call.map((c) => c.name)).toEqual(["Open call"]);
    expect(v.campaigns.email.map((c) => c.name)).toEqual(["Open mail"]);
  });
});

describe("AC-15.4 dialer outcome → lead success, and History", () => {
  it("recording `interested` in the dialer flips the lead to success and appears in History", async () => {
    const b = await insertBusiness(db, { name: "Bayou Plumbing" });
    const mine = await leadFor(USER_A, b);
    const other = await insertBusiness(db, { name: "Not my lead" });
    const c = await createCallCampaign(db, { name: "Q", status: "running" });
    // Through the leads action, as a user would.
    await addLeadsToCallCampaignAction(c.id, [mine.id]);
    await addBusinessesToCampaign(db, c.id, [other.id]);
    const items = await db.select().from(callQueueItems).where(eq(callQueueItems.campaignId, c.id));
    const itemFor = (id: string) => items.find((i) => i.businessId === id)!.id;

    cookieJar.set("crm_agent", "Sam");
    const f = new FormData();
    f.set("outcome", "interested");
    f.set("notes", "wants a demo");
    expect((await recordOutcomeAction(itemFor(b.id), null, f)).ok).toBe(true);
    const f2 = new FormData();
    f2.set("outcome", "no_answer");
    expect((await recordOutcomeAction(itemFor(other.id), null, f2)).ok).toBe(true);

    expect((await getLead(db, USER_A, mine.id))?.status).toBe("success");

    const history = await listLeadCallHistory(db, USER_A);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ businessName: "Bayou Plumbing", outcome: "interested", agent: "Sam", notes: "wants a demo" });
    expect(history[0].relative).toBe("just now");
    // User B has no leads → no history.
    expect(await listLeadCallHistory(db, USER_B)).toEqual([]);

    const v = await loadLeadsView(db, USER_A);
    expect(v.metrics).toMatchObject({ total: 1, queued: 0, success: 1, calls7d: 1 });
  });

  it("History is newest first and Calls (7d) counts only the last 7 days of call activities", async () => {
    const now = new Date("2026-11-08T12:00:00Z");
    const b = await insertBusiness(db, { name: "Lone Star" });
    await leadFor(USER_A, b);
    const day = 24 * 60 * 60 * 1000;
    await logActivity(db, { businessId: b.id, type: "call", outcome: "busy", agent: "A", occurredAt: new Date(now.getTime() - 10 * day) });
    await logActivity(db, { businessId: b.id, type: "call", outcome: "voicemail", agent: "A", occurredAt: new Date(now.getTime() - 2 * day) });
    await logActivity(db, { businessId: b.id, type: "call", outcome: "callback", agent: "A", occurredAt: new Date(now.getTime() - 3 * 60 * 60 * 1000) });
    await logActivity(db, { businessId: b.id, type: "note", body: "not a call", occurredAt: new Date(now.getTime() - 60 * 1000) });

    const h = await listLeadCallHistory(db, USER_A, { now });
    expect(h.map((x) => x.outcome)).toEqual(["callback", "voicemail", "busy"]);
    expect(h.map((x) => x.relative)).toEqual(["3 h ago", "2 d ago", "10 d ago"]);
    expect(await countLeadCallsSince(db, USER_A, new Date(now.getTime() - 7 * day))).toBe(2);
    expect((await getLeadMetrics(db, USER_A, now)).calls7d).toBe(2);
    expect((await getLeadMetrics(db, USER_B, now)).calls7d).toBe(0);
  });

  it("History for a business that is a lead for two users is listed once per user", async () => {
    const b = await insertBusiness(db);
    await leadFor(USER_A, b);
    await leadFor(USER_B, b);
    await logActivity(db, { businessId: b.id, type: "call", outcome: "busy", agent: "A" });
    expect(await listLeadCallHistory(db, USER_A)).toHaveLength(1);
    expect(await listLeadCallHistory(db, USER_B)).toHaveLength(1);
    expect(await db.select().from(leads)).toHaveLength(2);
  });
});
