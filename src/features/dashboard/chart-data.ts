// Shapes DashboardStats into chart rows (pure; unit-tested in tests/dashboard-ui.test.ts).
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import type { DashboardStats } from "@/db/repo/dashboard";
import type { CallOutcome, LeadStatus } from "@/db/schema";
import type { OverviewTiles } from "./data";

/** One row of a ranked bar list. */
export type CategoryDatum = { key: string; label: string; count: number };

/** One row per local day; outcome-group keys hold counts. */
export type OutcomeDayDatum = { day: string; label: string } & Record<string, number | string>;

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
 * The eight dialer outcomes folded into four groups a reader can tell apart at
 * a glance. Order is the stacking order (bottom first) and the legend order.
 */
export const OUTCOME_GROUPS = [
  { key: "interested", label: "Interested", color: "var(--series-1)", outcomes: ["interested"] },
  { key: "callback", label: "Callback", color: "var(--series-2)", outcomes: ["callback"] },
  { key: "no_contact", label: "No contact", color: "var(--series-3)", outcomes: ["no_answer", "voicemail", "busy"] },
  { key: "declined", label: "Declined or wrong number", color: "var(--series-4)", outcomes: ["not_interested", "wrong_number", "do_not_call"] },
] as const satisfies readonly { key: string; label: string; color: string; outcomes: readonly CallOutcome[] }[];

export type OutcomeGroupKey = (typeof OUTCOME_GROUPS)[number]["key"];

const GROUP_OF = new Map<string, OutcomeGroupKey>(
  OUTCOME_GROUPS.flatMap((g) => g.outcomes.map((o) => [o, g.key] as [string, OutcomeGroupKey])),
);

export function rejectionRows(stats: DashboardStats): CategoryDatum[] {
  return stats.rejectionBreakdown.map((r) => ({
    key: r.reason,
    label: SHORT_REASON_LABELS[r.reason] ?? r.reason,
    count: r.count,
  }));
}

/** "2026-11-07" → "Sat 7" (weekday + day of month, in the given zone). */
function dayLabel(day: string, tz: string): string {
  return formatInTimeZone(fromZonedTime(`${day}T12:00:00`, tz), tz, "EEE d");
}

/**
 * One row per day in `days` (oldest first) with a count per outcome group (0
 * when none), plus the groups that occur at least once. A group keeps its
 * color whichever groups are present.
 */
export function outcomeRows(
  stats: DashboardStats,
  days: string[],
  tz: string,
): { data: OutcomeDayDatum[]; outcomes: { key: string; label: string; color: string }[] } {
  const cells = stats.callsByOutcome7d.flatMap((c) => {
    const group = GROUP_OF.get(c.outcome);
    return group ? [{ day: c.day, group, count: c.count }] : [];
  });
  const present = new Set(cells.map((c) => c.group));
  const outcomes = OUTCOME_GROUPS.filter((g) => present.has(g.key)).map((g) => ({ key: g.key, label: g.label, color: g.color }));
  const data = days.map((day) => {
    const row: OutcomeDayDatum = { day, label: dayLabel(day, tz) };
    for (const o of outcomes) row[o.key] = 0;
    for (const c of cells) if (c.day === day) row[c.group] = (row[c.group] as number) + c.count;
    return row;
  });
  return { data, outcomes };
}

// ---------------------------------------------------------------- pipeline

export type PipelineStage = {
  key: "discovered" | "qualified" | "leads" | "contacted" | "won";
  label: string;
  /** How the next stage refers to this one, e.g. "of qualified". */
  asBase: string;
  count: number;
  /** What the count means, in a few words. */
  hint: string;
  href: string;
  /** Share of the previous stage, 0..1; null for the first stage, an empty previous stage, or a stage larger than the one before it. */
  shareOfPrevious: number | null;
};

/** Lead statuses that mean the business has been called or emailed at least once. */
const REACHED: LeadStatus[] = ["contacted", "callback", "success", "failed"];

/**
 * The path from a discovered business to a successful lead, as five counts.
 * Each stage also carries its share of the stage before it, so a drop-off is
 * readable whatever the absolute sizes are.
 *
 * The fourth stage is cumulative (every lead reached at least once, whatever
 * its status is now), so it is not called "Contacted": that is one lead
 * status, with its own smaller count. The last stage uses the Leads page's
 * word for it, "Success".
 */
export function pipelineStages(stats: DashboardStats, tiles: OverviewTiles): PipelineStage[] {
  const by = new Map(tiles.leadsByStatus.map((r) => [r.status, r.count]));
  const reached = REACHED.reduce((n, s) => n + (by.get(s) ?? 0), 0);
  const stages: Omit<PipelineStage, "shareOfPrevious">[] = [
    { key: "discovered", label: "Discovered", asBase: "discovered", count: stats.businessesTotal, hint: "Businesses found", href: "/businesses" },
    { key: "qualified", label: "Qualified", asBase: "qualified", count: stats.businessesQualified, hint: "Passed your rules", href: "/businesses?qualification=qualified" },
    { key: "leads", label: "Leads", asBase: "leads", count: tiles.leadsTotal, hint: "On a lead list", href: "/leads" },
    { key: "contacted", label: "Reached out", asBase: "those reached", count: reached, hint: "Called or emailed", href: "/leads" },
    { key: "won", label: "Success", asBase: "successes", count: by.get("success") ?? 0, hint: "Marked a success", href: "/leads?status=success" },
  ];
  return stages.map((s, i) => {
    const prev = i > 0 ? stages[i - 1].count : 0;
    return { ...s, shareOfPrevious: i > 0 && prev > 0 && s.count <= prev ? s.count / prev : null };
  });
}
