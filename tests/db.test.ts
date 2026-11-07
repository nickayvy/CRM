import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { count, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { seed } from "@/db/seed";
import {
  businesses,
  callCampaigns,
  callQueueItems,
  emailEnrollments,
  emailMessages,
  emailSteps,
  searchJobs,
} from "@/db/schema";
import { createTestDb } from "@/db/test-utils";
import { formatInTimeZone } from "date-fns-tz";

const chicagoDay = (d: Date) => formatInTimeZone(d, "America/Chicago", "yyyy-MM-dd");

const TABLES = [
  "qualification_rules",
  "search_jobs",
  "businesses",
  "activities",
  "call_campaigns",
  "call_queue_items",
  "email_campaigns",
  "email_steps",
  "email_enrollments",
  "email_messages",
];

let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});
afterAll(async () => {
  await close();
});

describe("createTestDb + seed", () => {
  it("starts migrated and empty", async () => {
    const [row] = await db.select({ n: count() }).from(businesses);
    expect(Number(row.n)).toBe(0);
  });

  let first: Record<string, number>;

  it("fills every table", async () => {
    first = await seed(db);
    expect(Object.keys(first).sort()).toEqual(
      [...TABLES, "businesses_qualified", "businesses_review", "businesses_rejected"].sort(),
    );
    // Engine results after the three fixture searches + requalifyAll: Houston 31/0/9 minus ABC Plumbing
    // (now multi_location), Dallas 26/0/4, Austin 26/0/4 (its ABC is already rejected for category_mismatch).
    expect(first.businesses_qualified).toBe(82);
    expect(first.businesses_review).toBe(0);
    expect(first.businesses_rejected).toBe(18);
    for (const t of TABLES) expect(first[t], t).toBeGreaterThan(0);
    expect(first.businesses).toBe(100);
    expect(first.search_jobs).toBe(3);
    expect(first.qualification_rules).toBe(1);
    expect(first.call_campaigns).toBe(2);
    expect(first.call_queue_items).toBe(25);
    expect(first.email_campaigns).toBe(1);
    expect(first.email_steps).toBe(3);
    expect(first.email_enrollments).toBe(8);
    expect(first.email_messages).toBe(4);
    expect(first.activities).toBeGreaterThanOrEqual(35);
    expect(first.activities).toBeLessThanOrEqual(45);
  });

  it("is idempotent", async () => {
    const second = await seed(db);
    expect(second).toEqual(first);
  });

  it("seeds the documented shape", async () => {
    const all = await db.select().from(businesses);
    expect(all.every((b) => b.qualifiedAt !== null && b.score > 0)).toBe(true);
    const abc = all.filter((b) => b.name === "ABC Plumbing");
    expect(abc).toHaveLength(3);
    expect(abc.every((b) => b.qualification === "rejected" && b.rejectionReasons.includes("multi_location"))).toBe(true);
    const jobs = await db.select().from(searchJobs);
    for (const j of jobs) {
      const mine = all.filter((b) => b.sourceJobId === j.id);
      expect(j.fetchedCount).toBe(mine.length);
      expect(j.apiCalls).toBe(1);
      expect(j.qualifiedCount).toBe(mine.filter((b) => b.qualification === "qualified").length);
      expect(j.rejectedCount).toBe(mine.filter((b) => b.qualification === "rejected").length);
      expect(j.status).toBe("completed");
    }
    expect(all.filter((b) => b.ownerName && b.ownerEmail)).toHaveLength(12);
    expect(new Set(all.map((b) => b.searchCategory))).toEqual(new Set(["plumbing", "hvac", "dentists"]));

    const [running] = await db.select().from(callCampaigns).where(eq(callCampaigns.status, "running"));
    const items = await db.select().from(callQueueItems).where(eq(callQueueItems.campaignId, running.id));
    expect(items).toHaveLength(25);
    const done = items.filter((i) => i.state === "completed");
    expect(done).toHaveLength(5);
    const today = chicagoDay(new Date());
    expect(done.every((i) => i.lastOutcome && i.lastOutcomeAt && chicagoDay(i.lastOutcomeAt) === today)).toBe(true);
    expect(await db.select().from(callCampaigns).where(eq(callCampaigns.status, "draft"))).toHaveLength(1);

    const enrollments = await db.select().from(emailEnrollments);
    const byId = new Map(all.map((b) => [b.id, b]));
    expect(items.every((i) => byId.get(i.businessId)?.qualification === "qualified")).toBe(true);
    expect(enrollments.every((e) => byId.get(e.businessId)?.qualification === "qualified")).toBe(true);
    expect(enrollments.every((e) => byId.get(e.businessId)?.ownerEmail)).toBe(true);
    const msgs = await db.select().from(emailMessages);
    expect(msgs.every((m) => m.status === "dry_run" && !m.bodyRendered.includes("{{"))).toBe(true);
    expect((await db.select().from(emailSteps)).map((s) => s.stepOrder).sort()).toEqual([1, 2, 3]);
  });
});
