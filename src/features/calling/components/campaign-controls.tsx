"use client";

import * as React from "react";
import { PauseIcon, PlayIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { CampaignStatus, PauseReason } from "@/db/schema";
import { pauseAction, resumeAction, startAction } from "../actions";
import { useLiveStatus } from "./campaign-live";

export type CampaignControlsProps = {
  campaignId: string;
  status: CampaignStatus;
  pauseReason: PauseReason | null;
};

/** Start (draft) / Pause (running) / Resume (paused or completed) for one campaign. */
export function CampaignControls({ campaignId, status: s0, pauseReason: r0 }: CampaignControlsProps) {
  const live = useLiveStatus();
  const status = live?.status ?? s0;
  const pauseReason = live?.pauseReason ?? r0;
  const [pending, startTransition] = React.useTransition();

  function run(fn: () => Promise<{ ok: boolean; message?: string }>, done: string) {
    startTransition(async () => {
      const r = await fn();
      if (r.ok) toast.success(done);
      else toast.error(r.message ?? "Something went wrong.");
    });
  }

  if (status === "draft") {
    return (
      <Button size="sm" disabled={pending} onClick={() => run(() => startAction(campaignId), "Campaign started")}>
        <PlayIcon aria-hidden /> Start
      </Button>
    );
  }
  if (status === "running" || (status === "paused" && pauseReason !== "manual")) {
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
