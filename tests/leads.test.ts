import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { addBusinessesToCampaign, createCallCampaign, recordOutcome } from "@/db/repo/call-campaigns";
import {
  OUTCOME_TO_LEAD_STATUS,
  addLead,
  addLeads,
  countLeadsByStatus,
  getLead,
  leadBusinessIds,
  listLeads,
  removeLead,
  syncLeadStatusFromOutcome,
  updateLead,
} from "@/db/repo/leads";
import { type Business, type CallOutcome, callOutcomeEnum, callQueueItems, leads } from "@/db/schema";
import { createTestDb } from "@/db/test-utils";
import { insertBusiness } from "./helpers/builders";

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";

let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});
afterAll(async () => {
  await close();
});
beforeEach(async () => {
  await db.execute(sql`TRUNCATE TABLE businesses, leads, call_campaigns, activities RESTART IDENTITY CASCADE`);
});

async function three(): Promise<Business[]> {
  return [
    await insertBusiness(db, { name: "Bayou Plumbing", website: "https://bayouplumbing.example", primaryCategory: "plumbing" }),
    await insertBusiness(db, {
      name: "Lone Star Dental",
      categories: [{ alias: "dentists", title: "General Dentistry" }],
      primaryCategory: "dentists",
    }),
    await insertBusiness(db, { name: "Comanche Climate", slug: "comanche.example", primaryCategory: "hvac" }),
  ];
}

describe("addLead / addLeads", () => {
  it("addLead is idempotent per (user, business)", async () => {
    const [b] = await three();
    const first = await addLead(db, USER_A, b.id);
    expect(first.created).toBe(true);
    expect(first.lead.status).toBe("queued");
    const again = await addLead(db, USER_A, b.id);
    expect(again.created).toBe(false);
    expect(again.lead.id).toBe(first.lead.id);
    expect(await db.select().from(leads)).toHaveLength(1);
    // Another user gets their own lead on the same business.
    expect((await addLead(db, USER_B, b.id)).created).toBe(true);
    expect(await db.select().from(leads)).toHaveLength(2);
  });

  it("addLeads counts added and existing, ignoring duplicates, malformed and unknown ids", async () => {
    const [a, b, c] = await three();
    await addLead(db, USER_A, a.id);
    const res = await addLeads(db, USER_A, [a.id, b.id, b.id, c.id, "nope", "33333333-3333-4333-8333-333333333333"]);
    expect(res).toEqual({ added: 2, existing: 1 });
    expect((await leadBusinessIds(db, USER_A)).sort()).toEqual([a.id, b.id, c.id].sort());
    expect(await addLeads(db, USER_A, [])).toEqual({ added: 0, existing: 0 });
  });
});

describe("user scoping", () => {
  it("listLeads never shows another user's leads", async () => {
    const [a, b, c] = await three();
    await addLeads(db, USER_A, [a.id, b.id]);
    await addLeads(db, USER_B, [c.id]);
    const mine = await listLeads(db, USER_A);
    expect(mine.map((l) => l.businessId).sort()).toEqual([a.id, b.id].sort());
    expect(mine.every((l) => l.userId === USER_A)).toBe(true);
    expect(mine[0].business.name).toBeTruthy();
    const theirs = await listLeads(db, USER_B);
    expect(theirs.map((l) => l.business.id)).toEqual([c.id]);
    expect(await listLeads(db, "not-a-uuid")).toEqual([]);
  });

  it("listLeads is newest first and filters by status, q (name/slug/website) and category", async () => {
    const [a, b, c] = await three();
    const la = (await addLead(db, USER_A, a.id)).lead;
    const lb = (await addLead(db, USER_A, b.id)).lead;
    const lc = (await addLead(db, USER_A, c.id)).lead;
    await db.update(leads).set({ createdAt: new Date("2026-01-01T00:00:00Z") }).where(eq(leads.id, la.id));
    await db.update(leads).set({ createdAt: new Date("2026-01-03T00:00:00Z") }).where(eq(leads.id, lb.id));
    await db.update(leads).set({ createdAt: new Date("2026-01-02T00:00:00Z") }).where(eq(leads.id, lc.id));
    expect((await listLeads(db, USER_A)).map((l) => l.id)).toEqual([lb.id, lc.id, la.id]);

    await updateLead(db, USER_A, lb.id, { status: "callback" });
    expect((await listLeads(db, USER_A, { status: ["callback"] })).map((l) => l.id)).toEqual([lb.id]);
    expect((await listLeads(db, USER_A, { status: ["queued", "callback"] })).length).toBe(3);
    expect((await listLeads(db, USER_A, { q: "bayou" })).map((l) => l.id)).toEqual([la.id]);
    expect((await listLeads(db, USER_A, { q: "bayouplumbing.example" })).map((l) => l.id)).toEqual([la.id]);
    expect((await listLeads(db, USER_A, { q: "comanche.ex" })).map((l) => l.id)).toEqual([lc.id]);
    expect((await listLeads(db, USER_A, { category: "dentists" })).map((l) => l.id)).toEqual([lb.id]);
    expect((await listLeads(db, USER_A, { category: "hvac" })).map((l) => l.id)).toEqual([lc.id]);
  });

  it("getLead, updateLead and removeLead by another user return null/false and change nothing", async () => {
    const [a] = await three();
    const { lead } = await addLead(db, USER_A, a.id);
    expect(await getLead(db, USER_B, lead.id)).toBeNull();
    expect(await updateLead(db, USER_B, lead.id, { status: "success", notes: "hijack" })).toBeNull();
    expect(await removeLead(db, USER_B, lead.id)).toBe(false);
    const still = await getLead(db, USER_A, lead.id);
    expect(still?.status).toBe("queued");
    expect(still?.notes).toBeNull();
    expect(still?.business.id).toBe(a.id);
  });

  it("updateLead patches status and notes for the owner; removeLead deletes", async () => {
    const [a] = await three();
    const { lead } = await addLead(db, USER_A, a.id);
    const u = await updateLead(db, USER_A, lead.id, { status: "contacted", notes: "left a message" });
    expect(u?.status).toBe("contacted");
    expect(u?.notes).toBe("left a message");
    expect(u!.updatedAt.getTime()).toBeGreaterThanOrEqual(lead.updatedAt.getTime());
    expect((await updateLead(db, USER_A, lead.id, { notes: null }))?.notes).toBeNull();
    expect((await updateLead(db, USER_A, lead.id, { notes: null }))?.status).toBe("contacted");
    expect(await removeLead(db, USER_A, lead.id)).toBe(true);
    expect(await getLead(db, USER_A, lead.id)).toBeNull();
    expect(await removeLead(db, USER_A, lead.id)).toBe(false);
  });
});

describe("countLeadsByStatus", () => {
  it("counts the user's leads per status, zeros included", async () => {
    const [a, b, c] = await three();
    await addLeads(db, USER_A, [a.id, b.id, c.id]);
    await addLeads(db, USER_B, [a.id]);
    const [, lb, lc] = (await listLeads(db, USER_A)).reverse();
    await updateLead(db, USER_A, lb.id, { status: "success" });
    await updateLead(db, USER_A, lc.id, { status: "success" });
    expect(await countLeadsByStatus(db, USER_A)).toEqual({
      queued: 1,
      contacted: 0,
      callback: 0,
      success: 2,
      failed: 0,
      skipped: 0,
    });
    expect((await countLeadsByStatus(db, USER_B)).queued).toBe(1);
  });
});

describe("syncLeadStatusFromOutcome", () => {
  const EXPECTED: Record<CallOutcome, string> = {
    interested: "success",
    not_interested: "failed",
    wrong_number: "failed",
    callback: "callback",
    no_answer: "contacted",
    voicemail: "contacted",
    busy: "contacted",
    do_not_call: "skipped",
  };

  it("maps every dialer outcome per the architecture", () => {
    expect(OUTCOME_TO_LEAD_STATUS).toEqual(EXPECTED);
    expect(Object.keys(OUTCOME_TO_LEAD_STATUS).sort()).toEqual([...callOutcomeEnum.enumValues].sort());
  });

  it.each(callOutcomeEnum.enumValues)("%s updates every user's lead on that business and no other", async (outcome) => {
    const [a, b] = await three();
    await addLead(db, USER_A, a.id);
    await addLead(db, USER_B, a.id);
    await addLead(db, USER_A, b.id);
    expect(await syncLeadStatusFromOutcome(db, a.id, outcome)).toBe(2);
    const rows = await db.select().from(leads);
    for (const l of rows) expect(l.status).toBe(l.businessId === a.id ? EXPECTED[outcome] : "queued");
  });

  it("is a no-op (0) when nobody has the business as a lead", async () => {
    const [a] = await three();
    expect(await syncLeadStatusFromOutcome(db, a.id, "interested")).toBe(0);
  });
});

describe("dialer hook: recordOutcome → lead status", () => {
  it("recording an outcome updates leads on the business; no leads is a no-op", async () => {
    const [a, b] = await three();
    await addLead(db, USER_A, a.id);
    await addLead(db, USER_B, a.id);
    const campaign = await createCallCampaign(db, { name: "Test", status: "running" });
    await addBusinessesToCampaign(db, campaign.id, [a.id, b.id]);
    const items = await db.select().from(callQueueItems).where(eq(callQueueItems.campaignId, campaign.id));
    const itemFor = (id: string) => items.find((i) => i.businessId === id)!.id;

    await recordOutcome(db, itemFor(a.id), { outcome: "interested", agent: "sam" });
    expect((await db.select().from(leads)).map((l) => l.status)).toEqual(["success", "success"]);

    // No leads on b: the outcome is still recorded and no lead changes.
    const updated = await recordOutcome(db, itemFor(b.id), { outcome: "not_interested", agent: "sam" });
    expect(updated.lastOutcome).toBe("not_interested");
    expect((await db.select().from(leads)).every((l) => l.status === "success")).toBe(true);
  });
});
