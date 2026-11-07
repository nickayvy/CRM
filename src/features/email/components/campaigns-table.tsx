"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { MailIcon } from "lucide-react";
import { DataTable, EmptyState, dataTableColumnHelper } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import type { CampaignStatus, PauseReason } from "@/db/schema";
import { CampaignStatusBadge } from "./badges";

export type CampaignRow = {
  id: string;
  name: string;
  status: CampaignStatus;
  pauseReason: PauseReason | null;
  stepCount: number;
  enrolled: number;
  active: number;
  completed: number;
  replied: number;
  unsubscribed: number;
  sentToday: number;
  sentTotal: number;
  dailyCap: number;
};

const col = dataTableColumnHelper<CampaignRow>();
const columns = col.columns([
  col.accessor("name", {
    header: "Campaign",
    cell: (c) => (
      <Link href={`/email/${c.row.original.id}`} className="font-medium hover:underline">
        {c.getValue()}
      </Link>
    ),
  }),
  col.accessor("status", {
    header: "Status",
    cell: (c) => <CampaignStatusBadge status={c.getValue()} pauseReason={c.row.original.pauseReason} />,
  }),
  col.accessor("stepCount", { header: "Steps", meta: { align: "right" } }),
  col.accessor("enrolled", { header: "Enrolled", meta: { align: "right" } }),
  col.accessor("active", { header: "Active", meta: { align: "right" } }),
  col.accessor("replied", { header: "Replied", meta: { align: "right" } }),
  col.accessor("unsubscribed", { header: "Unsub.", meta: { align: "right" } }),
  col.accessor("sentToday", {
    header: "Sent today / cap",
    meta: { align: "right" },
    cell: (c) => `${c.getValue()} / ${c.row.original.dailyCap}`,
  }),
  col.accessor("sentTotal", { header: "Sent total", meta: { align: "right" } }),
]);

export function CampaignsTable({ rows }: { rows: CampaignRow[] }) {
  const router = useRouter();
  return (
    <DataTable
      aria-label="Email campaigns"
      columns={columns}
      data={rows}
      getRowId={(r) => r.id}
      onRowClick={(r) => router.push(`/email/${r.id}`)}
      maxHeight="none"
      emptyState={
        <EmptyState
          size="compact"
          icon={<MailIcon />}
          title="No email campaigns yet"
          description="Create a sequence of steps, enroll businesses that have an email, then start it."
          action={
            <Button asChild size="sm">
              <Link href="/email/new">New campaign</Link>
            </Button>
          }
        />
      }
    />
  );
}
