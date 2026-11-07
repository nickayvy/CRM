import { describe, expect, it } from "vitest";
import type { DashboardStats } from "@/db/repo/dashboard";
import { funnelRows, outcomeRows, rejectionRows } from "@/features/dashboard/chart-data";

const base: DashboardStats = {
  businessesTotal: 3,
  businessesQualified: 1,
  businessesReview: 1,
  businessesRejected: 1,
  callsToday: 0,
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
  ],
  statusFunnel: [
    { status: "new", count: 2 },
    { status: "interested", count: 1 },
  ],
};
const DAYS = ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07"];

describe("dashboard chart rows", () => {
  it("fills every day with every present outcome, zeros included, in dialer order", () => {
    const { data, outcomes } = outcomeRows(base, DAYS, "America/Chicago");
    expect(outcomes.map((o) => o.key)).toEqual(["busy", "interested"]);
    expect(data).toHaveLength(7);
    expect(data[0]).toMatchObject({ day: "2026-11-01", label: "Sun 1", busy: 1, interested: 0 });
    expect(data[3]).toMatchObject({ busy: 0, interested: 0 });
    expect(data[6]).toMatchObject({ day: "2026-11-07", label: "Sat 7", busy: 1, interested: 2 });
  });

  it("returns no series when there are no calls", () => {
    expect(outcomeRows({ ...base, callsByOutcome7d: [] }, DAYS, "America/Chicago").outcomes).toEqual([]);
  });

  it("labels rejection reasons and statuses", () => {
    expect(rejectionRows(base)).toEqual([{ key: "chain", label: "Chain", count: 4 }]);
    expect(funnelRows(base).map((r) => r.label)).toEqual(["New", "Interested"]);
  });
});
