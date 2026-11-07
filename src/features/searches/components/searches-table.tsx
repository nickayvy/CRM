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
  col.accessor("categoryAliases", {
    header: "Categories",
    enableSorting: false,
    cell: (c) => <span className="text-muted-foreground">{c.getValue().join(", ")}</span>,
  }),
  col.accessor("status", { header: "Status", cell: (c) => <StatusBadge label={JOB_STATUS_LABELS[c.getValue()]} /> }),
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
          description="Run a Yelp search to pull in businesses."
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
