"use client";

import * as React from "react";
import Link from "next/link";
import { PlusIcon } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import type { CampaignTarget } from "@/features/leads/types";
import { CAMPAIGN_STATUS_LABELS } from "@/lib/labels";

export type CampaignKind = "call" | "email";

/** Radio value of the "New campaign" option. */
const NEW = "__new__";

/**
 * Pick a non-completed campaign, then add (call) or enroll (email) the
 * selected leads. WP-07 pattern (`AddToCampaignDialog` on /businesses).
 * With `onCreate`, a call campaign can also be created here from just a name,
 * so the user never has to leave (and lose the selection) to make one.
 * Mounted only while open; `onSubmit` resolves true when the dialog may close.
 */
export function AddToCampaignDialog({
  kind,
  count,
  subject,
  campaigns,
  onClose,
  onSubmit,
  onCreate,
}: {
  kind: CampaignKind;
  count: number;
  /** Named instead of "N selected leads" when the dialog is about one business. */
  subject?: string;
  campaigns: CampaignTarget[];
  onClose: () => void;
  onSubmit: (campaignId: string) => Promise<boolean>;
  /** Creates a draft campaign from a name and resolves its id (null on failure). Call campaigns only. */
  onCreate?: (name: string) => Promise<string | null>;
}) {
  const canCreate = kind === "call" && !!onCreate;
  const [chosen, setChosen] = React.useState<string | null>(
    campaigns.length === 1 ? campaigns[0].id : campaigns.length === 0 && canCreate ? NEW : null,
  );
  const [newName, setNewName] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const title = kind === "call" ? "Add to call campaign" : "Add to email sequence";
  const creating = chosen === NEW;
  const ready = creating ? newName.trim().length > 0 : chosen !== null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    // A dossier renders this inside its own dialog: keep the submit from reaching outer forms.
    e.stopPropagation();
    if (!ready || !chosen) return;
    setSaving(true);
    try {
      let id: string | null = chosen;
      if (creating) id = onCreate ? await onCreate(newName.trim()) : null;
      if (id && (await onSubmit(id))) onClose();
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
              {subject ? `${subject}.` : `${count} selected lead${count === 1 ? "" : "s"}.`}{" "}
              {kind === "call"
                ? "Businesses already in the queue, marked do not call, or without a phone are skipped."
                : "Businesses already enrolled, marked do not email, or without an owner email are skipped."}
            </DialogDescription>
          </DialogHeader>
          {campaigns.length === 0 && !canCreate ? (
            <p className="text-sm text-muted-foreground">
              No open {kind === "call" ? "call campaigns" : "email sequences"}.{" "}
              <Link href={kind === "call" ? "/calling/new" : "/email/new"} className="text-primary underline">
                Create one
              </Link>
              .
            </p>
          ) : (
            <div role="radiogroup" aria-label="Campaign" className="flex max-h-72 flex-col gap-1 overflow-y-auto">
              {campaigns.length === 0 && (
                <p className="pb-1 text-sm text-muted-foreground">No open call campaigns yet. Name one to create it here.</p>
              )}
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
              {canCreate && (
                <div
                  role="radio"
                  aria-checked={creating}
                  aria-label="New campaign"
                  tabIndex={creating ? -1 : 0}
                  onClick={() => setChosen(NEW)}
                  onKeyDown={(e) => {
                    if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
                      e.preventDefault();
                      setChosen(NEW);
                    }
                  }}
                  className="flex min-w-0 flex-col gap-2 rounded-md border border-dashed px-3 py-2 text-sm transition-colors duration-300 ease-out hover:bg-accent/50 aria-checked:border-solid aria-checked:border-primary aria-checked:bg-accent"
                >
                  <span className="flex items-center gap-1.5 font-medium">
                    <PlusIcon className="size-3.5" aria-hidden /> New campaign
                  </span>
                  {creating && (
                    <>
                      <Input
                        autoFocus
                        aria-label="New campaign name"
                        placeholder="e.g. Plumbers, March"
                        value={newName}
                        maxLength={120}
                        onChange={(e) => setNewName(e.target.value)}
                        className="h-8 text-sm"
                      />
                      <span className="text-xs text-muted-foreground">
                        Created as a draft dialed by people. Hours, script and AI calling are in its Settings.
                      </span>
                    </>
                  )}
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !ready}>
              {saving ? "Adding…" : creating ? "Create and add" : kind === "call" ? "Add to queue" : "Enroll"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
