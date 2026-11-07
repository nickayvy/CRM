"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { InboxIcon } from "lucide-react";
import { DataTable, EmptyState, KeyValue, KeyValueList, SidePanel, StatusBadge, dataTableColumnHelper } from "@/components/primitives";
import type { MessageStatus } from "@/db/schema";
import { MESSAGE_STATUS_LABELS } from "@/lib/labels";

export type MessageRow = {
  id: string;
  /** Pre-formatted on the server (sentAt ?? createdAt). */
  timeLabel: string;
  toEmail: string;
  subject: string;
  status: MessageStatus;
  /** Order of the campaign step this message belongs to; null when unknown. */
  stepOrder: number | null;
  businessId: string;
  businessName: string;
  providerId: string | null;
  error: string | null;
  bodyRendered: string;
};

export function MessagesTable({ rows, page, pageSize, total }: { rows: MessageRow[]; page: number; pageSize: number; total: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [openId, setOpenId] = React.useState<string | null>(null);
  const open = rows.find((r) => r.id === openId) ?? null;

  const columns = React.useMemo(() => {
    const col = dataTableColumnHelper<MessageRow>();
    return col.columns([
      col.accessor("timeLabel", { header: "Time", enableSorting: false, cell: (c) => <span className="whitespace-nowrap">{c.getValue()}</span> }),
      col.accessor("toEmail", { header: "To" }),
      col.accessor("subject", { header: "Subject", cell: (c) => <span className="font-medium">{c.getValue()}</span> }),
      col.accessor("status", { header: "Status", cell: (c) => <StatusBadge label={MESSAGE_STATUS_LABELS[c.getValue()]} /> }),
      col.accessor("stepOrder", {
        header: "Step",
        meta: { align: "right" },
        cell: (c) => c.getValue() ?? "—",
      }),
    ]);
  }, []);

  return (
    <>
      <DataTable
        aria-label="Message log"
        columns={columns}
        data={rows}
        getRowId={(r) => r.id}
        onRowClick={(r) => setOpenId(r.id)}
        activeRowId={openId}
        maxHeight="40rem"
        pagination={
          total > pageSize
            ? {
                page,
                pageSize,
                total,
                onPageChange: (p) => {
                  const next = new URLSearchParams(params.toString());
                  next.set("page", String(p));
                  router.push(`${pathname}?${next.toString()}`, { scroll: false });
                },
              }
            : undefined
        }
        emptyState={
          <EmptyState
            size="compact"
            icon={<InboxIcon />}
            title="No messages yet"
            description="Messages appear here once the campaign sends its first step."
          />
        }
      />
      <SidePanel
        open={open !== null}
        onOpenChange={(o) => !o && setOpenId(null)}
        title={open?.subject ?? ""}
        description={open ? `To ${open.toEmail} · ${open.timeLabel}` : undefined}
        headerActions={open ? <StatusBadge label={MESSAGE_STATUS_LABELS[open.status]} /> : null}
      >
        {open ? (
          <div className="flex flex-col gap-6">
            <KeyValueList>
              <KeyValue label="Status">
                <StatusBadge label={MESSAGE_STATUS_LABELS[open.status]} />
              </KeyValue>
              <KeyValue label="Step">{open.stepOrder ?? "—"}</KeyValue>
              <KeyValue label="Business">
                <Link href={`/businesses/${open.businessId}`} className="font-medium hover:underline">
                  {open.businessName}
                </Link>
              </KeyValue>
              {open.providerId ? (
                <KeyValue label="Provider id" mono>
                  {open.providerId}
                </KeyValue>
              ) : null}
              {open.error ? (
                <KeyValue label="Error">
                  <span className="text-destructive">{open.error}</span>
                </KeyValue>
              ) : null}
            </KeyValueList>
            <div className="whitespace-pre-wrap break-words rounded-md border bg-muted/30 p-3 text-sm">{open.bodyRendered}</div>
          </div>
        ) : null}
      </SidePanel>
    </>
  );
}
