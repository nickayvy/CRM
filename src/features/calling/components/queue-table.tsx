"use client";

import * as React from "react";
import Link from "next/link";
import { Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { DataTable, EmptyState, StatusBadge, dataTableColumnHelper, useConfirm } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import type { CallOutcome, QueueState } from "@/db/schema";
import { formatDate, formatPhone } from "@/lib/format";
import { OUTCOME_LABELS, QUEUE_STATE_LABELS } from "@/lib/labels";
import { removeQueueItemAction } from "../actions";

/** Serializable queue row for the table. */
export type QueueTableRow = {
  id: string;
  position: number;
  state: QueueState;
  attempts: number;
  lastOutcome: CallOutcome | null;
  lastOutcomeAt: Date | null;
  claimedBy: string | null;
  callbackAt: Date | null;
  businessId: string;
  businessName: string;
  phone: string | null;
};

const col = dataTableColumnHelper<QueueTableRow>();

function RemoveButton({ row }: { row: QueueTableRow }) {
  const { confirm, dialog } = useConfirm();
  const [pending, startTransition] = React.useTransition();
  return (
    <>
      <Button
        size="icon-xs"
        variant="ghost"
        aria-label={`Remove ${row.businessName} from the queue`}
        disabled={pending}
        onClick={async () => {
          const ok = await confirm({
            title: `Remove ${row.businessName}?`,
            description: "It leaves this campaign's queue. You can add it again later.",
            confirmLabel: "Remove",
            tone: "danger",
          });
          if (!ok) return;
          startTransition(async () => {
            const r = await removeQueueItemAction(row.id);
            if (r.ok) toast.success("Removed from queue");
            else toast.error(r.message ?? "Could not remove.");
          });
        }}
      >
        <Trash2Icon />
      </Button>
      {dialog}
    </>
  );
}

export function QueueTable({ rows, timezone, total }: { rows: QueueTableRow[]; timezone: string; total: number }) {
  const columns = React.useMemo(
    () =>
      col.columns([
        col.accessor("position", { header: "#", meta: { align: "right", width: 56 } }),
        col.accessor("businessName", {
          header: "Business",
          cell: (c) => (
            <div className="flex min-w-0 flex-col">
              <Link href={`/businesses/${c.row.original.businessId}`} className="truncate font-medium hover:underline">
                {c.getValue()}
              </Link>
              <span className="text-xs text-muted-foreground tabular-nums">{formatPhone(c.row.original.phone)}</span>
            </div>
          ),
        }),
        col.accessor("state", {
          header: "State",
          cell: (c) => <StatusBadge label={QUEUE_STATE_LABELS[c.getValue()]} />,
        }),
        col.accessor("attempts", { header: "Attempts", meta: { align: "right" } }),
        col.accessor("lastOutcome", {
          header: "Last outcome",
          cell: (c) => {
            const v = c.getValue();
            return v ? <StatusBadge variant="dot" label={OUTCOME_LABELS[v]} /> : <span className="text-muted-foreground">—</span>;
          },
        }),
        col.accessor("claimedBy", {
          header: "Claimed by",
          cell: (c) => c.getValue() ?? <span className="text-muted-foreground">—</span>,
        }),
        col.accessor("callbackAt", {
          header: "Callback at",
          sortFn: "datetime",
          cell: (c) => {
            const v = c.getValue();
            return v ? <span className="whitespace-nowrap">{formatDate(v, timezone)}</span> : <span className="text-muted-foreground">—</span>;
          },
        }),
        col.display({
          id: "actions",
          header: () => <span className="sr-only">Actions</span>,
          meta: { align: "right", width: 48 },
          cell: (c) => (c.row.original.state === "pending" ? <RemoveButton row={c.row.original} /> : null),
        }),
      ]),
    [timezone],
  );

  return (
    <div className="grid gap-2">
      <DataTable
        aria-label="Call queue"
        columns={columns}
        data={rows}
        getRowId={(r) => r.id}
        defaultSort={{ id: "position", desc: false }}
        emptyState={
          <EmptyState size="compact" title="The queue is empty" description="Use “Add businesses” to fill it." />
        }
      />
      {total > rows.length ? (
        <p className="text-xs text-muted-foreground">
          Showing the first {rows.length} of {total} items.
        </p>
      ) : null}
    </div>
  );
}
