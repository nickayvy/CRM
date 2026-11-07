import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { countByQualification, countByReason, listBusinesses, updateBusinessCrm } from "@/db/repo/businesses";
import { updateRules } from "@/db/repo/rules";
import { createSearchJob } from "@/db/repo/search-jobs";
import { listActivities } from "@/db/repo/activities";
import { type Business, businesses } from "@/db/schema";
import { createTestDb } from "@/db/test-utils";
import { enrichBusiness, requalifyAll, runSearchJob } from "@/features/ingest/run";
import { createYelpClient } from "@/lib/yelp";

let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});
afterAll(async () => {
  await close();
});

async function reset() {
  await db.execute(sql`TRUNCATE TABLE businesses, search_jobs, activities, qualification_rules RESTART IDENTITY CASCADE`);
}

type Slug = "plumbing-houston" | "hvac-dallas" | "dentists-austin";
const SEARCHES: Record<Slug, { location: string; categoryAliases: string[] }> = {
  "plumbing-houston": { location: "Houston, TX", categoryAliases: ["plumbing"] },
  "hvac-dallas": { location: "Dallas, TX", categoryAliases: ["hvac"] },
  "dentists-austin": { location: "Austin, TX", categoryAliases: ["dentists"] },
};

async function ingest(slug: Slug) {
  const job = await createSearchJob(db, { ...SEARCHES[slug], radiusM: 20000, maxResults: 200 });
  return runSearchJob(db, job.id, createYelpClient({ mode: "fixture" }));
}

async function all(): Promise<Business[]> {
  return db.select().from(businesses);
}

describe("runSearchJob — plumbing-houston fixture traps (AC-03.2)", () => {
  let rows: Business[];
  beforeAll(async () => {
    await reset();
    const job = await ingest("plumbing-houston");
    expect(job.status).toBe("completed");
    expect(job.fetchedCount).toBe(40);
    expect(job.apiCalls).toBe(1);
    expect(job.qualifiedCount).toBe(31);
    expect(job.reviewCount).toBe(0);
    expect(job.rejectedCount).toBe(9);
    expect(job.error).toBeNull();
    expect(job.startedAt).toBeInstanceOf(Date);
    expect(job.finishedAt).toBeInstanceOf(Date);
    rows = await all();
  });

  it("stores 40 businesses with qualified 31 / review 0 / rejected 9", async () => {
    expect(rows).toHaveLength(40);
    expect(await countByQualification(db)).toEqual({ qualified: 31, review: 0, rejected: 9 });
  });

  it("produces the per-reason counts", async () => {
    const hard = (await countByReason(db)).filter((r) => r.reason !== "unclaimed" && r.reason !== "low_score");
    expect(Object.fromEntries(hard.map((r) => [r.reason, r.count]))).toEqual({
      chain: 2,
      category_mismatch: 1,
      closed: 1,
      out_of_area: 1,
      no_phone: 1,
      low_rating: 1,
      too_few_reviews: 1,
      duplicate_phone: 1,
    });
  });

  const expected: [string, string | undefined, "qualified" | "rejected", string[]][] = [
    ["Roto-Rooter Plumbing & Water Cleanup", undefined, "rejected", ["chain"]],
    ["Mr. Rooter Plumbing of Houston", undefined, "rejected", ["chain"]],
    ["Bayou City Lawn & Landscape", undefined, "rejected", ["category_mismatch"]],
    ["Gulf Coast Plumbing", undefined, "rejected", ["closed"]],
    ["Katy Drain Pros", undefined, "rejected", ["out_of_area"]],
    ["Handy Hank Plumbing", undefined, "rejected", ["no_phone"]],
    ["Quick Fix Plumbing", undefined, "rejected", ["low_rating"]],
    ["New Guy Plumbing LLC", undefined, "rejected", ["too_few_reviews"]],
    ["Reliable Plumbing Co", "6o552ZUTsPPtE1iYRssNwq", "qualified", []],
    ["Reliable Plumbing Co", "KGbIjTTqeO3ZENvfgpunYW", "rejected", ["duplicate_phone"]],
    ["Sugar Land Pipe Masters", undefined, "qualified", []],
    ["Dusty Wrench Plumbing", undefined, "qualified", []],
    ["ABC Plumbing", undefined, "qualified", []],
  ];
  it.each(expected)("%s (%s) → %s %j", (name, yelpId, qualification, reasons) => {
    const matches = rows.filter((b) => b.name === name && (!yelpId || b.yelpId === yelpId));
    expect(matches).toHaveLength(1);
    expect(matches[0].qualification).toBe(qualification);
    expect(matches[0].rejectionReasons).toEqual(reasons);
  });

  it("Dusty Wrench scores 69", () => {
    expect(rows.find((b) => b.name === "Dusty Wrench Plumbing")!.score).toBe(69);
  });

  it("every business not named in the trap table qualifies with no reasons", () => {
    // 40 rows − 13 named records = 27; plus the 4 named qualifiers (Reliable #1, Sugar Land, Dusty Wrench, ABC) = 31 qualified.
    const named = new Set(expected.map((e) => e[0]));
    const rest = rows.filter((b) => !named.has(b.name));
    expect(rest).toHaveLength(27);
    expect(rest.every((b) => b.qualification === "qualified" && b.rejectionReasons.length === 0)).toBe(true);
  });

  it("links every business to the job and its search category", async () => {
    expect(new Set(rows.map((b) => b.searchCategory))).toEqual(new Set(["plumbing"]));
    expect(new Set(rows.map((b) => b.sourceJobId)).size).toBe(1);
    expect(rows.every((b) => b.qualifiedAt instanceof Date)).toBe(true);
  });

  it("re-qualifying keeps the first duplicate-phone record qualified", async () => {
    const counts = await requalifyAll(db);
    expect(counts).toEqual({ qualified: 31, review: 0, rejected: 9 });
    const reliable = (await all()).filter((b) => b.name === "Reliable Plumbing Co");
    expect(reliable.find((b) => b.yelpId === "6o552ZUTsPPtE1iYRssNwq")!.qualification).toBe("qualified");
    expect(reliable.find((b) => b.yelpId === "KGbIjTTqeO3ZENvfgpunYW")!.rejectionReasons).toEqual(["duplicate_phone"]);
  });

  it("re-running the same job is idempotent and keeps CRM fields", async () => {
    const target = rows.find((b) => b.name === "Evergreen Plumbing")!;
    await updateBusinessCrm(db, target.id, { status: "interested", notes: "keep me", tags: ["vip"] });
    const job = await ingest("plumbing-houston");
    expect(job.fetchedCount).toBe(40);
    expect(await countByQualification(db)).toEqual({ qualified: 31, review: 0, rejected: 9 });
    const after = (await all()).find((b) => b.id === target.id)!;
    expect(after.status).toBe("interested");
    expect(after.notes).toBe("keep me");
    expect(after.tags).toEqual(["vip"]);
    expect(after.sourceJobId).toBe(job.id);
    expect((await all()).length).toBe(40);
  });
});

describe("multi-location (AC-03.3)", () => {
  beforeEach(reset);

  it("after only plumbing-houston, ABC Plumbing is not multi_location", async () => {
    await ingest("plumbing-houston");
    await requalifyAll(db);
    const abc = (await all()).filter((b) => b.name === "ABC Plumbing");
    expect(abc).toHaveLength(1);
    expect(abc[0].rejectionReasons).not.toContain("multi_location");
    expect(abc[0].qualification).toBe("qualified");
  });

  it("after two fixtures it is still not multi_location (threshold 3)", async () => {
    await ingest("plumbing-houston");
    await ingest("hvac-dallas");
    await requalifyAll(db);
    const abc = (await all()).filter((b) => b.name === "ABC Plumbing");
    expect(abc).toHaveLength(2);
    expect(abc.every((b) => !b.rejectionReasons.includes("multi_location"))).toBe(true);
  });

  it("after all three fixtures + requalifyAll, every ABC Plumbing row is multi_location", async () => {
    const jobs = [await ingest("plumbing-houston"), await ingest("hvac-dallas"), await ingest("dentists-austin")];
    expect(jobs.map((j) => [j.fetchedCount, j.qualifiedCount, j.rejectedCount])).toEqual([
      [40, 31, 9],
      [30, 26, 4],
      [30, 26, 4],
    ]);
    await requalifyAll(db);
    const abc = (await all()).filter((b) => b.name === "ABC Plumbing");
    expect(abc).toHaveLength(3);
    expect(new Set(abc.map((b) => b.city))).toEqual(new Set(["Houston", "Dallas", "Austin"]));
    for (const b of abc) {
      expect(b.rejectionReasons).toContain("multi_location");
      expect(b.qualification).toBe("rejected");
    }
    expect(abc.find((b) => b.city === "Houston")!.rejectionReasons).toEqual(["multi_location"]);
    expect(abc.find((b) => b.city === "Dallas")!.rejectionReasons).toEqual(["category_mismatch", "multi_location"]);
  });
});

describe("requalifyAll after rule change (AC-03.7)", () => {
  beforeAll(async () => {
    await reset();
    await ingest("plumbing-houston");
    await ingest("hvac-dallas");
    await ingest("dentists-austin");
  });

  it("minRating 4.5 rejects every business rated below 4.5 with low_rating", async () => {
    await updateRules(db, { minRating: "4.5" });
    const counts = await requalifyAll(db);
    expect(counts).toEqual(await countByQualification(db));
    expect(counts.qualified + counts.review + counts.rejected).toBe(100);
    const rows = await all();
    const below = rows.filter((b) => Number(b.rating) < 4.5);
    expect(below.length).toBeGreaterThan(0);
    for (const b of below) {
      expect(b.qualification).toBe("rejected");
      expect(b.rejectionReasons).toContain("low_rating");
    }
    expect(rows.filter((b) => Number(b.rating) >= 4.5).some((b) => b.rejectionReasons.includes("low_rating"))).toBe(false);
    await updateRules(db, { minRating: "3.5" });
  });
});

describe("enrichBusiness (AC-03.8)", () => {
  beforeAll(async () => {
    await reset();
    await ingest("plumbing-houston");
  });

  it("is_claimed:false fixture sets hours/photos/isClaimed/enrichedAt, lowers score by 10, adds unclaimed", async () => {
    const { rows } = await listBusinesses(db, { q: "Armadillo Plumbers" });
    const before = rows[0];
    expect(before.yelpId).toBe("7iNUtRD6-1_PkjO9UEgQlq");
    expect(before.isClaimed).toBeNull();
    const after = await enrichBusiness(db, before.id, createYelpClient({ mode: "fixture" }));
    expect(after.isClaimed).toBe(false);
    expect(after.photos).toHaveLength(3);
    expect(Array.isArray(after.hours) && after.hours.length).toBeTruthy();
    expect(after.enrichedAt).toBeInstanceOf(Date);
    expect(after.score).toBe(before.score - 10);
    expect(after.rejectionReasons).toContain("unclaimed");
    expect(after.qualification).toBe("qualified");
    const acts = await listActivities(db, before.id);
    expect(acts[0].type).toBe("system");
  });

  it("is_claimed:true fixture raises the score by 10", async () => {
    const { rows } = await listBusinesses(db, { q: "Montrose Plumbing" });
    const before = rows[0];
    const after = await enrichBusiness(db, before.id, createYelpClient({ mode: "fixture" }));
    expect(after.isClaimed).toBe(true);
    expect(after.score).toBe(Math.min(100, before.score + 10));
    expect(after.rejectionReasons).not.toContain("unclaimed");
  });

  it("a business without a detail fixture falls back to the search record (claimed, no photos)", async () => {
    const { rows } = await listBusinesses(db, { q: "Evergreen Plumbing & Repair" });
    const after = await enrichBusiness(db, rows[0].id, createYelpClient({ mode: "fixture" }));
    expect(after.isClaimed).toBe(true);
    expect(after.photos).toEqual([]);
    expect(after.enrichedAt).toBeInstanceOf(Date);
  });

  it("a later search upsert does not clear enrichment data", async () => {
    await ingest("plumbing-houston");
    const { rows } = await listBusinesses(db, { q: "Armadillo Plumbers" });
    expect(rows[0].isClaimed).toBe(false);
    expect(rows[0].photos).toHaveLength(3);
    expect(rows[0].rejectionReasons).toContain("unclaimed");
  });
});

describe("runSearchJob failure", () => {
  it("marks the job failed with the error message", async () => {
    await reset();
    const job = await createSearchJob(db, { location: "Houston, TX", categoryAliases: ["plumbing"] });
    const failing = createYelpClient({
      apiKey: "test",
      fetch: (async () => new Response("bad", { status: 400 })) as typeof fetch,
    });
    const res = await runSearchJob(db, job.id, failing);
    expect(res.status).toBe("failed");
    expect(res.error).toMatch(/400/);
    expect(res.apiCalls).toBe(1);
  });
});
