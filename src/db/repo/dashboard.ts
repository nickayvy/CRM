// Dashboard numbers (WP-07). Definitions are in architecture §Interfaces
// `DashboardStats` and the WP-07 brief; every field is recomputed
// independently in tests/dashboard.test.ts.
import { and, asc, count, desc, eq, gte, inArray, isNotNull, lt, lte, sql } from "drizzle-orm";
import { addDays } from "date-fns";
import { localDay, localDayBounds } from "@/features/calling/time";
import { env } from "@/lib/env";
import { HARD_REASONS } from "@/lib/qualify";
import type { Db } from "../client";
import {
  type BusinessStatus,
  type CallQueueItem,
  type CampaignStatus,
  type EmailEnrollment,
  activities,
  businessStatusEnum,
  callCampaigns,
  callQueueItems,
  emailCampaigns,
  emailEnrollments,
  emailMessages,
} from "../schema";
import { countByQualification, countByReason, countByStatus } from "./businesses";

export type DashboardStats = {
  businessesTotal: number;
  businessesQualified: number;
  businessesReview: number;
  businessesRejected: number;
  callsToday: number;
  /**
   * Call activities on the previous local day up to the same time of day as
   * now: the fair comparison for `callsToday`, which is a day still in progress.
   */
  callsYesterday: number;
  /** Call outcomes over the 7-day window (the denominator of `interestRate7d`). */
  calls7d: number;
  /** "interested" outcomes over the 7-day window (the numerator of `interestRate7d`). */
  interested7d: number;
  /** interested / all call outcomes over the 7-day window, 0..1 (0 when there are none). */
  interestRate7d: number;
  emailsSentToday: number;
  runningCallCampaigns: number;
  runningEmailCampaigns: number;
  overdueCallbacks: number;
  /** Hard rejection reasons with the number of businesses carrying each, most common first. */
  rejectionBreakdown: { reason: string; count: number }[];
  /** Call outcomes per local day ("yyyy-MM-dd") over the 7-day window; only non-zero cells. */
  callsByOutcome7d: { day: string; outcome: string; count: number }[];
  /** Every CRM status in pipeline order (zeros included). */
  statusFunnel: { status: BusinessStatus; count: number }[];
};

/** Statuses in the order the funnel chart shows them. */
export const FUNNEL_ORDER: BusinessStatus[] = [
  "new",
  "contacted",
  "interested",
  "callback",
  "converted",
  "not_interested",
  "do_not_call",
];

/**
 * The 7-day window: today plus the six previous calendar days in `tz`.
 * Returns the window start (local midnight six days ago), the end of today,
 * and the seven day keys oldest first.
 */
export function sevenDayWindow(now: Date, tz: string = env.APP_TIMEZONE): { start: Date; end: Date; days: string[] } {
  const today = localDayBounds(now, tz);
  // Noon avoids DST edges when stepping back whole days.
  const noon = new Date(today.start.getTime() + 12 * 3_600_000);
  const days = Array.from({ length: 7 }, (_, i) => localDay(addDays(noon, i - 6), tz));
  const start = localDayBounds(addDays(noon, -6), tz).start;
  return { start, end: today.end, days };
}

export async function getDashboardStats(db: Db, now: Date = new Date()): Promise<DashboardStats> {
  const tz = env.APP_TIMEZONE;
  const today = localDayBounds(now, tz);
  const week = sevenDayWindow(now, tz);
  // Noon avoids DST edges when stepping back a whole day.
  const yesterday = localDayBounds(addDays(new Date(today.start.getTime() + 12 * 3_600_000), -1), tz);
  // As far into yesterday as now is into today (capped at the end of that day across a DST change).
  const yesterdayNow = new Date(Math.min(yesterday.end.getTime(), yesterday.start.getTime() + Math.max(0, now.getTime() - today.start.getTime())));
  const hard = new Set<string>(HARD_REASONS);

  const [qual, reasons, statuses, callsToday, callsYesterday, weekCalls, emailsToday, runningCall, runningEmail, overdue] =
    await Promise.all([
      countByQualification(db),
      countByReason(db),
      countByStatus(db),
      db
        .select({ n: count() })
        .from(activities)
        .where(and(eq(activities.type, "call"), gte(activities.occurredAt, today.start), lt(activities.occurredAt, today.end))),
      db
        .select({ n: count() })
        .from(activities)
        .where(
          and(eq(activities.type, "call"), gte(activities.occurredAt, yesterday.start), lt(activities.occurredAt, yesterdayNow)),
        ),
      // Window ends at `now`: future-dated activities never count.
      db
        .select({ outcome: activities.outcome, occurredAt: activities.occurredAt })
        .from(activities)
        .where(
          and(
            eq(activities.type, "call"),
            isNotNull(activities.outcome),
            gte(activities.occurredAt, week.start),
            lte(activities.occurredAt, now),
          ),
        ),
      db
        .select({ n: count() })
        .from(emailMessages)
        .where(
          and(
            // Same definition as the Email page (statsFor / countEmailsSent): went out today, by sentAt.
            inArray(emailMessages.status, ["sent", "dry_run"]),
            isNotNull(emailMessages.sentAt),
            gte(emailMessages.sentAt, today.start),
            lt(emailMessages.sentAt, today.end),
          ),
        ),
      db.select({ n: count() }).from(callCampaigns).where(eq(callCampaigns.status, "running")),
      db.select({ n: count() }).from(emailCampaigns).where(eq(emailCampaigns.status, "running")),
      db
        .select({ n: count() })
        .from(callQueueItems)
        .where(and(eq(callQueueItems.state, "callback"), lt(callQueueItems.callbackAt, sql`${now.toISOString()}::timestamptz`))),
    ]);

  const cells = new Map<string, number>();
  let interested = 0;
  for (const c of weekCalls) {
    if (c.outcome === "interested") interested++;
    const key = `${localDay(c.occurredAt, tz)}|${c.outcome}`;
    cells.set(key, (cells.get(key) ?? 0) + 1);
  }
  const callsByOutcome7d = [...cells.entries()]
    .map(([k, n]) => {
      const [day, outcome] = k.split("|");
      return { day, outcome, count: n };
    })
    .sort((a, b) => a.day.localeCompare(b.day) || a.outcome.localeCompare(b.outcome));

  const statusList = businessStatusEnum.enumValues;
  const order = [...FUNNEL_ORDER, ...statusList.filter((s) => !FUNNEL_ORDER.includes(s))];

  return {
    businessesTotal: qual.qualified + qual.review + qual.rejected,
    businessesQualified: qual.qualified,
    businessesReview: qual.review,
    businessesRejected: qual.rejected,
    callsToday: Number(callsToday[0]?.n ?? 0),
    callsYesterday: Number(callsYesterday[0]?.n ?? 0),
    calls7d: weekCalls.length,
    interested7d: interested,
    interestRate7d: weekCalls.length ? interested / weekCalls.length : 0,
    emailsSentToday: Number(emailsToday[0]?.n ?? 0),
    runningCallCampaigns: Number(runningCall[0]?.n ?? 0),
    runningEmailCampaigns: Number(runningEmail[0]?.n ?? 0),
    overdueCallbacks: Number(overdue[0]?.n ?? 0),
    rejectionBreakdown: reasons.filter((r) => hard.has(r.reason)),
    callsByOutcome7d,
    statusFunnel: order.map((status) => ({ status, count: statuses[status] ?? 0 })),
  };
}

// ---------------------------------------------------------------- campaign membership (business detail)

export type BusinessMemberships = {
  calls: (CallQueueItem & { campaignName: string; campaignStatus: CampaignStatus })[];
  emails: (EmailEnrollment & { campaignName: string; campaignStatus: CampaignStatus; stepCount: number })[];
};

/** Every call queue item and email enrollment of one business, newest first, with campaign names. */
export async function listBusinessMemberships(db: Db, businessId: string): Promise<BusinessMemberships> {
  const [calls, emails] = await Promise.all([
    db
      .select({ item: callQueueItems, campaignName: callCampaigns.name, campaignStatus: callCampaigns.status })
      .from(callQueueItems)
      .innerJoin(callCampaigns, eq(callCampaigns.id, callQueueItems.campaignId))
      .where(eq(callQueueItems.businessId, businessId))
      .orderBy(desc(callQueueItems.createdAt), asc(callQueueItems.id)),
    db
      .select({
        enrollment: emailEnrollments,
        campaignName: emailCampaigns.name,
        campaignStatus: emailCampaigns.status,
        stepCount: sql<number>`(SELECT count(*)::int FROM email_steps s WHERE s.campaign_id = ${emailEnrollments.campaignId})`,
      })
      .from(emailEnrollments)
      .innerJoin(emailCampaigns, eq(emailCampaigns.id, emailEnrollments.campaignId))
      .where(eq(emailEnrollments.businessId, businessId))
      .orderBy(desc(emailEnrollments.enrolledAt), asc(emailEnrollments.id)),
  ]);
  return {
    calls: calls.map((r) => ({ ...r.item, campaignName: r.campaignName, campaignStatus: r.campaignStatus })),
    emails: emails.map((r) => ({
      ...r.enrollment,
      campaignName: r.campaignName,
      campaignStatus: r.campaignStatus,
      stepCount: Number(r.stepCount),
    })),
  };
}
