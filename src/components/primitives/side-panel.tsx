"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

export type SidePanelProps = {
  /** Controlled open state. */
  open: boolean;
  /** Called on close (Esc, overlay click, × button) and open. */
  onOpenChange: (open: boolean) => void;
  /** Panel heading (also the dialog's accessible name). */
  title: React.ReactNode;
  /** One line under the title (the dialog's accessible description). */
  description?: React.ReactNode;
  /** Badges/actions on the right of the header row, left of the × button. */
  headerActions?: React.ReactNode;
  /** Sticky footer, usually buttons (`<Button>Save</Button>`). Right-aligned. */
  footer?: React.ReactNode;
  /** Width on ≥ sm screens: `sm` 24rem, `md` 32rem (default), `lg` 44rem. Full width on phones. */
  size?: "sm" | "md" | "lg";
  /** Scrollable body. */
  children?: React.ReactNode;
  className?: string;
};

const SIZES = {
  sm: "sm:max-w-sm",
  md: "sm:max-w-lg",
  lg: "sm:max-w-2xl",
} as const;

/**
 * Right-hand detail/edit panel on top of the page (Radix Dialog via shadcn
 * Sheet): focus trap, Esc to close, scrollable body, sticky footer.
 */
export function SidePanel({
  open,
  onOpenChange,
  title,
  description,
  headerActions,
  footer,
  size = "md",
  children,
  className,
}: SidePanelProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        data-slot="side-panel"
        className={cn("w-full gap-0 border-white/5 bg-surface-elevated p-0 surface-floating data-[side=right]:w-full", SIZES[size], className)}
      >
        <SheetHeader className="flex-row items-start gap-3 border-b border-l-[3px] border-b-white/10 border-l-primary px-5 py-4 pr-12">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <SheetTitle className="truncate font-serif text-xl font-normal tracking-tight">{title}</SheetTitle>
            {description ? (
              <SheetDescription className="text-xs">{description}</SheetDescription>
            ) : (
              <SheetDescription className="sr-only">Details</SheetDescription>
            )}
          </div>
          {headerActions ? <div className="flex shrink-0 items-center gap-1.5">{headerActions}</div> : null}
        </SheetHeader>
        <div className="dossier-scroll min-h-0 flex-1 overflow-y-auto px-5 py-5">{children}</div>
        {footer ? <SheetFooter className="flex-row justify-end gap-2 border-t border-white/10 bg-surface px-5 py-3">{footer}</SheetFooter> : null}
      </SheetContent>
    </Sheet>
  );
}
