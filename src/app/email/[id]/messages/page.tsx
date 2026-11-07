import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader, PageShell } from "@/components/primitives";
import { getDb } from "@/db/client";
import { listBusinesses } from "@/db/repo/businesses";
import { getEmailCampaign, listMessages } from "@/db/repo/email-campaigns";
import { CampaignStatusBadge, SenderBadge } from "@/features/email/components/badges";
import { type MessageRow, MessagesTable } from "@/features/email/components/messages-table";
import { senderKind } from "@/lib/email/sender";
import { env } from "@/lib/env";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Message log" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE_SIZE = 50;

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function EmailMessagesPage({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;
  if (!UUID_RE.test(id)) notFound();
  const db = getDb();
  const campaign = await getEmailCampaign(db, id);
  if (!campaign) notFound();

  const pageNum = Math.max(1, Number(typeof sp.page === "string" ? sp.page : 1) || 1);
  const messages = await listMessages(db, id, { limit: PAGE_SIZE, offset: (pageNum - 1) * PAGE_SIZE });

  const businessIds = [...new Set(messages.rows.map((m) => m.businessId))];
  const businessNames = new Map<string, string>();
  if (businessIds.length) {
    const found = await listBusinesses(db, { ids: businessIds }, { limit: businessIds.length });
    for (const b of found.rows) businessNames.set(b.id, b.name);
  }

  const stepOrders = new Map(campaign.steps.map((s) => [s.id, s.stepOrder]));
  const kind = senderKind(env);

  const rows: MessageRow[] = messages.rows.map((m) => ({
    id: m.id,
    timeLabel: formatDate(m.sentAt ?? m.createdAt, env.APP_TIMEZONE),
    toEmail: m.toEmail,
    subject: m.subject,
    status: m.status,
    stepOrder: m.stepId ? (stepOrders.get(m.stepId) ?? null) : null,
    businessId: m.businessId,
    businessName: businessNames.get(m.businessId) ?? "Unknown business",
    providerId: m.providerId,
    error: m.error,
    bodyRendered: m.bodyRendered,
  }));

  return (
    <PageShell>
      <PageHeader
        title="Message log"
        breadcrumbs={[{ label: "Email", href: "/email" }, { label: campaign.name, href: `/email/${id}` }, { label: "Message log" }]}
        meta={
          <>
            <CampaignStatusBadge status={campaign.status} pauseReason={campaign.pauseReason} />
            <SenderBadge kind={kind} />
          </>
        }
      />
      <MessagesTable rows={rows} page={pageNum} pageSize={PAGE_SIZE} total={messages.total} />
    </PageShell>
  );
}
