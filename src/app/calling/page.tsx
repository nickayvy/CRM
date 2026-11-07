import type { Metadata } from "next";
import Link from "next/link";
import { PhoneIcon, PlusIcon } from "lucide-react";
import { EmptyState, PageHeader, PageShell } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import { getDb } from "@/db/client";
import { evaluateAllCampaigns, listCallCampaigns } from "@/db/repo/call-campaigns";
import { CampaignCard } from "@/features/calling/components/campaign-card";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Calling" };

function NewCampaignButton() {
  return (
    <Button asChild>
      <Link href="/calling/new">
        <PlusIcon aria-hidden />
        New campaign
      </Link>
    </Button>
  );
}

export default async function CallingPage() {
  const db = getDb();
  // Bring running/paused statuses up to date (hours, caps, callbacks) before listing.
  await evaluateAllCampaigns(db);
  const campaigns = await listCallCampaigns(db);

  return (
    <PageShell>
      <PageHeader
        title="Calling"
        description="Call campaigns and their queues."
        actions={<NewCampaignButton />}
      />
      {campaigns.length === 0 ? (
        <EmptyState
          bordered
          icon={<PhoneIcon />}
          title="No call campaigns yet"
          description="Create a campaign, add businesses to its queue, then start calling."
          action={<NewCampaignButton />}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {campaigns.map((c) => (
            <CampaignCard key={c.id} campaign={c} />
          ))}
        </div>
      )}
    </PageShell>
  );
}
