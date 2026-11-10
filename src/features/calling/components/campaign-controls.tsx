"use client";

import * as React from "react";
import { PauseIcon, PlayIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { CampaignStatus, PauseReason } from "@/db/schema";
import { PAUSE_REASON_LABELS } from "@/lib/labels";
import { type AutoAiCalls, pauseAction, resumeAction, startAction } from "../actions";
import { useLiveStatus } from "./campaign-live";

export type CampaignControlsProps = {
  campaignId: string;
  status: CampaignStatus;
  pauseReason: PauseReason | null;
  /** Businesses waiting to be called (pending + callbacks) at render; the live poll overrides it. Omit to skip the check. */
  callable?: number;
  /** Off: an automatic pause (hours, cap, callbacks) is never lifted for the user, so Resume must be offered. */
  autoResume?: boolean;
};

type StateResult = { status?: string; pauseReason?: string | null; aiCalls?: AutoAiCalls };

/** Start (draft) / Pause (running) / Resume (paused or completed) for one campaign. */
export function CampaignControls({ campaignId, status: s0, pauseReason: r0, callable: c0, autoResume = true }: CampaignControlsProps) {
  const live = useLiveStatus();
  const status = live?.status ?? s0;
  const pauseReason = live?.pauseReason ?? r0;
  const callable = live ? live.stats.pending + live.stats.callback : c0;
  const [pending, startTransition] = React.useTransition();

  function run(fn: () => Promise<{ ok: boolean; message?: string; data?: unknown }>, done: string) {
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) {
        toast.error(r.message ?? "Something went wrong.");
        return;
      }
      // Start/Resume can land somewhere other than "running" (hours, cap, nothing left): say what happened.
      const after = (r.data ?? undefined) as StateResult | undefined;
      if (after?.status === "paused" && after.pauseReason && after.pauseReason in PAUSE_REASON_LABELS) {
        toast.info(`${done}, but it is paused`, { description: `${PAUSE_REASON_LABELS[after.pauseReason as PauseReason].label}.` });
      } else if (after?.status === "completed") {
        toast.info("Nothing left to call", { description: "Every business in the queue has an outcome. Add more to keep going." });
      } else {
        toast.success(done);
      }
      // Start/Resume on an AI campaign also places the first calls.
      const ai = after?.aiCalls;
      if (ai) (ai.error ? toast.error : ai.placed ? toast.success : toast.info)(ai.message);
    });
  }

  if (status === "draft") {
    const empty = callable !== undefined && callable <= 0;
    return (
      <>
        <Button size="sm" disabled={pending || empty} onClick={() => run(() => startAction(campaignId), "Campaign started")}>
          <PlayIcon aria-hidden /> Start
        </Button>
        {empty ? (
          <span className="text-xs text-muted-foreground" data-testid="start-hint">
            Add businesses to the queue first
          </span>
        ) : null}
      </>
    );
  }
  const autoPaused = status === "paused" && pauseReason !== "manual";
  if (status === "running" || (autoPaused && autoResume)) {
    return (
      <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => pauseAction(campaignId), "Campaign paused")}>
        <PauseIcon aria-hidden /> Pause
      </Button>
    );
  }
  return (
    <Button size="sm" disabled={pending} onClick={() => run(() => resumeAction(campaignId), "Campaign resumed")}>
      <PlayIcon aria-hidden /> Resume
    </Button>
  );
}
