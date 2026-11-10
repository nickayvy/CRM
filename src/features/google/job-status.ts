// Client-safe helpers for the Google job page: whether a paused job may be
// continued automatically, and the cost so far. Pure; no server imports.
import type { SearchJobJson } from "@/features/searches/format";

/** Least time between two automatic continue calls from an open job page. */
export const AUTO_CONTINUE_INTERVAL_MS = 20_000;

/** Matches the runner's cap pause message (`capMessage` in ./run.ts; tests tie the two together). */
const CAP_PAUSE = /monthly Google Places request cap/i;

export function isCapPause(error: string | null | undefined): boolean {
  return !!error && CAP_PAUSE.test(error);
}

/** True when a slice holds the job's lease at `now`. */
export function hasLiveLease(job: Pick<SearchJobJson, "leaseExpiresAt">, now: number): boolean {
  return !!job.leaseExpiresAt && new Date(job.leaseExpiresAt).getTime() > now;
}

/**
 * The open job page may continue the job itself: it is running, no slice
 * holds the lease, it is not paused at the monthly cap, and it has searches
 * left.
 */
export function canAutoContinue(
  job: Pick<SearchJobJson, "source" | "status" | "error" | "leaseExpiresAt" | "queriesDone" | "queriesTotal">,
  now: number,
): boolean {
  return (
    job.source === "google" &&
    job.status === "running" &&
    !hasLiveLease(job, now) &&
    !isCapPause(job.error) &&
    job.queriesDone < job.queriesTotal
  );
}

/** Estimated dollars for `requests` at `pricePer1000`, 2 decimals. */
export function costOf(requests: number, pricePer1000: number): number {
  return Math.round(((requests * pricePer1000) / 1000) * 100) / 100;
}
