import Link from "next/link";
import { PhoneIcon, SettingsIcon } from "lucide-react";
import { ProgressBar, StatusBadge } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
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
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle className="min-w-0 truncate">
          <Link href={`/calling/${c.id}`} className="rounded-sm hover:underline">
            {c.name}
          </Link>
        </CardTitle>
        {c.description ? <CardDescription className="line-clamp-2">{c.description}</CardDescription> : null}
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <StatusBadge label={CAMPAIGN_STATUS_LABELS[c.status]} />
          {c.status === "paused" && c.pauseReason ? <StatusBadge label={PAUSE_REASON_LABELS[c.pauseReason]} /> : null}
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4">
        <dl className="grid grid-cols-3 gap-x-3 gap-y-2">
          {counts.map((k) => (
            <div key={k.label} className="flex min-w-0 flex-col">
              <dt className="truncate text-xs text-muted-foreground">{k.label}</dt>
              <dd className="text-sm font-medium tabular-nums">{k.value}</dd>
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
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2">
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
      </CardFooter>
    </Card>
  );
}
