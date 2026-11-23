import Link from "next/link";
import { formatInTimeZone } from "date-fns-tz";
import {
  BotIcon,
  CheckIcon,
  FilePenLineIcon,
  ListChecksIcon,
  MailIcon,
  MegaphoneIcon,
  PauseIcon,
  PhoneCallIcon,
  PhoneIcon,
  SearchIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";
import { EmptyState, PageSection, ProgressBar, StatusBadge, Timeline, TimelineItem } from "@/components/primitives";
import { toneFill, toneSoft } from "@/components/primitives/tone";
import { Button } from "@/components/ui/button";
import type { CampaignStats } from "@/db/repo/call-campaigns";
import type { EmailCampaignDetailStats } from "@/db/repo/email-campaigns";
import type { Activity, Business, CallCampaign, CallOutcome, CallQueueItem, EmailCampaign } from "@/db/schema";
import { formatPhone, formatRelative } from "@/lib/format";
import { OUTCOME_LABELS, type Tone } from "@/lib/labels";
import { AnimatedItem, AnimatedList, FadeIn } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { AttentionIcon, AttentionItem } from "../attention";
import type { CategoryDatum, PipelineStage } from "../chart-data";

const nf = new Intl.NumberFormat("en-US");
const pct = (share: number) => `${Math.round(share * 100)}%`;

/** LAR surface panel (PageSection with the primary-dot micro-label) used by every overview panel. */
export function Panel({ className, ...props }: React.ComponentProps<typeof PageSection>) {
  return <PageSection className={cn("rounded-lg bg-surface p-5 shadow-[var(--shadow-elevated)]", className)} {...props} />;
}

// ---------------------------------------------------------------- up next

const ATTENTION_ICONS: Record<AttentionIcon, LucideIcon> = {
  dial: PhoneCallIcon,
  paused: PauseIcon,
  leads: UsersIcon,
  review: ListChecksIcon,
  draft: FilePenLineIcon,
  search: SearchIcon,
  campaign: MegaphoneIcon,
};

/**
 * The to-do list at the top of the overview: one row per thing that needs
 * the user, each with a single button that goes straight to where it is
 * handled. Only the first row gets the filled button, so there is one
 * obvious place to start.
 */
export function UpNextPanel({ items, className }: { items: AttentionItem[]; className?: string }) {
  return (
    <Panel title="Up next" description="What needs you, most urgent first" className={className} data-testid="up-next">
      {items.length === 0 ? (
        <EmptyState
          size="compact"
          icon={<CheckIcon />}
          title="You are all caught up"
          description="Nothing is waiting on you. Find more businesses to keep the pipeline full."
          action={
            <Button asChild size="sm" variant="outline">
              <Link href="/lookup">Open Lookup</Link>
            </Button>
          }
        />
      ) : (
        <AnimatedList as="ul" className="flex flex-col divide-y divide-white/5">
          {items.map((item, i) => {
            const Icon = ATTENTION_ICONS[item.icon];
            return (
              <AnimatedItem
                as="li"
                key={item.key}
                data-attention={item.key}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3 first:pt-0 last:pb-0"
              >
                <span aria-hidden className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", toneSoft[item.tone])}>
                  <Icon className="size-4" />
                </span>
                <div className="flex min-w-0 flex-1 basis-48 flex-col">
                  <span className="text-sm font-medium text-pretty">{item.title}</span>
                  <span className="text-xs text-pretty text-muted-foreground">{item.detail}</span>
                </div>
                <Button asChild size="sm" variant={i === 0 ? "default" : "outline"} className="ml-11 sm:ml-0">
                  <Link href={item.href}>{item.cta}</Link>
                </Button>
              </AnimatedItem>
            );
          })}
        </AnimatedList>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------- first run

const FIRST_STEPS = [
  {
    title: "Find businesses",
    body: "Search Google Maps by niche and area, or paste a Trustpilot link. Your rules sort what comes back into qualified, review and rejected.",
    href: "/lookup",
    cta: "Open Lookup",
  },
  {
    title: "Build your lead list",
    body: "Open a business to see its reviews, contacts and links, then add the good ones to your leads.",
    href: "/leads",
    cta: "Open leads",
  },
  {
    title: "Call and email them",
    body: "Put leads in a call queue (you dial, or the AI agent does) or an email sequence. Results land back here.",
    href: "/calling/new",
    cta: "New call campaign",
  },
] as const;

/**
 * Shown instead of the empty panels while the workspace has no businesses,
 * leads or campaigns: the three steps of the product, with the first one as
 * the only filled button.
 */
export function GettingStartedPanel() {
  return (
    <Panel title="Getting started" description="Three steps from an empty workspace to your first conversation" data-testid="getting-started">
      <ol className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {FIRST_STEPS.map((step, i) => (
          <li key={step.title} className="flex min-w-0 flex-col gap-3 rounded-lg bg-surface-elevated p-4">
            <span
              aria-hidden
              className={cn(
                "flex size-7 items-center justify-center rounded-full text-xs font-medium tabular-nums",
                i === 0 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
              )}
            >
              {i + 1}
            </span>
            <div className="flex flex-1 flex-col gap-1">
              <h3 className="font-serif text-lg leading-tight tracking-tight">{step.title}</h3>
              <p className="text-sm text-pretty text-muted-foreground">{step.body}</p>
            </div>
            <Button asChild size="sm" variant={i === 0 ? "default" : "outline"} className="self-start">
              <Link href={step.href}>{step.cta}</Link>
            </Button>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

// ---------------------------------------------------------------- callbacks

type DueCallback = CallQueueItem & { business: Business; campaignName: string };

/**
 * Callbacks that are overdue or fall later today, overdue first. Times read
 * the way they are acted on: "3 h ago" for a missed one, the clock time for
 * one still to come.
 */
export function DueCallbacksPanel({
  items,
  overdueTotal,
  now,
  tz,
  className,
}: {
  items: DueCallback[];
  /** Every overdue callback, which can be more than the rows shown. */
  overdueTotal: number;
  now: Date;
  tz: string;
  className?: string;
}) {
  return (
    <Panel
      className={className}
      title="Callbacks"
      description="Overdue and due later today"
      actions={
        overdueTotal > 0 ? (
          <StatusBadge tone="danger" data-testid="overdue-count">
            {nf.format(overdueTotal)} overdue
          </StatusBadge>
        ) : undefined
      }
      data-testid="due-callbacks"
    >
      {items.length === 0 ? (
        <EmptyState
          size="compact"
          icon={<PhoneCallIcon />}
          title="No callbacks due"
          description="Callbacks you schedule in the dialer show up here on their day."
        />
      ) : (
        <AnimatedList as="ul" className="flex flex-col divide-y divide-white/5">
          {items.map((i) => {
            const overdue = i.callbackAt !== null && i.callbackAt < now;
            return (
              <AnimatedItem as="li" key={i.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                <div className="flex min-w-0 flex-col">
                  <Link href={`/businesses/${i.business.id}`} className="truncate text-sm font-medium hover:underline">
                    {i.business.name}
                  </Link>
                  <span className="truncate text-xs text-muted-foreground">
                    {i.business.phone ? (
                      <>
                        <a href={`tel:${i.business.phone}`} className="tabular-nums hover:text-foreground hover:underline">
                          {formatPhone(i.business.phone)}
                        </a>
                        {" · "}
                      </>
                    ) : null}
                    {i.campaignName}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className={cn("text-xs tabular-nums", overdue ? "text-tone-danger" : "text-muted-foreground")}>
                    {i.callbackAt ? (overdue ? formatRelative(i.callbackAt, now) : formatInTimeZone(i.callbackAt, tz, "h:mm a")) : ""}
                  </span>
                  <Button asChild size="icon-sm" variant="outline">
                    <Link href={`/calling/${i.campaignId}/dial`} aria-label={`Open the dialer for ${i.campaignName}`} title="Open dialer">
                      <PhoneIcon />
                    </Link>
                  </Button>
                </div>
              </AnimatedItem>
            );
          })}
        </AnimatedList>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------- pipeline

/**
 * Five counts from discovered business to won lead. Every stage after the
 * first shows its share of the stage before it (number and bar), so the
 * drop-off between steps is readable whatever the absolute sizes are.
 */
export function PipelinePanel({ stages }: { stages: PipelineStage[] }) {
  return (
    <Panel title="Pipeline" description="From a discovered business to a won lead" data-testid="pipeline">
      <ol className="grid grid-cols-1 gap-1 sm:grid-cols-5 sm:gap-0">
        {stages.map((s, i) => {
          const prev = i > 0 ? stages[i - 1] : null;
          const caption = s.shareOfPrevious !== null && prev ? `${pct(s.shareOfPrevious)} of ${prev.label.toLowerCase()}` : s.hint;
          return (
            <li key={s.key} data-stage={s.key} className="min-w-0 sm:border-l sm:border-white/5 sm:first:border-l-0">
              <Link
                href={s.href}
                className="group grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 rounded-lg px-3 py-2 transition-colors duration-300 ease-out hover:bg-muted/50 sm:flex sm:flex-col sm:items-stretch sm:gap-2 sm:py-3"
              >
                <span className="text-2xs tracking-wider text-muted-foreground uppercase">{s.label}</span>
                <span
                  className="row-span-2 font-serif text-3xl leading-none tracking-tight tabular-nums sm:text-4xl"
                  data-slot="stage-value"
                >
                  {nf.format(s.count)}
                </span>
                <span className="flex min-w-0 flex-col gap-1.5">
                  <span className="hidden h-1 overflow-hidden rounded-full bg-muted sm:block" aria-hidden>
                    <span
                      className="block h-full rounded-full bg-primary"
                      style={{ width: i === 0 ? (s.count > 0 ? "100%" : "0%") : pct(s.shareOfPrevious ?? 0) }}
                    />
                  </span>
                  <span className="truncate text-xs text-muted-foreground">{caption}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}

// ---------------------------------------------------------------- bar lists

/**
 * Ranked horizontal bars as plain HTML: label, bar, value. One colour for
 * every bar (length already carries the number), value printed at the end so
 * nothing has to be read off an axis.
 */
export function BarList({ rows, empty, testId }: { rows: CategoryDatum[]; empty: string; testId?: string }) {
  const max = Math.max(...rows.map((r) => r.count), 0);
  if (max === 0) return <p className="text-xs text-muted-foreground">{empty}</p>;
  return (
    <dl className="grid grid-cols-[minmax(0,auto)_minmax(3rem,1fr)_auto] items-center gap-x-3 gap-y-2" data-testid={testId}>
      {rows.map((r) => (
        <div key={r.key} data-key={r.key} className="contents">
          <dt className="truncate text-xs text-muted-foreground">{r.label}</dt>
          <div className="h-2" aria-hidden>
            <div
              className="h-full rounded-r-[4px] bg-primary"
              style={{ width: r.count > 0 ? `max(2px, ${(r.count / max) * 100}%)` : 0 }}
            />
          </div>
          <dd className="text-right text-sm font-medium tabular-nums" data-slot="bar-value">
            {nf.format(r.count)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function LeadsByStatusPanel({ rows, total }: { rows: CategoryDatum[]; total: number }) {
  return (
    <Panel
      title="Leads by status"
      description={`${nf.format(total)} ${total === 1 ? "lead" : "leads"} across every user`}
      actions={
        <Button asChild size="sm" variant="ghost">
          <Link href="/leads">Open leads</Link>
        </Button>
      }
      data-testid="tile-leads-by-status"
    >
      <BarList rows={rows} empty="No leads yet. Add businesses to your leads from Lookup." />
    </Panel>
  );
}

const QUALIFICATION_TONES: { key: "qualified" | "review" | "rejected"; label: string; tone: Tone }[] = [
  { key: "qualified", label: "Qualified", tone: "success" },
  { key: "review", label: "Review", tone: "warning" },
  { key: "rejected", label: "Rejected", tone: "danger" },
];

/**
 * Where businesses come from and what the rules made of them: the
 * qualified / review / rejected split as one segmented bar, then sources and
 * the most common rejection reasons as ranked bars.
 */
export function DiscoveryPanel({
  qualification,
  sources,
  rejections,
}: {
  qualification: Record<"qualified" | "review" | "rejected", number>;
  sources: CategoryDatum[];
  rejections: CategoryDatum[];
}) {
  const total = qualification.qualified + qualification.review + qualification.rejected;
  return (
    <Panel
      title="Discovery"
      description={`${nf.format(total)} ${total === 1 ? "business" : "businesses"} found`}
      actions={
        <Button asChild size="sm" variant="ghost">
          <Link href="/businesses">All businesses</Link>
        </Button>
      }
      data-testid="discovery"
    >
      {total === 0 ? (
        <EmptyState
          size="compact"
          icon={<SearchIcon />}
          title="No businesses yet"
          description="Search Google Maps or paste a Trustpilot link in Lookup."
        />
      ) : (
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-2" data-testid="qualification-split">
            <div className="flex h-2 gap-0.5 overflow-hidden rounded-full" aria-hidden>
              {QUALIFICATION_TONES.map((q) =>
                qualification[q.key] > 0 ? (
                  <div key={q.key} className={cn("h-full min-w-1", toneFill[q.tone])} style={{ flexGrow: qualification[q.key], flexBasis: 0 }} />
                ) : null,
              )}
            </div>
            <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
              {QUALIFICATION_TONES.map((q) => (
                <div key={q.key} data-key={q.key} className="flex items-center gap-1.5">
                  <span aria-hidden className={cn("size-2 shrink-0 rounded-full", toneFill[q.tone])} />
                  <dt className="text-muted-foreground">{q.label}</dt>
                  <dd className="font-medium tabular-nums">{nf.format(qualification[q.key])}</dd>
                </div>
              ))}
            </dl>
          </div>
          <SubSection title="By source">
            <BarList rows={sources} empty="No businesses yet." testId="tile-businesses-by-source" />
          </SubSection>
          <SubSection
            title="Top rejection reasons"
            action={
              <Link href="/settings/rules" className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
                Edit rules
              </Link>
            }
          >
            <BarList rows={rejections} empty="Nothing has been rejected." testId="rejection-reasons" />
          </SubSection>
        </div>
      )}
    </Panel>
  );
}

function SubSection({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5 border-t border-white/5 pt-4">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-2xs tracking-wider text-muted-foreground uppercase">{title}</h3>
        {action}
      </div>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------- running campaigns

type RunningCall = CallCampaign & CampaignStats;
type RunningEmail = EmailCampaign & EmailCampaignDetailStats;

export function RunningCampaignsPanel({ calls, emails }: { calls: RunningCall[]; emails: RunningEmail[] }) {
  return (
    <Panel
      title="Running campaigns"
      description="Queue progress and today's work"
      actions={
        <Button asChild size="sm" variant="ghost">
          <Link href="/calling">All campaigns</Link>
        </Button>
      }
      data-testid="running-campaigns"
    >
      {calls.length + emails.length === 0 ? (
        <EmptyState
          size="compact"
          icon={<PhoneIcon />}
          title="Nothing running"
          description="Start a call or email campaign to see its progress here."
          action={
            <Button asChild size="sm" variant="outline">
              <Link href="/calling/new">New call campaign</Link>
            </Button>
          }
        />
      ) : (
        <AnimatedList as="ul" className="flex flex-col divide-y divide-white/5">
          {calls.map((c) => {
            const total = c.pending + c.claimed + c.completed + c.skipped + c.callback;
            const done = c.completed + c.skipped;
            const ai = c.mode === "ai";
            return (
              <AnimatedItem as="li" key={c.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0" data-testid="running-call-campaign">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    {ai ? (
                      <BotIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    ) : (
                      <PhoneIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    )}
                    <Link href={`/calling/${c.id}`} className="min-w-0 truncate text-sm font-medium hover:underline">
                      {c.name}
                    </Link>
                    <StatusBadge tone="neutral">{ai ? "AI agent" : "Dialer"}</StatusBadge>
                  </div>
                  <Button asChild size="sm" variant="outline">
                    {ai ? (
                      <Link href={`/calling/${c.id}`}>View AI calls</Link>
                    ) : (
                      <Link href={`/calling/${c.id}/dial`}>
                        <PhoneCallIcon /> Open dialer
                      </Link>
                    )}
                  </Button>
                </div>
                <ProgressBar value={done} max={Math.max(total, 1)} size="sm" label={`Queue: ${done} of ${total} done`} showValue />
                <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>
                    Calls today{" "}
                    <span className="font-medium text-foreground tabular-nums">
                      {c.completedToday}
                      {c.dailyCap ? ` of ${c.dailyCap}` : ""}
                    </span>
                  </span>
                  <span>
                    Callbacks <span className="font-medium text-foreground tabular-nums">{c.callback}</span>
                  </span>
                  {ai ? null : (
                    <span>
                      Agents online <span className="font-medium text-foreground tabular-nums">{c.activeAgents}</span>
                    </span>
                  )}
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
                  <StatusBadge tone="neutral">Email</StatusBadge>
                </div>
                <Button asChild size="sm" variant="outline">
                  <Link href={`/email/${e.id}`}>Open campaign</Link>
                </Button>
              </div>
              <ProgressBar
                value={e.sentToday}
                max={Math.max(e.dailyCap, 1)}
                size="sm"
                label={`Sent today: ${e.sentToday} of ${e.dailyCap}`}
                showValue
              />
              <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span>
                  In sequence <span className="font-medium text-foreground tabular-nums">{e.active}</span>
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

// ---------------------------------------------------------------- recent activity

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
    <Panel title="Recent activity" description="The latest calls, emails and notes" data-testid="recent-activity">
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
