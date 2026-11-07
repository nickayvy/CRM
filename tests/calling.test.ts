// WP-05 repository tests: AC-05.1 (claiming), AC-05.2 (outcomes),
// AC-05.3 (evaluation), AC-05.4 (isolation).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { fromZonedTime } from "date-fns-tz";
import type { Db } from "@/db/client";
import {
  type OutcomeInput,
  QueueItemError,
  addBusinessesToCampaign,
  claimNext,
  createCallCampaign,
  evaluateCampaign,
  getCallCampaign,
  getCampaignStats,
  getQueueItem,
  listQueue,
  pauseCampaign,
  recordOutcome,
  releaseItem,
  resumeCampaign,
} from "@/db/repo/call-campaigns";
import {
  type Business,
  type CallCampaign,
  type NewBusiness,
  type NewCallCampaign,
  activities,
  businesses,
  callQueueItems,
} from "@/db/schema";
import { createTestDb } from "@/db/test-utils";
import { normalizeName, phoneDigits } from "@/lib/format";

let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});
afterAll(async () => {
  await close();
});
beforeEach(async () => {
  await db.execute(sql`TRUNCATE TABLE call_queue_items, call_campaigns, activities, businesses RESTART IDENTITY CASCADE`);
});

// ---------------------------------------------------------------- fixtures

let seq = 0;

async function makeBusiness(overrides: Partial<NewBusiness> = {}): Promise<Business> {
  seq += 1;
  const name = overrides.name ?? `Calling Biz ${seq}`;
  const phone = overrides.phone === undefined ? `+1713555${String(1000 + seq).slice(-4)}` : overrides.phone;
  const [row] = await db
    .insert(businesses)
    .values({
      yelpId: `call-yelp-${seq}`,
      name,
      nameNormalized: normalizeName(name),
      phone,
      phoneDigits: phoneDigits(phone),
      rating: "4.5",
      reviewCount: 40,
      categories: [{ alias: "plumbing", title: "Plumbing" }],
      primaryCategory: "plumbing",
      city: "Houston",
      state: "TX",
      qualification: "qualified",
      score: 80,
      raw: {},
      ...overrides,
    })
    .returning();
  return row;
}

/** A running campaign (no hours, no cap unless overridden) with `n` fresh businesses queued in order. */
async function makeCampaign(
  n: number,
  overrides: Partial<NewCallCampaign> = {},
): Promise<{ campaign: CallCampaign; biz: Business[] }> {
  const campaign = await createCallCampaign(db, {
    name: `Campaign ${++seq}`,
    status: "running",
    timezone: "America/Chicago",
    ...overrides,
  });
  const biz: Business[] = [];
  for (let i = 0; i < n; i++) biz.push(await makeBusiness());
  await addBusinessesToCampaign(
    db,
    campaign.id,
    biz.map((b) => b.id),
  );
  return { campaign, biz };
}

function claimed(r: Awaited<ReturnType<typeof claimNext>>) {
  if (!r.ok) throw new Error(`expected a claim, got ${r.reason}`);
  return r;
}

// ---------------------------------------------------------------- AC-05.1

describe("AC-05.1 claiming", () => {
  it("hands out items in position order to different agents, then empty", async () => {
    const { campaign, biz } = await makeCampaign(3);
    const a = claimed(await claimNext(db, campaign.id, "ann"));
    const b = claimed(await claimNext(db, campaign.id, "bob"));
    const c = claimed(await claimNext(db, campaign.id, "cat"));
    expect([a.item.position, b.item.position, c.item.position]).toEqual([1, 2, 3]);
    expect([a.business.id, b.business.id, c.business.id]).toEqual(biz.map((x) => x.id));
    expect(new Set([a.item.id, b.item.id, c.item.id]).size).toBe(3);
    expect(a.item.state).toBe("claimed");
    expect(a.item.claimedBy).toBe("ann");
    // 10-minute lease
    expect(a.item.leaseExpiresAt!.getTime() - a.item.claimedAt!.getTime()).toBe(10 * 60_000);
    expect(await claimNext(db, campaign.id, "dan")).toEqual({ ok: false, reason: "empty" });
  });

  it("returns agent_limit for a third agent when maxConcurrentAgents = 2", async () => {
    const { campaign } = await makeCampaign(3, { maxConcurrentAgents: 2 });
    claimed(await claimNext(db, campaign.id, "ann"));
    claimed(await claimNext(db, campaign.id, "bob"));
    expect(await claimNext(db, campaign.id, "cat")).toEqual({ ok: false, reason: "agent_limit" });
  });

  it("re-queues an expired lease: ann's item becomes claimable by dan", async () => {
    const { campaign } = await makeCampaign(3);
    const a = claimed(await claimNext(db, campaign.id, "ann"));
    claimed(await claimNext(db, campaign.id, "bob"));
    claimed(await claimNext(db, campaign.id, "cat"));
    expect((await claimNext(db, campaign.id, "dan")).ok).toBe(false);
    await db
      .update(callQueueItems)
      .set({ leaseExpiresAt: new Date(Date.now() - 60_000) })
      .where(eq(callQueueItems.id, a.item.id));
    const d = claimed(await claimNext(db, campaign.id, "dan"));
    expect(d.item.id).toBe(a.item.id);
    expect(d.item.claimedBy).toBe("dan");
  });

  it("an expired lease does not count toward the agent limit", async () => {
    const { campaign } = await makeCampaign(3, { maxConcurrentAgents: 2 });
    const a = claimed(await claimNext(db, campaign.id, "ann"));
    claimed(await claimNext(db, campaign.id, "bob"));
    await db
      .update(callQueueItems)
      .set({ leaseExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(callQueueItems.id, a.item.id));
    const c = claimed(await claimNext(db, campaign.id, "cat"));
    expect(c.item.id).toBe(a.item.id);
  });

  it("an agent who already holds a live claim gets the same item back", async () => {
    const { campaign } = await makeCampaign(3);
    const first = claimed(await claimNext(db, campaign.id, "ann"));
    const again = claimed(await claimNext(db, campaign.id, "ann"));
    expect(again.item.id).toBe(first.item.id);
    const bob = claimed(await claimNext(db, campaign.id, "bob"));
    expect(bob.item.position).toBe(2);
  });

  it("returns the campaign status for draft, paused and completed campaigns", async () => {
    const { campaign: draft } = await makeCampaign(1, { status: "draft" });
    expect(await claimNext(db, draft.id, "ann")).toEqual({ ok: false, reason: "draft" });
    const { campaign: paused } = await makeCampaign(1, { status: "paused", pauseReason: "manual" });
    expect(await claimNext(db, paused.id, "ann")).toEqual({ ok: false, reason: "paused", pauseReason: "manual" });
    const { campaign: done } = await makeCampaign(0, { status: "completed" });
    expect(await claimNext(db, done.id, "ann")).toEqual({ ok: false, reason: "completed" });
  });

  it("skip (releaseItem) moves the item to the end of the queue", async () => {
    const { campaign } = await makeCampaign(3);
    const a = claimed(await claimNext(db, campaign.id, "ann"));
    await releaseItem(db, a.item.id);
    const released = await getQueueItem(db, a.item.id);
    expect(released).toMatchObject({ state: "pending", position: 4, claimedBy: null, leaseExpiresAt: null });
    const next = claimed(await claimNext(db, campaign.id, "ann"));
    expect(next.item.position).toBe(2);
  });

  it("addBusinessesToCampaign skips duplicates, do-not-call and phoneless businesses", async () => {
    const { campaign, biz } = await makeCampaign(2);
    const dnc = await makeBusiness({ doNotCall: true });
    const noPhone = await makeBusiness({ phone: null });
    const fresh = await makeBusiness();
    const r = await addBusinessesToCampaign(db, campaign.id, [biz[0].id, dnc.id, noPhone.id, fresh.id, fresh.id]);
    expect(r).toEqual({ added: 1, skipped: 3 });
    const q = await listQueue(db, campaign.id);
    expect(q.total).toBe(3);
    expect(q.rows.map((x) => x.business.id)).toEqual([biz[0].id, biz[1].id, fresh.id]);
    expect(q.rows.map((x) => x.position)).toEqual([1, 2, 3]);
  });
});

// ---------------------------------------------------------------- helpers (AC-05.2+)

const CT = "America/Chicago";
/** Exact instant for a Chicago wall-clock time, e.g. at("2026-03-10T11:00:00"). */
const at = (local: string) => fromZonedTime(local, CT);

async function bizRow(id: string): Promise<Business> {
  const [row] = await db.select().from(businesses).where(eq(businesses.id, id));
  return row;
}

async function itemFor(campaignId: string, businessId: string) {
  const { rows } = await listQueue(db, campaignId);
  const row = rows.find((r) => r.businessId === businessId);
  if (!row) throw new Error("no queue item for that business in that campaign");
  return row;
}

async function maxPosition(campaignId: string): Promise<number> {
  const { rows } = await listQueue(db, campaignId);
  return Math.max(...rows.map((r) => r.position));
}

/** Records an outcome for `businessId`'s item in `campaignId`. */
async function record(
  campaignId: string,
  businessId: string,
  outcome: OutcomeInput["outcome"],
  now: Date,
  extra: Partial<OutcomeInput> = {},
) {
  const item = await itemFor(campaignId, businessId);
  return recordOutcome(db, item.id, { outcome, agent: "ann", ...extra }, now);
}

// ---------------------------------------------------------------- AC-05.2

describe("AC-05.2 outcomes", () => {
  const T = at("2026-03-10T11:00:00");

  it("no_answer x3 with maxAttempts 3: pending (moved to the back) twice, then skipped", async () => {
    const { campaign, biz } = await makeCampaign(3, { maxAttempts: 3 });
    const target = biz[0];
    expect((await bizRow(target.id)).status).toBe("new");

    let max = await maxPosition(campaign.id);
    const first = await record(campaign.id, target.id, "no_answer", T);
    expect(first).toMatchObject({ state: "pending", attempts: 1, lastOutcome: "no_answer", position: max + 1 });
    let b = await bizRow(target.id);
    expect(b.status).toBe("contacted");
    expect(b.lastContactedAt?.getTime()).toBe(T.getTime());

    max = await maxPosition(campaign.id);
    const second = await record(campaign.id, target.id, "no_answer", T);
    expect(second).toMatchObject({ state: "pending", attempts: 2, position: max + 1 });

    const third = await record(campaign.id, target.id, "no_answer", T);
    expect(third).toMatchObject({ state: "skipped", attempts: 3 });
    b = await bizRow(target.id);
    expect(b.status).toBe("contacted");
    expect(b.lastContactedAt?.getTime()).toBe(T.getTime());
    // a skipped item can no longer take an outcome
    await expect(record(campaign.id, target.id, "no_answer", T)).rejects.toMatchObject({ code: "finished" });
  });

  it("interested completes the item and sets the business to interested", async () => {
    const { campaign, biz } = await makeCampaign(2);
    const item = await record(campaign.id, biz[0].id, "interested", T);
    expect(item.state).toBe("completed");
    const b = await bizRow(biz[0].id);
    expect(b.status).toBe("interested");
    expect(b.lastContactedAt?.getTime()).toBe(T.getTime());
  });

  it("not_interested completes the item and sets the business to not_interested", async () => {
    const { campaign, biz } = await makeCampaign(2);
    const item = await record(campaign.id, biz[0].id, "not_interested", T);
    expect(item.state).toBe("completed");
    expect((await bizRow(biz[0].id)).status).toBe("not_interested");
  });

  it("wrong_number completes the item and tags the business wrong_number (once)", async () => {
    const { campaign, biz } = await makeCampaign(2);
    const other = await makeCampaign(0);
    await addBusinessesToCampaign(db, other.campaign.id, [biz[0].id]);
    const item = await record(campaign.id, biz[0].id, "wrong_number", T);
    expect(item.state).toBe("completed");
    expect((await bizRow(biz[0].id)).tags).toEqual(["wrong_number"]);
    // a second wrong_number elsewhere does not duplicate the tag
    await record(other.campaign.id, biz[0].id, "wrong_number", T);
    expect((await bizRow(biz[0].id)).tags).toEqual(["wrong_number"]);
  });

  it("callback sets callbackAt on the item, and status + nextFollowUpAt on the business", async () => {
    const { campaign, biz } = await makeCampaign(2);
    const callbackAt = at("2026-03-10T15:00:00");
    const item = await record(campaign.id, biz[0].id, "callback", T, { callbackAt });
    expect(item.state).toBe("callback");
    expect(item.callbackAt?.getTime()).toBe(callbackAt.getTime());
    const b = await bizRow(biz[0].id);
    expect(b.status).toBe("callback");
    expect(b.nextFollowUpAt?.getTime()).toBe(callbackAt.getTime());
  });

  it("callback without callbackAt throws and changes nothing", async () => {
    const { campaign, biz } = await makeCampaign(1);
    const item = await itemFor(campaign.id, biz[0].id);
    const p = recordOutcome(db, item.id, { outcome: "callback", agent: "ann" }, T);
    await expect(p).rejects.toBeInstanceOf(QueueItemError);
    await expect(p).rejects.toMatchObject({ code: "callback_required" });
    expect((await getQueueItem(db, item.id))?.state).toBe("pending");
    expect(await db.select().from(activities)).toHaveLength(0);
    expect((await bizRow(biz[0].id)).status).toBe("new");
  });

  it("a callback item is not claimable before callbackAt, and is claimed first once due", async () => {
    const { campaign, biz } = await makeCampaign(3);
    const callbackAt = at("2026-03-10T15:00:00");
    // the LAST item asks for a callback; positions 1 and 2 stay pending
    const cb = await record(campaign.id, biz[2].id, "callback", T, { callbackAt });

    const before = claimed(await claimNext(db, campaign.id, "ann", at("2026-03-10T14:59:00")));
    expect(before.item.id).not.toBe(cb.id);
    expect(before.item.position).toBe(1);
    expect((await getQueueItem(db, cb.id))?.state).toBe("callback");

    // at/after callbackAt it jumps ahead of the pending item with the lower position
    const due = claimed(await claimNext(db, campaign.id, "bob", callbackAt));
    expect(due.item.id).toBe(cb.id);
    expect(due.item.state).toBe("claimed");
    expect(due.business.id).toBe(biz[2].id);
    // and the pending item at position 2 is still there for the next agent
    const next = claimed(await claimNext(db, campaign.id, "cat", callbackAt));
    expect(next.item.position).toBe(2);
  });

  it("a campaign whose only item is a future callback has nothing to claim until it is due", async () => {
    const { campaign, biz } = await makeCampaign(1);
    const callbackAt = at("2026-03-10T15:00:00");
    const cb = await record(campaign.id, biz[0].id, "callback", T, { callbackAt });
    const early = await claimNext(db, campaign.id, "ann", at("2026-03-10T12:00:00"));
    expect(early.ok).toBe(false);
    const due = claimed(await claimNext(db, campaign.id, "ann", at("2026-03-10T15:00:01")));
    expect(due.item.id).toBe(cb.id);
  });

  it("do_not_call flags the business, completes the item and deletes its pending item in other campaigns", async () => {
    const { campaign: a, biz } = await makeCampaign(2);
    const { campaign: b } = await makeCampaign(1);
    const shared = biz[0];
    await addBusinessesToCampaign(db, b.id, [shared.id]);
    const bCopy = await itemFor(b.id, shared.id);
    expect(bCopy.state).toBe("pending");

    const item = await record(a.id, shared.id, "do_not_call", T);
    expect(item.state).toBe("completed");
    const biz0 = await bizRow(shared.id);
    expect(biz0.doNotCall).toBe(true);
    expect(biz0.status).toBe("do_not_call");

    expect(await getQueueItem(db, bCopy.id)).toBeNull();
    const bQueue = await listQueue(db, b.id);
    expect(bQueue.rows.some((r) => r.businessId === shared.id)).toBe(false);
    // the other campaign's unrelated item is untouched, and A keeps its own history row
    expect(bQueue.total).toBe(1);
    expect((await getQueueItem(db, item.id))?.state).toBe("completed");
  });

  it("do_not_call also deletes the business's callback-state item in another campaign", async () => {
    const { campaign: a, biz } = await makeCampaign(1);
    const { campaign: c } = await makeCampaign(0);
    const shared = biz[0];
    await addBusinessesToCampaign(db, c.id, [shared.id]);
    const cb = await record(c.id, shared.id, "callback", T, { callbackAt: at("2026-03-12T10:00:00") });
    expect(cb.state).toBe("callback");

    await record(a.id, shared.id, "do_not_call", T);
    expect(await getQueueItem(db, cb.id)).toBeNull();
    expect((await bizRow(shared.id)).doNotCall).toBe(true);
  });

  it.each(["no_answer", "voicemail", "busy", "interested", "not_interested", "callback", "wrong_number", "do_not_call"] as const)(
    "%s writes exactly one call activity with outcome, agent, campaign and notes",
    async (outcome) => {
      const { campaign, biz } = await makeCampaign(2);
      const notes = `notes for ${outcome}`;
      await record(campaign.id, biz[0].id, outcome, T, {
        notes,
        agent: "dana",
        ...(outcome === "callback" ? { callbackAt: at("2026-03-11T09:00:00") } : {}),
      });
      const rows = await db.select().from(activities).where(eq(activities.businessId, biz[0].id));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        type: "call",
        outcome,
        agent: "dana",
        campaignType: "call",
        campaignId: campaign.id,
        body: notes,
      });
      expect(rows[0].occurredAt.getTime()).toBe(T.getTime());
      // other businesses got nothing
      expect(await db.select().from(activities)).toHaveLength(1);
    },
  );
});

// ---------------------------------------------------------------- AC-05.3

describe("AC-05.3 evaluation", () => {
  it("dailyCap 2: paused daily_cap after two outcomes today, running again the next local day", async () => {
    const { campaign, biz } = await makeCampaign(5, { dailyCap: 2 });
    const today = at("2026-03-10T11:00:00");

    expect((await evaluateCampaign(db, campaign.id, today)).status).toBe("running");
    await record(campaign.id, biz[0].id, "interested", today);
    expect((await evaluateCampaign(db, campaign.id, today)).status).toBe("running"); // 1 < cap
    await record(campaign.id, biz[1].id, "not_interested", today);

    const capped = await evaluateCampaign(db, campaign.id, today);
    expect(capped).toMatchObject({ status: "paused", pauseReason: "daily_cap" });
    expect((await getCallCampaign(db, campaign.id))?.pauseReason).toBe("daily_cap");
    // items remain, so the cap (not exhaustion) is why it is paused
    expect(await claimNext(db, campaign.id, "ann", today)).toEqual({ ok: false, reason: "paused", pauseReason: "daily_cap" });

    const tomorrow = await evaluateCampaign(db, campaign.id, at("2026-03-11T11:00:00"));
    expect(tomorrow).toMatchObject({ status: "running", pauseReason: null });
    expect(await getCallCampaign(db, campaign.id)).toMatchObject({ status: "running", pauseReason: null });
  });

  it("'today' is the campaign's local day, not the UTC day", async () => {
    // 23:30 local is 04:30Z the next UTC day; 00:10 local is 05:10Z — same UTC day, different local day.
    const late = await makeCampaign(4, { dailyCap: 2 });
    const t2330 = at("2026-03-10T23:30:00");
    await record(late.campaign.id, late.biz[0].id, "interested", t2330);
    await record(late.campaign.id, late.biz[1].id, "interested", t2330);
    expect(t2330.toISOString().slice(0, 10)).toBe("2026-03-11"); // UTC already rolled over
    expect(await evaluateCampaign(db, late.campaign.id, at("2026-03-10T23:50:00"))).toMatchObject({
      status: "paused",
      pauseReason: "daily_cap",
    });
    // UTC-day logic would still say "today" here; the local day has changed
    expect(await evaluateCampaign(db, late.campaign.id, at("2026-03-11T00:10:00"))).toMatchObject({
      status: "running",
      pauseReason: null,
    });

    // Opposite direction: UTC day changes between the outcomes and the check, the local day does not.
    const early = await makeCampaign(4, { dailyCap: 2 });
    const t1830 = at("2026-03-10T18:30:00"); // 23:30Z on the 10th
    await record(early.campaign.id, early.biz[0].id, "interested", t1830);
    await record(early.campaign.id, early.biz[1].id, "interested", t1830);
    const t1930 = at("2026-03-10T19:30:00"); // 00:30Z on the 11th
    expect(t1930.toISOString().slice(0, 10)).toBe("2026-03-11");
    expect(await evaluateCampaign(db, early.campaign.id, t1930)).toMatchObject({
      status: "paused",
      pauseReason: "daily_cap",
    });
  });

  it("calling hours 09:00-17:00: outside_hours before 09:00, running at 09:00, paused again at 17:00 (end exclusive)", async () => {
    const { campaign } = await makeCampaign(3, { callingHoursStart: "09:00", callingHoursEnd: "17:00" });
    expect(await evaluateCampaign(db, campaign.id, at("2026-03-10T08:00:00"))).toMatchObject({
      status: "paused",
      pauseReason: "outside_hours",
    });
    expect(await evaluateCampaign(db, campaign.id, at("2026-03-10T09:00:00"))).toMatchObject({
      status: "running",
      pauseReason: null,
    });
    expect(await evaluateCampaign(db, campaign.id, at("2026-03-10T16:59:00"))).toMatchObject({ status: "running" });
    expect(await evaluateCampaign(db, campaign.id, at("2026-03-10T17:00:00"))).toMatchObject({
      status: "paused",
      pauseReason: "outside_hours",
    });
    // claimNext reports the same reason
    expect(await claimNext(db, campaign.id, "ann", at("2026-03-10T17:00:00"))).toEqual({
      ok: false,
      reason: "paused",
      pauseReason: "outside_hours",
    });
  });

  it("calling hours are read in the campaign timezone (09:00 Chicago is not 09:00 UTC)", async () => {
    const { campaign } = await makeCampaign(1, { callingHoursStart: "09:00", callingHoursEnd: "17:00" });
    // 09:00Z on 2026-03-10 is 04:00 in Chicago -> outside hours
    expect(await evaluateCampaign(db, campaign.id, new Date("2026-03-10T09:00:00Z"))).toMatchObject({
      status: "paused",
      pauseReason: "outside_hours",
    });
  });

  it("manual pause survives evaluation (inside hours, under cap, items available); resume runs it", async () => {
    const { campaign } = await makeCampaign(3, {
      dailyCap: 10,
      callingHoursStart: "09:00",
      callingHoursEnd: "17:00",
    });
    const noon = at("2026-03-10T12:00:00");
    await pauseCampaign(db, campaign.id, noon);
    expect(await getCallCampaign(db, campaign.id)).toMatchObject({ status: "paused", pauseReason: "manual" });

    expect(await evaluateCampaign(db, campaign.id, noon)).toMatchObject({ status: "paused", pauseReason: "manual" });
    expect(await evaluateCampaign(db, campaign.id, at("2026-03-11T12:00:00"))).toMatchObject({
      status: "paused",
      pauseReason: "manual",
    });
    expect(await claimNext(db, campaign.id, "ann", noon)).toEqual({ ok: false, reason: "paused", pauseReason: "manual" });

    await resumeCampaign(db, campaign.id, noon);
    expect(await getCallCampaign(db, campaign.id)).toMatchObject({ status: "running", pauseReason: null });
    claimed(await claimNext(db, campaign.id, "ann", noon));
  });

  it("completes when no item is available and no callback is pending", async () => {
    const { campaign, biz } = await makeCampaign(2);
    const now = at("2026-03-10T11:00:00");
    await record(campaign.id, biz[0].id, "interested", now);
    expect((await evaluateCampaign(db, campaign.id, now)).status).toBe("running"); // one item left
    await record(campaign.id, biz[1].id, "not_interested", now);
    expect(await evaluateCampaign(db, campaign.id, now)).toMatchObject({ status: "completed", pauseReason: null });
    expect(await claimNext(db, campaign.id, "ann", now)).toEqual({ ok: false, reason: "completed" });
  });

  it("one future callback and nothing else: paused exhausted; running again at the callback time, which then claims it", async () => {
    const { campaign, biz } = await makeCampaign(2);
    const now = at("2026-03-10T11:00:00");
    const callbackAt = at("2026-03-10T15:00:00");
    await record(campaign.id, biz[0].id, "interested", now);
    const cb = await record(campaign.id, biz[1].id, "callback", now, { callbackAt });

    expect(await evaluateCampaign(db, campaign.id, now)).toMatchObject({ status: "paused", pauseReason: "exhausted" });
    expect(await claimNext(db, campaign.id, "ann", at("2026-03-10T14:59:00"))).toEqual({
      ok: false,
      reason: "paused",
      pauseReason: "exhausted",
    });

    expect(await evaluateCampaign(db, campaign.id, callbackAt)).toMatchObject({ status: "running", pauseReason: null });
    const r = claimed(await claimNext(db, campaign.id, "ann", callbackAt));
    expect(r.item.id).toBe(cb.id);
    expect(r.business.id).toBe(biz[1].id);
  });
});

// ---------------------------------------------------------------- AC-05.4

describe("AC-05.4 isolation", () => {
  const T = at("2026-03-10T11:00:00");

  it("claiming everything on A never touches B, even for a business in both campaigns", async () => {
    const { campaign: a, biz: aBiz } = await makeCampaign(2);
    const { campaign: b, biz: bBiz } = await makeCampaign(2);
    const shared = await makeBusiness();
    await addBusinessesToCampaign(db, a.id, [shared.id]);
    await addBusinessesToCampaign(db, b.id, [shared.id]);

    const seen: string[] = [];
    for (let i = 0; i < 10; i++) {
      const r = await claimNext(db, a.id, `agent${i}`, T);
      if (!r.ok) {
        expect(r.reason).toBe("empty");
        break;
      }
      expect(r.item.campaignId).toBe(a.id);
      seen.push(r.business.id);
    }
    expect(seen.sort()).toEqual([...aBiz.map((x) => x.id), shared.id].sort());

    const bQueue = await listQueue(db, b.id);
    expect(bQueue.total).toBe(3);
    expect(bQueue.rows.every((r) => r.state === "pending" && r.claimedBy === null)).toBe(true);
    expect(bQueue.rows.map((r) => r.businessId).sort()).toEqual([...bBiz.map((x) => x.id), shared.id].sort());
    // and B can still hand out its own copy of the shared business
    const bClaim = claimed(await claimNext(db, b.id, "zed", T));
    expect(bClaim.item.campaignId).toBe(b.id);
  });

  it("stats are per campaign: an outcome on A's copy of a shared business leaves B unchanged", async () => {
    const { campaign: a } = await makeCampaign(2);
    const { campaign: b } = await makeCampaign(2);
    const shared = await makeBusiness();
    await addBusinessesToCampaign(db, a.id, [shared.id]);
    await addBusinessesToCampaign(db, b.id, [shared.id]);

    const zero = { pending: 0, claimed: 0, completed: 0, skipped: 0, callback: 0, completedToday: 0, activeAgents: 0 };
    expect(await getCampaignStats(db, a.id, T)).toEqual({ ...zero, pending: 3 });
    expect(await getCampaignStats(db, b.id, T)).toEqual({ ...zero, pending: 3 });

    // A: ann and bob hold claims on its first two items
    const annClaim = claimed(await claimNext(db, a.id, "ann", T));
    claimed(await claimNext(db, a.id, "bob", T));
    expect(await getCampaignStats(db, a.id, T)).toEqual({ ...zero, pending: 1, claimed: 2, activeAgents: 2 });
    expect(await getCampaignStats(db, b.id, T)).toEqual({ ...zero, pending: 3 });

    // outcome on A's copy of the shared business (still pending, third in A)
    await record(a.id, shared.id, "interested", T);
    expect(await getCampaignStats(db, a.id, T)).toEqual({
      ...zero,
      claimed: 2,
      completed: 1,
      completedToday: 1,
      activeAgents: 2,
    });
    expect(await getCampaignStats(db, b.id, T)).toEqual({ ...zero, pending: 3 });
    expect((await itemFor(b.id, shared.id)).state).toBe("pending");

    // a callback on A's claimed item also stays on A
    await recordOutcome(
      db,
      annClaim.item.id,
      { outcome: "callback", agent: "ann", callbackAt: at("2026-03-10T15:00:00") },
      T,
    );
    const aStats = await getCampaignStats(db, a.id, T);
    expect(aStats).toMatchObject({ callback: 1, claimed: 1, completed: 1, completedToday: 2, activeAgents: 1 });
    expect(await getCampaignStats(db, b.id, T)).toEqual({ ...zero, pending: 3 });
  });
});
