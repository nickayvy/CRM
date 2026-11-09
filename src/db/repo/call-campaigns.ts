// Call campaigns: queue, claim path, outcomes and the pause/resume automation.
// See architecture.md §Campaign automation and concurrency.
import { and, asc, count, desc, eq, gt, gte, inArray, isNotNull, lt, lte, ne, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { isWithinHours, localDayBounds } from "@/features/calling/time";
import type { Schema } from "../client";
import { syncLeadStatusFromOutcome } from "./leads";
import {
  type Business,
  type CallCampaign,
  type CallOutcome,
  type CallQueueItem,
  type NewCallCampaign,
  type PauseReason,
  type QueueState,
  activities,
  businesses,
  callCampaigns,
  callQueueItems,
} from "../schema";

/** A Db or an open transaction on one. Every function here accepts either. */
export type DbOrTx = PgDatabase<PgQueryResultHKT, Schema>;

/** Claim lease length. An unfinished claim becomes claimable again after this. */
export const LEASE_MINUTES = 10;

export type CampaignStats = {
  pending: number;
  claimed: number;
  completed: number;
  skipped: number;
  callback: number;
  completedToday: number;
  activeAgents: number;
};

export type ClaimResult =
  | { ok: true; item: CallQueueItem; business: Business }
  | { ok: false; reason: "paused" | "completed" | "draft" | "empty" | "agent_limit"; pauseReason?: PauseReason };

export type OutcomeInput = { outcome: CallOutcome; notes?: string; callbackAt?: Date; agent: string };

export type QueueRow = CallQueueItem & { business: Business };

/** Thrown by recordOutcome when the item cannot take an outcome (finished, or held by another agent). */
export class QueueItemError extends Error {
  constructor(
    message: string,
    readonly code: "not_found" | "finished" | "claimed_by_other" | "callback_required",
  ) {
    super(message);
    this.name = "QueueItemError";
  }
}

function rowsOf<T>(res: unknown): T[] {
  if (Array.isArray(res)) return res as T[];
  return ((res as { rows?: T[] }).rows ?? []) as T[];
}

const iso = (d: Date) => sql`${d.toISOString()}::timestamptz`;

// ------------------------------------------------------------------ campaigns

export async function createCallCampaign(db: DbOrTx, input: NewCallCampaign): Promise<CallCampaign> {
  const [row] = await db.insert(callCampaigns).values(input).returning();
  return row;
}

export async function updateCallCampaign(
  db: DbOrTx,
  id: string,
  patch: Partial<Omit<NewCallCampaign, "id" | "createdAt">>,
): Promise<CallCampaign | null> {
  const [row] = await db
    .update(callCampaigns)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(callCampaigns.id, id))
    .returning();
  return row ?? null;
}

export async function getCallCampaign(db: DbOrTx, id: string): Promise<CallCampaign | null> {
  const [row] = await db.select().from(callCampaigns).where(eq(callCampaigns.id, id));
  return row ?? null;
}

/** Newest first, each with its stats. */
export async function listCallCampaigns(db: DbOrTx, now: Date = new Date()): Promise<(CallCampaign & CampaignStats)[]> {
  const rows = await db.select().from(callCampaigns).orderBy(desc(callCampaigns.createdAt), asc(callCampaigns.id));
  return Promise.all(rows.map(async (c) => ({ ...c, ...(await statsFor(db, c, now)) })));
}

export async function getCampaignStats(db: DbOrTx, id: string, now: Date = new Date()): Promise<CampaignStats> {
  const c = await getCallCampaign(db, id);
  if (!c) return { pending: 0, claimed: 0, completed: 0, skipped: 0, callback: 0, completedToday: 0, activeAgents: 0 };
  return statsFor(db, c, now);
}

async function statsFor(db: DbOrTx, c: CallCampaign, now: Date): Promise<CampaignStats> {
  const [byState, completedToday, activeAgents] = await Promise.all([
    db
      .select({ state: callQueueItems.state, n: count() })
      .from(callQueueItems)
      .where(eq(callQueueItems.campaignId, c.id))
      .groupBy(callQueueItems.state),
    countCompletedToday(db, c, now),
    countActiveAgents(db, c.id, now),
  ]);
  const by = Object.fromEntries(byState.map((r) => [r.state, Number(r.n)])) as Partial<Record<QueueState, number>>;
  return {
    pending: by.pending ?? 0,
    claimed: by.claimed ?? 0,
    completed: by.completed ?? 0,
    skipped: by.skipped ?? 0,
    callback: by.callback ?? 0,
    completedToday,
    activeAgents,
  };
}

/** Items whose last outcome was recorded on the campaign's local calendar day of `now`. */
async function countCompletedToday(db: DbOrTx, c: CallCampaign, now: Date): Promise<number> {
  const { start, end } = localDayBounds(now, c.timezone);
  const [row] = await db
    .select({ n: count() })
    .from(callQueueItems)
    .where(
      and(
        eq(callQueueItems.campaignId, c.id),
        inArray(callQueueItems.state, ["completed", "skipped", "pending", "callback"]),
        gte(callQueueItems.lastOutcomeAt, start),
        lt(callQueueItems.lastOutcomeAt, end),
      ),
    );
  return Number(row?.n ?? 0);
}

/** Distinct agents holding an unexpired claim, optionally ignoring one agent. */
async function countActiveAgents(db: DbOrTx, campaignId: string, now: Date, exceptAgent?: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(DISTINCT ${callQueueItems.claimedBy})` })
    .from(callQueueItems)
    .where(
      and(
        eq(callQueueItems.campaignId, campaignId),
        eq(callQueueItems.state, "claimed"),
        gt(callQueueItems.leaseExpiresAt, now),
        isNotNull(callQueueItems.claimedBy),
        exceptAgent !== undefined ? ne(callQueueItems.claimedBy, exceptAgent) : undefined,
      ),
    );
  return Number(row?.n ?? 0);
}

/** Items matching the claim predicate (what claimNext could hand out right now). */
async function countAvailable(db: DbOrTx, campaignId: string, now: Date): Promise<number> {
  const res = await db.execute(sql`
    SELECT count(*)::int AS n FROM call_queue_items
    WHERE campaign_id = ${campaignId} AND (
          state = 'pending'
       OR (state = 'claimed' AND lease_expires_at < ${iso(now)})
       OR (state = 'callback' AND callback_at <= ${iso(now)}))`);
  return Number(rowsOf<{ n: number }>(res)[0]?.n ?? 0);
}

// ------------------------------------------------------------------ queue

/**
 * Appends businesses to the end of the queue in the given order. Skips ids
 * already in this campaign, do-not-call businesses, businesses without a
 * phone, and unknown ids. A completed campaign that receives new items goes
 * back to running.
 */
export async function addBusinessesToCampaign(
  db: DbOrTx,
  id: string,
  businessIds: string[],
): Promise<{ added: number; skipped: number }> {
  const unique = [...new Set(businessIds)];
  if (unique.length === 0) return { added: 0, skipped: 0 };
  return db.transaction(async (tx) => {
    const eligible = new Set<string>();
    for (let i = 0; i < unique.length; i += 1000) {
      const chunk = unique.slice(i, i + 1000);
      const rows = await tx
        .select({ id: businesses.id })
        .from(businesses)
        .where(
          and(
            inArray(businesses.id, chunk),
            eq(businesses.doNotCall, false),
            isNotNull(businesses.phoneDigits),
            sql`NOT EXISTS (SELECT 1 FROM call_queue_items q WHERE q.campaign_id = ${id} AND q.business_id = ${businesses.id})`,
          ),
        );
      for (const r of rows) eligible.add(r.id);
    }
    const ordered = unique.filter((b) => eligible.has(b));
    let added = 0;
    if (ordered.length) {
      const start = await maxPosition(tx, id);
      const now = new Date();
      for (let i = 0; i < ordered.length; i += 1000) {
        const inserted = await tx
          .insert(callQueueItems)
          .values(
            ordered.slice(i, i + 1000).map((businessId, j) => ({
              campaignId: id,
              businessId,
              position: start + i + j + 1,
              createdAt: now,
              updatedAt: now,
            })),
          )
          .onConflictDoNothing()
          .returning({ id: callQueueItems.id });
        added += inserted.length;
      }
      if (added > 0) {
        await tx
          .update(callCampaigns)
          .set({ status: "running", pauseReason: null, pausedAt: null, updatedAt: now })
          .where(and(eq(callCampaigns.id, id), eq(callCampaigns.status, "completed")));
      }
    }
    return { added, skipped: unique.length - added };
  });
}

/** How many of `businessIds` addBusinessesToCampaign would add (not queued here, not do-not-call, has a phone). */
export async function countAddable(db: DbOrTx, id: string, businessIds: string[]): Promise<number> {
  const unique = [...new Set(businessIds)];
  let n = 0;
  for (let i = 0; i < unique.length; i += 1000) {
    const [row] = await db
      .select({ n: count() })
      .from(businesses)
      .where(
        and(
          inArray(businesses.id, unique.slice(i, i + 1000)),
          eq(businesses.doNotCall, false),
          isNotNull(businesses.phoneDigits),
          sql`NOT EXISTS (SELECT 1 FROM call_queue_items q WHERE q.campaign_id = ${id} AND q.business_id = ${businesses.id})`,
        ),
      );
    n += Number(row?.n ?? 0);
  }
  return n;
}

async function maxPosition(db: DbOrTx, campaignId: string): Promise<number> {
  const [row] = await db
    .select({ m: sql<number | null>`max(${callQueueItems.position})` })
    .from(callQueueItems)
    .where(eq(callQueueItems.campaignId, campaignId));
  return Number(row?.m ?? 0);
}

/** Removes a pending item from its queue (claimed or finished items are kept for history). */
export async function removeQueueItem(db: DbOrTx, itemId: string): Promise<void> {
  await db.delete(callQueueItems).where(and(eq(callQueueItems.id, itemId), eq(callQueueItems.state, "pending")));
}

export async function getQueueItem(db: DbOrTx, itemId: string): Promise<CallQueueItem | null> {
  const [row] = await db.select().from(callQueueItems).where(eq(callQueueItems.id, itemId));
  return row ?? null;
}

/** Queue in position order with the business joined. */
export async function listQueue(
  db: DbOrTx,
  id: string,
  opts: { state?: QueueState[]; limit?: number; offset?: number } = {},
): Promise<{ rows: QueueRow[]; total: number }> {
  const where = and(
    eq(callQueueItems.campaignId, id),
    opts.state?.length ? inArray(callQueueItems.state, opts.state) : undefined,
  );
  const limit = Math.max(0, Math.min(opts.limit ?? 100, 1000));
  const offset = Math.max(0, opts.offset ?? 0);
  const [rows, [{ n }]] = await Promise.all([
    db
      .select({ item: callQueueItems, business: businesses })
      .from(callQueueItems)
      .innerJoin(businesses, eq(businesses.id, callQueueItems.businessId))
      .where(where)
      .orderBy(asc(callQueueItems.position), asc(callQueueItems.id))
      .limit(limit)
      .offset(offset),
    db.select({ n: count() }).from(callQueueItems).where(where),
  ]);
  return { rows: rows.map((r) => ({ ...r.item, business: r.business })), total: Number(n) };
}

// ------------------------------------------------------------------ automation

/**
 * Applies the pause/resume/complete rules to one campaign at `now` and
 * persists any status change. Draft, completed and manually paused campaigns
 * are returned unchanged. A paused campaign with `autoResume` is re-checked
 * as if it were running, so it resumes, switches to a different pause reason,
 * or completes.
 */
export async function evaluateCampaign(db: DbOrTx, id: string, now: Date = new Date()): Promise<CallCampaign> {
  const c = await getCallCampaign(db, id);
  if (!c) throw new Error(`Call campaign ${id} not found`);
  if (c.status !== "running" && c.status !== "paused") return c;
  if (c.status === "paused" && (c.pauseReason === "manual" || c.pauseReason === null)) return c;
  if (c.status === "paused" && !c.autoResume) return c;

  const next = await targetStatus(db, c, now);
  if (next.status === c.status && next.pauseReason === c.pauseReason) return c;
  const [row] = await db
    .update(callCampaigns)
    .set({
      status: next.status,
      pauseReason: next.pauseReason,
      pausedAt: next.status === "paused" ? (c.status === "paused" ? (c.pausedAt ?? now) : now) : null,
      updatedAt: now,
    })
    .where(eq(callCampaigns.id, id))
    .returning();
  return row;
}

async function targetStatus(
  db: DbOrTx,
  c: CallCampaign,
  now: Date,
): Promise<{ status: "running" | "paused" | "completed"; pauseReason: PauseReason | null }> {
  if (c.dailyCap !== null && c.dailyCap !== undefined) {
    if ((await countCompletedToday(db, c, now)) >= c.dailyCap) return { status: "paused", pauseReason: "daily_cap" };
  }
  if (!isWithinHours(now, c.timezone, c.callingHoursStart, c.callingHoursEnd)) {
    return { status: "paused", pauseReason: "outside_hours" };
  }
  const available = await countAvailable(db, c.id, now);
  if (available > 0) return { status: "running", pauseReason: null };
  const [[{ futureCallbacks }], [{ activeClaims }]] = await Promise.all([
    db
      .select({ futureCallbacks: count() })
      .from(callQueueItems)
      .where(
        and(eq(callQueueItems.campaignId, c.id), eq(callQueueItems.state, "callback"), gt(callQueueItems.callbackAt, now)),
      ),
    db
      .select({ activeClaims: count() })
      .from(callQueueItems)
      .where(
        and(
          eq(callQueueItems.campaignId, c.id),
          eq(callQueueItems.state, "claimed"),
          gte(callQueueItems.leaseExpiresAt, now),
        ),
      ),
  ]);
  if (Number(futureCallbacks) > 0) return { status: "paused", pauseReason: "exhausted" };
  if (Number(activeClaims) > 0) return { status: "running", pauseReason: null };
  return { status: "completed", pauseReason: null };
}

/** Evaluates every running or paused campaign; returns how many were evaluated. */
export async function evaluateAllCampaigns(db: DbOrTx, now: Date = new Date()): Promise<number> {
  const rows = await db
    .select({ id: callCampaigns.id })
    .from(callCampaigns)
    .where(inArray(callCampaigns.status, ["running", "paused"]));
  for (const r of rows) await evaluateCampaign(db, r.id, now);
  return rows.length;
}

/** Manual pause (only a running or auto-paused campaign). Auto-evaluation never lifts it. */
export async function pauseCampaign(db: DbOrTx, id: string, now: Date = new Date()): Promise<void> {
  await db
    .update(callCampaigns)
    .set({ status: "paused", pauseReason: "manual", pausedAt: now, updatedAt: now })
    .where(and(eq(callCampaigns.id, id), inArray(callCampaigns.status, ["running", "paused"])));
}

/** Clears the pause reason and sets the campaign running (also reopens a completed one). */
export async function resumeCampaign(db: DbOrTx, id: string, now: Date = new Date()): Promise<void> {
  await db
    .update(callCampaigns)
    .set({ status: "running", pauseReason: null, pausedAt: null, updatedAt: now })
    .where(and(eq(callCampaigns.id, id), inArray(callCampaigns.status, ["running", "paused", "completed"])));
}

/** Draft → running. Returns false when the campaign is not a draft. */
export async function startCampaign(db: DbOrTx, id: string, now: Date = new Date()): Promise<boolean> {
  const rows = await db
    .update(callCampaigns)
    .set({ status: "running", pauseReason: null, pausedAt: null, updatedAt: now })
    .where(and(eq(callCampaigns.id, id), eq(callCampaigns.status, "draft")))
    .returning({ id: callCampaigns.id });
  return rows.length > 0;
}

// ------------------------------------------------------------------ claim / outcome

/**
 * Hands `agent` the next item: due callbacks first, then pending (and
 * lease-expired claims) in position order. Runs `evaluateCampaign` first in
 * the same transaction. If the agent already holds an unexpired claim in this
 * campaign, that item is returned again with a fresh lease (so a reloaded
 * dialer resumes instead of taking a second business).
 */
export async function claimNext(db: DbOrTx, campaignId: string, agent: string, now: Date = new Date()): Promise<ClaimResult> {
  return db.transaction(async (tx) => {
    const c = await evaluateCampaign(tx, campaignId, now);
    if (c.status === "paused") return { ok: false, reason: "paused", pauseReason: c.pauseReason ?? undefined };
    if (c.status === "draft" || c.status === "completed") return { ok: false, reason: c.status };

    const lease = new Date(now.getTime() + LEASE_MINUTES * 60_000);
    const [held] = await tx
      .update(callQueueItems)
      .set({ leaseExpiresAt: lease, updatedAt: now })
      .where(
        and(
          eq(callQueueItems.campaignId, campaignId),
          eq(callQueueItems.state, "claimed"),
          eq(callQueueItems.claimedBy, agent),
          gte(callQueueItems.leaseExpiresAt, now),
        ),
      )
      .returning();
    if (held) return withBusiness(tx, held);

    if ((await countActiveAgents(tx, campaignId, now, agent)) >= c.maxConcurrentAgents) {
      return { ok: false, reason: "agent_limit" };
    }

    const res = await tx.execute(sql`
      UPDATE call_queue_items SET state = 'claimed', claimed_by = ${agent}, claimed_at = ${iso(now)},
        lease_expires_at = ${iso(now)} + interval '10 minutes', updated_at = ${iso(now)}
      WHERE id = (
        SELECT id FROM call_queue_items
        WHERE campaign_id = ${campaignId} AND (
              state = 'pending'
           OR (state = 'claimed' AND lease_expires_at < ${iso(now)})
           OR (state = 'callback' AND callback_at <= ${iso(now)}))
        ORDER BY CASE WHEN state = 'callback' THEN 0 ELSE 1 END, position
        FOR UPDATE SKIP LOCKED LIMIT 1)
      RETURNING *`);
    const claimed = rowsOf<{ id: string }>(res)[0];
    if (!claimed) return { ok: false, reason: "empty" };
    const item = await getQueueItem(tx, claimed.id);
    if (!item) return { ok: false, reason: "empty" };
    return withBusiness(tx, item);
  });
}

async function withBusiness(db: DbOrTx, item: CallQueueItem): Promise<ClaimResult> {
  const [business] = await db.select().from(businesses).where(eq(businesses.id, item.businessId));
  return { ok: true, item, business };
}

/** Skip: the item goes back to pending at the end of the queue, unclaimed. */
export async function releaseItem(db: DbOrTx, itemId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const item = await getQueueItem(tx, itemId);
    if (!item || item.state !== "claimed") return;
    const pos = await maxPosition(tx, item.campaignId);
    await tx
      .update(callQueueItems)
      .set({
        state: "pending",
        position: pos + 1,
        claimedBy: null,
        claimedAt: null,
        leaseExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(and(eq(callQueueItems.id, itemId), eq(callQueueItems.state, "claimed")));
  });
}

/**
 * Records a call outcome on an item and applies the transitions in
 * architecture.md (item state, business status, do-not-call cleanup) and one
 * `activities` row, all in one transaction. Throws `QueueItemError` when the
 * item is finished (completed/skipped), held by another agent's live lease, or
 * `callback` has no `callbackAt`.
 */
export async function recordOutcome(
  db: DbOrTx,
  itemId: string,
  input: OutcomeInput,
  now: Date = new Date(),
): Promise<CallQueueItem> {
  if (input.outcome === "callback" && !input.callbackAt) {
    throw new QueueItemError("A callback needs a date and time.", "callback_required");
  }
  return db.transaction(async (tx) => {
    const [item] = await tx.select().from(callQueueItems).where(eq(callQueueItems.id, itemId)).for("update");
    if (!item) throw new QueueItemError("Queue item not found.", "not_found");
    if (item.state === "completed" || item.state === "skipped") {
      throw new QueueItemError("This call already has an outcome.", "finished");
    }
    if (
      item.state === "claimed" &&
      item.claimedBy &&
      item.claimedBy !== input.agent &&
      item.leaseExpiresAt &&
      item.leaseExpiresAt > now
    ) {
      throw new QueueItemError(`This business is being called by ${item.claimedBy}.`, "claimed_by_other");
    }
    const campaign = await getCallCampaign(tx, item.campaignId);
    if (!campaign) throw new QueueItemError("Campaign not found.", "not_found");
    const [business] = await tx.select().from(businesses).where(eq(businesses.id, item.businessId));

    const attempts = item.attempts + 1;
    const notes = input.notes?.trim() ? input.notes.trim() : null;
    const itemPatch: Partial<CallQueueItem> = {
      attempts,
      lastOutcome: input.outcome,
      lastOutcomeAt: now,
      claimedBy: input.agent,
      leaseExpiresAt: null,
      updatedAt: now,
      callbackAt: null,
      ...(notes !== null ? { notes } : {}),
    };
    const bizPatch: Partial<Business> = { updatedAt: now };

    switch (input.outcome) {
      case "no_answer":
      case "voicemail":
      case "busy":
        if (attempts < campaign.maxAttempts) {
          itemPatch.state = "pending";
          itemPatch.position = (await maxPosition(tx, item.campaignId)) + 1;
        } else {
          itemPatch.state = "skipped";
        }
        if (business?.status === "new") bizPatch.status = "contacted";
        bizPatch.lastContactedAt = now;
        break;
      case "interested":
        itemPatch.state = "completed";
        bizPatch.status = "interested";
        bizPatch.lastContactedAt = now;
        break;
      case "not_interested":
        itemPatch.state = "completed";
        bizPatch.status = "not_interested";
        bizPatch.lastContactedAt = now;
        break;
      case "callback":
        itemPatch.state = "callback";
        itemPatch.callbackAt = input.callbackAt!;
        bizPatch.status = "callback";
        bizPatch.nextFollowUpAt = input.callbackAt!;
        bizPatch.lastContactedAt = now;
        break;
      case "wrong_number":
        itemPatch.state = "completed";
        if (business && !business.tags.includes("wrong_number")) bizPatch.tags = [...business.tags, "wrong_number"];
        break;
      case "do_not_call":
        itemPatch.state = "completed";
        bizPatch.doNotCall = true;
        bizPatch.status = "do_not_call";
        bizPatch.lastContactedAt = now;
        break;
    }

    const [updated] = await tx.update(callQueueItems).set(itemPatch).where(eq(callQueueItems.id, itemId)).returning();
    if (business) await tx.update(businesses).set(bizPatch).where(eq(businesses.id, business.id));

    if (input.outcome === "do_not_call") {
      await tx
        .delete(callQueueItems)
        .where(
          and(
            eq(callQueueItems.businessId, item.businessId),
            inArray(callQueueItems.state, ["pending", "callback"]),
            ne(callQueueItems.id, itemId),
          ),
        );
    }

    await tx.insert(activities).values({
      businessId: item.businessId,
      type: "call",
      outcome: input.outcome,
      body: notes ?? "",
      metadata: {
        queueItemId: item.id,
        attempt: attempts,
        ...(input.callbackAt ? { callbackAt: input.callbackAt.toISOString() } : {}),
      },
      agent: input.agent,
      campaignType: "call",
      campaignId: item.campaignId,
      occurredAt: now,
    });

    // v2: mirror the outcome onto every user's lead for this business (no-op when there are none).
    await syncLeadStatusFromOutcome(tx, item.businessId, input.outcome);

    return updated;
  });
}

// ------------------------------------------------------------------ reporting (WP-07)

/** Call activities since `since`, grouped by outcome (most frequent first). */
export async function countCallsByOutcome(db: DbOrTx, since: Date): Promise<{ outcome: CallOutcome; count: number }[]> {
  const rows = await db
    .select({ outcome: activities.outcome, n: count() })
    .from(activities)
    .where(and(eq(activities.type, "call"), gte(activities.occurredAt, since), isNotNull(activities.outcome)))
    .groupBy(activities.outcome)
    .orderBy(desc(count()), asc(activities.outcome));
  return rows.map((r) => ({ outcome: r.outcome as CallOutcome, count: Number(r.n) }));
}

/** Per-campaign variant of `countCallsByOutcome` over all time (campaign page breakdown). */
export async function countCampaignOutcomes(db: DbOrTx, campaignId: string): Promise<{ outcome: CallOutcome; count: number }[]> {
  const rows = await db
    .select({ outcome: activities.outcome, n: count() })
    .from(activities)
    .where(and(eq(activities.type, "call"), eq(activities.campaignId, campaignId), isNotNull(activities.outcome)))
    .groupBy(activities.outcome);
  return rows.map((r) => ({ outcome: r.outcome as CallOutcome, count: Number(r.n) }));
}

/** Callback items due at or before `before`, earliest first. `opts.campaignId` narrows to one campaign. */
export async function listDueCallbacks(
  db: DbOrTx,
  before: Date,
  opts: { campaignId?: string; limit?: number } = {},
): Promise<(CallQueueItem & { business: Business; campaignName: string })[]> {
  const rows = await db
    .select({ item: callQueueItems, business: businesses, campaignName: callCampaigns.name })
    .from(callQueueItems)
    .innerJoin(businesses, eq(businesses.id, callQueueItems.businessId))
    .innerJoin(callCampaigns, eq(callCampaigns.id, callQueueItems.campaignId))
    .where(
      and(
        eq(callQueueItems.state, "callback"),
        lte(callQueueItems.callbackAt, before),
        opts.campaignId ? eq(callQueueItems.campaignId, opts.campaignId) : undefined,
      ),
    )
    .orderBy(asc(callQueueItems.callbackAt), asc(callQueueItems.id))
    .limit(opts.limit ?? 200);
  return rows.map((r) => ({ ...r.item, business: r.business, campaignName: r.campaignName }));
}

/** Upcoming (not yet due) callbacks for one campaign, earliest first. */
export async function listUpcomingCallbacks(
  db: DbOrTx,
  campaignId: string,
  after: Date,
  limit = 50,
): Promise<(CallQueueItem & { business: Business })[]> {
  const rows = await db
    .select({ item: callQueueItems, business: businesses })
    .from(callQueueItems)
    .innerJoin(businesses, eq(businesses.id, callQueueItems.businessId))
    .where(
      and(eq(callQueueItems.campaignId, campaignId), eq(callQueueItems.state, "callback"), gt(callQueueItems.callbackAt, after)),
    )
    .orderBy(asc(callQueueItems.callbackAt))
    .limit(limit);
  return rows.map((r) => ({ ...r.item, business: r.business }));
}

/** Call activities for one business within one campaign, newest first (the dialer's "previous outcomes"). */
export async function listItemHistory(db: DbOrTx, campaignId: string, businessId: string, limit = 20) {
  return db
    .select()
    .from(activities)
    .where(and(eq(activities.campaignId, campaignId), eq(activities.businessId, businessId), eq(activities.type, "call")))
    .orderBy(desc(activities.occurredAt))
    .limit(limit);
}

