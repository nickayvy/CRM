"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { BotIcon } from "lucide-react";
import { toast } from "sonner";
import { EmptyState, StatusBadge } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import type { AiCallStatus, CallOutcome } from "@/db/schema";
import { formatDate } from "@/lib/format";
import { OUTCOME_LABELS } from "@/lib/labels";
import { placeAiCallsAction } from "../actions";

export type AiCallView = {
  id: string;
  businessName: string;
  toNumber: string;
  status: AiCallStatus;
  outcome: CallOutcome | null;
  summary: string | null;
  error: string | null;
  durationSecs: number | null;
  startedAt: Date;
  transcript: { role: string; message: string }[] | null;
};

/** "Place AI calls" button: fills free AI slots now; later calls follow each webhook. */
export function PlaceAiCallsButton({
  campaignId,
  missingConfig,
  draft,
}: {
  campaignId: string;
  missingConfig: string[];
  /** A draft campaign cannot place calls; Start does that. */
  draft: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const disabled = pending || draft || missingConfig.length > 0;
  return (
    <Button
      size="sm"
      disabled={disabled}
      title={
        missingConfig.length
          ? `Set ${missingConfig.join(", ")} to enable AI calling`
          : draft
            ? "Start the campaign first; Start places the first calls"
            : undefined
      }
      onClick={() =>
        startTransition(async () => {
          const r = await placeAiCallsAction(campaignId);
          if (r.ok) toast.success(r.data.message);
          else toast.error(r.message ?? "Could not place AI calls.");
          router.refresh();
        })
      }
    >
      <BotIcon aria-hidden /> {pending ? "Placing…" : "Place AI calls"}
    </Button>
  );
}

const STATUS_TONE: Record<AiCallStatus, "info" | "success" | "danger"> = {
  initiated: "info",
  completed: "success",
  failed: "danger",
};
const STATUS_LABEL: Record<AiCallStatus, string> = { initiated: "In progress", completed: "Done", failed: "Failed" };

export function AiCallsList({ calls, timezone }: { calls: AiCallView[]; timezone: string }) {
  if (calls.length === 0) {
    return (
      <EmptyState
        size="compact"
        title="No AI calls yet"
        description="Starting the campaign places the first AI calls. Each result lands here and on the queue."
      />
    );
  }
  return (
    <ul className="grid gap-2">
      {calls.map((c) => (
        <li key={c.id} className="grid gap-1.5 rounded-lg bg-surface-elevated p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="min-w-0 truncate font-medium">{c.businessName}</p>
            <div className="flex shrink-0 items-center gap-1.5">
              {c.outcome ? <StatusBadge tone={OUTCOME_LABELS[c.outcome].tone}>{OUTCOME_LABELS[c.outcome].label}</StatusBadge> : null}
              <StatusBadge tone={STATUS_TONE[c.status]}>{STATUS_LABEL[c.status]}</StatusBadge>
            </div>
          </div>
          <p className="text-xs text-muted-foreground tabular-nums">
            {formatDate(c.startedAt, timezone)}
            {c.durationSecs !== null ? ` · ${Math.floor(c.durationSecs / 60)}:${String(c.durationSecs % 60).padStart(2, "0")}` : ""}
          </p>
          {c.summary ? <p className="text-sm text-pretty">{c.summary}</p> : null}
          {c.error ? <p className="text-xs text-destructive">{c.error}</p> : null}
          {c.transcript?.length ? (
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground">Transcript ({c.transcript.length} turns)</summary>
              <ol className="mt-2 grid gap-1">
                {c.transcript.map((t, i) => (
                  <li key={i}>
                    <span className="font-medium">{t.role === "agent" ? "Agent" : "Them"}:</span> {t.message}
                  </li>
                ))}
              </ol>
            </details>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
