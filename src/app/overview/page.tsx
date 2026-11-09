import type { Metadata } from "next";
import { BuildingIcon, MailIcon, PercentIcon, PhoneCallIcon, PhoneIcon, PlayIcon } from "lucide-react";
import { ChartCard, PageHeader, PageShell, StatCard } from "@/components/primitives";
import { getDb } from "@/db/client";
import { listRecentActivities } from "@/db/repo/activities";
import { evaluateAllCampaigns, listCallCampaigns, listDueCallbacks } from "@/db/repo/call-campaigns";
import { getDashboardStats, sevenDayWindow } from "@/db/repo/dashboard";
import { listEmailCampaigns } from "@/db/repo/email-campaigns";
import { localDayBounds } from "@/features/calling/time";
import { funnelRows, outcomeRows, rejectionRows } from "@/features/dashboard/chart-data";
import { CategoryBarChart, OutcomesByDayChart } from "@/features/dashboard/components/dashboard-charts";
import {
  BreakdownTile,
  DueCallbacksPanel,
  RecentActivityPanel,
  RunningCampaignsPanel,
} from "@/features/dashboard/components/dashboard-panels";
import { LEAD_STATUS_LABELS, SOURCE_LABELS, getOverviewTiles } from "@/features/dashboard/data";
import { env } from "@/lib/env";
import { AnimatedItem, AnimatedList } from "@/lib/motion";
import { requireUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Overview" };

/** The v1 dashboard, restyled: discovery yield, leads, calls and email at a glance. */
export default async function OverviewPage() {
  await requireUser();
  const db = getDb();
  const now = new Date();
  const tz = env.APP_TIMEZONE;
  // Bring auto-pause/resume up to date so "running" means running right now.
  await evaluateAllCampaigns(db, now);
  const [stats, tiles, callCampaigns, emailCampaigns, callbacks, recent] = await Promise.all([
    getDashboardStats(db, now),
    getOverviewTiles(db),
    listCallCampaigns(db, now),
    listEmailCampaigns(db, now),
    listDueCallbacks(db, localDayBounds(now, tz).end, { limit: 8 }),
    listRecentActivities(db, 10),
  ]);
  const runningCalls = callCampaigns.filter((c) => c.status === "running");
  const runningEmails = emailCampaigns.filter((c) => c.status === "running");
  const outcomes = outcomeRows(stats, sevenDayWindow(now, tz).days, tz);
  const running = stats.runningCallCampaigns + stats.runningEmailCampaigns;

  const cards = [
    {
      key: "businesses",
      label: "Businesses",
      value: stats.businessesTotal,
      icon: <BuildingIcon />,
      href: "/businesses",
      hint: `${stats.businessesQualified} qualified · ${stats.businessesReview} review · ${stats.businessesRejected} rejected`,
    },
    { key: "calls", label: "Calls today", value: stats.callsToday, icon: <PhoneIcon />, href: "/calling" },
    {
      key: "interest",
      label: "Interest rate (7d)",
      value: stats.interestRate7d,
      format: "percent" as const,
      icon: <PercentIcon />,
      hint: "Interested ÷ all call outcomes",
    },
    { key: "emails", label: "Emails sent today", value: stats.emailsSentToday, icon: <MailIcon />, href: "/email", hint: "Sent and dry-run" },
    {
      key: "running",
      label: "Running campaigns",
      value: running,
      icon: <PlayIcon />,
      hint: `${stats.runningCallCampaigns} call · ${stats.runningEmailCampaigns} email`,
    },
    {
      key: "overdue",
      label: "Overdue callbacks",
      value: stats.overdueCallbacks,
      icon: <PhoneCallIcon />,
      href: "/calling",
      hint: stats.overdueCallbacks ? "Past their scheduled time" : "All caught up",
    },
  ];

  return (
    <PageShell>
      <PageHeader title="Overview" description="Discovery yield, leads, calls and email at a glance." />

      <AnimatedList className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3" data-slot="stat-grid" data-testid="dashboard-stats">
        {cards.map(({ key, ...c }) => (
          <AnimatedItem key={key} className="min-w-0" data-stat={key}>
            <StatCard {...c} className="h-full" />
          </AnimatedItem>
        ))}
      </AnimatedList>

      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="min-w-0 lg:col-span-2">
          <BreakdownTile
            title="Leads by status"
            description={`${tiles.leadsTotal} leads across every user`}
            testId="tile-leads-by-status"
            href="/leads"
            items={tiles.leadsByStatus.map((r) => ({ key: r.status, label: LEAD_STATUS_LABELS[r.status], count: r.count }))}
          />
        </div>
        <BreakdownTile
          title="Businesses by source"
          description="Where discovered businesses came from"
          testId="tile-businesses-by-source"
          href="/businesses"
          items={tiles.businessesBySource.map((r) => ({ key: r.source, label: SOURCE_LABELS[r.source], count: r.count }))}
        />
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-3">
        <ChartCard className="lg:col-span-2" title="Calls by outcome" description="Last 7 days, by day" height={260}>
          <OutcomesByDayChart data={outcomes.data} outcomes={outcomes.outcomes} />
        </ChartCard>
        <ChartCard title="Rejection reasons" description="Businesses per hard rule" height={260}>
          <CategoryBarChart
            data={rejectionRows(stats)}
            name="Businesses"
            color="var(--chart-3)"
            emptyText="No rejections"
            testId="chart-rejections"
          />
        </ChartCard>
        <ChartCard title="Status funnel" description="Businesses by CRM status" height={260}>
          <CategoryBarChart data={funnelRows(stats)} name="Businesses" emptyText="No businesses yet" testId="chart-funnel" />
        </ChartCard>
        <div className="min-w-0 lg:col-span-2">
          <RunningCampaignsPanel calls={runningCalls} emails={runningEmails} />
        </div>
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">
        <DueCallbacksPanel items={callbacks} now={now} tz={tz} />
        <RecentActivityPanel items={recent} />
      </div>
    </PageShell>
  );
}
