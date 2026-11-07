// Dashboard numbers (WP-07). Definitions are in architecture §Interfaces
// `DashboardStats` and the WP-07 brief; every field is recomputed
// independently in tests/dashboard.test.ts.
import { and, count, eq, gte, inArray, isNotNull, lt, lte, sql } from "drizzle-orm";
import { addDays } from "date-fns";
import { localDay, localDayBounds } from "@/features/calling/time";
import { env } from "@/lib/env";
import { HARD_REASONS } from "@/lib/qualify";
import type { Db } from "../client";
import {
  type BusinessStatus,
  activities,
  businessStatusEnum,
  callCampaigns,
  callQueueItems,
  emailCampaigns,
  emailMessages,
} from "../schema";
import { countByQualification, countByReason, countByStatus } from "./businesses";

export type DashboardStats = {
  businessesTotal: number;
  businessesQualified: number;
  businessesReview: number;
  businessesRejected: number;
  callsToday: number;
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
  const hard = new Set<string>(HARD_REASONS);

  const [qual, reasons, statuses, callsToday, weekCalls, emailsToday, runningCall, runningEmail, overdue] =
    await Promise.all([
      countByQualification(db),
      countByReason(db),
      countByStatus(db),
      db
        .select({ n: count() })
        .from(activities)
        .where(and(eq(activities.type, "call"), gte(activities.occurredAt, today.start), lt(activities.occurredAt, today.end))),
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
            inArray(emailMessages.status, ["sent", "dry_run"]),
            gte(emailMessages.createdAt, today.start),
            lt(emailMessages.createdAt, today.end),
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
