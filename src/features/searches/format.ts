import type { SearchJob } from "@/db/schema";

/** Serializable job (dates as ISO strings), the shape `GET /api/searches/[id]` returns. */
export type SearchJobJson = Omit<SearchJob, "startedAt" | "finishedAt" | "createdAt"> & {
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
};

export function toJobJson(job: SearchJob): SearchJobJson {
  return {
    ...job,
    startedAt: job.startedAt ? new Date(job.startedAt).toISOString() : null,
    finishedAt: job.finishedAt ? new Date(job.finishedAt).toISOString() : null,
    createdAt: new Date(job.createdAt).toISOString(),
  };
}

/** "850 ms", "12 s", "1 min 5 s" from startedAt to finishedAt (or `now` while running); "—" before start. */
export function jobDuration(
  job: { startedAt: Date | string | null; finishedAt: Date | string | null },
  now: Date = new Date(),
): string {
  if (!job.startedAt) return "—";
  const end = job.finishedAt ? new Date(job.finishedAt) : now;
  const ms = Math.max(0, end.getTime() - new Date(job.startedAt).getTime());
  if (ms < 1000) return `${ms} ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  return `${Math.floor(s / 60)} min ${s % 60} s`;
}

export function isActive(status: SearchJob["status"]): boolean {
  return status === "pending" || status === "running";
}
