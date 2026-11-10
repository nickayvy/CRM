// WP-20: the four Google server actions and the cron `google` stage, on PGlite
// with the fake Places client. AC-20.1 (actions), AC-20.2, AC-20.3, AC-20.7,
// AC-20.8, AC-20.12 (rerun of a failed job).
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { GOOGLE_PLACES_PROVIDER, createGoogleJob, getUsage, reserveUsage } from "@/db/repo/google";
import { getSearchJob, updateSearchJob } from "@/db/repo/search-jobs";
import { businesses, searchJobs } from "@/db/schema";
import { createTestDb } from "@/db/test-utils";
import { GOOGLE_NOT_CONFIGURED } from "@/lib/google-places/client";
import { planGoogleSearch } from "@/lib/google-places/plan";
import type { GooglePlace } from "@/lib/google-places/types";
import { type FakePlacesClient, createFakePlaces, makeGooglePlace } from "./helpers/fake-places";

const state = vi.hoisted(() => ({
  signedIn: true,
  fake: null as unknown as FakePlacesClient,
  clientKeys: [] as string[],
  afterQueue: [] as (() => Promise<unknown> | unknown)[],
  direct: [] as string[],
  geocoded: [] as string[],
}));

vi.mock("@/lib/supabase/server", () => ({
  requireUser: async () => {
    if (!state.signedIn) throw new Error("NEXT_REDIRECT /login");
    return { id: "u1", email: "rep@example.com" };
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
// after() needs a request scope; collect the callbacks and run them explicitly.
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (fn: () => Promise<unknown> | unknown) => void state.afterQueue.push(fn),
}));
// Every Places client is the in-memory fake; the key it was built with is recorded.
vi.mock("@/lib/google-places/client", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/google-places/client")>();
  return {
    ...real,
    createPlacesClient: (key: string) => {
      state.clientKeys.push(key);
      return state.fake;
    },
  };
});
// Geocoding never reaches the network: a fake answers "Deep Ellum" and records every text.
vi.mock("@/lib/google-places/geocode", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/google-places/geocode")>();
  return {
    ...real,
    createGeocoder: (_key: string, opts: { reserve?: () => Promise<boolean> } = {}) =>
      async (text: string) => {
        if (opts.reserve && !(await opts.reserve())) throw new Error("geocoding cap");
        state.geocoded.push(text);
        return /deep ellum/i.test(text) ? { latitude: 32.784, longitude: -96.784 } : null;
      },
  };
});
// Website reads after a job completes never reach the network.
vi.mock("@/lib/web/fetch-page", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/web/fetch-page")>();
  return {
    ...real,
    fetchPage: async (url: string) => {
      state.direct.push(url);
      return { url, finalUrl: url, links: [`mailto:office@${new URL(url).hostname.replace(/^www\./, "")}`], markdown: "Roofing since 1990." };
    },
  };
});

const actions = await import("@/features/google/actions");
const { GET } = await import("@/app/api/cron/daily/route");

let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  globalThis.__db = { db, driver: "pglite", close };
});
afterAll(async () => {
  globalThis.__db = undefined;
  await close();
});
beforeEach(async () => {
  await db.execute(sql`TRUNCATE TABLE businesses, search_jobs, api_usage, review_snapshots RESTART IDENTITY CASCADE`);
  state.signedIn = true;
  state.fake = createFakePlaces();
  state.clientKeys = [];
  state.afterQueue.length = 0;
  state.direct = [];
  state.geocoded = [];
  vi.stubEnv("GOOGLE_PLACES_API_KEY", "test-key");
  vi.stubEnv("GOOGLE_GEOCODING_API_KEY", "");
  vi.stubEnv("GOOGLE_PLACES_MONTHLY_REQUEST_CAP", "1000");
  vi.stubEnv("FIRECRAWL_API_KEY", "");
  vi.stubEnv("CRON_SECRET", "");
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function drainAfter() {
  while (state.afterQueue.length) await state.afterQueue.shift()!();
}

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

/** One distinct place per text query, so every search is one page. */
function onePerQuery() {
  const byQuery = new Map<string, GooglePlace[]>();
  return (q: string) => {
    if (!byQuery.has(q)) byQuery.set(q, [makeGooglePlace()]);
    return byQuery.get(q)!;
  };
}

async function useRequests(n: number) {
  for (let i = 0; i < n; i++) await reserveUsage(db, GOOGLE_PLACES_PROVIDER, 1_000_000);
}

describe("googleConfigured", () => {
  it("follows GOOGLE_PLACES_API_KEY", () => {
    expect(actions.googleConfigured()).toBe(true);
    vi.stubEnv("GOOGLE_PLACES_API_KEY", "");
    expect(actions.googleConfigured()).toBe(false);
  });
});

describe("AC-20.1 not configured", () => {
  beforeEach(() => vi.stubEnv("GOOGLE_PLACES_API_KEY", ""));

  it("start, continue and rerun fail with GOOGLE_NOT_CONFIGURED; no job, no request, nothing scheduled", async () => {
    const res = await actions.startGoogleSearchAction(null, form({ nicheId: "roofing", area: "75201" }));
    expect(res).toEqual({ ok: false, message: GOOGLE_NOT_CONFIGURED });
    const id = "00000000-0000-4000-8000-000000000000";
    expect(await actions.continueGoogleSearchAction(id)).toEqual({ ok: false, message: GOOGLE_NOT_CONFIGURED });
    expect(await actions.rerunGoogleSearchAction(id)).toEqual({ ok: false, message: GOOGLE_NOT_CONFIGURED });
    expect(await db.select().from(searchJobs)).toEqual([]);
    expect(state.afterQueue).toHaveLength(0);
    expect(state.fake.callCount).toBe(0);
    expect(state.clientKeys).toEqual([]);
  });
});

describe("AC-20.2 previewGoogleSearchAction", () => {
  it("roofing in 75201, 75202: 2 zips, the niche's terms, searches, requests, cost, usage and cap; no Places request", async () => {
    await useRequests(108);
    const res = await actions.previewGoogleSearchAction({ nicheId: "roofing", area: "75201, 75202" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data).toEqual({
      preview: {
        location: "2 zips, TX",
        term: "Roofing",
        queries: 6,
        maxRequests: 18,
        estMaxUsd: 0.63,
        terms: ["roofer", "roofing contractor", "roofing company"],
        zipCount: 2,
        areaLabel: "2 zips, TX",
      },
      usedThisMonth: 108,
      cap: 1000,
    });
    expect(state.fake.callCount).toBe(0);
    expect(state.clientKeys).toEqual([]);
  });

  it("works without a key too (planning is offline) and honours edited terms and pages", async () => {
    vi.stubEnv("GOOGLE_PLACES_API_KEY", "");
    const res = await actions.previewGoogleSearchAction({
      nicheId: "roofing",
      terms: ["Roofer", "metal roofing"],
      area: "75201",
      maxPagesPerQuery: 1,
    });
    expect(res.ok && res.data.preview).toMatchObject({ terms: ["roofer", "metal roofing"], queries: 2, maxRequests: 2 });
  });

  it("an unresolvable area is ok: false with a field error on area", async () => {
    const res = await actions.previewGoogleSearchAction({ nicheId: "roofing", area: "Nowhere special" });
    expect(res.ok).toBe(false);
    expect(!res.ok && res.fieldErrors?.area?.[0]).toMatch(/Could not find "Nowhere special"/);
    const empty = await actions.previewGoogleSearchAction({ nicheId: "roofing", area: "" });
    expect(!empty.ok && empty.fieldErrors?.area).toBeTruthy();
    // Without any Google key the area is resolved offline only.
    vi.stubEnv("GOOGLE_PLACES_API_KEY", "");
    const offline = await actions.previewGoogleSearchAction({ nicheId: "roofing", area: "Deep Ellum arts district" });
    expect(!offline.ok && offline.fieldErrors?.area?.[0]).toMatch(/Could not find "Deep Ellum arts district" offline/);
    expect(state.fake.callCount).toBe(0);
  });

  it("geocodes other text with the key, once per text for preview and start together", async () => {
    const a = await actions.previewGoogleSearchAction({ nicheId: "roofing", area: "Deep Ellum, Dallas" });
    expect(a.ok && a.data.preview.zipCount).toBeGreaterThan(0);
    await actions.previewGoogleSearchAction({ nicheId: "roofing", area: "Deep Ellum, Dallas", maxPagesPerQuery: 1 });
    const started = await actions.startGoogleSearchAction(null, form({ nicheId: "roofing", area: "Deep Ellum, Dallas" }));
    expect(started.ok).toBe(true);
    expect(state.geocoded).toEqual(["Deep Ellum, Dallas"]);
    expect(await getUsage(db, "google_geocoding")).toBe(1);
    expect(state.fake.callCount).toBe(0);
  });

  it("over a limit is ok: false with the limit in the message", async () => {
    const res = await actions.previewGoogleSearchAction({ terms: ["roofer"], area: "75201 +60mi" });
    expect(res.ok).toBe(false);
    expect(!res.ok && res.fieldErrors?.area?.[0]).toMatch(/over the limit of 200/);
  });
});

describe("AC-20.3 startGoogleSearchAction", () => {
  it("creates a source = google job, schedules the run, and the run finishes the job and enriches its rows", async () => {
    state.fake = createFakePlaces({ results: onePerQuery() });
    const res = await actions.startGoogleSearchAction(
      null,
      form({ nicheId: "roofing", terms: "roofer, roofing company", area: "75201, 75202", maxPagesPerQuery: "1" }),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const job = (await getSearchJob(db, res.data.jobId))!;
    expect(job).toMatchObject({ source: "google", status: "pending", queriesTotal: 4, queriesDone: 0, term: "Roofing" });
    expect(job.plan).toMatchObject({ nicheId: "roofing", terms: ["roofer", "roofing company"], zips: ["75201", "75202"], maxPagesPerQuery: 1 });
    // Nothing has been requested before the response; the run is queued.
    expect(state.fake.callCount).toBe(0);
    expect(state.afterQueue).toHaveLength(1);

    await drainAfter();
    expect(state.clientKeys).toEqual(["test-key"]);
    expect(state.fake.requests.map((r) => r.textQuery)).toEqual([
      "roofer 75201",
      "roofing company 75201",
      "roofer 75202",
      "roofing company 75202",
    ]);
    const done = (await getSearchJob(db, job.id))!;
    expect(done).toMatchObject({ status: "completed", queriesDone: 4, fetchedCount: 4, newCount: 4, apiCalls: 4 });
    // The job's rows were enriched from their websites in the same task.
    expect(state.direct).toHaveLength(4);
    const rows = await db.select().from(businesses).where(eq(businesses.sourceJobId, job.id));
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.enrichedAt !== null && r.email?.startsWith("office@fakeroofing"))).toBe(true);
  });

  it("with usage at the cap it fails naming the cap and creates no job", async () => {
    vi.stubEnv("GOOGLE_PLACES_MONTHLY_REQUEST_CAP", "50");
    await useRequests(50);
    const res = await actions.startGoogleSearchAction(null, form({ nicheId: "roofing", area: "75201" }));
    expect(res.ok).toBe(false);
    expect(!res.ok && res.message).toMatch(/cap of 50 is reached/);
    expect(await db.select().from(searchJobs)).toEqual([]);
    expect(state.afterQueue).toHaveLength(0);
  });

  it("below the cap it starts even when the plan needs more than is left (the runner pauses at the cap)", async () => {
    vi.stubEnv("GOOGLE_PLACES_MONTHLY_REQUEST_CAP", "50");
    await useRequests(48);
    state.fake = createFakePlaces({ results: onePerQuery() });
    const res = await actions.startGoogleSearchAction(null, form({ nicheId: "roofing", area: "75201, 75202" }));
    expect(res.ok).toBe(true);
    await drainAfter();
    const job = (await getSearchJob(db, res.ok ? res.data.jobId : ""))!;
    expect(job.status).toBe("running");
    expect(job.error).toMatch(/cap of 50 is reached/);
    expect(state.fake.callCount).toBe(2);
    expect(await getUsage(db, GOOGLE_PLACES_PROVIDER)).toBe(50);
  });

  it("returns field errors for a bad area or pages value and creates no job", async () => {
    const bad = await actions.startGoogleSearchAction(null, form({ nicheId: "roofing", area: "nowhere special" }));
    expect(!bad.ok && bad.fieldErrors?.area).toBeTruthy();
    const pages = await actions.startGoogleSearchAction(null, form({ nicheId: "roofing", area: "75201", maxPagesPerQuery: "7" }));
    expect(!pages.ok && pages.fieldErrors?.maxPagesPerQuery).toBeTruthy();
    expect(await db.select().from(searchJobs)).toEqual([]);
  });
});

describe("continueGoogleSearchAction", () => {
  it("answers queued at once and runs the next slice in the background", async () => {
    state.fake = createFakePlaces({ results: onePerQuery() });
    const job = await createGoogleJob(db, await planGoogleSearch({ terms: ["roofer"], area: "75201, 75202", maxPagesPerQuery: 1 }));
    const res = await actions.continueGoogleSearchAction(job.id);
    expect(res).toEqual({ ok: true, data: { outcome: "queued" } });
    expect(state.fake.callCount).toBe(0);
    await drainAfter();
    expect((await getSearchJob(db, job.id))!.status).toBe("completed");
  });

  it("a held lease makes the background slice busy: nothing is requested", async () => {
    const job = await createGoogleJob(db, await planGoogleSearch({ terms: ["roofer"], area: "75201" }));
    await updateSearchJob(db, job.id, { status: "running", leaseExpiresAt: new Date(Date.now() + 60_000) });
    expect((await actions.continueGoogleSearchAction(job.id)).ok).toBe(true);
    await drainAfter();
    expect(state.fake.callCount).toBe(0);
    expect((await getSearchJob(db, job.id))!.queriesDone).toBe(0);
  });

  it("refuses finished, failed, unknown and malformed ids", async () => {
    const job = await createGoogleJob(db, await planGoogleSearch({ terms: ["roofer"], area: "75201" }));
    await updateSearchJob(db, job.id, { status: "completed" });
    expect(await actions.continueGoogleSearchAction(job.id)).toMatchObject({ ok: false, message: expect.stringMatching(/Run again/) });
    await updateSearchJob(db, job.id, { status: "failed" });
    expect(await actions.continueGoogleSearchAction(job.id)).toMatchObject({ ok: false, message: expect.stringMatching(/Run again/) });
    expect(await actions.continueGoogleSearchAction("00000000-0000-4000-8000-000000000000")).toMatchObject({ ok: false });
    expect(await actions.continueGoogleSearchAction("nope")).toEqual({ ok: false, message: "Invalid search id" });
    expect(state.afterQueue).toHaveLength(0);
  });
});

describe("rerunGoogleSearchAction (scope item 10)", () => {
  it.each(["completed", "failed"] as const)("starts a new job with the plan of a %s job", async (status) => {
    state.fake = createFakePlaces({ results: onePerQuery() });
    const old = await createGoogleJob(db, await planGoogleSearch({ nicheId: "roofing", area: "75201", maxPagesPerQuery: 2 }));
    await updateSearchJob(db, old.id, {
      status,
      queriesDone: 1,
      error: status === "failed" ? "connection reset" : null,
      plan: { ...old.plan!, saturated: [{ term: "roofer", zip: "75201" }], errors: [{ term: "x", zip: "75201", message: "m" }] },
    });
    const res = await actions.rerunGoogleSearchAction(old.id);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.jobId).not.toBe(old.id);
    const fresh = (await getSearchJob(db, res.data.jobId))!;
    expect(fresh).toMatchObject({
      source: "google",
      status: "pending",
      term: old.term,
      location: old.location,
      queriesTotal: 3,
      queriesDone: 0,
      categoryAliases: old.categoryAliases,
    });
    expect(fresh.plan).toEqual({ ...old.plan, saturated: [], errors: [] });
    await drainAfter();
    expect((await getSearchJob(db, fresh.id))!.status).toBe("completed");
  });

  it("refuses a running job and refuses at the cap", async () => {
    const job = await createGoogleJob(db, await planGoogleSearch({ terms: ["roofer"], area: "75201" }));
    expect(await actions.rerunGoogleSearchAction(job.id)).toMatchObject({ ok: false, message: expect.stringMatching(/still running/) });
    await updateSearchJob(db, job.id, { status: "completed" });
    vi.stubEnv("GOOGLE_PLACES_MONTHLY_REQUEST_CAP", "3");
    await useRequests(3);
    expect(await actions.rerunGoogleSearchAction(job.id)).toMatchObject({ ok: false, message: expect.stringMatching(/cap of 3/) });
    expect(await db.select().from(searchJobs)).toHaveLength(1);
  });
});

describe("AC-20.8 auth", () => {
  it("each action rejects when requireUser throws, before touching anything", async () => {
    state.signedIn = false;
    const id = "00000000-0000-4000-8000-000000000000";
    await expect(actions.previewGoogleSearchAction({ nicheId: "roofing", area: "75201" })).rejects.toThrow(/NEXT_REDIRECT/);
    await expect(actions.startGoogleSearchAction(null, form({ nicheId: "roofing", area: "75201" }))).rejects.toThrow(/NEXT_REDIRECT/);
    await expect(actions.continueGoogleSearchAction(id)).rejects.toThrow(/NEXT_REDIRECT/);
    await expect(actions.rerunGoogleSearchAction(id)).rejects.toThrow(/NEXT_REDIRECT/);
    expect(await db.select().from(searchJobs)).toEqual([]);
    expect(state.afterQueue).toHaveLength(0);
  });
});

describe("AC-20.7 cron google stage", () => {
  const call = () => GET(new Request("http://localhost:3300/api/cron/daily"));

  it("continues an unfinished Google job: google.jobs >= 1 and its searches are reported", async () => {
    state.fake = createFakePlaces({ results: onePerQuery() });
    const job = await createGoogleJob(db, await planGoogleSearch({ terms: ["roofer", "roofing company"], area: "75201", maxPagesPerQuery: 1 }));
    const body = await (await call()).json();
    expect(body.google).toEqual({ jobs: 1, searches: 2, outcome: "completed" });
    expect(body.google.jobs).toBeGreaterThanOrEqual(1);
    expect((await getSearchJob(db, job.id))!.status).toBe("completed");
    expect(state.fake.callCount).toBe(2);
    // The links stage that follows picks up the new rows.
    expect(body.links.enriched).toBe(2);
  });

  it("oldest first, and stops at the monthly cap", async () => {
    vi.stubEnv("GOOGLE_PLACES_MONTHLY_REQUEST_CAP", "1");
    state.fake = createFakePlaces({ results: onePerQuery() });
    const older = await createGoogleJob(db, await planGoogleSearch({ terms: ["roofer"], area: "75201, 75202", maxPagesPerQuery: 1 }));
    await createGoogleJob(db, await planGoogleSearch({ terms: ["plumber"], area: "75201", maxPagesPerQuery: 1 }));
    const body = await (await call()).json();
    expect(body.google).toEqual({ jobs: 1, searches: 1, outcome: "capped" });
    expect(state.fake.requests.map((r) => r.textQuery)).toEqual(["roofer 75201"]);
    expect((await getSearchJob(db, older.id))!.error).toMatch(/cap of 1 is reached/);
  });

  it("with no unfinished job it reports jobs: 0 and makes no request", async () => {
    const done = await createGoogleJob(db, await planGoogleSearch({ terms: ["roofer"], area: "75201" }));
    await updateSearchJob(db, done.id, { status: "completed" });
    const body = await (await call()).json();
    expect(body.google).toEqual({ jobs: 0, searches: 0, outcome: null });
    expect(state.fake.callCount).toBe(0);
  });

  it("without the key it reports skipped", async () => {
    vi.stubEnv("GOOGLE_PLACES_API_KEY", "");
    await createGoogleJob(db, await planGoogleSearch({ terms: ["roofer"], area: "75201" }));
    const body = await (await call()).json();
    expect(body.google).toEqual({ skipped: "GOOGLE_PLACES_API_KEY not set" });
    expect(state.fake.callCount).toBe(0);
    expect(state.clientKeys).toEqual([]);
  });
});
