import type { Metadata } from "next";
import Link from "next/link";
import { PlusIcon } from "lucide-react";
import { PageHeader, PageShell, StatCard, StatGrid } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import { getDb } from "@/db/client";
import { listEmailCampaigns } from "@/db/repo/email-campaigns";
import { SenderBadge } from "@/features/email/components/badges";
import { type CampaignRow, CampaignsTable } from "@/features/email/components/campaigns-table";
import { senderKind } from "@/lib/email/sender";
import { env } from "@/lib/env";
import { requireUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Email" };

export default async function EmailPage() {
  await requireUser();
  const campaigns = await listEmailCampaigns(getDb());
  const rows: CampaignRow[] = campaigns.map((c) => ({
    id: c.id,
    name: c.name,
    status: c.status,
    pauseReason: c.pauseReason,
    stepCount: c.stepCount,
    enrolled: c.enrolled,
    active: c.active,
    completed: c.completed,
    replied: c.replied,
    unsubscribed: c.unsubscribed,
    sentToday: c.sentToday,
    sentTotal: c.sentTotal,
    dailyCap: c.dailyCap,
  }));
  const sum = (k: keyof Pick<CampaignRow, "active" | "replied" | "sentToday" | "sentTotal">) =>
    rows.reduce((n, r) => n + r[k], 0);

  return (
    <PageShell>
      <PageHeader
        title="Email"
        description="Cold-email sequences: ordered steps with delays, sent within a daily cap."
        meta={<SenderBadge kind={senderKind(env)} />}
        actions={
          <Button asChild>
            <Link href="/email/new">
              <PlusIcon data-icon="inline-start" />
              New campaign
            </Link>
          </Button>
        }
      />
      <StatGrid columns={4}>
        <StatCard label="Running" value={rows.filter((r) => r.status === "running").length} />
        <StatCard label="Active enrollments" value={sum("active")} />
        <StatCard label="Sent today" value={sum("sentToday")} />
        <StatCard label="Replies" value={sum("replied")} hint={`${sum("sentTotal")} sent in total`} />
      </StatGrid>
      <CampaignsTable rows={rows} />
    </PageShell>
  );
}
