import type { Metadata } from "next";
import { PageHeader, PageShell } from "@/components/primitives";
import { createCampaignAction } from "@/features/calling/actions";
import { CampaignForm } from "@/features/calling/components/campaign-form";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "New call campaign" };

export default function NewCallCampaignPage() {
  return (
    <PageShell width="narrow">
      <PageHeader
        title="New call campaign"
        description="Campaigns start as drafts. Add businesses to the queue, then start it."
        breadcrumbs={[{ label: "Calling", href: "/calling" }, { label: "New" }]}
      />
      <CampaignForm
        action={createCampaignAction}
        initial={{ timezone: env.APP_TIMEZONE, maxConcurrentAgents: 5, maxAttempts: 3, autoResume: true }}
        submitLabel="Create campaign"
        cancelHref="/calling"
      />
    </PageShell>
  );
}
