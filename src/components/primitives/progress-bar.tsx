import * as React from "react";
import { cn } from "@/lib/utils";
import { toneFill, type Tone } from "./tone";

export type ProgressBarProps = {
  /** Current progress. Clamped to [0, `max`]. */
  value: number;
  /** Value that means 100%. Default 100. */
  max?: number;
  /** Fill color family. Default `info`. */
  tone?: Tone;
  /** Caption above the bar, left. Used as `aria-label` when it is a string. */
  label?: React.ReactNode;
  /** Shows the rounded percentage above the bar, right. Default false. */
  showValue?: boolean;
  /** Bar thickness: `sm` is h-1, `md` is h-2. Default `md`. */
  size?: "sm" | "md";
  className?: string;
};

/**
 * Horizontal determinate progress bar.
 *
 * ```tsx
 * <ProgressBar label="Enriched" value={42} max={120} showValue tone="success" />
 * ```
 */
export function ProgressBar({ value, max = 100, tone = "info", label, showValue = false, size = "md", className }: ProgressBarProps) {
  const safeMax = max > 0 ? max : 100;
  const clamped = Number.isFinite(value) ? Math.min(Math.max(value, 0), safeMax) : 0;
  const pct = (clamped / safeMax) * 100;
  const hasLabel = label !== undefined && label !== null && label !== false;
  return (
    <div data-slot="progress-bar" data-tone={tone} className={cn("flex w-full flex-col gap-1", className)}>
      {hasLabel || showValue ? (
        <div className="flex items-baseline justify-between gap-2 text-xs">
          <span className="min-w-0 truncate text-2xs tracking-wider text-muted-foreground uppercase">{label}</span>
          {showValue ? <span className="shrink-0 font-medium tabular-nums">{Math.round(pct)}%</span> : null}
        </div>
      ) : null}
      <div
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={safeMax}
        aria-label={typeof label === "string" ? label : undefined}
        className={cn("w-full overflow-hidden rounded-full bg-muted", size === "sm" ? "h-1" : "h-1.5")}
      >
        <div
          data-slot="progress-bar-fill"
          className={cn("h-full rounded-full transition-[width] duration-300 ease-out", toneFill[tone])}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
