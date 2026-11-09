import Link from "next/link";
import { PhoneIcon, SettingsIcon } from "lucide-react";
import { ProgressBar, StatusBadge } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import type { CampaignStats } from "@/db/repo/call-campaigns";
import type { CallCampaign } from "@/db/schema";
import { CAMPAIGN_STATUS_LABELS, PAUSE_REASON_LABELS } from "@/lib/labels";

export type CampaignCardProps = {
  campaign: CallCampaign & CampaignStats;
};

/** One call campaign in the /calling list: status, queue counts, daily progress and shortcuts. */
export function CampaignCard({ campaign: c }: CampaignCardProps) {
  const counts: { label: string; value: number }[] = [
    { label: "Pending", value: c.pending },
    { label: "In progress", value: c.claimed },
    { label: "Callbacks", value: c.callback },
    { label: "Completed", value: c.completed },
    { label: "Skipped", value: c.skipped },
  ];

  return (
    <article className="card-glow flex min-w-0 flex-col gap-4 rounded-lg bg-surface p-4 shadow-[var(--shadow-elevated)] transition-all duration-300 ease-out">
      <header className="flex flex-col gap-1.5">
        <h3 className="min-w-0 truncate font-serif text-xl tracking-tight">
          <Link href={`/calling/${c.id}`} className="rounded-sm transition-colors duration-300 ease-out hover:text-primary">
            {c.name}
          </Link>
        </h3>
        {c.description ? <p className="line-clamp-2 text-sm text-muted-foreground">{c.description}</p> : null}
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <StatusBadge label={CAMPAIGN_STATUS_LABELS[c.status]} />
          {c.status === "paused" && c.pauseReason ? <StatusBadge label={PAUSE_REASON_LABELS[c.pauseReason]} /> : null}
        </div>
      </header>
      <div className="flex flex-1 flex-col gap-4">
        <dl className="grid grid-cols-3 gap-x-3 gap-y-3">
          {counts.map((k) => (
            <div key={k.label} className="flex min-w-0 flex-col gap-0.5">
              <dt className="truncate text-[10px] tracking-wider text-muted-foreground uppercase">{k.label}</dt>
              <dd className="font-serif text-2xl tracking-tight tabular-nums">{k.value}</dd>
            </div>
          ))}
        </dl>
        {c.dailyCap !== null && c.dailyCap !== undefined ? (
          <ProgressBar
            value={c.completedToday}
            max={c.dailyCap}
            size="sm"
            tone={c.completedToday >= c.dailyCap ? "warning" : "info"}
            label={`Completed today: ${c.completedToday} / ${c.dailyCap}`}
          />
        ) : (
          <p className="text-xs text-muted-foreground">
            Completed today: <span className="font-medium text-foreground tabular-nums">{c.completedToday}</span> (no cap)
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          Active agents: <span className="font-medium text-foreground tabular-nums">{c.activeAgents}</span>
        </p>
      </div>
      <footer className="flex flex-wrap gap-2">
        <Button asChild size="sm">
          <Link href={`/calling/${c.id}/dial`}>
            <PhoneIcon aria-hidden />
            Open dialer
          </Link>
        </Button>
        <Button asChild size="sm" variant="outline">
          <Link href={`/calling/${c.id}`}>
            <SettingsIcon aria-hidden />
            Manage
          </Link>
        </Button>
      </footer>
    </article>
  );
}
