import * as React from "react";
import { cn } from "@/lib/utils";

export type EmptyStateProps = {
  /** Icon shown in a soft rounded well above the title, e.g. `<InboxIcon />`. */
  icon?: React.ReactNode;
  /** Short headline, e.g. "No leads yet". */
  title: React.ReactNode;
  /** Muted explanation under the title; say what to do next. */
  description?: React.ReactNode;
  /** Call-to-action area under the description, typically one or two `Button`s. */
  action?: React.ReactNode;
  /** `default`: roomy, for whole pages and cards. `compact`: less padding, for inside tables and panels. Default `default`. */
  size?: "default" | "compact";
  /** Draws a dashed border around the block. Default false. */
  bordered?: boolean;
  className?: string;
};

/**
 * Centered placeholder for lists, tables and panels with nothing to show.
 *
 * ```tsx
 * <EmptyState icon={<InboxIcon />} title="No leads yet" description="Import a CSV to get started." action={<Button>Import</Button>} />
 * ```
 */
export function EmptyState({ icon, title, description, action, size = "default", bordered = false, className }: EmptyStateProps) {
  const compact = size === "compact";
  return (
    <div
      data-slot="empty-state"
      data-size={size}
      className={cn(
        "flex flex-col items-center justify-center text-center",
        compact ? "gap-2 px-4 py-6" : "gap-3 px-6 py-12",
        bordered && "rounded-lg border border-dashed border-white/10",
        className,
      )}
    >
      {icon ? (
        <span
          aria-hidden
          data-slot="empty-state-icon"
          className={cn(
            "flex shrink-0 items-center justify-center rounded-lg bg-surface-elevated text-primary shadow-[var(--shadow-elevated)]",
            compact ? "size-8 [&_svg]:size-4" : "size-10 [&_svg]:size-5",
          )}
        >
          {icon}
        </span>
      ) : null}
      <div className="flex max-w-sm flex-col gap-1">
        <p className={cn("font-serif tracking-tight text-foreground", compact ? "text-base" : "text-xl")}>{title}</p>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {action ? <div className="mt-1 flex flex-wrap items-center justify-center gap-2">{action}</div> : null}
    </div>
  );
}
