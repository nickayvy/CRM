import { describe, expect, it } from "vitest";
import type { DashboardStats } from "@/db/repo/dashboard";
import { ATTENTION_LIMIT, buildAttention, type AttentionInput } from "@/features/dashboard/attention";
import { OUTCOME_GROUPS, outcomeRows, pipelineStages, rejectionRows } from "@/features/dashboard/chart-data";
import type { OverviewTiles } from "@/features/dashboard/data";
import { callOutcomeEnum } from "@/db/schema";

const base: DashboardStats = {
  businessesTotal: 3,
  businessesQualified: 1,
  businessesReview: 1,
  businessesRejected: 1,
  callsToday: 0,
  callsYesterday: 0,
  calls7d: 4,
  interested7d: 2,
  interestRate7d: 0,
  emailsSentToday: 0,
  runningCallCampaigns: 0,
  runningEmailCampaigns: 0,
  overdueCallbacks: 0,
  rejectionBreakdown: [{ reason: "chain", count: 4 }],
  callsByOutcome7d: [
    { day: "2026-11-01", outcome: "busy", count: 1 },
    { day: "2026-11-07", outcome: "interested", count: 2 },
    { day: "2026-11-07", outcome: "busy", count: 1 },
    { day: "2026-11-07", outcome: "voicemail", count: 3 },
  ],
  statusFunnel: [
    { status: "new", count: 2 },
    { status: "interested", count: 1 },
  ],
};
const DAYS = ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07"];

const tiles = (by: Partial<Record<OverviewTiles["leadsByStatus"][number]["status"], number>>): OverviewTiles => {
  const leadsByStatus = (["queued", "contacted", "callback", "success", "failed", "skipped"] as const).map((status) => ({
    status,
    count: by[status] ?? 0,
  }));
  return { leadsByStatus, leadsTotal: leadsByStatus.reduce((n, r) => n + r.count, 0), businessesBySource: [] };
};

describe("dashboard chart rows", () => {
  it("puts every dialer outcome in exactly one group", () => {
    const grouped = OUTCOME_GROUPS.flatMap((g) => [...g.outcomes]);
    expect([...grouped].sort()).toEqual([...callOutcomeEnum.enumValues].sort());
    expect(new Set(grouped).size).toBe(grouped.length);
    // Four hues at most: more than that stops being readable in one stack.
    expect(OUTCOME_GROUPS.map((g) => g.color)).toEqual(["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)"]);
  });

  it("fills every day with every present group, zeros included, and sums the outcomes in a group", () => {
    const { data, outcomes } = outcomeRows(base, DAYS, "America/Chicago");
    expect(outcomes.map((o) => o.key)).toEqual(["interested", "no_contact"]);
    expect(data).toHaveLength(7);
    expect(data[0]).toMatchObject({ day: "2026-11-01", label: "Sun 1", no_contact: 1, interested: 0 });
    expect(data[3]).toMatchObject({ no_contact: 0, interested: 0 });
    // busy 1 + voicemail 3 on the 7th.
    expect(data[6]).toMatchObject({ day: "2026-11-07", label: "Sat 7", no_contact: 4, interested: 2 });
  });

  it("keeps a group's colour whichever groups are present", () => {
    const only = outcomeRows({ ...base, callsByOutcome7d: [{ day: "2026-11-07", outcome: "do_not_call", count: 1 }] }, DAYS, "America/Chicago");
    expect(only.outcomes).toEqual([{ key: "declined", label: "Declined or wrong number", color: "var(--series-4)" }]);
  });

  it("returns no series when there are no calls", () => {
    expect(outcomeRows({ ...base, callsByOutcome7d: [] }, DAYS, "America/Chicago").outcomes).toEqual([]);
  });

  it("labels rejection reasons", () => {
    expect(rejectionRows(base)).toEqual([{ key: "chain", label: "Chain", count: 4 }]);
  });
});

describe("pipeline stages", () => {
  it("counts discovered, qualified, leads, contacted and won with each stage's share of the one before", () => {
    const stages = pipelineStages(
      { ...base, businessesTotal: 200, businessesQualified: 50 },
      tiles({ queued: 10, contacted: 4, callback: 2, success: 3, failed: 1, skipped: 5 }),
    );
    expect(stages.map((s) => [s.key, s.count])).toEqual([
      ["discovered", 200],
      ["qualified", 50],
      ["leads", 25],
      // contacted + callback + success + failed; queued and skipped were never reached.
      ["contacted", 10],
      ["won", 3],
    ]);
    expect(stages.map((s) => s.shareOfPrevious)).toEqual([null, 0.25, 0.5, 0.4, 0.3]);
  });

  it("has no share for an empty previous stage or a stage larger than the one before", () => {
    const empty = pipelineStages({ ...base, businessesTotal: 0, businessesQualified: 0 }, tiles({}));
    expect(empty.map((s) => s.shareOfPrevious)).toEqual([null, null, null, null, null]);
    // Leads can be added from businesses that are not qualified.
    const more = pipelineStages({ ...base, businessesTotal: 10, businessesQualified: 2 }, tiles({ queued: 5 }));
    expect(more.find((s) => s.key === "leads")?.shareOfPrevious).toBeNull();
  });
});

describe("up next", () => {
  const call = (o: Partial<AttentionInput["callCampaigns"][number]>): AttentionInput["callCampaigns"][number] => ({
    id: "c1",
    name: "Houston roofers",
    status: "running",
    mode: "human",
    pauseReason: null,
    dailyCap: 40,
    pending: 12,
    completedToday: 4,
    ...o,
  });
  const input = (o: Partial<AttentionInput>): AttentionInput => ({
    callCampaigns: [],
    emailCampaigns: [],
    queuedLeads: 0,
    leadsTotal: 5,
    businessesTotal: 10,
    businessesReview: 0,
    ...o,
  });

  it("lists ready work first, then stuck campaigns, backlogs and drafts", () => {
    const items = buildAttention(
      input({
        callCampaigns: [
          call({ id: "draft", name: "Drafted", status: "draft" }),
          call({ id: "paused", name: "Austin plumbers", status: "paused", pauseReason: "manual", pending: 6 }),
          call({ id: "run" }),
        ],
        emailCampaigns: [{ id: "e1", name: "Winter check-in", status: "draft", pauseReason: null }],
        queuedLeads: 16,
        businessesReview: 28,
      }),
    );
    expect(items.map((i) => i.key)).toEqual(["dial-run", "paused-call-paused", "queued-leads", "review", "draft-call-draft", "draft-email-e1"]);
    expect(items[0]).toMatchObject({
      title: "Continue Houston roofers",
      detail: "12 waiting in the queue · 4 of 40 calls done today",
      href: "/calling/run/dial",
      cta: "Open dialer",
    });
    expect(items[2].title).toBe("16 leads not contacted yet");
    expect(items[3]).toMatchObject({ title: "28 businesses need a decision", href: "/businesses?qualification=review" });
  });

  it("leaves out what needs nobody: AI campaigns, empty queues and pauses that lift on their own", () => {
    const items = buildAttention(
      input({
        callCampaigns: [
          call({ id: "ai", mode: "ai" }),
          call({ id: "empty", pending: 0 }),
          call({ id: "cap", status: "paused", pauseReason: "daily_cap" }),
          call({ id: "hours", status: "paused", pauseReason: "outside_hours" }),
        ],
      }),
    );
    expect(items).toEqual([]);
  });

  it("uses the singular for one", () => {
    const items = buildAttention(input({ queuedLeads: 1, businessesReview: 1, callCampaigns: [call({ pending: 0 })] }));
    expect(items.map((i) => i.title)).toEqual(["1 lead not contacted yet", "1 business needs a decision"]);
  });

  it("suggests only the next missing setup step", () => {
    expect(buildAttention(input({ businessesTotal: 0, leadsTotal: 0 })).map((i) => i.key)).toEqual(["setup-discover"]);
    expect(buildAttention(input({ leadsTotal: 0 })).map((i) => i.key)).toEqual(["setup-leads"]);
    expect(buildAttention(input({})).map((i) => i.key)).toEqual(["setup-campaign"]);
    expect(buildAttention(input({ callCampaigns: [call({ pending: 0 })] }))).toEqual([]);
  });

  it("never returns more rows than the limit", () => {
    const many = Array.from({ length: 10 }, (_, i) => call({ id: `c${i}`, name: `Campaign ${i}` }));
    expect(buildAttention(input({ callCampaigns: many }))).toHaveLength(ATTENTION_LIMIT);
  });
});
