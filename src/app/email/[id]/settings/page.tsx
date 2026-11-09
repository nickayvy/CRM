import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader, PageShell } from "@/components/primitives";
import { getDb } from "@/db/client";
import { getEmailCampaign } from "@/db/repo/email-campaigns";
import { CampaignStatusBadge } from "@/features/email/components/badges";
import { CampaignForm } from "@/features/email/components/campaign-form";
import { loadPreviewBusinesses } from "@/features/email/preview-businesses";
import { requireUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Campaign settings" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EmailCampaignSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const db = getDb();
  const campaign = await getEmailCampaign(db, id);
  if (!campaign) notFound();
  const previewBusinesses = await loadPreviewBusinesses(db);
  return (
    <PageShell width="narrow" className="max-w-5xl">
      <PageHeader
        title="Settings"
        description={
          campaign.status === "draft"
            ? "Edit the campaign and its steps."
            : "Changes apply to future sends. Enrollments keep their position: step N stays step N."
        }
        meta={<CampaignStatusBadge status={campaign.status} pauseReason={campaign.pauseReason} />}
        breadcrumbs={[
          { label: "Email", href: "/email" },
          { label: campaign.name, href: `/email/${id}` },
          { label: "Settings" },
        ]}
      />
      <CampaignForm
        campaignId={id}
        previewBusinesses={previewBusinesses}
        initial={{
          name: campaign.name,
          fromName: campaign.fromName,
          fromEmail: campaign.fromEmail,
          dailyCap: campaign.dailyCap,
          steps: campaign.steps.map((s) => ({ subject: s.subject, body: s.body, delayDays: s.delayDays })),
        }}
      />
    </PageShell>
  );
}
