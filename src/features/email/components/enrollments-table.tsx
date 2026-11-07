"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { UsersIcon } from "lucide-react";
import { toast } from "sonner";
import { DataTable, EmptyState, StatusBadge, dataTableColumnHelper, useConfirm } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import type { EnrollmentState } from "@/db/schema";
import { ENROLLMENT_STATE_LABELS } from "@/lib/labels";
import { markRepliedAction, unsubscribeAction } from "../actions";

export type EnrollmentRow = {
  id: string;
  businessId: string;
  businessName: string;
  email: string | null;
  state: EnrollmentState;
  /** Steps sent so far. */
  currentStep: number;
  nextSendAt: string | null;
  nextSendLabel: string;
  lastSentAt: string | null;
  lastSentLabel: string;
};

function RowActions({ row }: { row: EnrollmentRow }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const { confirm, dialog } = useConfirm();
  const open = row.state === "active" || row.state === "paused" || row.state === "completed";

  const act = (fn: () => Promise<{ ok: boolean; message?: string }>, done: string) =>
    startTransition(async () => {
      const res = await fn();
      if (res.ok) {
        toast.success(done);
        router.refresh();
      } else toast.error(res.message ?? "Something went wrong");
    });

  return (
    <div className="flex justify-end gap-1" data-no-row-click>
      <Button size="xs" variant="outline" disabled={pending || row.state === "replied" || row.state === "unsubscribed"} onClick={() => act(() => markRepliedAction(row.id), `${row.businessName} marked replied`)}>
        Mark replied
      </Button>
      <Button
        size="xs"
        variant="ghost"
        disabled={pending || row.state === "unsubscribed" || !open}
        onClick={async () => {
          const ok = await confirm({
            title: `Unsubscribe ${row.businessName}?`,
            description: "No more emails in this campaign, and the business is marked do not email everywhere.",
            confirmLabel: "Unsubscribe",
            tone: "danger",
          });
          if (ok) act(() => unsubscribeAction(row.id), `${row.businessName} unsubscribed`);
        }}
      >
        Unsubscribe
      </Button>
      {dialog}
    </div>
  );
}

export function EnrollmentsTable({
  rows,
  stepCount,
  page,
  pageSize,
  total,
}: {
  rows: EnrollmentRow[];
  stepCount: number;
  page: number;
  pageSize: number;
  total: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const columns = React.useMemo(() => {
    const col = dataTableColumnHelper<EnrollmentRow>();
    return col.columns([
      col.accessor("businessName", {
        header: "Business",
        cell: (c) => (
          <Link href={`/businesses/${c.row.original.businessId}`} className="font-medium hover:underline">
            {c.getValue()}
          </Link>
        ),
      }),
      col.accessor("email", { header: "Email", cell: (c) => <span className="text-muted-foreground">{c.getValue() ?? "—"}</span> }),
      col.accessor("state", { header: "State", cell: (c) => <StatusBadge label={ENROLLMENT_STATE_LABELS[c.getValue()]} /> }),
      col.accessor("currentStep", {
        header: "Step",
        meta: { align: "right" },
        cell: (c) => `${Math.min(c.getValue(), stepCount)}/${stepCount}`,
      }),
      col.accessor("nextSendAt", {
        header: "Next send",
        sortFn: "datetime",
        cell: (c) => <span title={c.row.original.nextSendAt ?? undefined}>{c.row.original.nextSendLabel}</span>,
      }),
      col.accessor("lastSentAt", {
        header: "Last sent",
        sortFn: "datetime",
        cell: (c) => <span title={c.row.original.lastSentAt ?? undefined}>{c.row.original.lastSentLabel}</span>,
      }),
      col.display({ id: "actions", header: () => <span className="sr-only">Actions</span>, cell: (c) => <RowActions row={c.row.original} /> }),
    ]);
  }, [stepCount]);

  return (
    <DataTable
      aria-label="Enrollments"
      columns={columns}
      data={rows}
      getRowId={(r) => r.id}
      maxHeight="32rem"
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
        <EmptyState size="compact" icon={<UsersIcon />} title="No one enrolled yet" description="Use “Enroll businesses” to add businesses that have an email." />
      }
    />
  );
}
