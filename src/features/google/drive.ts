// Drives Google jobs across slices inside one wall-clock budget: the
// background task of the start / continue / rerun actions (240 s) and the
// daily cron's `google` stage (60 s). SERVER ONLY.
import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { listPendingLinkIds } from "@/db/repo/discovery";
import { listUnfinishedGoogleJobs } from "@/db/repo/google";
import { getSearchJob } from "@/db/repo/search-jobs";
import { businesses } from "@/db/schema";
import { env } from "@/lib/env";
import { createFirecrawl } from "@/lib/firecrawl/client";
import { enrichPendingLinks } from "@/lib/firecrawl/enrich";
import type { PlacesClient } from "@/lib/google-places/types";
import { createPageSource } from "@/lib/web/page-source";
import { MIN_SEARCH_BUDGET_MS, type SliceOutcome, runGoogleJobSlice } from "./run";

/** Total budget of the background task behind start, continue and rerun (under a 300 s function). */
export const GOOGLE_RUN_BUDGET_MS = 240_000;
/** The daily cron's `google` stage budget. */
export const GOOGLE_CRON_BUDGET_MS = 60_000;
/** Link enrichment after a job completes starts only with at least this much budget left. */
export const MIN_ENRICH_BUDGET_MS = 10_000;
/** At most this many of a job's rows are enriched in the task that completed it (the cron drains the rest). */
export const JOB_ENRICH_LIMIT = 300;

export type DriveResult = {
  outcome: SliceOutcome;
  /** Slices run (0 when the budget was too small to start one). */
  slices: number;
  /** Searches finished by this task. */
  searches: number;
  /** Link enrichment of the job's rows after it completed here; null when it did not run. */
  links: Awaited<ReturnType<typeof enrichPendingLinks>> | null;
};

type Clock = { now?: () => number };

/**
 * Runs slices of one job until `budgetMs` is spent or the outcome is not
 * `more`. When the job completes inside this task and at least 10 s remain,
 * drains link enrichment for the job's own pending rows (direct website fetch
 * first, Firecrawl as the fallback when a key is set) in what is left.
 */
export async function driveGoogleJob(
  db: Db,
  client: PlacesClient,
  jobId: string,
  opts: { budgetMs: number; cap?: number; enrich?: boolean } & Clock,
): Promise<DriveResult> {
  const clock = opts.now ?? Date.now;
  const started = clock();
  const left = () => opts.budgetMs - (clock() - started);
  const before = await getSearchJob(db, jobId);
  if (!before) throw new Error(`Search job not found: ${jobId}`);

  let outcome: SliceOutcome = before.status === "completed" ? "completed" : before.status === "failed" ? "failed" : "more";
  let slices = 0;
  let done = before.queriesDone;
  while (outcome === "more" && left() >= MIN_SEARCH_BUDGET_MS) {
    const r = await runGoogleJobSlice(db, client, jobId, { budgetMs: left(), cap: opts.cap, now: opts.now });
    slices++;
    outcome = r.outcome;
    done = r.job.queriesDone;
  }

  let links: DriveResult["links"] = null;
  const completedHere = outcome === "completed" && before.status !== "completed";
  if (completedHere && opts.enrich !== false && left() >= MIN_ENRICH_BUDGET_MS) {
    try {
      links = await enrichJobLinks(db, jobId, left(), opts.now);
    } catch (err) {
      console.error(`[google] link enrichment after job ${jobId} failed`, err instanceof Error ? err.message : err);
    }
  }
  return { outcome, slices, searches: done - before.queriesDone, links };
}

/** Link enrichment for the rows this job wrote that are still pending, inside `budgetMs`. */
async function enrichJobLinks(db: Db, jobId: string, budgetMs: number, now?: () => number) {
  const rows = await db
    .select({ id: businesses.id })
    .from(businesses)
    .where(eq(businesses.sourceJobId, jobId))
    .limit(JOB_ENRICH_LIMIT * 4);
  const ids = rows.map((r) => r.id);
  const pending = ids.length ? await listPendingLinkIds(db, { ids, limit: JOB_ENRICH_LIMIT }) : [];
  if (pending.length === 0) return { enriched: 0, empty: 0, failed: 0, remaining: 0, rateLimited: false };
  const key = env.FIRECRAWL_API_KEY;
  const source = createPageSource({ firecrawl: key ? createFirecrawl(key) : null });
  // limit = the job's pending rows, so the drain does not move on to other rows.
  return enrichPendingLinks(db, source, { limit: pending.length, budgetMs, ids: pending, now });
}

export type CronGoogle = { jobs: number; searches: number; outcome: SliceOutcome | null };

/**
 * The cron stage: continues unfinished Google jobs, oldest first, inside
 * `budgetMs`. Stops at the monthly cap (every other job would pause too).
 * `outcome` is the last slice's outcome; null when no job was continued.
 * Link enrichment is left to the cron's own links stage.
 */
export async function continueUnfinishedGoogleJobs(
  db: Db,
  client: PlacesClient,
  opts: { budgetMs: number; cap?: number } & Clock,
): Promise<CronGoogle> {
  const clock = opts.now ?? Date.now;
  const started = clock();
  const left = () => opts.budgetMs - (clock() - started);
  const res: CronGoogle = { jobs: 0, searches: 0, outcome: null };
  for (const job of await listUnfinishedGoogleJobs(db)) {
    if (left() < MIN_SEARCH_BUDGET_MS) break;
    const r = await driveGoogleJob(db, client, job.id, { budgetMs: left(), cap: opts.cap, now: opts.now, enrich: false });
    res.jobs++;
    res.searches += r.searches;
    res.outcome = r.outcome;
    if (r.outcome === "capped") break;
  }
  return res;
}
