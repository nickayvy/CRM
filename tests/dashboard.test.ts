// AC-07.1: every DashboardStats field equals a value computed here with
// hand-written SQL over the tables (no repo calls for the expected values).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { getDashboardStats, sevenDayWindow, type DashboardStats } from "@/db/repo/dashboard";
import { activities, businesses, callCampaigns, callQueueItems, emailEnrollments, emailMessages } from "@/db/schema";
import { seed } from "@/db/seed";
import { createTestDb } from "@/db/test-utils";
import { env } from "@/lib/env";

const TZ = env.APP_TIMEZONE;
// 12:30 in Chicago on a Saturday (CST, UTC-6).
const NOW = new Date("2026-11-07T18:30:00Z");
const HOUR = 3_600_000;

let db: Db;
let close: () => Promise<void>;
let stats: DashboardStats;

function rowsOf<T>(res: unknown): T[] {
  return (Array.isArray(res) ? res : ((res as { rows?: T[] }).rows ?? [])) as T[];
}

async function q<T>(query: ReturnType<typeof sql>): Promise<T[]> {
  return rowsOf<T>(await db.execute(query));
}

async function one(query: ReturnType<typeof sql>): Promise<number> {
  const [r] = await q<{ n: number | string }>(query);
  return Number(r?.n ?? 0);
}

const nowSql = sql`${NOW.toISOString()}::timestamptz`;
const localDate = (col: string) => sql.raw(`(${col} AT TIME ZONE '${TZ}')::date`);
const todayLocal = sql.raw(`(timestamptz '${NOW.toISOString()}' AT TIME ZONE '${TZ}')::date`);

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  await seed(db, { now: NOW });

  // Extra rows so every number is non-trivial and the window edges are exercised.
  const [campaign] = await db.select().from(callCampaigns).where(eq(callCampaigns.status, "running"));
  const pending = await db
    .select()
    .from(callQueueItems)
    .where(sql`${callQueueItems.campaignId} = ${campaign.id} AND ${callQueueItems.state} = 'pending'`)
    .limit(4);
  // Two overdue callbacks, one due later today (not overdue), one exactly now (not overdue: strict <).
  const callbackTimes = [new Date(NOW.getTime() - 2 * HOUR), new Date(NOW.getTime() - 26 * HOUR), new Date(NOW.getTime() + 2 * HOUR), NOW];
  for (const [i, item] of pending.entries()) {
    await db
      .update(callQueueItems)
      .set({ state: "callback", callbackAt: callbackTimes[i], lastOutcome: "callback", attempts: 1 })
      .where(eq(callQueueItems.id, item.id));
  }

  const [b] = await db.select().from(businesses).where(eq(businesses.qualification, "qualified")).limit(1);
  const call = (occurredAt: Date, outcome: string) => ({
    businessId: b.id,
    type: "call" as const,
    outcome,
    body: "",
    campaignType: "call",
    campaignId: campaign.id,
    occurredAt,
  });
  // Local midnight today in Chicago is 06:00Z.
  await db.insert(activities).values([
    call(new Date("2026-11-07T06:00:30Z"), "interested"), // just after local midnight: today
    call(new Date("2026-11-07T05:59:00Z"), "voicemail"), // just before: yesterday, inside the 7-day window
    call(new Date("2026-11-01T06:30:00Z"), "busy"), // Nov 1 01:30 CDT (DST ends that day): first day of the window
    call(new Date("2026-10-31T12:00:00Z"), "interested"), // Oct 31: outside the window
    call(new Date(NOW.getTime() + HOUR), "interested"), // future: never counted in the rate
  ]);

  // Emails: one dry run today, one failed today (not counted), one sent yesterday local.
  const [enr] = await db.select().from(emailEnrollments).limit(1);
  const msg = (createdAt: Date, status: "sent" | "dry_run" | "failed") => ({
    enrollmentId: enr.id,
    businessId: enr.businessId,
    toEmail: "x@example.com",
    subject: "s",
    bodyRendered: "b",
    status,
    sentAt: status === "failed" ? null : createdAt,
    createdAt,
  });
  await db
    .insert(emailMessages)
    .values([
      msg(new Date("2026-11-07T07:00:00Z"), "dry_run"),
      msg(new Date("2026-11-07T08:00:00Z"), "sent"),
      msg(new Date("2026-11-07T09:00:00Z"), "failed"),
      msg(new Date("2026-11-07T05:00:00Z"), "sent"),
    ]);

  stats = await getDashboardStats(db, NOW);
});

afterAll(async () => {
  await close();
});

describe("getDashboardStats on a seeded DB", () => {
  it("businesses by qualification", async () => {
    const total = await one(sql`SELECT count(*) AS n FROM businesses`);
    expect(total).toBe(100);
    expect(stats.businessesTotal).toBe(total);
    expect(stats.businessesQualified).toBe(await one(sql`SELECT count(*) AS n FROM businesses WHERE qualification = 'qualified'`));
    expect(stats.businessesReview).toBe(await one(sql`SELECT count(*) AS n FROM businesses WHERE qualification = 'review'`));
    expect(stats.businessesRejected).toBe(await one(sql`SELECT count(*) AS n FROM businesses WHERE qualification = 'rejected'`));
  });

  it("callsToday counts call activities on today's local date", async () => {
    const expected = await one(
      sql`SELECT count(*) AS n FROM activities WHERE type = 'call' AND ${localDate("occurred_at")} = ${todayLocal}`,
    );
    // Seed: 5 outcomes today; plus the 00:00:30 call and the call one hour from now.
    expect(expected).toBe(7);
    expect(stats.callsToday).toBe(expected);
  });

  it("interestRate7d = interested / all call outcomes over today and the 6 previous local days", async () => {
    const [r] = await q<{ interested: string | number; total: string | number }>(sql`
      SELECT count(*) FILTER (WHERE outcome = 'interested') AS interested, count(*) AS total
      FROM activities
      WHERE type = 'call' AND outcome IS NOT NULL
        AND ${localDate("occurred_at")} BETWEEN ${todayLocal} - 6 AND ${todayLocal}
        AND occurred_at <= ${nowSql}`);
    const interested = Number(r.interested);
    const total = Number(r.total);
    expect(total).toBeGreaterThan(0);
    expect(interested).toBeGreaterThan(0);
    expect(stats.interestRate7d).toBeCloseTo(interested / total, 10);
  });

  it("emailsSentToday counts sent + dry_run messages created today (local)", async () => {
    const expected = await one(sql`
      SELECT count(*) AS n FROM email_messages
      WHERE status IN ('sent', 'dry_run') AND ${localDate("created_at")} = ${todayLocal}`);
    expect(expected).toBe(2);
    expect(stats.emailsSentToday).toBe(expected);
  });

  it("running campaigns", async () => {
    expect(stats.runningCallCampaigns).toBe(await one(sql`SELECT count(*) AS n FROM call_campaigns WHERE status = 'running'`));
    expect(stats.runningEmailCampaigns).toBe(await one(sql`SELECT count(*) AS n FROM email_campaigns WHERE status = 'running'`));
    expect(stats.runningCallCampaigns).toBe(1);
    expect(stats.runningEmailCampaigns).toBe(1);
  });

  it("overdueCallbacks = callback items with callbackAt < now", async () => {
    const expected = await one(
      sql`SELECT count(*) AS n FROM call_queue_items WHERE state = 'callback' AND callback_at < ${nowSql}`,
    );
    expect(expected).toBe(2);
    expect(stats.overdueCallbacks).toBe(expected);
  });

  it("rejectionBreakdown counts hard reasons only", async () => {
    const expected = await q<{ reason: string; n: string | number }>(sql`
      SELECT r AS reason, count(*) AS n FROM businesses, unnest(rejection_reasons) AS r
      WHERE r NOT IN ('unclaimed', 'low_score') GROUP BY r`);
    const got = Object.fromEntries(stats.rejectionBreakdown.map((r) => [r.reason, r.count]));
    expect(got).toEqual(Object.fromEntries(expected.map((r) => [r.reason, Number(r.n)])));
    const counts = stats.rejectionBreakdown.map((r) => r.count);
    expect([...counts].sort((a, b) => b - a)).toEqual(counts);
  });

  it("callsByOutcome7d buckets by local day and outcome", async () => {
    const expected = await q<{ day: string; outcome: string; n: string | number }>(sql`
      SELECT to_char(occurred_at AT TIME ZONE ${TZ}, 'YYYY-MM-DD') AS day, outcome, count(*) AS n
      FROM activities
      WHERE type = 'call' AND outcome IS NOT NULL
        AND ${localDate("occurred_at")} BETWEEN ${todayLocal} - 6 AND ${todayLocal}
        AND occurred_at <= ${nowSql}
      GROUP BY 1, 2 ORDER BY 1, 2`);
    expect(stats.callsByOutcome7d).toEqual(expected.map((r) => ({ day: r.day, outcome: r.outcome, count: Number(r.n) })));
    const days = new Set(stats.callsByOutcome7d.map((c) => c.day));
    expect(days.has("2026-11-01")).toBe(true);
    expect(days.has("2026-10-31")).toBe(false);
    // Total equals the rate's denominator.
    const total = stats.callsByOutcome7d.reduce((s, c) => s + c.count, 0);
    const interested = stats.callsByOutcome7d.filter((c) => c.outcome === "interested").reduce((s, c) => s + c.count, 0);
    expect(stats.interestRate7d).toBeCloseTo(interested / total, 10);
  });

  it("statusFunnel lists every status with its count", async () => {
    const expected = await q<{ status: string; n: string | number }>(sql`SELECT status, count(*) AS n FROM businesses GROUP BY status`);
    const exp = Object.fromEntries(expected.map((r) => [r.status, Number(r.n)]));
    expect(stats.statusFunnel).toHaveLength(7);
    for (const s of stats.statusFunnel) expect(s.count).toBe(exp[s.status] ?? 0);
    expect(stats.statusFunnel.reduce((s, x) => s + x.count, 0)).toBe(100);
  });
});

describe("edge cases", () => {
  it("interestRate7d is 0 with no calls in the window", async () => {
    const empty = await getDashboardStats(db, new Date("2030-01-01T18:00:00Z"));
    expect(empty.interestRate7d).toBe(0);
    expect(empty.callsByOutcome7d).toEqual([]);
    expect(empty.callsToday).toBe(0);
  });

  it("sevenDayWindow spans 7 local days across a DST change", () => {
    const w = sevenDayWindow(NOW, "America/Chicago");
    expect(w.days).toEqual(["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07"]);
    expect(w.start.toISOString()).toBe("2026-11-01T05:00:00.000Z"); // midnight CDT
    expect(w.end.toISOString()).toBe("2026-11-08T06:00:00.000Z"); // midnight CST
  });
});
