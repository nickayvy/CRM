"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SearchIcon } from "lucide-react";
import { DataTable, EmptyState, StatusBadge, dataTableColumnHelper } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import { formatRelative } from "@/lib/format";
import { JOB_STATUS_LABELS } from "@/lib/labels";
import { type SearchJobJson, jobDuration } from "../format";

const col = dataTableColumnHelper<SearchJobJson>();
const SOURCE_LABELS: Record<string, string> = { google: "Google Maps", yelp: "Yelp", trustpilot: "Trustpilot" };
const num = { align: "right" as const };

const columns = col.columns([
  col.accessor("location", {
    header: "Location",
    cell: (c) => (
      <Link href={`/searches/${c.row.original.id}`} className="font-medium hover:underline">
        {c.getValue()}
      </Link>
    ),
  }),
  col.accessor("source", {
    header: "Source",
    cell: (c) => <span className="whitespace-nowrap">{SOURCE_LABELS[c.getValue()] ?? c.getValue()}</span>,
  }),
  col.accessor("categoryAliases", {
    header: "Categories / terms",
    enableSorting: false,
    cell: (c) => {
      const j = c.row.original;
      const text = j.source === "google" ? (j.plan?.terms.join(", ") ?? j.term ?? "") : c.getValue().join(", ");
      return <span className="text-muted-foreground">{text}</span>;
    },
  }),
  col.accessor("status", {
    header: "Status",
    cell: (c) => {
      const j = c.row.original;
      // A running Google job with an error is paused (cap reached, rate limited).
      const paused = j.source === "google" && j.status === "running" && !!j.error;
      return <StatusBadge label={paused ? { label: "Paused", tone: "warning" } : JOB_STATUS_LABELS[c.getValue()]} />;
    },
  }),
  col.display({
    id: "searches",
    header: "Searches",
    meta: num,
    cell: (c) => {
      const j = c.row.original;
      return j.source === "google" ? (
        <span className="whitespace-nowrap tabular-nums" title="Searches done of total">
          {j.queriesDone}/{j.queriesTotal}
        </span>
      ) : (
        <span className="text-muted-foreground">—</span>
      );
    },
  }),
  col.accessor("fetchedCount", { header: "Fetched", meta: num }),
  col.accessor("qualifiedCount", { header: "Qualified", meta: num }),
  col.accessor("reviewCount", { header: "Review", meta: num }),
  col.accessor("rejectedCount", { header: "Rejected", meta: num }),
  col.accessor("apiCalls", { header: "API calls", meta: num }),
  col.accessor("createdAt", {
    header: "Created",
    meta: num,
    sortFn: "datetime",
    cell: (c) => (
      <time dateTime={c.getValue()} className="whitespace-nowrap text-muted-foreground" suppressHydrationWarning>
        {formatRelative(c.getValue())}
      </time>
    ),
  }),
  col.display({
    id: "duration",
    header: "Duration",
    meta: num,
    cell: (c) => <span className="whitespace-nowrap tabular-nums">{jobDuration(c.row.original)}</span>,
  }),
]);

/** Search jobs, newest first (client-side sort). Row click opens the job. */
export function SearchesTable({ jobs }: { jobs: SearchJobJson[] }) {
  const router = useRouter();
  return (
    <DataTable
      aria-label="Searches"
      columns={columns}
      data={jobs}
      getRowId={(j) => j.id}
      defaultSort={{ id: "createdAt", desc: true }}
      onRowClick={(j) => router.push(`/searches/${j.id}`)}
      maxHeight="none"
      emptyState={
        <EmptyState
          size="compact"
          icon={<SearchIcon />}
          title="No searches yet"
          description="Run a Google Maps or Yelp search to pull in businesses."
          action={
            <Button asChild size="sm">
              <Link href="/searches/new">New search</Link>
            </Button>
          }
        />
      }
    />
  );
}
