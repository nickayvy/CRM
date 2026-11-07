import * as React from "react";
import Link from "next/link";
import { ArrowDownRightIcon, ArrowUpRightIcon, MinusIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { AnimatedNumber, formatNumber, type NumberFormat } from "@/lib/motion";
import { Skeleton } from "@/components/ui/skeleton";
import { toneText, type Tone } from "./tone";

export type StatDelta = {
  /** Change vs the comparison period. Numbers get a sign and are formatted with `format`; strings are shown as is. */
  value: number | string;
  /** Format for a numeric `value`. Default `integer`; use `percent` with a fraction (0.12 → +12%). */
  format?: NumberFormat;
  /** Override the color. Default: positive → success, negative → danger, zero → neutral (inverted when `invert`). */
  tone?: Tone;
  /** Set when a decrease is good (e.g. bounce rate) so the automatic tone flips. */
  invert?: boolean;
  /** Comparison text after the delta, e.g. "vs last week". */
  label?: string;
};

export type StatCardProps = {
  /** Metric name, e.g. "Qualified leads". */
  label: React.ReactNode;
  /** The metric. A number animates via `AnimatedNumber` with `format`; a string/node is rendered as is. */
  value: number | React.ReactNode;
  /** Format for a numeric `value` (preset or `Intl.NumberFormatOptions`; serializable). Default `integer`. */
  format?: NumberFormat;
  /** Change indicator under the value. */
  delta?: StatDelta;
  /** Small icon in the top-right corner, e.g. `<PhoneIcon />`. */
  icon?: React.ReactNode;
  /** Muted one-liner at the bottom, e.g. "Updated 3 min ago". */
  hint?: React.ReactNode;
  /** Makes the whole card a link with hover state. */
  href?: string;
  /** Shows skeletons instead of value/delta. */
  loading?: boolean;
  className?: string;
};

function deltaTone(delta: StatDelta): Tone {
  if (delta.tone) return delta.tone;
  if (typeof delta.value !== "number" || delta.value === 0) return "neutral";
  const up = delta.value > 0;
  return up !== Boolean(delta.invert) ? "success" : "danger";
}

function DeltaLine({ delta }: { delta: StatDelta }) {
  const tone = deltaTone(delta);
  const n = typeof delta.value === "number" ? delta.value : null;
  const Icon = n === null || n === 0 ? MinusIcon : n > 0 ? ArrowUpRightIcon : ArrowDownRightIcon;
  const text =
    n === null ? delta.value : `${n > 0 ? "+" : n < 0 ? "−" : ""}${formatNumber(Math.abs(n), delta.format ?? "integer")}`;
  return (
    <div className="flex items-center gap-1 text-xs">
      <span className={cn("inline-flex items-center gap-0.5 font-medium", toneText[tone])} data-slot="stat-delta" data-tone={tone}>
        {n !== null ? <Icon className="size-3.5" aria-hidden /> : null}
        {text}
      </span>
      {delta.label ? <span className="text-muted-foreground">{delta.label}</span> : null}
    </div>
  );
}

/**
 * One KPI tile: label, big tabular number (animated when numeric), optional
 * delta, icon and hint. Server-component friendly: pass `format` as a preset
 * or options object.
 */
export function StatCard({ label, value, format, delta, icon, hint, href, loading, className }: StatCardProps) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        {icon ? (
          <span aria-hidden className="text-muted-foreground [&_svg]:size-4">
            {icon}
          </span>
        ) : null}
      </div>
      {loading ? (
        <div className="flex flex-col gap-2" data-slot="stat-skeleton" aria-busy="true" aria-label="Loading">
          <Skeleton className="h-7 w-24" />
          <Skeleton className="h-3.5 w-16" />
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          <div className="text-2xl leading-none font-semibold tracking-tight tabular-nums" data-slot="stat-value">
            {typeof value === "number" ? <AnimatedNumber value={value} format={format} /> : value}
          </div>
          {delta ? <DeltaLine delta={delta} /> : null}
        </div>
      )}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </>
  );
  const classes = cn(
    "flex min-w-0 flex-col gap-3 rounded-lg border bg-card p-4 text-card-foreground",
    href && "transition-colors hover:border-foreground/20 hover:bg-accent/40",
    className,
  );
  if (href) {
    return (
      <Link href={href} data-slot="stat-card" className={classes}>
        {body}
      </Link>
    );
  }
  return (
    <div data-slot="stat-card" className={classes}>
      {body}
    </div>
  );
}

export type StatGridProps = React.ComponentProps<"div"> & {
  /** Columns from the `lg` breakpoint up (always 2 below). Default 4. */
  columns?: 2 | 3 | 4 | 5;
};

/** Responsive grid for `StatCard`s. */
export function StatGrid({ columns = 4, className, ...props }: StatGridProps) {
  return (
    <div
      data-slot="stat-grid"
      className={cn(
        "grid grid-cols-2 gap-3",
        columns === 3 && "lg:grid-cols-3",
        columns === 4 && "lg:grid-cols-4",
        columns === 5 && "lg:grid-cols-5",
        className,
      )}
      {...props}
    />
  );
}
