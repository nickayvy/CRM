import * as React from "react";
import { cn } from "@/lib/utils";

export type KeyValueListProps = {
  /** Number of columns: 1, or 2 from the `sm` breakpoint up (1 below). Default 1. */
  columns?: 1 | 2;
  className?: string;
  /** `KeyValue` rows. */
  children: React.ReactNode;
};

/**
 * Description list of label/value rows, separated by spacing rather than borders.
 *
 * ```tsx
 * <KeyValueList columns={2}>
 *   <KeyValue label="Phone" mono>{phone}</KeyValue>
 *   <KeyValue label="Website">{website}</KeyValue>
 * </KeyValueList>
 * ```
 */
export function KeyValueList({ columns = 1, className, children }: KeyValueListProps) {
  return (
    <dl
      data-slot="key-value-list"
      className={cn("grid grid-cols-1 gap-x-8 gap-y-3", columns === 2 && "sm:grid-cols-2", className)}
    >
      {children}
    </dl>
  );
}

export type KeyValueProps = {
  /** Field name, shown in a fixed-width muted column. */
  label: React.ReactNode;
  /** The value. `null`, `undefined` and `""` render a muted "—". */
  children?: React.ReactNode;
  /** Muted one-liner under the value, e.g. "Verified 3 d ago". */
  hint?: React.ReactNode;
  /** Monospace value, for ids and phone numbers. Default false. */
  mono?: boolean;
  className?: string;
};

/** One label/value row inside a `KeyValueList`. */
export function KeyValue({ label, children, hint, mono = false, className }: KeyValueProps) {
  const empty = children === null || children === undefined || children === "";
  return (
    <div data-slot="key-value" className={cn("flex min-w-0 items-baseline gap-3", className)}>
      <dt className="w-28 shrink-0 text-2xs tracking-wider text-muted-foreground uppercase">{label}</dt>
      <dd className="m-0 min-w-0 flex-1 text-sm">
        {empty ? (
          <span className="text-muted-foreground" aria-label="No value">
            —
          </span>
        ) : (
          <span className={cn("break-words", mono && "font-mono")}>{children}</span>
        )}
        {hint ? <span className="mt-0.5 block text-xs text-muted-foreground">{hint}</span> : null}
      </dd>
    </div>
  );
}
