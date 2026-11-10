"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangleIcon, ArrowRightIcon, Loader2Icon, PauseCircleIcon, PlayIcon, RotateCwIcon } from "lucide-react";
import { toast } from "sonner";
import { KeyValue, KeyValueList, ProgressBar, StatusBadge, toneSoft, toneText, type Tone } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import { type SearchJobJson, isActive, jobDuration } from "@/features/searches/format";
import { useJobPolling } from "@/features/searches/use-job-polling";
import { JOB_STATUS_LABELS } from "@/lib/labels";
import { AnimatedNumber } from "@/lib/motion";
import { AUTO_CONTINUE_INTERVAL_MS, canAutoContinue, costOf, hasLiveLease, isCapPause } from "../job-status";
import { continueGoogleSearchAction, rerunGoogleSearchAction } from "../server-actions";

/** Poll a Google job every 3 s (slices persist after every search). */
export const GOOGLE_POLL_INTERVAL_MS = 3000;
/** How often the page re-checks whether it should continue the job itself. */
const AUTO_CHECK_MS = 1000;

const n = (v: number) => v.toLocaleString("en-US");
const usd = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function Count({ label, value, tone, hint }: { label: string; value: number; tone?: Tone; hint?: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg bg-surface-elevated px-3 py-3" title={hint}>
      <span className="text-[10px] tracking-wider text-muted-foreground uppercase">{label}</span>
      <AnimatedNumber value={value} className={`font-serif text-3xl tracking-tight tabular-nums ${tone ? toneText[tone] : ""}`} />
    </div>
  );
}

type Props = {
  initial: SearchJobJson;
  /** Estimated USD per 1,000 requests (from the server; plan.ts is server only). */
  pricePer1000: number;
};

/**
 * Live progress for a Google Maps job: searches done of total, counts, Google
 * requests and cost so far, saturated and skipped searches, the pause reason,
 * Continue and Run again. While open it continues a running job that no slice
 * holds, at most once every 20 s, and never when paused at the monthly cap.
 */
export function GoogleJobProgress({ initial, pricePer1000 }: Props) {
  const job = useJobPolling(initial, GOOGLE_POLL_INTERVAL_MS);
  const router = useRouter();
  const active = isActive(job.status);
  const wasActive = React.useRef(active);
  const [continuing, startContinue] = React.useTransition();
  const [rerunning, startRerun] = React.useTransition();

  React.useEffect(() => {
    if (wasActive.current && !active) router.refresh();
    wasActive.current = active;
  }, [active, router]);

  // Auto-continue: the latest job in a ref, checked every second; one call per 20 s at most.
  const latest = React.useRef(job);
  React.useEffect(() => {
    latest.current = job;
  }, [job]);
  const lastAuto = React.useRef<number | null>(null);
  // Clock for "is a slice running now" (the lease), ticked by the same check.
  const [clock, setClock] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!active) return;
    const check = () => {
      const now = Date.now();
      setClock(now);
      if (!canAutoContinue(latest.current, now)) return;
      if (lastAuto.current !== null && now - lastAuto.current < AUTO_CONTINUE_INTERVAL_MS) return;
      lastAuto.current = now;
      continueGoogleSearchAction(latest.current.id).catch(() => {
        // Network hiccup: the next check (20 s on) tries again.
      });
    };
    check();
    const timer = setInterval(check, AUTO_CHECK_MS);
    return () => clearInterval(timer);
  }, [active]);

  function continueNow() {
    lastAuto.current = Date.now();
    startContinue(async () => {
      const res = await continueGoogleSearchAction(job.id);
      if (res.ok) toast.success("Continuing", { description: "The next searches run in the background; this page updates as they finish." });
      else toast.error("Could not continue", { description: res.message ?? "Unknown error" });
    });
  }

  function runAgain() {
    startRerun(async () => {
      const res = await rerunGoogleSearchAction(job.id);
      if (res.ok) router.push(`/searches/${res.data.jobId}`);
      else toast.error("Could not run again", { description: res.message ?? "Unknown error" });
    });
  }

  const plan = job.plan;
  const total = Math.max(job.queriesTotal, 0);
  const done = job.status === "completed";
  const failed = job.status === "failed";
  const paused = job.status === "running" && !!job.error;
  const capPaused = paused && isCapPause(job.error);
  const live = hasLiveLease(job, clock);
  const saturated = plan?.saturated.length ?? 0;
  const skipped = plan?.errors ?? [];
  const maxPages = plan?.maxPagesPerQuery ?? 3;

  return (
    <div className="flex flex-col gap-4" data-job-status={job.status} data-testid="google-job-progress">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge label={paused ? { label: "Paused", tone: "warning" } : JOB_STATUS_LABELS[job.status]} />
        <span className="text-sm text-muted-foreground">
          {done
            ? `Finished in ${jobDuration(job)}`
            : failed
              ? "The search failed."
              : paused
                ? capPaused
                  ? "Paused until the monthly request cap allows more."
                  : "Paused; it resumes on the next run."
                : live
                  ? "Searching Google Maps…"
                  : job.status === "pending"
                    ? "Starting…"
                    : "Waiting for the next run."}
        </span>
      </div>

      <ProgressBar
        value={Math.min(job.queriesDone, Math.max(total, 1))}
        max={Math.max(total, 1)}
        tone={failed ? "danger" : done ? "success" : paused ? "warning" : "info"}
        label={`${n(job.queriesDone)} of ${n(total)} searches`}
        showValue
      />

      {paused ? (
        <div role="alert" className={`flex items-start gap-2 rounded-lg p-3 text-sm ${toneSoft.warning}`} data-testid="pause-reason">
          <PauseCircleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span className="break-words">{job.error}</span>
        </div>
      ) : null}
      {failed && job.error ? (
        <div role="alert" className="flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span className="break-words">{job.error}</span>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Count label="New" value={job.newCount} hint="Businesses added to LAR by this search" />
        <Count label="Matched" value={job.matchedCount} hint="Already in LAR from Yelp or Trustpilot; the Google listing was attached" />
        <Count label="Qualified" value={job.qualifiedCount} tone="success" />
        <Count label="Review" value={job.reviewCount} tone="warning" />
        <Count label="Rejected" value={job.rejectedCount} tone="danger" />
      </div>

      <KeyValueList columns={2}>
        <KeyValue label="Google requests">{`${n(job.apiCalls)} of up to ${n(total * maxPages)}`}</KeyValue>
        <KeyValue label="Estimated cost so far">{`about ${usd(costOf(job.apiCalls, pricePer1000))}`}</KeyValue>
        <KeyValue label="Area">{plan ? `${plan.areaLabel} (${plural(plan.zips.length, "zip")})` : job.location}</KeyValue>
        <KeyValue label="Search terms">{plan?.terms.join(", ") ?? job.term ?? "—"}</KeyValue>
        <KeyValue label="Pages per search">{String(maxPages)}</KeyValue>
        <KeyValue label="Places processed">{n(job.fetchedCount)}</KeyValue>
        <KeyValue label="Duration">{jobDuration(job)}</KeyValue>
        <KeyValue label="Place types counted on-target">{plan?.acceptTypes.length ? plan.acceptTypes.join(", ") : "Any (custom terms)"}</KeyValue>
      </KeyValueList>

      <div className="flex flex-col gap-1 text-sm" data-testid="saturated">
        <span>
          <span className="font-medium tabular-nums">{plural(saturated, "saturated search", "saturated searches")}</span>
          <span className="text-muted-foreground"> — these returned the full 60; more may exist, try narrower terms.</span>
        </span>
        {skipped.length > 0 ? (
          <details className="text-muted-foreground" data-testid="skipped">
            <summary className="cursor-pointer">
              {plural(skipped.length, "skipped search", "skipped searches")} — Google failed twice, so the job moved on.
            </summary>
            <ul className="mt-1 flex flex-col gap-0.5 text-xs">
              {skipped.slice(-10).map((e, i) => (
                <li key={`${e.term}-${e.zip}-${i}`}>
                  {e.term} in {e.zip}: {e.message}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        {active ? (
          <Button onClick={continueNow} disabled={continuing || live} title={live ? "A run is in progress now" : undefined}>
            {continuing ? <Loader2Icon className="animate-spin" aria-hidden /> : <PlayIcon aria-hidden />}
            Continue
          </Button>
        ) : (
          <Button onClick={runAgain} disabled={rerunning}>
            {rerunning ? <Loader2Icon className="animate-spin" aria-hidden /> : <RotateCwIcon aria-hidden />}
            Run again
          </Button>
        )}
        <Button asChild variant="outline">
          <Link href="/lookup?source=google">
            Open Google businesses in Lookup <ArrowRightIcon />
          </Link>
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {active
          ? "Continue runs the next searches now. While this page is open it also continues on its own; the daily run finishes jobs nobody is watching."
          : "Run again searches the same terms and zips as a new job; it uses new Google requests and refreshes the businesses it finds."}
      </p>
    </div>
  );
}

function plural(v: number, one: string, many = `${one}s`) {
  return `${n(v)} ${v === 1 ? one : many}`;
}
