"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { StatCard, StatGrid, StatusBadge } from "@/components/primitives";
import type { CampaignStatus, PauseReason } from "@/db/schema";
import { CAMPAIGN_STATUS_LABELS, PAUSE_REASON_LABELS } from "@/lib/labels";
import type { CampaignStatusPayload } from "../types";

type Stats = CampaignStatusPayload["stats"];

export type CampaignLiveProps = {
  campaignId: string;
  initialStatus: CampaignStatus;
  initialPauseReason: PauseReason | null;
  dailyCap: number | null;
  initialStats: Stats;
  /** Poll interval in ms. Default 5000. */
  intervalMs?: number;
};

const LiveContext = React.createContext<{ status: CampaignStatus; pauseReason: PauseReason | null; stats: Stats } | null>(null);

/** Current status and queue counts from the 5-second poll (for controls rendered inside CampaignLive). */
export function useLiveStatus() {
  return React.useContext(LiveContext);
}

/**
 * Polls `GET /api/calling/[id]/status` and renders the stat grid and status
 * badge. When the stats or status change, refreshes the server components so
 * the queue table and callbacks follow.
 */
export function CampaignLive({
  campaignId,
  initialStatus,
  initialPauseReason,
  dailyCap,
  initialStats,
  intervalMs = 5000,
  children,
}: CampaignLiveProps & { children?: React.ReactNode }) {
  const router = useRouter();
  const initial = React.useMemo(
    () => ({ status: initialStatus, pauseReason: initialPauseReason, stats: initialStats }),
    [initialStatus, initialPauseReason, initialStats],
  );
  const initialSig = JSON.stringify(initial);
  // Polled data is tagged with the server render it followed; a newer server render wins.
  const [polled, setPolled] = React.useState<{ base: string; data: typeof initial } | null>(null);
  const data = polled && polled.base === initialSig ? polled.data : initial;
  const shown = React.useRef({ base: initialSig, sig: initialSig });
  React.useEffect(() => {
    shown.current = { base: initialSig, sig: JSON.stringify(data) };
  });

  React.useEffect(() => {
    let stopped = false;
    async function tick() {
      if (document.visibilityState === "hidden") return;
      try {
        const res = await fetch(`/api/calling/${campaignId}/status`, { cache: "no-store" });
        if (!res.ok || stopped) return;
        const body = (await res.json()) as CampaignStatusPayload;
        const next = { status: body.campaign.status, pauseReason: body.campaign.pauseReason, stats: body.stats };
        const sig = JSON.stringify(next);
        if (sig !== shown.current.sig) {
          shown.current = { ...shown.current, sig };
          setPolled({ base: shown.current.base, data: next });
          router.refresh();
        }
      } catch {
        // offline or server restarting: try again next tick
      }
    }
    const id = window.setInterval(tick, intervalMs);
    return () => {
      stopped = true;
      window.clearInterval(id);
    };
  }, [campaignId, intervalMs, router]);

  const s = data.stats;
  return (
    <LiveContext.Provider value={{ status: data.status, pauseReason: data.pauseReason, stats: data.stats }}>
      <div className="flex flex-wrap items-center gap-2" data-testid="campaign-status">
        <StatusBadge label={CAMPAIGN_STATUS_LABELS[data.status]} />
        {data.status === "paused" && data.pauseReason ? <StatusBadge label={PAUSE_REASON_LABELS[data.pauseReason]} /> : null}
        <span className="text-xs text-muted-foreground">Updates every {Math.round(intervalMs / 1000)} s</span>
      </div>
      {children}
      <StatGrid columns={4}>
        <StatCard label="Pending" value={s.pending} format="integer" />
        <StatCard label="In progress" value={s.claimed} format="integer" hint={`${s.activeAgents} active agent${s.activeAgents === 1 ? "" : "s"}`} />
        <StatCard label="Callbacks" value={s.callback} format="integer" />
        <StatCard
          label="Completed today"
          value={s.completedToday}
          format="integer"
          hint={dailyCap ? `of ${dailyCap} daily cap` : "no daily cap"}
        />
        <StatCard label="Completed" value={s.completed} format="integer" />
        <StatCard label="Skipped" value={s.skipped} format="integer" hint="max attempts reached" />
        <StatCard label="Active agents" value={s.activeAgents} format="integer" />
        <StatCard
          label="Total in queue"
          value={s.pending + s.claimed + s.callback + s.completed + s.skipped}
          format="integer"
        />
      </StatGrid>
    </LiveContext.Provider>
  );
}
