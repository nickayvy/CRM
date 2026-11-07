/**
 * Shared UI primitives. Feature pages compose tables, cards, headers,
 * badges, empty states and panels only from these.
 *
 * Client components (hooks/handlers inside): DataTable, BulkActionBar,
 * FilterBar/FilterSelect/FilterRange, SidePanel, ConfirmDialog/useConfirm.
 * Everything else is server-renderable.
 */
export { PageShell, PageHeader, PageSection } from "./page-shell";
export type { PageShellProps, PageHeaderProps, PageSectionProps, Breadcrumb } from "./page-shell";

export { StatCard, StatGrid } from "./stat-card";
export type { StatCardProps, StatGridProps, StatDelta } from "./stat-card";

export { DataTable, BulkActionBar, dataTableColumnHelper, dataTableFeatures } from "./data-table";
export type {
  DataTableProps,
  DataTableColumn,
  DataTableColumnMeta,
  DataTableFeatures,
  DataTablePagination,
  BulkActionBarProps,
  BulkActionContext,
  SortState,
  RowSelectionState,
} from "./data-table";

export { FilterBar, FilterSelect, FilterRange } from "./filter-bar";
export type {
  FilterBarProps,
  FilterBarSearch,
  ActiveFilter,
  FilterSelectProps,
  FilterOption,
  FilterRangeProps,
  RangeValue,
} from "./filter-bar";

export { StatusBadge, ReasonChip } from "./status-badge";
export type { StatusBadgeProps, ReasonChipProps } from "./status-badge";

export { EmptyState } from "./empty-state";
export type { EmptyStateProps } from "./empty-state";

export { SidePanel } from "./side-panel";
export type { SidePanelProps } from "./side-panel";

export { KeyValueList, KeyValue } from "./key-value-list";
export type { KeyValueListProps, KeyValueProps } from "./key-value-list";

export { Timeline, TimelineItem } from "./timeline";
export type { TimelineProps, TimelineItemProps } from "./timeline";

export { Toolbar, ToolbarGroup, ToolbarSeparator, ToolbarSpacer } from "./toolbar";
export type { ToolbarProps } from "./toolbar";

export { Kbd, KbdGroup } from "./kbd";
export type { KbdProps, KbdGroupProps } from "./kbd";

export { ScoreRing } from "./score-ring";
export type { ScoreRingProps } from "./score-ring";

export { ProgressBar } from "./progress-bar";
export type { ProgressBarProps } from "./progress-bar";

export { ConfirmDialog, useConfirm } from "./confirm-dialog";
export type { ConfirmDialogProps, ConfirmOptions, UseConfirmResult } from "./confirm-dialog";

export { ChartCard } from "./chart-card";
export type { ChartCardProps } from "./chart-card";

export { toneText, toneSoft, toneFill, toneStroke } from "./tone";
export type { Tone } from "./tone";
