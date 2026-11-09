import * as React from "react";
import { cn } from "@/lib/utils";

export type KbdProps = {
  /** Key label, e.g. "⌘" or "K". */
  children: React.ReactNode;
  className?: string;
};

/** Single keyboard key cap. */
export function Kbd({ children, className }: KbdProps) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-sm border border-white/10 bg-surface-elevated px-1 font-mono text-2xs text-muted-foreground shadow-[var(--shadow-inset)]",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

export type KbdGroupProps = {
  /** Keys in order, one `Kbd` each, e.g. `["⌘", "K"]`. */
  keys: string[];
  className?: string;
};

/** A shortcut as adjacent key caps with a 2px gap. */
export function KbdGroup({ keys, className }: KbdGroupProps) {
  return (
    <span data-slot="kbd-group" className={cn("inline-flex items-center gap-0.5", className)}>
      {keys.map((key, i) => (
        <Kbd key={`${key}-${i}`}>{key}</Kbd>
      ))}
    </span>
  );
}
