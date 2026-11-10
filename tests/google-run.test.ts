// AC-18.9 (resumable slices, lease), AC-18.10 (cap), AC-18.11 (errors, saturation),
// AC-18.12 (qualification of Google rows), AC-18.13 (review snapshots).
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { asc, eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { getBusiness } from "@/db/repo/businesses";
import { upsertBusinessByTrustpilotId } from "@/db/repo/discovery";
import { GOOGLE_PLACES_PROVIDER, acquireJobLease, createGoogleJob, getBusinessByPlaceId, getUsage } from "@/db/repo/google";
import { getSearchJob } from "@/db/repo/search-jobs";
import { businesses, reviewSnapshots } from "@/db/schema";
import { createTestDb } from "@/db/test-utils";
import { ingestGooglePlace, runGoogleJobSlice } from "@/features/google/run";
import { qualifyOne, requalifyAll } from "@/features/ingest/run";
import { createPlacesClient } from "@/lib/google-places/client";
import { type PlanInput, planGoogleSearch } from "@/lib/google-places/plan";
import type { GooglePlace } from "@/lib/google-places/types";
import { makeTrustpilotRow } from "./helpers/builders";
import { createFakePlaces, fakeError, makeGooglePlace } from "./helpers/fake-places";

let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});
afterAll(async () => {
  await close();
});
beforeEach(async () => {
  await db.execute(sql`TRUNCATE TABLE businesses, search_jobs, api_usage, review_snapshots, qualification_rules RESTART IDENTITY CASCADE`);
});

/** Six searches: terms a, b, c × zips 75201, 75202. */
const SIX: PlanInput = { terms: ["a", "b", "c"], area: "75201, 75202" };
const QUERIES = ["a 75201", "b 75201", "c 75201", "a 75202", "b 75202", "c 75202"];

async function job(input: PlanInput) {
  return createGoogleJob(db, await planGoogleSearch(input));
}

/** One distinct place per query, so every search is one page. */
const onePerQuery = () => {
  const byQuery = new Map<string, GooglePlace[]>();
  return (q: string) => {
    if (!byQuery.has(q)) byQuery.set(q, [makeGooglePlace()]);
    return byQuery.get(q)!;
  };
};

describe("runGoogleJobSlice: resumable slices and the lease (AC-18.9)", () => {
  it("6 searches of 100 ms with a budget for 2 → more, more, completed; each search once; queriesDone 2, 4, 6", async () => {
    const j = await job(SIX);
    let t = 0;
    const now = () => t;
    const fake = createFakePlaces({ results: onePerQuery(), onRequest: () => (t += 100) });
    const budgetMs = 15_150; // 15 s floor + room for two 100 ms searches

    const outcomes: string[] = [];
    const done: number[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await runGoogleJobSlice(db, fake, j.id, { budgetMs, cap: 1000, now });
      outcomes.push(r.outcome);
      done.push(r.job.queriesDone);
    }
    expect(outcomes).toEqual(["more", "more", "completed"]);
    expect(done).toEqual([2, 4, 6]);
    expect(fake.requests.map((r) => r.textQuery)).toEqual(QUERIES);

    const final = (await getSearchJob(db, j.id))!;
    expect(final).toMatchObject({
      status: "completed",
      queriesDone: 6,
      queriesTotal: 6,
      fetchedCount: 6,
      newCount: 6,
      matchedCount: 0,
      apiCalls: 6,
      error: null,
      leaseExpiresAt: null,
    });
    expect(final.startedAt).not.toBeNull();
    expect(final.finishedAt).not.toBeNull();
    expect(final.qualifiedCount + final.reviewCount + final.rejectedCount).toBe(6);
    // Requests carry the zip-centre bias and US region.
    expect(fake.requests[0]).toMatchObject({ regionCode: "US", locationBias: { radiusM: 8000 } });
    expect(fake.requests[0].locationBias?.latitude).toBeCloseTo(32.79, 0);
    // A completed job is a no-op.
    expect((await runGoogleJobSlice(db, fake, j.id, { budgetMs, cap: 1000, now })).outcome).toBe("completed");
    expect(fake.requests).toHaveLength(6);
  });

  it("a slice started while another holds the lease returns busy and sends nothing", async () => {
    const j = await job(SIX);
    await acquireJobLease(db, j.id);
    const fake = createFakePlaces({ results: onePerQuery() });
    const r = await runGoogleJobSlice(db, fake, j.id, { budgetMs: 60_000, cap: 1000 });
    expect(r.outcome).toBe("busy");
    expect(fake.requests).toHaveLength(0);
    expect(await getUsage(db, GOOGLE_PLACES_PROVIDER)).toBe(0);
    expect((await getSearchJob(db, j.id))!.queriesDone).toBe(0);
  });

  it("two concurrent slices: one runs, the other is busy", async () => {
    const j = await job(SIX);
    const fake = createFakePlaces({ results: onePerQuery() });
    const [a, b] = await Promise.all([
      runGoogleJobSlice(db, fake, j.id, { budgetMs: 60_000, cap: 1000 }),
      runGoogleJobSlice(db, fake, j.id, { budgetMs: 60_000, cap: 1000 }),
    ]);
    expect([a.outcome, b.outcome].sort()).toEqual(["busy", "completed"]);
    expect(fake.requests.map((r) => r.textQuery)).toEqual(QUERIES);
  });

  it("a place returned by searches in two slices is counted once", async () => {
    const shared = makeGooglePlace();
    const j = await job({ terms: ["a", "b"], area: "75201" });
    let t = 0;
    const fake = createFakePlaces({ results: () => [shared], onRequest: () => (t += 100) });
    await runGoogleJobSlice(db, fake, j.id, { budgetMs: 15_050, cap: 1000, now: () => t });
    const r = await runGoogleJobSlice(db, fake, j.id, { budgetMs: 15_050, cap: 1000, now: () => t });
    expect(r.outcome).toBe("completed");
    expect(r.job).toMatchObject({ fetchedCount: 1, newCount: 1, apiCalls: 2 });
  });
});

describe("runGoogleJobSlice: monthly cap (AC-18.10)", () => {
  it("cap 5 → the sixth request is never sent, capped, running with the cap named; cap 100 resumes at the same search", async () => {
    const j = await job(SIX);
    const fake = createFakePlaces({ results: onePerQuery() });
    const r1 = await runGoogleJobSlice(db, fake, j.id, { budgetMs: 60_000, cap: 5 });
    expect(r1.outcome).toBe("capped");
    expect(fake.requests).toHaveLength(5);
    expect(r1.job.status).toBe("running");
    expect(r1.job.queriesDone).toBe(5);
    expect(r1.job.error).toMatch(/cap of 5/);
    expect(r1.job.error).toMatch(/GOOGLE_PLACES_MONTHLY_REQUEST_CAP/);
    expect(await getUsage(db, GOOGLE_PLACES_PROVIDER)).toBe(5);

    // Still capped: nothing sent.
    expect((await runGoogleJobSlice(db, fake, j.id, { budgetMs: 60_000, cap: 5 })).outcome).toBe("capped");
    expect(fake.requests).toHaveLength(5);

    const r2 = await runGoogleJobSlice(db, fake, j.id, { budgetMs: 60_000, cap: 100 });
    expect(r2.outcome).toBe("completed");
    expect(fake.requests.map((r) => r.textQuery)).toEqual(QUERIES);
    expect(r2.job).toMatchObject({ status: "completed", queriesDone: 6, error: null, apiCalls: 6 });
    expect(await getUsage(db, GOOGLE_PLACES_PROVIDER)).toBe(fake.requests.length);
  });

  it("defaults to GOOGLE_PLACES_MONTHLY_REQUEST_CAP", async () => {
    vi.stubEnv("GOOGLE_PLACES_MONTHLY_REQUEST_CAP", "2");
    try {
      const j = await job(SIX);
      const fake = createFakePlaces({ results: onePerQuery() });
      expect((await runGoogleJobSlice(db, fake, j.id, { budgetMs: 60_000 })).outcome).toBe("capped");
      expect(fake.requests).toHaveLength(2);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("runGoogleJobSlice: errors and saturation (AC-18.11)", () => {
  it("a fatal error fails the job with the message and never the key", async () => {
    const KEY = "AIzaSECRETSECRETSECRETSECRETSECRET12345";
    const fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({ error: { code: 403, message: `API key ${KEY} is not authorized for Places API (New).`, status: "PERMISSION_DENIED" } }),
        { status: 403 },
      ),
    );
    const client = createPlacesClient(KEY, { fetch: fetch as unknown as typeof globalThis.fetch });
    const j = await job(SIX);
    const r = await runGoogleJobSlice(db, client, j.id, { budgetMs: 60_000, cap: 100 });
    expect(r.outcome).toBe("failed");
    expect(r.job.status).toBe("failed");
    expect(r.job.error).toMatch(/403 PERMISSION_DENIED/);
    expect(r.job.error).not.toContain(KEY);
    expect(JSON.stringify(r.job)).not.toContain(KEY);
    expect(fetch).toHaveBeenCalledTimes(1); // fatal: no retry
    expect(r.job.finishedAt).not.toBeNull();
    expect((await runGoogleJobSlice(db, client, j.id, { budgetMs: 60_000, cap: 100 })).outcome).toBe("failed");
  });

  it("a 429 → rate_limited, queriesDone unchanged, pause message; the next slice retries the same search", async () => {
    const j = await job(SIX);
    let limited = true;
    const fake = createFakePlaces({
      results: onePerQuery(),
      fail: (req) => (limited && req.textQuery === "b 75201" ? fakeError("429") : null),
    });
    const r = await runGoogleJobSlice(db, fake, j.id, { budgetMs: 60_000, cap: 100 });
    expect(r.outcome).toBe("rate_limited");
    expect(r.job).toMatchObject({ status: "running", queriesDone: 1 });
    expect(r.job.error).toMatch(/rate limit/i);
    limited = false;
    const r2 = await runGoogleJobSlice(db, fake, j.id, { budgetMs: 60_000, cap: 100 });
    expect(r2.outcome).toBe("completed");
    expect(r2.job.error).toBeNull();
    expect(fake.requests.map((x) => x.textQuery)).toEqual(["a 75201", "b 75201", ...QUERIES.slice(1)]);
  });

  it("a search failing twice with a 500 is recorded in plan.errors and the job continues", async () => {
    const j = await job(SIX);
    const fake = createFakePlaces({
      results: onePerQuery(),
      fail: (req, n) => (req.textQuery === "c 75201" && n <= 2 ? fakeError("500") : null),
    });
    const r = await runGoogleJobSlice(db, fake, j.id, { budgetMs: 60_000, cap: 100 });
    expect(r.outcome).toBe("completed");
    expect(fake.requests.filter((x) => x.textQuery === "c 75201")).toHaveLength(2);
    expect(r.job.plan?.errors).toEqual([{ term: "c", zip: "75201", message: expect.stringMatching(/500 INTERNAL/) }]);
    expect(r.job).toMatchObject({ queriesDone: 6, fetchedCount: 5, apiCalls: 7 });
    expect(await getUsage(db, GOOGLE_PLACES_PROVIDER)).toBe(7);
  });

  it("a search that fails once is retried and succeeds", async () => {
    const j = await job({ terms: ["a"], area: "75201" });
    const fake = createFakePlaces({ results: onePerQuery(), fail: (_req, n) => (n === 1 ? fakeError("network") : null) });
    const r = await runGoogleJobSlice(db, fake, j.id, { budgetMs: 60_000, cap: 100 });
    expect(r.outcome).toBe("completed");
    expect(r.job.plan?.errors).toEqual([]);
    expect(r.job.fetchedCount).toBe(1);
  });

  it("a search filling 3 pages is saturated; repeated places across pages are handled once", async () => {
    const sixty = Array.from({ length: 60 }, () => makeGooglePlace());
    const thirty = Array.from({ length: 30 }, () => makeGooglePlace());
    const j = await job({ terms: ["a"], area: "75201, 75202" });
    const fake = createFakePlaces({ results: { "a 75201": [...sixty, ...sixty.slice(0, 5)], "a 75202": [...thirty, sixty[0]] } });
    const r = await runGoogleJobSlice(db, fake, j.id, { budgetMs: 60_000, cap: 100 });
    expect(r.outcome).toBe("completed");
    expect(fake.requests.map((x) => [x.textQuery, x.pageToken ?? null])).toEqual([
      ["a 75201", null],
      ["a 75201", "page-2"],
      ["a 75201", "page-3"],
      ["a 75202", null],
      ["a 75202", "page-2"],
    ]);
    expect(r.job.plan?.saturated).toEqual([{ term: "a", zip: "75201" }]);
    expect(r.job).toMatchObject({ fetchedCount: 90, newCount: 90, apiCalls: 5 });
  });
});

describe("qualification of Google rows (AC-18.12)", () => {
  async function verdicts(ids: string[]) {
    const out: Record<string, string[]> = {};
    for (const id of ids) out[id] = (await getBusiness(db, id))!.rejectionReasons;
    return out;
  }

  it("roofing job: hardware_store → category_mismatch; closed → closed; shared domain → later duplicate_website; email → duplicate_email", async () => {
    const good = makeGooglePlace();
    const hardware = makeGooglePlace({ primaryType: "hardware_store", primaryTypeDisplayName: { text: "Hardware store" }, types: ["hardware_store", "store"] });
    const closed = makeGooglePlace({ businessStatus: "CLOSED_PERMANENTLY" });
    const siteA = makeGooglePlace({ websiteUri: "https://www.twinroofs.com/" });
    const siteB = makeGooglePlace({ websiteUri: "http://twinroofs.com/contact" });
    const fbA = makeGooglePlace({ websiteUri: "https://www.facebook.com/fbroofing" });
    const fbB = makeGooglePlace({ websiteUri: "https://www.facebook.com/otherroofing" });
    const j = await job({ nicheId: "roofing", area: "75201" });
    const fake = createFakePlaces({ results: { "roofer 75201": [good, hardware, closed, siteA, siteB, fbA, fbB] } });
    const r = await runGoogleJobSlice(db, fake, j.id, { budgetMs: 60_000, cap: 100 });
    expect(r.outcome).toBe("completed");

    const id = async (p: GooglePlace) => (await getBusinessByPlaceId(db, p.id))!.id;
    const ids = {
      good: await id(good),
      hardware: await id(hardware),
      closed: await id(closed),
      siteA: await id(siteA),
      siteB: await id(siteB),
      fbA: await id(fbA),
      fbB: await id(fbB),
    };
    const v = await verdicts(Object.values(ids));
    expect(v[ids.good]).toEqual([]);
    expect((await getBusiness(db, ids.good))!.qualification).toBe("qualified");
    expect(v[ids.hardware]).toEqual(["category_mismatch"]);
    expect(v[ids.closed]).toEqual(["closed"]);
    expect(v[ids.siteA]).toEqual([]);
    expect(v[ids.siteB]).toEqual(["duplicate_website"]);
    expect(v[ids.fbA]).toEqual([]);
    expect(v[ids.fbB]).toEqual([]);
    expect(r.job).toMatchObject({ qualifiedCount: 4, rejectedCount: 3 });

    // The later row gains an email already on an earlier row.
    await db.update(businesses).set({ email: "Office@Example.com" }).where(eq(businesses.id, ids.good));
    await db.update(businesses).set({ email: "office@example.com" }).where(eq(businesses.id, ids.fbB));
    const later = (await getBusiness(db, ids.fbB))!;
    expect((await qualifyOne(db, later)).reasons).toEqual(["duplicate_email"]);
    expect((await qualifyOne(db, (await getBusiness(db, ids.good))!)).reasons).toEqual([]);

    // requalifyAll gives the same verdicts as qualifyOne.
    const before = await verdicts(Object.values(ids));
    await requalifyAll(db);
    expect(await verdicts(Object.values(ids))).toEqual(before);
    expect(before[ids.fbB]).toEqual(["duplicate_email"]);
  });

  it("custom terms (no niche) apply no category rule; a matched Trustpilot row keeps its own rules", async () => {
    const hardware = makeGooglePlace({ primaryType: "hardware_store", types: ["hardware_store"] });
    const { business: tp } = await upsertBusinessByTrustpilotId(
      db,
      makeTrustpilotRow({ trustpilotId: "matchme.com", phone: "+1 512 555 4242", phoneDigits: "15125554242", reviewCount: 50, rating: "4.5" }),
    );
    const attach = makeGooglePlace({ websiteUri: "https://matchme.com" });
    const j = await job({ terms: ["hardware"], area: "75201" });
    const fake = createFakePlaces({ results: { "hardware 75201": [hardware, attach] } });
    const r = await runGoogleJobSlice(db, fake, j.id, { budgetMs: 60_000, cap: 100 });
    expect(r.job).toMatchObject({ newCount: 1, matchedCount: 1, fetchedCount: 2 });
    expect((await getBusinessByPlaceId(db, hardware.id))!.rejectionReasons).toEqual([]);
    const matched = (await getBusiness(db, tp.id))!;
    expect(matched).toMatchObject({ source: "trustpilot", googlePlaceId: attach.id, qualification: "qualified" });
    // No Google snapshot on a matched row.
    expect(await db.select().from(reviewSnapshots).where(eq(reviewSnapshots.businessId, tp.id))).toEqual([]);
  });
});

describe("review snapshots (AC-18.13)", () => {
  it("twice inside 24 h stores one snapshot; 31 days apart stores two and sets reviewsLast30d to the difference", async () => {
    const j = await job({ nicheId: "roofing", area: "75201" });
    const place = makeGooglePlace({ userRatingCount: 40 });
    const t0 = new Date("2026-10-01T12:00:00Z");
    const snaps = async (id: string) =>
      db.select().from(reviewSnapshots).where(eq(reviewSnapshots.businessId, id)).orderBy(asc(reviewSnapshots.capturedAt));

    const a = await ingestGooglePlace(db, place, { job: j, now: t0 });
    expect(a.outcome).toBe("created");
    const b = await ingestGooglePlace(db, { ...place, userRatingCount: 41 }, { job: j, now: new Date(t0.getTime() + 3 * 3_600_000) });
    expect(b.outcome).toBe("updated");
    expect((await snaps(a.business.id)).map((s) => s.totalReviews)).toEqual([40]);

    const later = new Date(t0.getTime() + 31 * 24 * 3_600_000);
    const c = await ingestGooglePlace(db, { ...place, userRatingCount: 52 }, { job: j, now: later });
    expect((await snaps(a.business.id)).map((s) => s.totalReviews)).toEqual([40, 52]);
    expect(c.business.reviewsLast30d).toBe(12);
    expect((await getBusiness(db, a.business.id))!.reviewsLast30d).toBe(12);
  });
});
