import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { countByQualification, listBusinesses } from "@/db/repo/businesses";
import { getRules } from "@/db/repo/rules";
import { getSearchJob } from "@/db/repo/search-jobs";
import { createTestDb } from "@/db/test-utils";

const pending: (() => unknown)[] = [];
vi.mock("next/server", () => ({ after: (cb: () => unknown) => void pending.push(cb) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { enrichAction, requalifyAllAction, startSearchAction, updateRulesAction } = await import(
  "@/features/ingest/actions"
);

let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  // Actions call getDb(); point the process-wide handle at the test DB.
  globalThis.__db = { db, driver: "pglite", close };
  vi.stubEnv("YELP_API_KEY", "");
  vi.stubEnv("YELP_MODE", "fixture");
});
afterAll(async () => {
  globalThis.__db = undefined;
  vi.unstubAllEnvs();
  await close();
});
beforeEach(() => {
  pending.length = 0;
});

function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

async function flushAfter() {
  for (const cb of pending.splice(0)) await cb();
}

describe("startSearchAction", () => {
  beforeAll(async () => {
    await db.execute(sql`TRUNCATE TABLE businesses, search_jobs, activities, qualification_rules CASCADE`);
  });

  it("validates location, categories, radius and maxResults", async () => {
    const r = await startSearchAction(null, form({ location: " ", categoryAliases: "", radiusM: "100", maxResults: "5000" }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(Object.keys(r.fieldErrors ?? {}).sort()).toEqual(["categoryAliases", "location", "maxResults", "radiusM"]);
    expect(pending).toHaveLength(0);
    const r2 = await startSearchAction(null, form({ location: "Houston, TX", categoryAliases: "plumbing", radiusM: "40001" }));
    expect(r2.ok).toBe(false);
    const r3 = await startSearchAction(null, form({ location: "Houston, TX", categoryAliases: "plumbing", maxResults: "0" }));
    expect(r3.ok).toBe(false);
  });

  it("creates the job, returns at once, and runs it in after()", async () => {
    const r = await startSearchAction(
      null,
      form({ location: "Houston, TX", categoryAliases: "Plumbing, ", radiusM: "20000", maxResults: "200", term: "" }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const queued = await getSearchJob(db, r.data.jobId);
    expect(queued?.status).toBe("pending");
    expect(queued?.categoryAliases).toEqual(["plumbing"]);
    expect(queued?.term).toBeNull();
    expect(pending).toHaveLength(1);
    await flushAfter();
    const done = await getSearchJob(db, r.data.jobId);
    expect(done).toMatchObject({ status: "completed", fetchedCount: 40, qualifiedCount: 31, rejectedCount: 9, apiCalls: 1 });
  });

  it("defaults radius and maxResults when blank", async () => {
    const r = await startSearchAction(null, form({ location: "Dallas, TX", categoryAliases: "hvac", radiusM: "", maxResults: "" }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(await getSearchJob(db, r.data.jobId)).toMatchObject({ radiusM: 20000, maxResults: 200 });
  });
});

describe("enrichAction / requalifyAllAction / updateRulesAction", () => {
  it("enrichAction enriches and re-scores; unknown id fails cleanly", async () => {
    const { rows } = await listBusinesses(db, { q: "Armadillo Plumbers" });
    const r = await enrichAction(rows[0].id);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.isClaimed).toBe(false);
    const bad = await enrichAction("00000000-0000-4000-8000-000000000000");
    expect(bad).toEqual({ ok: false, message: "Business not found." });
  });

  it("updateRulesAction validates and saves every field", async () => {
    const bad = await updateRulesAction(null, form({ minRating: "6", reviewScoreBelow: "abc" }));
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(Object.keys(bad.fieldErrors ?? {}).sort()).toEqual(["minRating", "reviewScoreBelow"]);

    const r = await updateRulesAction(
      null,
      form({
        minRating: "4.5",
        minReviews: "10",
        maxReviews: "",
        requirePhone: "on",
        rejectClosed: "on",
        rejectChains: "on",
        categoryStrict: "on",
        chainPatterns: "Roto-Rooter\n\n  mr. rooter \nroto-rooter",
        distanceTolerancePct: "15",
        multiLocationThreshold: "3",
        reviewScoreBelow: "40",
      }),
    );
    expect(r.ok).toBe(true);
    const rules = await getRules(db);
    expect(rules).toMatchObject({
      minRating: "4.5",
      minReviews: 10,
      maxReviews: null,
      requirePhone: true,
      categoryStrict: true,
      chainPatterns: ["roto-rooter", "mr. rooter"],
      distanceTolerancePct: 15,
    });
    const off = await updateRulesAction(null, form({ minRating: "3.5", maxReviews: "500", chainPatterns: "" }));
    expect(off.ok).toBe(true);
    expect(await getRules(db)).toMatchObject({ requirePhone: false, rejectChains: false, maxReviews: 500, chainPatterns: [] });
  });

  it("requalifyAllAction returns the counts", async () => {
    const r = await requalifyAllAction();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data).toEqual(await countByQualification(db));
  });
});
