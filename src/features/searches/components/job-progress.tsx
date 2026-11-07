"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangleIcon, ArrowRightIcon } from "lucide-react";
import { KeyValue, KeyValueList, ProgressBar, StatusBadge, toneText, type Tone } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import { AnimatedNumber } from "@/lib/motion";
import { JOB_STATUS_LABELS } from "@/lib/labels";
import { type SearchJobJson, isActive, jobDuration } from "../format";
import { useJobPolling } from "../use-job-polling";

function Count({ label, value, tone }: { label: string; value: number; tone?: Tone }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border bg-card p-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <AnimatedNumber value={value} className={`text-2xl font-semibold tabular-nums ${tone ? toneText[tone] : ""}`} />
    </div>
  );
}

/** Live progress for one search job; polls while pending/running. */
export function JobProgress({ initial }: { initial: SearchJobJson }) {
  const job = useJobPolling(initial);
  const router = useRouter();
  const active = isActive(job.status);
  const wasActive = React.useRef(active);

  // Refresh server data (header, links) once the job finishes.
  React.useEffect(() => {
    if (wasActive.current && !active) router.refresh();
    wasActive.current = active;
  }, [active, router]);

  const max = Math.max(job.maxResults, 1);
  const done = job.status === "completed";

  return (
    <div className="flex flex-col gap-4" data-job-status={job.status}>
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge label={JOB_STATUS_LABELS[job.status]} />
        <span className="text-sm text-muted-foreground">
          {active ? "Fetching from Yelp…" : done ? `Finished in ${jobDuration(job)}` : job.status === "failed" ? "The search failed." : null}
        </span>
      </div>
      <ProgressBar
        value={done ? max : Math.min(job.fetchedCount, max)}
        max={max}
        tone={job.status === "failed" ? "danger" : done ? "success" : "info"}
        label={`${job.fetchedCount} of up to ${job.maxResults} fetched`}
        showValue
      />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Count label="Fetched" value={job.fetchedCount} />
        <Count label="Qualified" value={job.qualifiedCount} tone="success" />
        <Count label="Review" value={job.reviewCount} tone="warning" />
        <Count label="Rejected" value={job.rejectedCount} tone="danger" />
      </div>
      {job.status === "failed" && job.error ? (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span className="break-words">{job.error}</span>
        </div>
      ) : null}
      <KeyValueList columns={2}>
        <KeyValue label="Location">{job.location}</KeyValue>
        <KeyValue label="Categories">{job.categoryAliases.join(", ")}</KeyValue>
        <KeyValue label="Term">{job.term}</KeyValue>
        <KeyValue label="Radius">{`${(job.radiusM / 1000).toFixed(1)} km`}</KeyValue>
        <KeyValue label="API calls">{String(job.apiCalls)}</KeyValue>
        <KeyValue label="Duration">{jobDuration(job)}</KeyValue>
      </KeyValueList>
      {!active ? (
        <div>
          <Button asChild>
            <Link href={`/businesses?sourceJobId=${job.id}`}>
              View businesses <ArrowRightIcon />
            </Link>
          </Button>
        </div>
      ) : null}
    </div>
  );
}
