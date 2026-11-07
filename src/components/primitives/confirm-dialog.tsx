"use client";

import * as React from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export type ConfirmOptions = {
  /** Question, e.g. "Delete 3 businesses?". */
  title: React.ReactNode;
  /** Consequence, e.g. "This cannot be undone." */
  description?: React.ReactNode;
  /** Confirm button text. Default "Confirm". */
  confirmLabel?: string;
  /** Cancel button text. Default "Cancel". */
  cancelLabel?: string;
  /** `danger` styles the confirm button as destructive. Default `default`. */
  tone?: "default" | "danger";
};

export type ConfirmDialogProps = ConfirmOptions & {
  /** Controlled open state. */
  open: boolean;
  /** Called when the dialog opens/closes (Esc and Cancel close it). */
  onOpenChange: (open: boolean) => void;
  /** Called when the user confirms. The dialog closes afterwards. */
  onConfirm: () => void;
};

/** Controlled confirmation dialog (Radix AlertDialog). Prefer `useConfirm` for imperative flows. */
export function ConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "default",
}: ConfirmDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent data-slot="confirm-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description ? <AlertDialogDescription>{description}</AlertDialogDescription> : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel size="sm">{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction size="sm" variant={tone === "danger" ? "destructive" : "default"} onClick={onConfirm}>
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export type UseConfirmResult = {
  /** Opens the dialog and resolves `true` on confirm, `false` on cancel/Esc. */
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  /** Render this once in the component that calls `confirm`. */
  dialog: React.ReactNode;
};

/**
 * Imperative confirmation.
 *
 * ```tsx
 * const { confirm, dialog } = useConfirm();
 * async function onDelete() {
 *   if (!(await confirm({ title: "Delete 3 businesses?", tone: "danger", confirmLabel: "Delete" }))) return;
 *   await deleteAction(ids);
 * }
 * return <>{dialog}<Button onClick={onDelete}>Delete</Button></>;
 * ```
 */
export function useConfirm(): UseConfirmResult {
  const [state, setState] = React.useState<{ options: ConfirmOptions; open: boolean } | null>(null);
  const resolver = React.useRef<((ok: boolean) => void) | null>(null);

  const settle = React.useCallback((ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setState((s) => (s ? { ...s, open: false } : s));
  }, []);

  const confirm = React.useCallback((options: ConfirmOptions) => {
    resolver.current?.(false);
    setState({ options, open: true });
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const dialog = state ? (
    <ConfirmDialog
      {...state.options}
      open={state.open}
      onOpenChange={(open) => {
        if (!open) settle(false);
      }}
      onConfirm={() => settle(true)}
    />
  ) : null;

  return { confirm, dialog };
}
