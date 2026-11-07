import Link from "next/link";
import { MailIcon, PhoneCallIcon, PhoneIcon } from "lucide-react";
import {
  EmptyState,
  PageSection,
  ProgressBar,
  StatusBadge,
  Timeline,
  TimelineItem,
} from "@/components/primitives";
import { Button } from "@/components/ui/button";
import type { CampaignStats } from "@/db/repo/call-campaigns";
import type { EmailCampaignDetailStats } from "@/db/repo/email-campaigns";
import type { Activity, Business, CallCampaign, CallOutcome, CallQueueItem, EmailCampaign } from "@/db/schema";
import { AnimatedItem, AnimatedList, FadeIn } from "@/lib/motion";
import { formatDate, formatPhone } from "@/lib/format";
import { CAMPAIGN_STATUS_LABELS, OUTCOME_LABELS } from "@/lib/labels";

/** Card-styled PageSection used by every dashboard panel. */
export function Panel({ className, ...props }: React.ComponentProps<typeof PageSection>) {
  return <PageSection className={`rounded-lg border bg-card p-4 text-card-foreground ${className ?? ""}`} {...props} />;
}

type RunningCall = CallCampaign & CampaignStats;
type RunningEmail = EmailCampaign & EmailCampaignDetailStats;

export function RunningCampaignsPanel({ calls, emails }: { calls: RunningCall[]; emails: RunningEmail[] }) {
  return (
    <Panel title="Running campaigns" description="Queue progress and today's work" data-testid="running-campaigns">
      {calls.length + emails.length === 0 ? (
        <EmptyState
          size="compact"
          icon={<PhoneIcon />}
          title="Nothing running"
          description="Start a call or email campaign to see it here."
        />
      ) : (
        <AnimatedList as="ul" className="flex flex-col divide-y">
          {calls.map((c) => {
            const total = c.pending + c.claimed + c.completed + c.skipped + c.callback;
            const done = c.completed + c.skipped;
            return (
              <AnimatedItem as="li" key={c.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0" data-testid="running-call-campaign">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <PhoneIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <Link href={`/calling/${c.id}`} className="min-w-0 truncate text-sm font-medium hover:underline">
                      {c.name}
                    </Link>
                    <StatusBadge label={CAMPAIGN_STATUS_LABELS[c.status]} />
                  </div>
                  <Button asChild size="sm" variant="outline">
                    <Link href={`/calling/${c.id}/dial`}>
                      <PhoneCallIcon /> Open dialer
                    </Link>
                  </Button>
                </div>
                <ProgressBar
                  value={done}
                  max={Math.max(total, 1)}
                  size="sm"
                  label={`Queue: ${done} of ${total} done`}
                  showValue
                />
                <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>
                    Completed today{" "}
                    <span className="font-medium text-foreground tabular-nums">
                      {c.completedToday}
                      {c.dailyCap ? ` / ${c.dailyCap}` : ""}
                    </span>
                  </span>
                  <span>
                    Active agents <span className="font-medium text-foreground tabular-nums">{c.activeAgents}</span>
                  </span>
                  <span>
                    Callbacks <span className="font-medium text-foreground tabular-nums">{c.callback}</span>
                  </span>
                </p>
              </AnimatedItem>
            );
          })}
          {emails.map((e) => (
            <AnimatedItem as="li" key={e.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0" data-testid="running-email-campaign">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <MailIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <Link href={`/email/${e.id}`} className="min-w-0 truncate text-sm font-medium hover:underline">
                    {e.name}
                  </Link>
                  <StatusBadge label={CAMPAIGN_STATUS_LABELS[e.status]} />
                </div>
                <Button asChild size="sm" variant="outline">
                  <Link href={`/email/${e.id}`}>Open</Link>
                </Button>
              </div>
              <ProgressBar
                value={e.sentToday}
                max={Math.max(e.dailyCap, 1)}
                size="sm"
                label={`Sent today: ${e.sentToday} / ${e.dailyCap}`}
              />
              <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span>
                  Active <span className="font-medium text-foreground tabular-nums">{e.active}</span>
                </span>
                <span>
                  Replied <span className="font-medium text-foreground tabular-nums">{e.replied}</span>
                </span>
              </p>
            </AnimatedItem>
          ))}
        </AnimatedList>
      )}
    </Panel>
  );
}

type DueCallback = CallQueueItem & { business: Business; campaignName: string };

export function DueCallbacksPanel({ items, now, tz }: { items: DueCallback[]; now: Date; tz: string }) {
  return (
    <Panel
      title="Due callbacks"
      description="Overdue and due later today"
      actions={
        <Button asChild size="sm" variant="ghost">
          <Link href="/calling">All campaigns</Link>
        </Button>
      }
      data-testid="due-callbacks"
    >
      {items.length === 0 ? (
        <EmptyState size="compact" icon={<PhoneCallIcon />} title="No callbacks due" description="Scheduled callbacks show up here on their day." />
      ) : (
        <AnimatedList as="ul" className="flex flex-col divide-y">
          {items.map((i) => {
            const overdue = i.callbackAt !== null && i.callbackAt < now;
            return (
              <AnimatedItem as="li" key={i.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2 first:pt-0 last:pb-0">
                <div className="flex min-w-0 flex-col">
                  <Link href={`/businesses/${i.business.id}`} className="truncate text-sm font-medium hover:underline">
                    {i.business.name}
                  </Link>
                  <span className="truncate text-xs text-muted-foreground">
                    <Link href={`/calling/${i.campaignId}`} className="hover:underline">
                      {i.campaignName}
                    </Link>
                    {i.business.phone ? <> · {formatPhone(i.business.phone)}</> : null}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="tabular-nums text-muted-foreground" suppressHydrationWarning>
                    {i.callbackAt ? formatDate(i.callbackAt, tz) : ""}
                  </span>
                  {overdue ? <StatusBadge tone="danger">Overdue</StatusBadge> : <StatusBadge tone="info">Today</StatusBadge>}
                </div>
              </AnimatedItem>
            );
          })}
        </AnimatedList>
      )}
    </Panel>
  );
}

const ACTIVITY_TITLES: Record<Activity["type"], string> = {
  note: "Note",
  call: "Call",
  email: "Email",
  status_change: "Status change",
  system: "System",
};

function activityTitle(a: Activity & { businessName: string }) {
  const outcome = a.type === "call" && a.outcome ? OUTCOME_LABELS[a.outcome as CallOutcome]?.label : null;
  return (
    <>
      <Link href={`/businesses/${a.businessId}`} className="hover:underline">
        {a.businessName}
      </Link>
      <span className="font-normal text-muted-foreground">
        {" "}
        · {ACTIVITY_TITLES[a.type]}
        {outcome ? `: ${outcome}` : ""}
      </span>
    </>
  );
}

export function RecentActivityPanel({ items }: { items: (Activity & { businessName: string })[] }) {
  return (
    <Panel title="Recent activity" description="Latest 10 across all businesses" data-testid="recent-activity">
      {items.length === 0 ? (
        <EmptyState size="compact" title="No activity yet" description="Calls, emails and notes show up here." />
      ) : (
        <FadeIn>
          <Timeline>
            {items.map((a) => (
              <TimelineItem key={a.id} type={a.type} time={a.occurredAt} agent={a.agent} title={activityTitle(a)}>
                {a.body ? <span className="line-clamp-2">{a.body}</span> : null}
              </TimelineItem>
            ))}
          </Timeline>
        </FadeIn>
      )}
    </Panel>
  );
}
