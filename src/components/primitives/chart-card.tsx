import * as React from "react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

export type ChartCardProps = {
  /** Chart title, e.g. "Calls per day". */
  title: React.ReactNode;
  /** One line under the title (period, definition). */
  description?: React.ReactNode;
  /** Right side of the header (range picker, legend toggles). */
  actions?: React.ReactNode;
  /** Height of the chart area in px. Default 240. The child (e.g. recharts `ResponsiveContainer`) should fill it. */
  height?: number;
  /** Shows a skeleton instead of the chart. */
  loading?: boolean;
  /** Optional footer (summary numbers, source note). */
  footer?: React.ReactNode;
  /** The chart. */
  children?: React.ReactNode;
  className?: string;
};

/**
 * Thin card wrapper for charts: header, fixed-height plot area, optional
 * footer. Chart colors: use `var(--chart-1)` … `var(--chart-5)` (the
 * LAR blue ramp).
 */
export function ChartCard({ title, description, actions, height = 240, loading, footer, children, className }: ChartCardProps) {
  return (
    <figure data-slot="chart-card" className={cn("flex min-w-0 flex-col gap-4 rounded-lg bg-surface p-5 text-card-foreground shadow-[var(--shadow-elevated)]", className)}>
      <figcaption className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-xs font-medium tracking-wider uppercase">{title}</span>
          {description ? <span className="text-xs text-muted-foreground">{description}</span> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
      </figcaption>
      <div className="min-w-0" style={{ height }}>
        {loading ? <Skeleton className="size-full" /> : children}
      </div>
      {footer ? <div className="border-t border-white/5 pt-3 text-xs text-muted-foreground">{footer}</div> : null}
    </figure>
  );
}
