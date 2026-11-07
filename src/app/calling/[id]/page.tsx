import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PhoneIcon, SettingsIcon } from "lucide-react";
import {
  EmptyState,
  KeyValue,
  KeyValueList,
  PageHeader,
  PageSection,
  PageShell,
  ProgressBar,
  StatusBadge,
  Toolbar,
  ToolbarGroup,
} from "@/components/primitives";
import { Button } from "@/components/ui/button";
import { getDb } from "@/db/client";
import { listCategories, listCities } from "@/db/repo/businesses";
import {
  countCampaignOutcomes,
  evaluateCampaign,
  getCallCampaign,
  getCampaignStats,
  listDueCallbacks,
  listQueue,
  listUpcomingCallbacks,
} from "@/db/repo/call-campaigns";
import { AddBusinessesPanel } from "@/features/calling/components/add-businesses-panel";
import { CampaignControls } from "@/features/calling/components/campaign-controls";
import { CampaignLive } from "@/features/calling/components/campaign-live";
import { QueueTable, type QueueTableRow } from "@/features/calling/components/queue-table";
import { shortTime } from "@/features/calling/time";
import { CALL_OUTCOMES } from "@/features/calling/types";
import { formatDate, formatPhone, formatRelative } from "@/lib/format";
import { OUTCOME_LABELS } from "@/lib/labels";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const QUEUE_LIMIT = 500;

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  if (!UUID_RE.test(id)) return { title: "Campaign" };
  const c = await getCallCampaign(getDb(), id);
  return { title: c?.name ?? "Campaign" };
}

export default async function CallCampaignPage({ params }: Props) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const db = getDb();
  if (!(await getCallCampaign(db, id))) notFound();

  const now = new Date();
  const campaign = await evaluateCampaign(db, id, now);
  const [stats, queue, due, upcoming, outcomes, cities, categories] = await Promise.all([
    getCampaignStats(db, id, now),
    listQueue(db, id, { limit: QUEUE_LIMIT }),
    listDueCallbacks(db, now, { campaignId: id }),
    listUpcomingCallbacks(db, id, now, 10),
    countCampaignOutcomes(db, id),
    listCities(db),
    listCategories(db),
  ]);

  const rows: QueueTableRow[] = queue.rows.map((r) => ({
    id: r.id,
    position: r.position,
    state: r.state,
    attempts: r.attempts,
    lastOutcome: r.lastOutcome,
    lastOutcomeAt: r.lastOutcomeAt,
    claimedBy: r.claimedBy,
    callbackAt: r.callbackAt,
    businessId: r.businessId,
    businessName: r.business.name,
    phone: r.business.phone,
  }));

  const outcomeTotal = outcomes.reduce((n, o) => n + o.count, 0);
  const outcomeCount = new Map(outcomes.map((o) => [o.outcome, o.count]));
  const tz = campaign.timezone;
  const hours =
    campaign.callingHoursStart && campaign.callingHoursEnd
      ? `${shortTime(campaign.callingHoursStart)}–${shortTime(campaign.callingHoursEnd)}`
      : "Any time";

  return (
    <PageShell>
      <PageHeader
        title={campaign.name}
        description={campaign.description ?? undefined}
        breadcrumbs={[{ label: "Calling", href: "/calling" }, { label: campaign.name }]}
        actions={
          <>
            <Button size="sm" variant="ghost" asChild>
              <Link href={`/calling/${id}/settings`}>
                <SettingsIcon aria-hidden /> Settings
              </Link>
            </Button>
            <Button size="sm" asChild>
              <Link href={`/calling/${id}/dial`}>
                <PhoneIcon aria-hidden /> Open dialer
              </Link>
            </Button>
          </>
        }
      />

      <CampaignLive
        campaignId={id}
        initialStatus={campaign.status}
        initialPauseReason={campaign.pauseReason}
        dailyCap={campaign.dailyCap}
        initialStats={stats}
      >
        <Toolbar>
          <ToolbarGroup>
            <CampaignControls campaignId={id} status={campaign.status} pauseReason={campaign.pauseReason} />
            <AddBusinessesPanel campaignId={id} cities={cities} categories={categories} />
          </ToolbarGroup>
        </Toolbar>
      </CampaignLive>

      <div className="grid gap-6 lg:grid-cols-3">
        <PageSection title="Queue" description={`${queue.total} items in position order.`} className="min-w-0 lg:col-span-2">
          <QueueTable rows={rows} timezone={tz} total={queue.total} />
        </PageSection>

        <div className="grid min-w-0 content-start gap-6">
          <PageSection title="Due callbacks">
            {due.length === 0 ? (
              <EmptyState size="compact" title="No callbacks due" description="Due callbacks are dialed before the rest of the queue." />
            ) : (
              <ul className="grid gap-2">
                {due.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{c.business.name}</p>
                      <p className="text-xs text-muted-foreground tabular-nums">{formatPhone(c.business.phone)}</p>
                    </div>
                    <StatusBadge tone="warning">{c.callbackAt ? formatRelative(c.callbackAt, now) : "due"}</StatusBadge>
                  </li>
                ))}
              </ul>
            )}
            {upcoming.length ? (
              <div className="mt-3 grid gap-1">
                <p className="text-xs font-medium text-muted-foreground">Upcoming</p>
                <ul className="grid gap-1 text-sm">
                  {upcoming.map((c) => (
                    <li key={c.id} className="flex justify-between gap-2">
                      <span className="truncate">{c.business.name}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{c.callbackAt ? formatDate(c.callbackAt, tz) : ""}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </PageSection>

          <PageSection title="Outcomes" description={`${outcomeTotal} calls logged in this campaign.`}>
            <div className="grid gap-2">
              {CALL_OUTCOMES.map((o) => (
                <ProgressBar
                  key={o}
                  size="sm"
                  value={outcomeCount.get(o) ?? 0}
                  max={Math.max(outcomeTotal, 1)}
                  tone={OUTCOME_LABELS[o].tone === "neutral" ? "info" : OUTCOME_LABELS[o].tone}
                  label={`${OUTCOME_LABELS[o].label} · ${outcomeCount.get(o) ?? 0}`}
                />
              ))}
            </div>
          </PageSection>

          <PageSection title="Settings">
            <KeyValueList>
              <KeyValue label="Daily cap">{campaign.dailyCap ?? "No cap"}</KeyValue>
              <KeyValue label="Calling hours">{hours}</KeyValue>
              <KeyValue label="Time zone">{tz.replace(/_/g, " ")}</KeyValue>
              <KeyValue label="Max agents">{campaign.maxConcurrentAgents}</KeyValue>
              <KeyValue label="Max attempts">{campaign.maxAttempts}</KeyValue>
              <KeyValue label="Auto-resume">{campaign.autoResume ? "On" : "Off"}</KeyValue>
            </KeyValueList>
          </PageSection>
        </div>
      </div>
    </PageShell>
  );
}
