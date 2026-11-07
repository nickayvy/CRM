import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { createSearchJob, getSearchJob, listSearchJobs, updateSearchJob } from "@/db/repo/search-jobs";
import { searchJobs } from "@/db/schema";
import { createTestDb } from "@/db/test-utils";

let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});
afterAll(async () => {
  await close();
});
beforeEach(async () => {
  await db.execute(sql`TRUNCATE TABLE search_jobs RESTART IDENTITY CASCADE`);
});

const UNKNOWN_UUID = "00000000-0000-4000-8000-000000000000";

describe("createSearchJob", () => {
  it("applies defaults: radiusM 20000, maxResults 200, pending, zero counts", async () => {
    const job = await createSearchJob(db, { location: "Houston, TX", categoryAliases: ["plumbing"] });
    expect(job.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(job.radiusM).toBe(20000);
    expect(job.maxResults).toBe(200);
    expect(job.status).toBe("pending");
    expect(job.fetchedCount).toBe(0);
    expect(job.qualifiedCount).toBe(0);
    expect(job.reviewCount).toBe(0);
    expect(job.rejectedCount).toBe(0);
    expect(job.apiCalls).toBe(0);
    expect(job.term).toBeNull();
    expect(job.error).toBeNull();
    expect(job.startedAt).toBeNull();
    expect(job.finishedAt).toBeNull();
    expect(job.createdAt).toBeInstanceOf(Date);
    expect(job.categoryAliases).toEqual(["plumbing"]);
  });

  it("uses explicit radiusM and maxResults", async () => {
    const job = await createSearchJob(db, {
      location: "Dallas, TX",
      categoryAliases: ["hvac"],
      radiusM: 5000,
      maxResults: 40,
    });
    expect(job.radiusM).toBe(5000);
    expect(job.maxResults).toBe(40);
  });

  it("trims location and term", async () => {
    const job = await createSearchJob(db, {
      term: "  emergency plumber  ",
      location: "  Austin, TX  ",
      categoryAliases: ["plumbing"],
    });
    expect(job.location).toBe("Austin, TX");
    expect(job.term).toBe("emergency plumber");
  });

  it("stores an empty or whitespace-only term as null", async () => {
    const a = await createSearchJob(db, { term: "", location: "Austin, TX", categoryAliases: [] });
    const b = await createSearchJob(db, { term: "   ", location: "Austin, TX", categoryAliases: [] });
    expect(a.term).toBeNull();
    expect(b.term).toBeNull();
  });

  it("trims category aliases and drops blank ones", async () => {
    const job = await createSearchJob(db, {
      location: "Austin, TX",
      categoryAliases: [" plumbing ", "", "   ", "hvac"],
    });
    expect(job.categoryAliases).toEqual(["plumbing", "hvac"]);
  });
});

describe("getSearchJob", () => {
  it("returns the job when found", async () => {
    const job = await createSearchJob(db, { location: "Houston, TX", categoryAliases: ["plumbing"] });
    const found = await getSearchJob(db, job.id);
    expect(found).toEqual(job);
  });

  it("returns null for an unknown uuid", async () => {
    expect(await getSearchJob(db, UNKNOWN_UUID)).toBeNull();
  });

  it("returns null for a non-uuid id", async () => {
    expect(await getSearchJob(db, "not-a-uuid")).toBeNull();
    expect(await getSearchJob(db, "")).toBeNull();
  });
});

describe("listSearchJobs", () => {
  async function seed(n: number): Promise<string[]> {
    // Explicit createdAt values keep the ordering deterministic.
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const [row] = await db
        .insert(searchJobs)
        .values({
          location: `City ${i}`,
          categoryAliases: ["plumbing"],
          createdAt: new Date(Date.UTC(2026, 0, 1 + i)),
        })
        .returning({ id: searchJobs.id });
      ids.push(row.id);
    }
    return ids;
  }

  it("returns an empty list when there are no jobs", async () => {
    expect(await listSearchJobs(db)).toEqual([]);
  });

  it("returns newest first", async () => {
    const ids = await seed(4);
    const rows = await listSearchJobs(db);
    expect(rows.map((r) => r.id)).toEqual([...ids].reverse());
  });

  it("honours limit", async () => {
    const ids = await seed(5);
    const rows = await listSearchJobs(db, 2);
    expect(rows.map((r) => r.id)).toEqual([ids[4], ids[3]]);
    expect(await listSearchJobs(db, 100)).toHaveLength(5);
  });
});

describe("updateSearchJob", () => {
  it("patches status, counts and timestamps", async () => {
    const job = await createSearchJob(db, { location: "Houston, TX", categoryAliases: ["plumbing"] });
    const startedAt = new Date("2026-03-01T10:00:00Z");
    const finishedAt = new Date("2026-03-01T10:05:00Z");
    await updateSearchJob(db, job.id, {
      status: "completed",
      fetchedCount: 40,
      qualifiedCount: 31,
      reviewCount: 2,
      rejectedCount: 7,
      apiCalls: 1,
      startedAt,
      finishedAt,
    });
    const after = await getSearchJob(db, job.id);
    expect(after).toMatchObject({
      status: "completed",
      fetchedCount: 40,
      qualifiedCount: 31,
      reviewCount: 2,
      rejectedCount: 7,
      apiCalls: 1,
      error: null,
    });
    expect(after?.startedAt?.toISOString()).toBe(startedAt.toISOString());
    expect(after?.finishedAt?.toISOString()).toBe(finishedAt.toISOString());
    // Untouched fields stay as they were.
    expect(after?.location).toBe("Houston, TX");
    expect(after?.radiusM).toBe(20000);
  });

  it("stores an error message with a failed status", async () => {
    const job = await createSearchJob(db, { location: "Houston, TX", categoryAliases: ["plumbing"] });
    await updateSearchJob(db, job.id, { status: "failed", error: "Yelp 429" });
    const after = await getSearchJob(db, job.id);
    expect(after?.status).toBe("failed");
    expect(after?.error).toBe("Yelp 429");
  });

  it("only changes the targeted job", async () => {
    const a = await createSearchJob(db, { location: "A", categoryAliases: [] });
    const b = await createSearchJob(db, { location: "B", categoryAliases: [] });
    await updateSearchJob(db, a.id, { status: "running" });
    expect((await getSearchJob(db, a.id))?.status).toBe("running");
    expect((await getSearchJob(db, b.id))?.status).toBe("pending");
  });

  it("ignores id and createdAt in the patch", async () => {
    const job = await createSearchJob(db, { location: "Houston, TX", categoryAliases: [] });
    await updateSearchJob(db, job.id, {
      id: UNKNOWN_UUID,
      createdAt: new Date("2000-01-01T00:00:00Z"),
      status: "running",
    });
    const after = await getSearchJob(db, job.id);
    expect(after?.id).toBe(job.id);
    expect(after?.createdAt.toISOString()).toBe(job.createdAt.toISOString());
    expect(after?.status).toBe("running");
    expect(await getSearchJob(db, UNKNOWN_UUID)).toBeNull();
  });

  it("is a no-op for an empty patch or an unknown id", async () => {
    const job = await createSearchJob(db, { location: "Houston, TX", categoryAliases: [] });
    await expect(updateSearchJob(db, job.id, {})).resolves.toBeUndefined();
    await expect(updateSearchJob(db, UNKNOWN_UUID, { status: "running" })).resolves.toBeUndefined();
    expect(await getSearchJob(db, job.id)).toEqual(job);
  });
});
