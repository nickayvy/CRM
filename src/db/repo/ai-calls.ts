// AI calls: claims queue items for the ElevenLabs agent and keeps one ai_calls
// row per placed call. Outcomes go through recordOutcome like a human call.
import { and, count, desc, eq, gte, sql } from "drizzle-orm";
import { type DbOrTx, evaluateCampaign } from "./call-campaigns";
import { type AiCall, type Business, type CallQueueItem, type NewAiCall, aiCalls, businesses, callQueueItems } from "../schema";

/** `claimed_by` / activity agent name for calls the ElevenLabs agent places. */
export const AI_AGENT = "AI agent";
/** Lease on an item the AI is calling. Covers the call plus ElevenLabs' post-call analysis. */
export const AI_LEASE_MINUTES = 30;

function rowsOf<T>(res: unknown): T[] {
  if (Array.isArray(res)) return res as T[];
  return ((res as { rows?: T[] }).rows ?? []) as T[];
}

const iso = (d: Date) => sql`${d.toISOString()}::timestamptz`;

/** Items the AI agent holds with a live lease (calls in flight). */
export async function countActiveAiClaims(db: DbOrTx, campaignId: string, now: Date = new Date()): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(callQueueItems)
    .where(
      and(
        eq(callQueueItems.campaignId, campaignId),
        eq(callQueueItems.state, "claimed"),
        eq(callQueueItems.claimedBy, AI_AGENT),
        gte(callQueueItems.leaseExpiresAt, now),
      ),
    );
  return Number(row?.n ?? 0);
}

export type AiClaim =
  | { ok: true; item: CallQueueItem; business: Business }
  | { ok: false; reason: "not_running" | "empty" | "at_capacity" };

/**
 * Claims the next item for the AI agent: same order and predicate as the
 * dialer (due callbacks, then pending and expired claims by position), with
 * a longer lease. Evaluates the campaign first so hours and caps apply, and
 * refuses when `maxConcurrentAgents` AI calls are already in flight.
 */
export async function claimNextForAi(db: DbOrTx, campaignId: string, now: Date = new Date()): Promise<AiClaim> {
  return db.transaction(async (tx) => {
    const c = await evaluateCampaign(tx, campaignId, now);
    if (c.status !== "running") return { ok: false, reason: "not_running" };
    if ((await countActiveAiClaims(tx, campaignId, now)) >= c.maxConcurrentAgents) return { ok: false, reason: "at_capacity" };
    const res = await tx.execute(sql`
      UPDATE call_queue_items SET state = 'claimed', claimed_by = ${AI_AGENT}, claimed_at = ${iso(now)},
        lease_expires_at = ${iso(now)} + make_interval(mins => ${AI_LEASE_MINUTES}), updated_at = ${iso(now)}
      WHERE id = (
        SELECT id FROM call_queue_items
        WHERE campaign_id = ${campaignId} AND (
              state = 'pending'
           OR (state = 'claimed' AND lease_expires_at < ${iso(now)})
           OR (state = 'callback' AND callback_at <= ${iso(now)}))
        ORDER BY CASE WHEN state = 'callback' THEN 0 ELSE 1 END, position
        FOR UPDATE SKIP LOCKED LIMIT 1)
      RETURNING id`);
    const claimed = rowsOf<{ id: string }>(res)[0];
    if (!claimed) return { ok: false, reason: "empty" };
    const [row] = await tx
      .select({ item: callQueueItems, business: businesses })
      .from(callQueueItems)
      .innerJoin(businesses, eq(businesses.id, callQueueItems.businessId))
      .where(eq(callQueueItems.id, claimed.id));
    return { ok: true, item: row.item, business: row.business };
  });
}

export async function createAiCall(db: DbOrTx, input: NewAiCall): Promise<AiCall> {
  const [row] = await db.insert(aiCalls).values(input).returning();
  return row;
}

export async function updateAiCall(db: DbOrTx, id: string, patch: Partial<Omit<NewAiCall, "id">>): Promise<AiCall | null> {
  const [row] = await db.update(aiCalls).set(patch).where(eq(aiCalls.id, id)).returning();
  return row ?? null;
}

export async function getAiCall(db: DbOrTx, id: string): Promise<AiCall | null> {
  const [row] = await db.select().from(aiCalls).where(eq(aiCalls.id, id));
  return row ?? null;
}

export async function getAiCallByConversation(db: DbOrTx, conversationId: string): Promise<AiCall | null> {
  const [row] = await db.select().from(aiCalls).where(eq(aiCalls.conversationId, conversationId));
  return row ?? null;
}

export type AiCallRow = AiCall & { businessName: string };

/** Newest first, with the business name. */
export async function listAiCalls(db: DbOrTx, campaignId: string, limit = 50): Promise<AiCallRow[]> {
  const rows = await db
    .select({ call: aiCalls, businessName: businesses.name })
    .from(aiCalls)
    .innerJoin(businesses, eq(businesses.id, aiCalls.businessId))
    .where(eq(aiCalls.campaignId, campaignId))
    .orderBy(desc(aiCalls.startedAt), desc(aiCalls.id))
    .limit(limit);
  return rows.map((r) => ({ ...r.call, businessName: r.businessName }));
}
