"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { BanIcon, ChevronDownIcon, InboxIcon, TagIcon, UserCheckIcon } from "lucide-react";
import { toast } from "sonner";
import {
  DataTable,
  EmptyState,
  ScoreRing,
  StatusBadge,
  dataTableColumnHelper,
  useConfirm,
  type RowSelectionState,
  type SortState,
} from "@/components/primitives";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { BusinessStatus } from "@/db/schema";
import { formatPhone, formatRating, formatRelative } from "@/lib/format";
import { QUALIFICATION_LABELS, STATUS_LABELS } from "@/lib/labels";
import { bulkAddTagAction, bulkDoNotCallAction, bulkUpdateStatusAction } from "../actions";
import { PAGE_SIZES, patchSearchParams } from "../search-params";
import type { BusinessRow } from "../types";
import { ReasonChips } from "./reason-chips";

/**
 * Extension point for extra bulk actions (WP-07 passes "Add to campaign").
 * Rendered after the built-in "Set status…", "Add tag…" and "Mark do-not-call".
 * The selection is cleared and the route refreshed after `onSelect` resolves.
 */
export type BulkAction = {
  label: string;
  icon?: React.ReactNode;
  onSelect: (ids: string[]) => void | Promise<void>;
};

export type BusinessesTableProps = {
  rows: BusinessRow[];
  /** Total matches across all pages. */
  total: number;
  /** 1-based page. */
  page: number;
  pageSize: number;
  /** Current sort, as read from the URL (`?sort=score&dir=desc`). */
  sort: SortState | null;
  /** Extra bulk actions (extension point; the three built-in actions are always present). */
  bulkActions?: BulkAction[];
  /** Shown when there are no rows. */
  emptyState?: React.ReactNode;
};

const col = dataTableColumnHelper<BusinessRow>();

function useColumns() {
  return React.useMemo(
    () =>
      col.columns([
        col.accessor("name", {
          header: "Name",
          meta: { className: "min-w-48" },
          cell: (c) => (
            <Link href={`/businesses/${c.row.original.id}`} className="font-medium text-foreground hover:underline">
              {c.getValue()}
            </Link>
          ),
        }),
        col.accessor("score", {
          header: "Score",
          meta: { align: "right", width: 72 },
          cell: (c) => <ScoreRing value={c.getValue()} size={26} thickness={3} className="ml-auto" />,
        }),
        col.accessor("qualification", {
          header: "Qualification",
          enableSorting: false,
          cell: (c) => (
            <div className="flex items-center gap-1" data-testid="qualification-cell">
              <StatusBadge label={QUALIFICATION_LABELS[c.getValue()]} />
              <ReasonChips reasons={c.row.original.rejectionReasons} />
            </div>
          ),
        }),
        col.accessor("status", {
          header: "Status",
          cell: (c) => <StatusBadge variant="dot" label={STATUS_LABELS[c.getValue()]} />,
        }),
        col.display({
          id: "category",
          header: "Category",
          cell: (c) => (
            <span className="text-muted-foreground">
              {c.row.original.categories[0]?.title ?? c.row.original.primaryCategory ?? "—"}
            </span>
          ),
        }),
        col.accessor("city", {
          header: "City",
          cell: (c) => {
            const { city, state } = c.row.original;
            return <span className="whitespace-nowrap">{[city, state].filter(Boolean).join(", ") || "—"}</span>;
          },
        }),
        col.accessor("rating", {
          header: "Rating · reviews",
          meta: { align: "right" },
          cell: (c) => (
            <span className="whitespace-nowrap">
              {formatRating(c.getValue())} <span className="text-muted-foreground">· {c.row.original.reviewCount}</span>
            </span>
          ),
        }),
        col.accessor("phone", {
          header: "Phone",
          enableSorting: false,
          cell: (c) => {
            const phone = c.getValue();
            if (!phone) return <span className="text-muted-foreground">—</span>;
            return (
              <a href={`tel:${phone}`} className="whitespace-nowrap tabular-nums hover:underline">
                {formatPhone(phone)}
              </a>
            );
          },
        }),
        col.accessor("lastContactedAt", {
          header: "Last contacted",
          meta: { align: "right" },
          cell: (c) => {
            const v = c.getValue();
            if (!v) return <span className="text-muted-foreground">Never</span>;
            return (
              <time dateTime={new Date(v).toISOString()} className="whitespace-nowrap text-muted-foreground" suppressHydrationWarning>
                {formatRelative(v)}
              </time>
            );
          },
        }),
      ]),
    [],
  );
}

/** URL-driven navigation for the table; falls back gracefully when used outside /businesses. */
function useUrlNavigation() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = React.useTransition();
  const navigate = React.useCallback(
    (patch: Parameters<typeof patchSearchParams>[1]) => {
      const qs = patchSearchParams(searchParams?.toString() ?? "", patch);
      startTransition(() => router.push(`${pathname}${qs}`, { scroll: false }));
    },
    [router, pathname, searchParams],
  );
  const refresh = React.useCallback(() => startTransition(() => router.refresh()), [router]);
  return { navigate, refresh, pending };
}

/**
 * The businesses table: server-sorted and paginated via URL params
 * (`sort`, `dir`, `page`, `pageSize`), row selection with bulk actions.
 */
export function BusinessesTable({ rows, total, page, pageSize, sort, bulkActions = [], emptyState }: BusinessesTableProps) {
  const columns = useColumns();
  const { navigate, refresh, pending } = useUrlNavigation();
  const [selection, setSelection] = React.useState<RowSelectionState>({});
  const [busy, setBusy] = React.useState(false);
  const [tagIds, setTagIds] = React.useState<string[] | null>(null);
  const { confirm, dialog } = useConfirm();

  async function run<T>(fn: () => Promise<T>, clear: () => void) {
    setBusy(true);
    try {
      await fn();
      clear();
      refresh();
    } finally {
      setBusy(false);
    }
  }

  const setStatus = (ids: string[], status: BusinessStatus, clear: () => void) =>
    run(async () => {
      const r = await bulkUpdateStatusAction(ids, status);
      if (r.ok) toast.success(`Set ${r.data.updated} of ${ids.length} to ${STATUS_LABELS[status].label}`);
      else toast.error(r.message ?? "Could not update the status.");
    }, clear);

  const markDoNotCall = async (ids: string[], clear: () => void) => {
    const yes = await confirm({
      title: `Mark ${ids.length} as do not call?`,
      description: "They will be excluded from calling campaigns.",
      confirmLabel: "Mark do not call",
      tone: "danger",
    });
    if (!yes) return;
    await run(async () => {
      const r = await bulkDoNotCallAction(ids);
      if (r.ok) toast.success(`Marked ${r.data.updated} as do not call`);
      else toast.error(r.message ?? "Could not mark do not call.");
    }, clear);
  };

  return (
    <div className="flex min-w-0 flex-col gap-3" data-pending={pending || undefined}>
      {dialog}
      {tagIds ? (
        <AddTagDialog
          ids={tagIds}
          onClose={() => setTagIds(null)}
          onDone={() => {
            setTagIds(null);
            setSelection({});
            refresh();
          }}
        />
      ) : null}
      <DataTable
        aria-label="Businesses"
        className={pending ? "opacity-70 transition-opacity" : "transition-opacity"}
        columns={columns}
        data={rows}
        getRowId={(b) => b.id}
        sort={sort}
        manualSorting
        onSortChange={(s) => navigate({ sort: s?.id ?? null, dir: s ? (s.desc ? "desc" : "asc") : null })}
        enableSelection
        selection={selection}
        onSelectionChange={setSelection}
        bulkActions={({ selectedIds, clear }) => (
          <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="ghost" disabled={busy}>
                  <UserCheckIcon /> Set status… <ChevronDownIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuLabel>Set status</DropdownMenuLabel>
                {(Object.keys(STATUS_LABELS) as BusinessStatus[]).map((s) => (
                  <DropdownMenuItem key={s} onSelect={() => void setStatus(selectedIds, s, clear)}>
                    {STATUS_LABELS[s].label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setTagIds(selectedIds)}>
              <TagIcon /> Add tag…
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive"
              disabled={busy}
              onClick={() => void markDoNotCall(selectedIds, clear)}
            >
              <BanIcon /> Mark do-not-call
            </Button>
            {/* Extension point: extra bulk actions passed by other packages (e.g. WP-07 "Add to campaign"). */}
            {bulkActions.map((a) => (
              <Button
                key={a.label}
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => void run(async () => a.onSelect(selectedIds), clear)}
              >
                {a.icon} {a.label}
              </Button>
            ))}
          </>
        )}
        emptyState={
          emptyState ?? (
            <EmptyState
              size="compact"
              icon={<InboxIcon />}
              title="No businesses match"
              description="Clear a filter or run a new search."
            />
          )
        }
        pagination={{
          page,
          pageSize,
          total,
          onPageChange: (p) => navigate({ page: p }),
          onPageSizeChange: (n) => navigate({ pageSize: n }),
          pageSizeOptions: [...PAGE_SIZES],
        }}
      />
    </div>
  );
}

/** Mounted only while open, so its state starts fresh each time. */
function AddTagDialog({ ids, onClose, onDone }: { ids: string[]; onClose: () => void; onDone: () => void }) {
  const [tag, setTag] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const r = await bulkAddTagAction(ids, tag);
      if (!r.ok) {
        setError(r.fieldErrors?.tag?.[0] ?? r.message ?? "Could not add the tag.");
        return;
      }
      toast.success(`Tagged ${r.data.updated} of ${ids.length} with “${tag.trim()}”`);
      onDone();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Add tag</DialogTitle>
            <DialogDescription>
              Adds the tag to {ids.length} selected business{ids.length === 1 ? "" : "es"}.
            </DialogDescription>
          </DialogHeader>
          <Field data-invalid={error ? true : undefined}>
            <FieldLabel htmlFor="bulk-tag">Tag</FieldLabel>
            <Input
              id="bulk-tag"
              value={tag}
              onChange={(e) => setTag(e.target.value)}
              placeholder="e.g. spring-promo"
              aria-invalid={error ? true : undefined}
              autoFocus
            />
            {error ? <FieldError>{error}</FieldError> : null}
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              Add tag
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
