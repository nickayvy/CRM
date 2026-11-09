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

/** LAR surface panel (PageSection with the primary-dot micro-label) used by every overview panel. */
export function Panel({ className, ...props }: React.ComponentProps<typeof PageSection>) {
  return <PageSection className={`rounded-lg bg-surface p-5 shadow-[var(--shadow-elevated)] ${className ?? ""}`} {...props} />;
}

/**
 * Breakdown tile: a titled surface with one serif numeral per key and a thin
 * share bar on the blue ramp. Used for "Leads by status" and "Businesses by source".
 */
export function BreakdownTile({
  title,
  description,
  items,
  testId,
  href,
}: {
  title: string;
  description?: string;
  items: { key: string; label: string; count: number }[];
  testId: string;
  href?: string;
}) {
  const total = items.reduce((n, i) => n + i.count, 0);
  return (
    <Panel
      title={title}
      description={description}
      data-testid={testId}
      actions={
        href ? (
          <Button asChild size="sm" variant="ghost">
            <Link href={href}>Open</Link>
          </Button>
        ) : undefined
      }
    >
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {items.map((i, idx) => (
          <div key={i.key} data-key={i.key} className="flex min-w-0 flex-col gap-1 rounded-lg bg-surface-elevated px-3 py-3">
            <dt className="truncate text-[10px] tracking-wider text-muted-foreground uppercase">{i.label}</dt>
            <dd className="font-serif text-3xl leading-none tracking-tight tabular-nums" data-slot="tile-value">
              {i.count}
            </dd>
            <div className="h-1 overflow-hidden rounded-full bg-muted" aria-hidden>
              <div
                className="h-full rounded-full transition-all duration-300 ease-out"
                style={{ width: `${total ? Math.round((i.count / total) * 100) : 0}%`, backgroundColor: `var(--chart-${(idx % 5) + 1})` }}
              />
            </div>
          </div>
        ))}
      </dl>
    </Panel>
  );
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
        <AnimatedList as="ul" className="flex flex-col divide-y divide-white/5">
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
        <AnimatedList as="ul" className="flex flex-col divide-y divide-white/5">
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
