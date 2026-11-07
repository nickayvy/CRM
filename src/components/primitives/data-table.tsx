"use client";

import * as React from "react";
import {
  createColumnHelper,
  createSortedRowModel,
  flexRender,
  rowSelectionFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_basic,
  sortFn_datetime,
  sortFn_text,
  tableFeatures,
  useTable,
  type ColumnDef,
  type Row,
  type RowData,
  type RowSelectionState,
  type SortingState,
  type Updater,
} from "@tanstack/react-table";
import { motion } from "motion/react";
import { ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon, ChevronLeftIcon, ChevronRightIcon, XIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Presence, fadeInUp, formatNumber } from "@/lib/motion";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "./empty-state";

/** Column metadata understood by DataTable (`columnDef.meta`). */
export type DataTableColumnMeta = {
  /** Cell/header alignment. Use `right` for numbers (also applies tabular-nums). Default `left`. */
  align?: "left" | "right" | "center";
  /** Fixed column width (px number or CSS length). */
  width?: number | string;
  /** Extra classes for every body cell of the column. */
  className?: string;
  /** Extra classes for the header cell. */
  headerClassName?: string;
};

/**
 * The TanStack Table v9 feature set DataTable is built on (sorting with the
 * `alphanumeric`/`basic`/`datetime`/`text` sort fns, row selection). Column
 * definitions are typed against it.
 */
export const dataTableFeatures = tableFeatures({
  rowSortingFeature,
  rowSelectionFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { alphanumeric: sortFn_alphanumeric, basic: sortFn_basic, datetime: sortFn_datetime, text: sortFn_text },
  columnMeta: {} as DataTableColumnMeta,
});

export type DataTableFeatures = typeof dataTableFeatures;

/** A column definition for `DataTable<T>`. */
// TanStack's ColumnDef value type is invariant; `any` lets one array mix columns of different value types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DataTableColumn<T extends RowData> = ColumnDef<DataTableFeatures, T, any>;

/**
 * Typed column helper for `DataTable` (TanStack v9 `createColumnHelper` bound to `dataTableFeatures`).
 *
 * ```ts
 * const col = dataTableColumnHelper<Business>();
 * const columns = col.columns([
 *   col.accessor("name", { header: "Name" }),
 *   col.accessor("rating", { header: "Rating", meta: { align: "right" }, cell: (c) => formatRating(c.getValue()) }),
 *   col.display({ id: "actions", cell: () => <Button size="xs">Call</Button> }),
 * ]);
 * ```
 */
export function dataTableColumnHelper<T extends RowData>() {
  return createColumnHelper<DataTableFeatures, T>();
}

/** Single-column sort, shaped for URL params (`?sort=name&dir=asc`). */
export type SortState = { id: string; desc: boolean };

export type DataTablePagination = {
  /** Current page, 1-based. */
  page: number;
  /** Rows per page. */
  pageSize: number;
  /** Total rows across all pages (server count). */
  total: number;
  /** Called with the new 1-based page. */
  onPageChange: (page: number) => void;
  /** Called when the user picks a page size; omit to hide the picker. */
  onPageSizeChange?: (pageSize: number) => void;
  /** Choices for the page size picker. Default `[25, 50, 100]`. */
  pageSizeOptions?: number[];
};

export type BulkActionContext<T> = {
  /** Ids of every selected row (may include rows on other pages when selection is controlled). */
  selectedIds: string[];
  /** Selected rows that are in the current `data`. */
  selectedRows: T[];
  /** Clears the selection. */
  clear: () => void;
};

export type DataTableProps<T extends RowData> = {
  /**
   * Column definitions (build them with `dataTableColumnHelper<T>()` inside a client component: cells are functions,
   * which cannot cross the server→client boundary). Keep the array stable (module scope or `useMemo`).
   * Set `meta.align: "right"` on numeric columns;
   * set `enableSorting: false` on columns that cannot be sorted.
   */
  columns: DataTableColumn<T>[];
  /** Rows for the current page. */
  data: T[];
  /** Stable row id (used for selection and React keys). Default: the row index. Required for server pagination + selection. */
  getRowId?: (row: T, index: number) => string;

  /** Controlled sort. Pass `null` for unsorted. Omit to let the table manage sort internally. */
  sort?: SortState | null;
  /** Initial sort when uncontrolled. */
  defaultSort?: SortState | null;
  /** Called whenever the user changes the sort (header click toggles asc ↔ desc). */
  onSortChange?: (sort: SortState | null) => void;
  /** When true the table does not sort `data` itself; the server (via `onSortChange`) does. */
  manualSorting?: boolean;

  /** Adds a checkbox column and enables selection (click checkbox, or `x`/Space on the focused row). */
  enableSelection?: boolean;
  /** Controlled selection: `{ [rowId]: true }`. Omit for internal state. */
  selection?: RowSelectionState;
  /** Called with the next selection map. */
  onSelectionChange?: (selection: RowSelectionState) => void;
  /** Bulk action buttons shown in the `BulkActionBar` while at least one row is selected. */
  bulkActions?: (ctx: BulkActionContext<T>) => React.ReactNode;

  /** Shows skeleton rows instead of data. */
  loading?: boolean;
  /** Number of skeleton rows. Default: `pagination.pageSize` capped at 10, else 8. */
  loadingRows?: number;
  /** Rendered in the body when `data` is empty and not loading. Default: a compact "No results" EmptyState. */
  emptyState?: React.ReactNode;

  /** Row activation: click on the row (outside interactive elements) or Enter on the focused row. */
  onRowClick?: (row: T) => void;
  /** Highlights one row as "open" (e.g. shown in a side panel). */
  activeRowId?: string | null;
  /** Extra classes per row. */
  rowClassName?: (row: T) => string | undefined;

  /** Row height: `compact` 32px / 13px text (default), `comfortable` 40px / 14px text. */
  density?: "compact" | "comfortable";
  /**
   * Max height of the scroll area; the header sticks while the body scrolls.
   * Default `max(20rem, calc(100svh - 16rem))`. Pass `"none"` to let the table grow.
   */
  maxHeight?: string;
  /** Server pagination footer. Omit to render no footer. */
  pagination?: DataTablePagination;

  /** Accessible name of the table, e.g. "Businesses". */
  "aria-label"?: string;
  className?: string;
};

const SELECT_COLUMN_ID = "__select";

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
}

const INTERACTIVE = "a,button,input,select,textarea,label,[role=checkbox],[role=button],[role=menuitem],[data-no-row-click]";

function toSorting(sort: SortState | null | undefined): SortingState {
  return sort ? [{ id: sort.id, desc: sort.desc }] : [];
}

function fromSorting(sorting: SortingState): SortState | null {
  const first = sorting[0];
  return first ? { id: first.id, desc: first.desc } : null;
}

function resolve<S>(updater: Updater<S>, prev: S): S {
  return typeof updater === "function" ? (updater as (p: S) => S)(prev) : updater;
}

function alignClass(align: "left" | "right" | "center" | undefined) {
  return align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left";
}

/**
 * Data table on TanStack Table: sorting (internal or controlled/server),
 * row selection with a bulk action bar, sticky header, skeleton loading,
 * empty state, row click, keyboard navigation (j/k or ↑/↓ move the focused
 * row, Home/End jump, Enter activates, x/Space toggles selection), density
 * and a server pagination footer.
 *
 * ```tsx
 * <DataTable
 *   aria-label="Businesses"
 *   columns={columns}
 *   data={rows}
 *   getRowId={(b) => b.id}
 *   sort={sort} onSortChange={setSortInUrl} manualSorting
 *   enableSelection bulkActions={({ selectedIds }) => <Button>Add {selectedIds.length} to campaign</Button>}
 *   pagination={{ page, pageSize, total, onPageChange: setPageInUrl }}
 *   onRowClick={(b) => openPanel(b.id)}
 * />
 * ```
 */
export function DataTable<T extends RowData>({
  columns,
  data,
  getRowId,
  sort,
  defaultSort = null,
  onSortChange,
  manualSorting = false,
  enableSelection = false,
  selection,
  onSelectionChange,
  bulkActions,
  loading = false,
  loadingRows,
  emptyState,
  onRowClick,
  activeRowId,
  rowClassName,
  density = "compact",
  maxHeight = "max(20rem, calc(100svh - 16rem))",
  pagination,
  "aria-label": ariaLabel,
  className,
}: DataTableProps<T>) {
  const [internalSort, setInternalSort] = React.useState<SortState | null>(defaultSort);
  const [internalSelection, setInternalSelection] = React.useState<RowSelectionState>({});
  const sortValue = sort !== undefined ? sort : internalSort;
  const selectionValue = selection ?? internalSelection;
  const sorting = React.useMemo(() => toSorting(sortValue), [sortValue]);
  // Latest values for resolving TanStack updaters: several changes can fire before the parent re-renders.
  const sortingRef = React.useRef(sorting);
  const selectionRef = React.useRef(selectionValue);
  React.useLayoutEffect(() => {
    sortingRef.current = sorting;
    selectionRef.current = selectionValue;
  }, [sorting, selectionValue]);

  const allColumns = React.useMemo(() => {
    if (!enableSelection) return columns;
    const select: DataTableColumn<T> = {
      id: SELECT_COLUMN_ID,
      enableSorting: false,
      meta: { width: 36 },
      header: ({ table }) => (
        <Checkbox
          aria-label="Select all rows"
          checked={table.getIsAllPageRowsSelected() ? true : table.getIsSomePageRowsSelected() ? "indeterminate" : false}
          onCheckedChange={(v) => table.toggleAllPageRowsSelected(v === true)}
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          aria-label="Select row"
          checked={row.getIsSelected()}
          onCheckedChange={(v) => row.toggleSelected(v === true)}
        />
      ),
    };
    return [select, ...columns];
  }, [columns, enableSelection]);

  const table = useTable({
    features: dataTableFeatures,
    data,
    columns: allColumns,
    getRowId,
    state: { sorting, rowSelection: selectionValue },
    enableRowSelection: enableSelection,
    enableSortingRemoval: false,
    sortDescFirst: false,
    manualSorting,
    onSortingChange: (updater) => {
      const resolved = resolve(updater, sortingRef.current);
      sortingRef.current = resolved;
      const next = fromSorting(resolved);
      if (sort === undefined) setInternalSort(next);
      onSortChange?.(next);
    },
    onRowSelectionChange: (updater) => {
      const next = resolve(updater, selectionRef.current);
      selectionRef.current = next;
      if (selection === undefined) setInternalSelection(next);
      onSelectionChange?.(next);
    },
  });

  const rows = table.getRowModel().rows;
  const [focusedIndex, setFocusedIndex] = React.useState(-1);
  const rowRefs = React.useRef<(HTMLTableRowElement | null)[]>([]);
  const effectiveFocus = focusedIndex >= rows.length ? rows.length - 1 : focusedIndex;

  const selectedIds = Object.keys(selectionValue).filter((id) => selectionValue[id]);
  // Clearing goes through the table so `onRowSelectionChange` also resets
  // `selectionRef`: a toggle fired before the next render must start from {}.
  const clearSelection = () => table.setRowSelection({});

  function focusRow(i: number) {
    if (rows.length === 0) return;
    const next = Math.max(0, Math.min(rows.length - 1, i));
    setFocusedIndex(next);
    rowRefs.current[next]?.focus();
  }

  function onBodyKeyDown(e: React.KeyboardEvent<HTMLTableSectionElement>) {
    if (e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
    // Derive the current row from the DOM so rapid key repeats never act on a stale render.
    const fromDom = e.target instanceof HTMLElement ? rowRefs.current.findIndex((r) => r?.contains(e.target as Node)) : -1;
    const current = fromDom >= 0 ? fromDom : effectiveFocus;
    const onRow = e.target instanceof HTMLTableRowElement;
    switch (e.key) {
      case "ArrowDown":
      case "j":
        e.preventDefault();
        focusRow(current + 1);
        break;
      case "ArrowUp":
      case "k":
        e.preventDefault();
        focusRow(current < 0 ? 0 : current - 1);
        break;
      case "Home":
        e.preventDefault();
        focusRow(0);
        break;
      case "End":
        e.preventDefault();
        focusRow(rows.length - 1);
        break;
      case "Enter":
        if (onRow && current >= 0 && onRowClick) {
          e.preventDefault();
          onRowClick(rows[current].original);
        }
        break;
      case "x":
      case " ":
        if (onRow && enableSelection && current >= 0) {
          e.preventDefault();
          rows[current].toggleSelected();
        }
        break;
    }
  }

  function onRowMouseClick(e: React.MouseEvent<HTMLTableRowElement>, row: Row<DataTableFeatures, T>) {
    if (!onRowClick) return;
    const target = e.target as HTMLElement;
    const interactive = target.closest(INTERACTIVE);
    if (interactive && e.currentTarget.contains(interactive)) return;
    onRowClick(row.original);
  }

  const compact = density === "compact";
  const cellPad = compact ? "px-3 py-1.5" : "px-3 py-2.5";
  const skeletonCount = loadingRows ?? (pagination ? Math.min(pagination.pageSize, 10) : 8);
  const colCount = table.getAllLeafColumns().length;
  const showBulk = enableSelection && selectedIds.length > 0;

  return (
    <div data-slot="data-table" className={cn("relative flex min-w-0 flex-col rounded-lg border bg-card", className)}>
      <div className="relative min-w-0 overflow-auto rounded-t-lg" style={{ maxHeight: maxHeight === "none" ? undefined : maxHeight }}>
        <table
          aria-label={ariaLabel}
          aria-busy={loading || undefined}
          className={cn("w-full caption-bottom border-separate border-spacing-0", compact ? "text-dense" : "text-sm")}
        >
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((header) => {
                  const meta = header.column.columnDef.meta;
                  const sortable = header.column.getCanSort();
                  const dir = header.column.getIsSorted();
                  return (
                    <th
                      key={header.id}
                      scope="col"
                      aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : sortable ? "none" : undefined}
                      style={{ width: meta?.width }}
                      className={cn(
                        "sticky top-0 z-10 h-8 bg-muted/80 px-3 text-xs font-medium whitespace-nowrap text-muted-foreground shadow-[inset_0_-1px_0_var(--border)] backdrop-blur-sm",
                        header.column.id === SELECT_COLUMN_ID && "pr-0",
                        alignClass(meta?.align),
                        meta?.headerClassName,
                      )}
                    >
                      {header.isPlaceholder ? null : sortable ? (
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          className={cn(
                            "-mx-1 inline-flex items-center gap-1 rounded-sm px-1 py-0.5 hover:text-foreground",
                            meta?.align === "right" && "flex-row-reverse",
                            dir && "text-foreground",
                          )}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {dir === "asc" ? (
                            <ArrowUpIcon className="size-3" aria-hidden />
                          ) : dir === "desc" ? (
                            <ArrowDownIcon className="size-3" aria-hidden />
                          ) : (
                            <ArrowUpDownIcon className="size-3 opacity-40" aria-hidden />
                          )}
                        </button>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody onKeyDown={onBodyKeyDown}>
            {loading ? (
              Array.from({ length: skeletonCount }, (_, i) => (
                <tr key={`sk-${i}`} data-slot="data-table-skeleton-row">
                  {table.getAllLeafColumns().map((col) => (
                    <td key={col.id} className={cn(cellPad, "border-b border-border/60")}>
                      <Skeleton className={cn("h-3.5", col.id === SELECT_COLUMN_ID ? "w-4" : "w-full max-w-40")} />
                    </td>
                  ))}
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={colCount} className="p-0">
                  {emptyState ?? <EmptyState size="compact" title="No results" description="Try adjusting the filters." />}
                </td>
              </tr>
            ) : (
              rows.map((row, i) => {
                const selected = row.getIsSelected();
                const active = activeRowId != null && row.id === activeRowId;
                const tabbable = effectiveFocus === i || (effectiveFocus < 0 && i === 0);
                return (
                  <tr
                    key={row.id}
                    ref={(el) => {
                      rowRefs.current[i] = el;
                    }}
                    tabIndex={tabbable ? 0 : -1}
                    data-state={selected ? "selected" : undefined}
                    data-active={active || undefined}
                    data-focused={effectiveFocus === i || undefined}
                    aria-selected={enableSelection ? selected : undefined}
                    onFocus={(e) => {
                      if (e.target === e.currentTarget) setFocusedIndex(i);
                    }}
                    onClick={(e) => onRowMouseClick(e, row)}
                    className={cn(
                      "group/row outline-none transition-colors hover:bg-row-hover focus-visible:bg-row-hover",
                      "focus-visible:shadow-[inset_2px_0_0_var(--ring)]",
                      onRowClick && "cursor-pointer",
                      selected && "bg-row-selected hover:bg-row-selected",
                      active && "bg-row-selected shadow-[inset_2px_0_0_var(--primary)]",
                      rowClassName?.(row.original),
                    )}
                  >
                    {row.getAllCells().map((cell) => {
                      const meta = cell.column.columnDef.meta;
                      return (
                        <td
                          key={cell.id}
                          className={cn(
                            cellPad,
                            "border-b border-border/60 align-middle whitespace-nowrap group-last/row:border-b-0",
                            cell.column.id === SELECT_COLUMN_ID && "pr-0",
                            alignClass(meta?.align),
                            meta?.align === "right" && "tabular-nums",
                            meta?.className,
                          )}
                        >
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      );
                    })}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
        {showBulk ? <div aria-hidden className="h-14" /> : null}
      </div>
      <Presence>
        {showBulk ? (
          <div
            key="bulk"
            className={cn(
              "pointer-events-none absolute inset-x-0 z-20 flex justify-center px-3",
              pagination ? "bottom-12" : "bottom-3",
            )}
          >
            <BulkActionBar
              className="pointer-events-auto"
              count={selectedIds.length}
              onClear={clearSelection}
            >
              {bulkActions?.({
                selectedIds,
                selectedRows: rows.filter((r) => r.getIsSelected()).map((r) => r.original),
                clear: clearSelection,
              })}
            </BulkActionBar>
          </div>
        ) : null}
      </Presence>
      {pagination ? <PaginationFooter {...pagination} /> : <div className="h-px" />}
    </div>
  );
}

export type BulkActionBarProps = {
  /** Number of selected items; rendered as "{count} selected". */
  count: number;
  /** Clears the selection (the × button). Omit to hide it. */
  onClear?: () => void;
  /** Action buttons (use `size="sm"`). */
  children?: React.ReactNode;
  className?: string;
};

/**
 * Floating bar with the selection count and bulk actions. `DataTable` renders
 * it automatically when `bulkActions` is set; use it directly for custom lists.
 * Wrap in `Presence` (with a `key`) for its enter/exit animation.
 */
export function BulkActionBar({ count, onClear, children, className }: BulkActionBarProps) {
  return (
    <motion.div
      role="region"
      aria-label="Bulk actions"
      data-slot="bulk-action-bar"
      variants={fadeInUp}
      initial="hidden"
      animate="visible"
      exit="exit"
      className={cn(
        "flex max-w-full items-center gap-2 overflow-x-auto rounded-lg border bg-popover py-1.5 pr-1.5 pl-3 text-popover-foreground shadow-lg",
        className,
      )}
    >
      <span className="text-dense font-medium whitespace-nowrap tabular-nums" aria-live="polite">
        {`${count} selected`}
      </span>
      {children ? <span aria-hidden className="h-4 w-px bg-border" /> : null}
      <div className="flex items-center gap-1">{children}</div>
      {onClear ? (
        <Button variant="ghost" size="icon-sm" aria-label="Clear selection" onClick={onClear}>
          <XIcon />
        </Button>
      ) : null}
    </motion.div>
  );
}

function PaginationFooter({ page, pageSize, total, onPageChange, onPageSizeChange, pageSizeOptions = [25, 50, 100] }: DataTablePagination) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div
      data-slot="data-table-pagination"
      className="flex flex-wrap items-center justify-between gap-2 border-t px-3 py-1.5 text-xs text-muted-foreground"
    >
      <span className="tabular-nums">
        {formatNumber(from)}–{formatNumber(to)} of {formatNumber(total)}
      </span>
      <div className="flex items-center gap-3">
        {onPageSizeChange ? (
          <label className="flex items-center gap-1.5">
            <span className="hidden sm:inline">Rows</span>
            <Select value={String(pageSize)} onValueChange={(v) => onPageSizeChange(Number(v))}>
              <SelectTrigger size="sm" aria-label="Rows per page" className="h-7 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {pageSizeOptions.map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        ) : null}
        <span className="tabular-nums">
          Page {formatNumber(page)} of {formatNumber(pageCount)}
        </span>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Previous page"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
          >
            <ChevronLeftIcon />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Next page"
            disabled={page >= pageCount}
            onClick={() => onPageChange(page + 1)}
          >
            <ChevronRightIcon />
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Selection map `{ [rowId]: true }` used by `DataTable` `selection`. */
export type { RowSelectionState } from "@tanstack/react-table";
