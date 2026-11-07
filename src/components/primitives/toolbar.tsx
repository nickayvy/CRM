import * as React from "react";
import { cn } from "@/lib/utils";

export type ToolbarProps = React.ComponentProps<"div"> & {
  /** Accessible name, e.g. "Campaign actions". */
  "aria-label"?: string;
  /** `plain` (default): no chrome. `bar`: bordered strip with a muted background, for above tables/editors. */
  variant?: "plain" | "bar";
};

/**
 * Horizontal row of controls (`role="toolbar"`). Compose with
 * `ToolbarGroup`, `ToolbarSeparator` and `ToolbarSpacer` (pushes the rest right).
 */
export function Toolbar({ variant = "plain", className, ...props }: ToolbarProps) {
  return (
    <div
      role="toolbar"
      data-slot="toolbar"
      data-variant={variant}
      className={cn(
        "flex min-w-0 flex-wrap items-center gap-1.5",
        variant === "bar" && "rounded-lg border bg-muted/40 px-1.5 py-1",
        className,
      )}
      {...props}
    />
  );
}

/** Groups related toolbar controls with tighter spacing. */
export function ToolbarGroup({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="toolbar-group" role="group" className={cn("flex items-center gap-1", className)} {...props} />;
}

/** Thin vertical divider between toolbar groups. */
export function ToolbarSeparator({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="toolbar-separator"
      role="separator"
      aria-orientation="vertical"
      className={cn("mx-0.5 h-4 w-px bg-border", className)}
      {...props}
    />
  );
}

/** Flexible space; everything after it is right-aligned. */
export function ToolbarSpacer({ className, ...props }: React.ComponentProps<"span">) {
  return <span data-slot="toolbar-spacer" aria-hidden className={cn("flex-1", className)} {...props} />;
}
