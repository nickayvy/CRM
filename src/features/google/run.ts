// Runs Google Places jobs in slices that fit a function time limit (spec R5–R7,
// R17): resumable from `queriesDone`, one slice at a time per job (DB lease),
// every request reserved against the monthly cap before it is sent.
import { asc, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { getBusiness } from "@/db/repo/businesses";
import {
  GOOGLE_PLACES_PROVIDER,
  type GoogleUpsert,
  acquireJobLease,
  addDailySnapshot,
  getBusinessByPlaceId,
  releaseJobLease,
  renewJobLease,
  reserveUsage,
  upsertGooglePlace,
} from "@/db/repo/google";
import { getRules } from "@/db/repo/rules";
import { getSearchJob, updateSearchJob } from "@/db/repo/search-jobs";
import { type QualificationRules, type SearchJob, businesses, reviewSnapshots } from "@/db/schema";
import { qualifyOne } from "@/features/ingest/run";
import { env } from "@/lib/env";
import { GooglePlacesError, GoogleRateLimited, PLACES_PAGE_SIZE } from "@/lib/google-places/client";
import { getNiche } from "@/lib/google-places/niches";
import { normalizeGooglePlace } from "@/lib/google-places/normalize";
import { ZIP_BIAS_RADIUS_M, searchAt, textQueryFor } from "@/lib/google-places/plan";
import type { GooglePlace, GooglePlan, PlacesClient } from "@/lib/google-places/types";
import { zipCentre } from "@/lib/google-places/zips";
import type { QualifyResult } from "@/lib/qualify";

export type SliceOutcome = "completed" | "more" | "busy" | "capped" | "rate_limited" | "failed";

/** No search starts with less than this much of the slice budget left. */
export const MIN_SEARCH_BUDGET_MS = 15_000;
/** plan.errors keeps the most recent this-many skipped searches. */
export const MAX_PLAN_ERRORS = 50;

export function capMessage(cap: number): string {
  return `Paused: the monthly Google Places request cap of ${cap} is reached. Raise GOOGLE_PLACES_MONTHLY_REQUEST_CAP or wait until next month.`;
}
export const RATE_LIMIT_MESSAGE = "Paused: Google is rate limiting requests (HTTP 429). The search resumes on the next run.";

// ------------------------------------------------------------ one place

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/**
 * Reviews per 30 days from earlier snapshots (mirrors the snapshot method of
 * computeVelocity in src/lib/firecrawl/trustpilot.ts): the newest snapshot at
 * least 30 days old gives `current - then`; otherwise the oldest snapshot at
 * least 1 hour old is extrapolated to 30 days. Negative deltas clamp to 0.
 */
export function velocityFromSnapshots(snapshots: { totalReviews: number; capturedAt: Date }[], current: number, now: Date): number {
  const t = now.getTime();
  const usable = snapshots.filter((s) => s.capturedAt.getTime() <= t - HOUR_MS);
  const monthOld = usable
    .filter((s) => s.capturedAt.getTime() <= t - 30 * DAY_MS)
    .sort((a, b) => b.capturedAt.getTime() - a.capturedAt.getTime())[0];
  if (monthOld) return Math.max(0, current - monthOld.totalReviews);
  const oldest = [...usable].sort((a, b) => a.capturedAt.getTime() - b.capturedAt.getTime())[0];
  if (!oldest) return 0;
  const days = (t - oldest.capturedAt.getTime()) / DAY_MS;
  return days > 0 ? Math.max(0, Math.round(((current - oldest.totalReviews) / days) * 30)) : 0;
}

/** The searchCategory stored on a job's rows: the niche's top-level slug, else the job term. */
function searchCategoryOf(job: SearchJob): string {
  return getNiche(job.plan?.nicheId)?.category ?? job.term ?? "";
}

export type IngestedPlace = GoogleUpsert & { result: QualifyResult };

/**
 * Normalise → upsert → review snapshot (Google rows only, at most one a day;
 * `reviewsLast30d` set once an earlier snapshot exists) → qualifyOne.
 */
export async function ingestGooglePlace(
  db: Db,
  place: GooglePlace,
  opts: { job: Pick<SearchJob, "id" | "location" | "term" | "plan">; rules?: QualificationRules; now?: Date },
): Promise<IngestedPlace> {
  const now = opts.now ?? new Date();
  const row = normalizeGooglePlace(place, {
    jobId: opts.job.id,
    searchCategory: searchCategoryOf(opts.job as SearchJob),
    searchLocation: opts.job.location,
    now,
  });
  const up = await upsertGooglePlace(db, row);
  let business = up.business;
  // A matched Yelp/Trustpilot row keeps its own review count; its snapshots are that source's.
  if (business.source === "google") {
    await addDailySnapshot(db, business.id, business.reviewCount, now);
    const earlier = (
      await db
        .select({ totalReviews: reviewSnapshots.totalReviews, capturedAt: reviewSnapshots.capturedAt })
        .from(reviewSnapshots)
        .where(eq(reviewSnapshots.businessId, business.id))
        .orderBy(asc(reviewSnapshots.capturedAt))
    ).filter((s) => s.capturedAt.getTime() < now.getTime());
    if (earlier.length > 0) {
      const l30 = velocityFromSnapshots(earlier, business.reviewCount, now);
      if (l30 !== business.reviewsLast30d) {
        await db.update(businesses).set({ reviewsLast30d: l30 }).where(eq(businesses.id, business.id));
      }
    }
    business = (await getBusiness(db, business.id))!;
  }
  const result = await qualifyOne(db, business, opts.rules);
  return { ...up, business, result };
}

// ------------------------------------------------------------ one slice

/** Reported after every finished search (CLI progress lines). */
export type SearchEvent = {
  /** 0-based search index; `total` searches in the job. */
  index: number;
  total: number;
  term: string;
  zip: string;
  /** Requests sent for this search, retries included. */
  requests: number;
  /** Places newly processed by this job. */
  places: number;
  saturated: boolean;
  /** Set when the search was skipped after its retry. */
  error?: string;
};

type SearchResult =
  | { kind: "ok"; saturated: boolean }
  | { kind: "capped" }
  | { kind: "error"; error: unknown };

/**
 * Runs searches from `queriesDone` until the job is done or `budgetMs` is
 * nearly spent (no search starts with under 15 s left). Takes the job lease
 * (120 s, renewed after every search) and releases it on exit.
 *   busy         another slice holds the lease; nothing done
 *   capped       monthly cap reached; status stays running, error = pause reason
 *   rate_limited Google answered 429; same search is retried by the next slice
 *   failed       fatal GooglePlacesError; status failed, error set
 *   more         budget spent with searches left; status running
 *   completed    every search done; status completed, finishedAt set
 * Per place: skip ids already handled in this slice, normalise, upsert,
 * snapshot (R17), qualifyOne. Counters and `queriesDone` are persisted after
 * every search. A non-fatal error on one search is retried once, then
 * recorded in `plan.errors` and the job moves on.
 */
export async function runGoogleJobSlice(
  db: Db,
  client: PlacesClient,
  jobId: string,
  opts: { budgetMs: number; cap?: number; now?: () => number; onSearch?: (e: SearchEvent) => void },
): Promise<{ job: SearchJob; outcome: SliceOutcome }> {
  const clock = opts.now ?? Date.now;
  const started = clock();
  const initial = await getSearchJob(db, jobId);
  if (!initial) throw new Error(`Search job not found: ${jobId}`);
  if (initial.source !== "google" || !initial.plan) throw new Error(`Not a Google search job: ${jobId}`);
  if (initial.status === "completed") return { job: initial, outcome: "completed" };
  if (initial.status === "failed") return { job: initial, outcome: "failed" };

  let lease = await acquireJobLease(db, jobId);
  if (!lease) return { job: initial, outcome: "busy" };

  try {
    // Re-read under the lease: another slice may have advanced the job meanwhile.
    const job = (await getSearchJob(db, jobId))!;
    const plan: GooglePlan = { ...job.plan!, saturated: [...(job.plan!.saturated ?? [])], errors: [...(job.plan!.errors ?? [])] };
    const total = job.queriesTotal || plan.terms.length * plan.zips.length;
    const cap = opts.cap ?? env.GOOGLE_PLACES_MONTHLY_REQUEST_CAP;
    const maxPages = plan.maxPagesPerQuery ?? 3;
    const counts = {
      fetchedCount: job.fetchedCount,
      qualifiedCount: job.qualifiedCount,
      reviewCount: job.reviewCount,
      rejectedCount: job.rejectedCount,
      newCount: job.newCount,
      matchedCount: job.matchedCount,
      apiCalls: job.apiCalls,
    };
    let queriesDone = job.queriesDone;

    if (job.status === "pending") {
      await updateSearchJob(db, jobId, { status: "running", startedAt: new Date(), finishedAt: null });
    }
    const persist = (extra: Partial<SearchJob> = {}) => updateSearchJob(db, jobId, { ...counts, queriesDone, plan, ...extra });
    const finish = async (outcome: SliceOutcome, extra: Partial<SearchJob> = {}) => {
      await persist(extra);
      return { job: (await getSearchJob(db, jobId))!, outcome };
    };

    const rules = await getRules(db);
    const handled = new Set<string>();

    const handlePlace = async (place: GooglePlace) => {
      if (handled.has(place.id)) return;
      handled.add(place.id);
      // Already processed by this job in an earlier slice (a later search returned it again).
      const prior = await getBusinessByPlaceId(db, place.id);
      if (prior && prior.sourceJobId === jobId) return;
      const r = await ingestGooglePlace(db, place, { job, rules });
      counts.fetchedCount++;
      counts[`${r.result.qualification}Count` as const]++;
      if (r.outcome === "created") counts.newCount++;
      if (r.outcome === "matched") counts.matchedCount++;
    };

    const runSearch = async (term: string, zip: string): Promise<SearchResult> => {
      const centre = zipCentre(zip);
      let pageToken: string | undefined;
      for (let page = 1; page <= maxPages; page++) {
        if (!(await reserveUsage(db, GOOGLE_PLACES_PROVIDER, cap))) return { kind: "capped" };
        counts.apiCalls++;
        let res: Awaited<ReturnType<PlacesClient["searchText"]>>;
        try {
          res = await client.searchText({
            textQuery: textQueryFor(term, zip),
            ...(pageToken ? { pageToken } : {}),
            ...(centre ? { locationBias: { ...centre, radiusM: ZIP_BIAS_RADIUS_M } } : {}),
            regionCode: "US",
          });
        } catch (error) {
          return { kind: "error", error };
        }
        for (const place of res.places) await handlePlace(place);
        if (!res.nextPageToken) {
          return { kind: "ok", saturated: page === maxPages && res.places.length >= PLACES_PAGE_SIZE };
        }
        pageToken = res.nextPageToken;
      }
      return { kind: "ok", saturated: true }; // every allowed page was full and Google had more
    };

    while (queriesDone < total) {
      if (opts.budgetMs - (clock() - started) < MIN_SEARCH_BUDGET_MS) return await finish("more");
      const { term, zip } = searchAt(plan, queriesDone);
      const before = { requests: counts.apiCalls, places: counts.fetchedCount };

      let r = await runSearch(term, zip);
      const retryable = (x: SearchResult) =>
        x.kind === "error" &&
        !(x.error instanceof GoogleRateLimited) &&
        !(x.error instanceof GooglePlacesError && x.error.fatal);
      if (retryable(r)) r = await runSearch(term, zip);

      if (r.kind === "capped") return await finish("capped", { error: capMessage(cap) });
      if (r.kind === "error") {
        const e = r.error;
        if (e instanceof GoogleRateLimited) return await finish("rate_limited", { error: RATE_LIMIT_MESSAGE });
        if (e instanceof GooglePlacesError && e.fatal) {
          return await finish("failed", { status: "failed", error: e.message, finishedAt: new Date() });
        }
      }
      const message = r.kind === "error" ? (r.error instanceof Error ? r.error.message : String(r.error)) : undefined;
      if (message !== undefined) {
        // Failed twice: record and move on.
        plan.errors = [...plan.errors, { term, zip, message }].slice(-MAX_PLAN_ERRORS);
      }
      const saturated = r.kind === "ok" && r.saturated;
      if (saturated) plan.saturated = [...plan.saturated, { term, zip }];
      opts.onSearch?.({
        index: queriesDone,
        total,
        term,
        zip,
        requests: counts.apiCalls - before.requests,
        places: counts.fetchedCount - before.places,
        saturated,
        ...(message !== undefined ? { error: message } : {}),
      });
      queriesDone++;
      await persist({ error: null });
      lease = (await renewJobLease(db, jobId, lease)) ?? lease;
    }
    return await finish("completed", { status: "completed", finishedAt: new Date(), error: null });
  } catch (err) {
    // A database or programming error: fail the job rather than leave it spinning.
    console.error(`[google] job ${jobId} slice failed`, err instanceof Error ? err.message : err);
    await updateSearchJob(db, jobId, {
      status: "failed",
      finishedAt: new Date(),
      error: err instanceof Error ? err.message : String(err),
    });
    return { job: (await getSearchJob(db, jobId))!, outcome: "failed" };
  } finally {
    await releaseJobLease(db, jobId, lease);
  }
}
