// Shapes DashboardStats into chart rows (pure; unit-tested in tests/dashboard-ui.test.ts).
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import type { DashboardStats } from "@/db/repo/dashboard";
import type { CallOutcome } from "@/db/schema";
import { OUTCOME_LABELS, STATUS_LABELS } from "@/lib/labels";
import type { CategoryDatum, OutcomeDayDatum } from "./components/dashboard-charts";

/** Short axis labels for the hard rejection reasons (full sentences live in REASON_LABELS). */
export const SHORT_REASON_LABELS: Record<string, string> = {
  closed: "Closed",
  category_mismatch: "Wrong category",
  chain: "Chain",
  multi_location: "Multi-location",
  no_phone: "No phone",
  out_of_area: "Out of area",
  low_rating: "Low rating",
  too_few_reviews: "Few reviews",
  too_many_reviews: "Many reviews",
  duplicate_phone: "Duplicate phone",
};

/**
 * Fixed color per outcome so a series keeps its color whichever outcomes are
 * present. LAR blue ramp only (`--chart-1..5`): the five most telling
 * outcomes take a ramp step each, the three "no contact" outcomes share
 * translucent steps.
 */
export const OUTCOME_COLORS: Record<CallOutcome, string> = {
  interested: "var(--chart-1)",
  callback: "var(--chart-2)",
  not_interested: "var(--chart-3)",
  wrong_number: "var(--chart-4)",
  do_not_call: "var(--chart-5)",
  voicemail: "color-mix(in oklab, var(--chart-1) 45%, transparent)",
  busy: "color-mix(in oklab, var(--chart-3) 45%, transparent)",
  no_answer: "color-mix(in oklab, var(--chart-5) 55%, transparent)",
};

export function rejectionRows(stats: DashboardStats): CategoryDatum[] {
  return stats.rejectionBreakdown.map((r) => ({
    key: r.reason,
    label: SHORT_REASON_LABELS[r.reason] ?? r.reason,
    count: r.count,
  }));
}

export function funnelRows(stats: DashboardStats): CategoryDatum[] {
  return stats.statusFunnel.map((s) => ({ key: s.status, label: STATUS_LABELS[s.status].label, count: s.count }));
}

/** "2026-11-07" → "Sat 7" (weekday + day of month, in the given zone). */
function dayLabel(day: string, tz: string): string {
  return formatInTimeZone(fromZonedTime(`${day}T12:00:00`, tz), tz, "EEE d");
}

/**
 * One row per day in `days` (oldest first) with a count per outcome (0 when
 * none), plus the outcomes that occur at least once, in dialer order.
 */
export function outcomeRows(
  stats: DashboardStats,
  days: string[],
  tz: string,
): { data: OutcomeDayDatum[]; outcomes: { key: string; label: string; color: string }[] } {
  const present = new Set(stats.callsByOutcome7d.map((c) => c.outcome));
  const outcomes = (Object.keys(OUTCOME_LABELS) as CallOutcome[])
    .filter((o) => present.has(o))
    .map((o) => ({ key: o, label: OUTCOME_LABELS[o].label, color: OUTCOME_COLORS[o] }));
  const data = days.map((day) => {
    const row: OutcomeDayDatum = { day, label: dayLabel(day, tz) };
    for (const o of outcomes) row[o.key] = 0;
    for (const c of stats.callsByOutcome7d) if (c.day === day && present.has(c.outcome)) row[c.outcome] = c.count;
    return row;
  });
  return { data, outcomes };
}
