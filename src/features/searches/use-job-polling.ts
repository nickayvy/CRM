"use client";

import * as React from "react";
import { type SearchJobJson, isActive } from "./format";

export const POLL_INTERVAL_MS = 1500;

/**
 * Polls `GET /api/searches/[id]` every `intervalMs` while the job is pending
 * or running; stops once it is completed/failed. Returns the latest job.
 */
export function useJobPolling(initial: SearchJobJson, intervalMs: number = POLL_INTERVAL_MS): SearchJobJson {
  const [job, setJob] = React.useState(initial);
  const active = isActive(job.status);

  React.useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/searches/${initial.id}`, { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const next = (await res.json()) as SearchJobJson;
        if (!cancelled) setJob(next);
      } catch {
        // Transient network error: try again on the next tick.
      }
    };
    const timer = setInterval(() => void tick(), intervalMs);
    void tick();
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [active, initial.id, intervalMs]);

  return job;
}
