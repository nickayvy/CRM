"use client";

import * as React from "react";
import Link from "next/link";
import { StatusBadge as ToneBadge } from "@/components/primitives/status-badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { CampaignTarget } from "@/features/leads/types";
import { CAMPAIGN_STATUS_LABELS } from "@/lib/labels";

export type CampaignKind = "call" | "email";

/**
 * Pick a non-completed campaign, then add (call) or enroll (email) the
 * selected leads. WP-07 pattern (`AddToCampaignDialog` on /businesses).
 * Mounted only while open; `onSubmit` resolves true when the dialog may close.
 */
export function AddToCampaignDialog({
  kind,
  count,
  campaigns,
  onClose,
  onSubmit,
}: {
  kind: CampaignKind;
  count: number;
  campaigns: CampaignTarget[];
  onClose: () => void;
  onSubmit: (campaignId: string) => Promise<boolean>;
}) {
  const [chosen, setChosen] = React.useState<string | null>(campaigns.length === 1 ? campaigns[0].id : null);
  const [saving, setSaving] = React.useState(false);
  const title = kind === "call" ? "Add to call campaign" : "Add to email sequence";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!chosen) return;
    setSaving(true);
    try {
      if (await onSubmit(chosen)) onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="flex min-w-0 flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              {count} selected lead{count === 1 ? "" : "s"}.{" "}
              {kind === "call"
                ? "Businesses already in the queue, marked do not call, or without a phone are skipped."
                : "Businesses already enrolled, marked do not email, or without an owner email are skipped."}
            </DialogDescription>
          </DialogHeader>
          {campaigns.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No open {kind === "call" ? "call campaigns" : "email sequences"}.{" "}
              <Link href={kind === "call" ? "/calling/new" : "/email/new"} className="text-primary underline">
                Create one
              </Link>
              .
            </p>
          ) : (
            <div role="radiogroup" aria-label="Campaign" className="flex max-h-72 flex-col gap-1 overflow-y-auto">
              {campaigns.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  role="radio"
                  aria-checked={chosen === c.id}
                  onClick={() => setChosen(c.id)}
                  className="flex min-w-0 items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors duration-300 ease-out hover:bg-accent/50 aria-checked:border-primary aria-checked:bg-accent"
                >
                  <span className="min-w-0 truncate font-medium">{c.name}</span>
                  <ToneBadge label={CAMPAIGN_STATUS_LABELS[c.status]} />
                </button>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !chosen}>
              {kind === "call" ? "Add to queue" : "Enroll"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
