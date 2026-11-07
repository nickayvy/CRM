// WP-05 repository tests: AC-05.1 (claiming), AC-05.2 (outcomes),
// AC-05.3 (evaluation), AC-05.4 (isolation).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import {
  addBusinessesToCampaign,
  claimNext,
  createCallCampaign,
  evaluateCampaign,
  getCallCampaign,
  getCampaignStats,
  getQueueItem,
  listQueue,
  recordOutcome,
  releaseItem,
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

// Keep imports used until the remaining AC sections land.
void [evaluateCampaign, getCallCampaign, getCampaignStats, recordOutcome, activities];
