import type { Metadata } from "next";
import { formatInTimeZone } from "date-fns-tz";
import { MailIcon, PercentIcon, PhoneIcon, PlayIcon } from "lucide-react";
import { ChartCard, PageHeader, PageShell, StatCard } from "@/components/primitives";
import { getDb } from "@/db/client";
import { listRecentActivities } from "@/db/repo/activities";
import { evaluateAllCampaigns, listCallCampaigns, listDueCallbacks } from "@/db/repo/call-campaigns";
import { getDashboardStats, sevenDayWindow } from "@/db/repo/dashboard";
import { listEmailCampaigns } from "@/db/repo/email-campaigns";
import { countLeadsByStatus } from "@/db/repo/leads";
import { localDayBounds } from "@/features/calling/time";
import { buildAttention } from "@/features/dashboard/attention";
import { outcomeRows, pipelineStages, rejectionRows } from "@/features/dashboard/chart-data";
import { OutcomesByDayChart } from "@/features/dashboard/components/dashboard-charts";
import {
  DiscoveryPanel,
  DueCallbacksPanel,
  GettingStartedPanel,
  LeadsByStatusPanel,
  PipelinePanel,
  RecentActivityPanel,
  RunningCampaignsPanel,
  UpNextPanel,
} from "@/features/dashboard/components/dashboard-panels";
import { LEAD_STATUS_LABELS, SOURCE_LABELS, getOverviewTiles } from "@/features/dashboard/data";
import { env } from "@/lib/env";
import { AnimatedItem, AnimatedList } from "@/lib/motion";
import { requireUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Overview" };

/**
 * Home. Read top to bottom it answers, in order: what needs me now (up next,
 * callbacks), how today is going (four numbers), how the pipeline is doing
 * (stages, call outcomes, leads, discovery), and what happened lately.
 */
export default async function OverviewPage() {
  const user = await requireUser();
  const db = getDb();
  const now = new Date();
  const tz = env.APP_TIMEZONE;
  // Bring auto-pause/resume up to date so "running" means running right now.
  await evaluateAllCampaigns(db, now);
  const [stats, tiles, myLeads, callCampaigns, emailCampaigns, callbacks, recent] = await Promise.all([
    getDashboardStats(db, now),
    getOverviewTiles(db),
    countLeadsByStatus(db, user.id),
    listCallCampaigns(db, now),
    listEmailCampaigns(db, now),
    listDueCallbacks(db, localDayBounds(now, tz).end, { limit: 6 }),
    listRecentActivities(db, 6),
  ]);
  const runningCalls = callCampaigns.filter((c) => c.status === "running");
  const runningEmails = emailCampaigns.filter((c) => c.status === "running");
  const outcomes = outcomeRows(stats, sevenDayWindow(now, tz).days, tz);
  const running = stats.runningCallCampaigns + stats.runningEmailCampaigns;
  const attention = buildAttention({
    callCampaigns,
    emailCampaigns,
    queuedLeads: myLeads.queued,
    leadsTotal: tiles.leadsTotal,
    businessesTotal: stats.businessesTotal,
    businessesReview: stats.businessesReview,
  });

  const cards = [
    {
      key: "calls",
      label: "Calls today",
      value: stats.callsToday,
      icon: <PhoneIcon />,
      href: "/calling",
      // A comparison of nothing with nothing is noise.
      ...(stats.callsToday || stats.callsYesterday
        ? { delta: { value: stats.callsToday - stats.callsYesterday, label: "vs yesterday" } }
        : { hint: "No calls yet today" }),
    },
    {
      key: "interest",
      label: "Interest rate (7 days)",
      value: stats.interestRate7d,
      format: "percent" as const,
      icon: <PercentIcon />,
      hint: stats.calls7d ? `${stats.interested7d} interested of ${stats.calls7d} calls` : "No calls in the last 7 days",
    },
    {
      key: "emails",
      label: "Emails sent today",
      value: stats.emailsSentToday,
      icon: <MailIcon />,
      href: "/email",
      hint: env.RESEND_API_KEY ? "Across every email campaign" : "Dry run: recorded, not delivered",
    },
    {
      key: "running",
      label: "Running campaigns",
      value: running,
      icon: <PlayIcon />,
      href: "/calling",
      hint: `${stats.runningCallCampaigns} call · ${stats.runningEmailCampaigns} email`,
    },
  ];

  const today = formatInTimeZone(now, tz, "EEEE, MMMM d");

  // Nothing found, saved or set up yet: show how to start instead of a page of empty panels.
  if (stats.businessesTotal === 0 && tiles.leadsTotal === 0 && callCampaigns.length + emailCampaigns.length === 0) {
    return (
      <PageShell>
        <PageHeader title="Overview" description={`${today} · your workspace is empty. Here is how to fill it.`} />
        <GettingStartedPanel />
      </PageShell>
    );
  }

  return (
    <PageShell>
      <PageHeader title="Overview" description={`${today} · what needs you today, then how the pipeline is doing.`} />

      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-3">
        <UpNextPanel items={attention} className="lg:col-span-2" />
        <DueCallbacksPanel items={callbacks} overdueTotal={stats.overdueCallbacks} now={now} tz={tz} />
      </div>

      <AnimatedList className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4" data-slot="stat-grid" data-testid="dashboard-stats">
        {cards.map(({ key, ...c }) => (
          <AnimatedItem key={key} className="min-w-0" data-stat={key}>
            <StatCard {...c} className="h-full" />
          </AnimatedItem>
        ))}
      </AnimatedList>

      <div className="grid min-w-0 grid-cols-1 items-start gap-4 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-4 lg:col-span-2">
          <PipelinePanel stages={pipelineStages(stats, tiles)} />
          <ChartCard
            title="Calls by outcome"
            description={stats.calls7d ? `${stats.calls7d} calls in the last 7 days` : "Last 7 days"}
            height={outcomes.outcomes.length ? 260 : 120}
          >
            <OutcomesByDayChart data={outcomes.data} outcomes={outcomes.outcomes} />
          </ChartCard>
          <RunningCampaignsPanel calls={runningCalls} emails={runningEmails} />
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <LeadsByStatusPanel
            total={tiles.leadsTotal}
            rows={tiles.leadsByStatus.map((r) => ({ key: r.status, label: LEAD_STATUS_LABELS[r.status], count: r.count }))}
          />
          <DiscoveryPanel
            qualification={{ qualified: stats.businessesQualified, review: stats.businessesReview, rejected: stats.businessesRejected }}
            sources={tiles.businessesBySource
              .map((r) => ({ key: r.source, label: SOURCE_LABELS[r.source], count: r.count }))
              .sort((a, b) => b.count - a.count)}
            rejections={rejectionRows(stats).slice(0, 5)}
          />
          <RecentActivityPanel items={recent} />
        </div>
      </div>
    </PageShell>
  );
}
