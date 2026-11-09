// Server-side reads for /leads (imported by the page only). Every function is
// scoped by the user's id.
import { and, count, desc, eq, gte } from "drizzle-orm";
import type { Db } from "@/db/client";
import { listCallCampaigns } from "@/db/repo/call-campaigns";
import { listEmailCampaigns } from "@/db/repo/email-campaigns";
import { countLeadsByStatus, listLeads } from "@/db/repo/leads";
import { type CallOutcome, activities, businesses, callOutcomeEnum, leads } from "@/db/schema";
import { formatRelative } from "@/lib/format";
import {
  type CallHistoryRow,
  type CampaignTarget,
  type LeadMetricsData,
  type LeadRow,
  toLeadRow,
} from "./types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OUTCOMES = new Set<string>(callOutcomeEnum.enumValues);
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Dialer call activities on the user's lead businesses, newest first. One row
 * per activity (a business that is a lead for several users only joins once
 * here because the join is filtered to this user).
 */
export async function listLeadCallHistory(
  db: Db,
  userId: string,
  opts: { limit?: number; now?: Date } = {},
): Promise<CallHistoryRow[]> {
  if (!UUID_RE.test(userId)) return [];
  const now = opts.now ?? new Date();
  const rows = await db
    .select({ a: activities, businessName: businesses.name })
    .from(activities)
    .innerJoin(leads, and(eq(leads.businessId, activities.businessId), eq(leads.userId, userId)))
    .innerJoin(businesses, eq(businesses.id, activities.businessId))
    .where(eq(activities.type, "call"))
    .orderBy(desc(activities.occurredAt), desc(activities.createdAt))
    .limit(opts.limit ?? 200);
  return rows.map(({ a, businessName }) => ({
    id: a.id,
    businessId: a.businessId,
    businessName,
    outcome: a.outcome && OUTCOMES.has(a.outcome) ? (a.outcome as CallOutcome) : null,
    agent: a.agent,
    notes: a.body,
    occurredAt: a.occurredAt.toISOString(),
    relative: formatRelative(a.occurredAt, now),
  }));
}

/** Call activities on the user's lead businesses since `since`. */
export async function countLeadCallsSince(db: Db, userId: string, since: Date): Promise<number> {
  if (!UUID_RE.test(userId)) return 0;
  const [row] = await db
    .select({ n: count() })
    .from(activities)
    .innerJoin(leads, and(eq(leads.businessId, activities.businessId), eq(leads.userId, userId)))
    .where(and(eq(activities.type, "call"), gte(activities.occurredAt, since)));
  return Number(row?.n ?? 0);
}

export async function getLeadMetrics(db: Db, userId: string, now: Date = new Date()): Promise<LeadMetricsData> {
  const [counts, calls7d] = await Promise.all([
    countLeadsByStatus(db, userId),
    countLeadCallsSince(db, userId, new Date(now.getTime() - 7 * DAY_MS)),
  ]);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return { total, queued: counts.queued, success: counts.success, calls7d };
}

/** Non-completed call and email campaigns (targets for the bulk dialogs). */
export async function listCampaignTargets(db: Db, now: Date = new Date()): Promise<{ call: CampaignTarget[]; email: CampaignTarget[] }> {
  const [call, email] = await Promise.all([listCallCampaigns(db, now), listEmailCampaigns(db, now)]);
  const toTarget = (c: CampaignTarget): CampaignTarget => ({ id: c.id, name: c.name, status: c.status });
  return {
    call: call.filter((c) => c.status !== "completed").map(toTarget),
    email: email.filter((c) => c.status !== "completed").map(toTarget),
  };
}

export type LeadsView = {
  leads: LeadRow[];
  metrics: LeadMetricsData;
  history: CallHistoryRow[];
  campaigns: { call: CampaignTarget[]; email: CampaignTarget[] };
};

/** Everything the /leads page renders, for one user. */
export async function loadLeadsView(db: Db, userId: string, now: Date = new Date()): Promise<LeadsView> {
  const [rows, metrics, history, campaigns] = await Promise.all([
    listLeads(db, userId),
    getLeadMetrics(db, userId, now),
    listLeadCallHistory(db, userId, { now }),
    listCampaignTargets(db, now),
  ]);
  return { leads: rows.map(toLeadRow), metrics, history, campaigns };
}
