import type { Metadata } from "next";
import { PageHeader, PageShell } from "@/components/primitives";
import { getDb } from "@/db/client";
import { CampaignForm } from "@/features/email/components/campaign-form";
import { loadPreviewBusinesses, parseFrom } from "@/features/email/preview-businesses";
import { env } from "@/lib/env";
import { requireUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "New email campaign" };

export default async function NewEmailCampaignPage() {
  await requireUser();
  const previewBusinesses = await loadPreviewBusinesses(getDb());
  const from = parseFrom(env.EMAIL_FROM);
  return (
    <PageShell width="narrow" className="max-w-5xl">
      <PageHeader
        title="New email campaign"
        description="Saved as a draft. Enroll businesses and start it from the campaign page."
        breadcrumbs={[{ label: "Email", href: "/email" }, { label: "New campaign" }]}
      />
      <CampaignForm
        previewBusinesses={previewBusinesses}
        initial={{
          name: "",
          fromName: from.fromName,
          fromEmail: from.fromEmail,
          dailyCap: 50,
          steps: [
            {
              subject: "Quick question about {{business_name}}",
              body: "Hi {{owner_first_name}},\n\nI came across {{business_name}} in {{city}} and noticed your {{review_count}} reviews. Do you have a plan for calls that come in while your team is on a job?\n\nThanks",
              delayDays: 0,
            },
          ],
        }}
      />
    </PageShell>
  );
}
