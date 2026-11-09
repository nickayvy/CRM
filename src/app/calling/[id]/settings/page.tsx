import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader, PageShell } from "@/components/primitives";
import { getDb } from "@/db/client";
import { getCallCampaign } from "@/db/repo/call-campaigns";
import { updateCampaignAction } from "@/features/calling/actions";
import { CampaignForm } from "@/features/calling/components/campaign-form";
import { requireUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Campaign settings" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function CampaignSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const campaign = await getCallCampaign(getDb(), id);
  if (!campaign) notFound();

  return (
    <PageShell width="narrow">
      <PageHeader
        title="Settings"
        breadcrumbs={[
          { label: "Calling", href: "/calling" },
          { label: campaign.name, href: `/calling/${id}` },
          { label: "Settings" },
        ]}
      />
      <CampaignForm
        action={updateCampaignAction.bind(null, id)}
        initial={campaign}
        submitLabel="Save changes"
        cancelHref={`/calling/${id}`}
        successMessage="Campaign saved"
      />
    </PageShell>
  );
}
