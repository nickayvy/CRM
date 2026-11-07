import * as React from "react";
import { cn } from "@/lib/utils";
import type { Label } from "@/lib/labels";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { toneFill, toneSoft, type Tone } from "./tone";

export type StatusBadgeProps = Omit<React.ComponentProps<"span">, "children"> & {
  /** Color family. Usually from a `src/lib/labels.ts` map: `STATUS_LABELS[s].tone`. Default `neutral`. */
  tone?: Tone;
  /** Badge text. Alternatively pass `label`. */
  children?: React.ReactNode;
  /** A `{ label, tone }` entry from `src/lib/labels.ts`; sets both text and tone. */
  label?: Label;
  /**
   * `soft` (default): tinted pill. `dot`: colored dot + plain text, for dense
   * tables where many pills would be noisy.
   */
  variant?: "soft" | "dot";
};

/**
 * Status pill colored by tone.
 *
 * ```tsx
 * <StatusBadge label={STATUS_LABELS[business.status]} />
 * <StatusBadge tone="warning" variant="dot">Callback</StatusBadge>
 * ```
 */
export function StatusBadge({ tone, label, children, variant = "soft", className, ...props }: StatusBadgeProps) {
  const t: Tone = tone ?? label?.tone ?? "neutral";
  const text = children ?? label?.label;
  if (variant === "dot") {
    return (
      <span
        data-slot="status-badge"
        data-tone={t}
        data-variant="dot"
        className={cn("inline-flex items-center gap-1.5 text-dense whitespace-nowrap text-foreground", className)}
        {...props}
      >
        <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", toneFill[t])} />
        {text}
      </span>
    );
  }
  return (
    <span
      data-slot="status-badge"
      data-tone={t}
      data-variant="soft"
      className={cn(
        "inline-flex h-5 items-center gap-1 rounded-sm px-1.5 text-xs font-medium whitespace-nowrap",
        toneSoft[t],
        className,
      )}
      {...props}
    >
      {text}
    </span>
  );
}

export type ReasonChipProps = Omit<React.ComponentProps<"span">, "children"> & {
  /** Machine code, shown in the chip, e.g. `low_rating`. */
  code: string;
  /** Human explanation shown in the tooltip, e.g. "Rating below 3.5". Also the accessible name. */
  label: string;
  /** Default `danger` for hard rejections; use `warning` for soft flags (`unclaimed`, `low_score`). */
  tone?: Tone;
};

/**
 * Compact chip for a qualification reason code with a tooltip explaining it.
 * Focusable so keyboard users can reveal the tooltip.
 */
export function ReasonChip({ code, label, tone = "danger", className, ...props }: ReasonChipProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          data-slot="reason-chip"
          data-tone={tone}
          aria-label={label}
          className={cn(
            "inline-flex h-5 cursor-default items-center rounded-sm border border-current/20 px-1.5 font-mono text-2xs whitespace-nowrap",
            toneSoft[tone],
            className,
          )}
          {...props}
        >
          {code}
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
