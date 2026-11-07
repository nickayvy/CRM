import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { InboxIcon } from "lucide-react";
import { PageHeader, PageSection, PageShell, StatCard, StatGrid } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import { getDb } from "@/db/client";
import { listCategories, listCities } from "@/db/repo/businesses";
import { getEmailCampaign, getEmailCampaignStats, listEnrollments } from "@/db/repo/email-campaigns";
import { CampaignStatusBadge, SenderBadge } from "@/features/email/components/badges";
import { CampaignControls } from "@/features/email/components/campaign-controls";
import { type EnrollmentRow, EnrollmentsTable } from "@/features/email/components/enrollments-table";
import { senderKind } from "@/lib/email/sender";
import { env } from "@/lib/env";
import { formatDate, formatRelative } from "@/lib/format";
import { PAUSE_REASON_LABELS } from "@/lib/labels";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Email campaign" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE_SIZE = 50;

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function EmailCampaignPage({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;
  if (!UUID_RE.test(id)) notFound();
  const db = getDb();
  const campaign = await getEmailCampaign(db, id);
  if (!campaign) notFound();

  const pageNum = Math.max(1, Number(typeof sp.page === "string" ? sp.page : 1) || 1);
  const now = new Date();
  const [stats, enrollments, cities, categories] = await Promise.all([
    getEmailCampaignStats(db, id, now),
    listEnrollments(db, id, { limit: PAGE_SIZE, offset: (pageNum - 1) * PAGE_SIZE }),
    listCities(db),
    listCategories(db),
  ]);
  const stepCount = campaign.steps.length;
  const kind = senderKind(env);

  const rows: EnrollmentRow[] = enrollments.rows.map((e) => {
    const waiting = e.state === "active" && e.nextSendAt;
    return {
      id: e.id,
      businessId: e.businessId,
      businessName: e.business.name,
      email: e.business.ownerEmail,
      state: e.state,
      currentStep: e.currentStep,
      nextSendAt: waiting ? e.nextSendAt!.toISOString() : null,
      nextSendLabel: waiting
        ? e.nextSendAt! <= now
          ? "Due now"
          : `${formatRelative(e.nextSendAt!, now)}`
        : "—",
      lastSentAt: e.lastSentAt?.toISOString() ?? null,
      lastSentLabel: e.lastSentAt ? formatDate(e.lastSentAt, env.APP_TIMEZONE) : "—",
    };
  });

  return (
    <PageShell>
      <PageHeader
        title={campaign.name}
        breadcrumbs={[{ label: "Email", href: "/email" }, { label: campaign.name }]}
        description={`From ${campaign.fromName} <${campaign.fromEmail}> · ${stepCount} ${stepCount === 1 ? "step" : "steps"} · cap ${campaign.dailyCap}/day${
          campaign.status === "paused" && campaign.pauseReason ? ` · ${PAUSE_REASON_LABELS[campaign.pauseReason].label}` : ""
        }`}
        meta={
          <>
            <CampaignStatusBadge status={campaign.status} pauseReason={campaign.pauseReason} />
            <SenderBadge kind={kind} />
          </>
        }
        actions={
          <CampaignControls
            campaignId={id}
            status={campaign.status}
            stepCount={stepCount}
            dryRun={kind === "dry_run"}
            cities={cities.map((c) => ({ value: c.city, label: c.state ? `${c.city}, ${c.state} (${c.count})` : `${c.city} (${c.count})` }))}
            categories={categories.map((c) => ({ value: c.alias, label: `${c.alias} (${c.count})` }))}
          />
        }
      />
      <StatGrid columns={5}>
        <StatCard label="Enrolled" value={stats.enrolled} hint={stats.paused ? `${stats.paused} paused` : undefined} />
        <StatCard label="Active" value={stats.active} hint={`${stats.completed} completed`} />
        <StatCard label="Replied" value={stats.replied} hint={stats.sentTotal ? `${Math.round((stats.replied / Math.max(1, stats.enrolled)) * 100)}% of enrolled` : undefined} />
        <StatCard label="Unsubscribed" value={stats.unsubscribed} />
        <StatCard label="Sent today" value={`${stats.sentToday} / ${campaign.dailyCap}`} hint={`${stats.sentTotal} sent in total`} href={`/email/${id}/messages`} />
      </StatGrid>
      <PageSection
        title="Enrollments"
        description={`${enrollments.total} ${enrollments.total === 1 ? "business" : "businesses"} in this sequence`}
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link href={`/email/${id}/messages`}>
              <InboxIcon data-icon="inline-start" />
              Message log
            </Link>
          </Button>
        }
      >
        <EnrollmentsTable rows={rows} stepCount={stepCount} page={pageNum} pageSize={PAGE_SIZE} total={enrollments.total} />
      </PageSection>
    </PageShell>
  );
}
