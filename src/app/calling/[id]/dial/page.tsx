import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BotIcon, PhoneIcon } from "lucide-react";
import { EmptyState, PageShell } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import { getDb } from "@/db/client";
import { evaluateCampaign, getCallCampaign } from "@/db/repo/call-campaigns";
import { AgentNameForm } from "@/features/calling/components/agent-name-form";
import { Dialer } from "@/features/calling/components/dialer";
import { getAgentName } from "@/lib/agent-cookie";
import { requireUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const c = UUID_RE.test(id) ? await getCallCampaign(getDb(), id) : null;
  return { title: c ? `Dialer · ${c.name}` : "Dialer" };
}

export default async function DialPage({ params }: Props) {
  await requireUser();
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const db = getDb();
  if (!(await getCallCampaign(db, id))) notFound();
  const campaign = await evaluateCampaign(db, id);
  const agent = await getAgentName();

  // Say why a campaign cannot be dialed before asking who is calling.
  const blocked =
    campaign.mode === "ai"
      ? {
          icon: <BotIcon />,
          title: `${campaign.name} is called by the AI agent`,
          description: "There is nothing to dial by hand. Its page shows each AI call and outcome.",
          label: "View AI calls",
        }
      : campaign.status === "draft"
        ? {
            icon: <PhoneIcon />,
            title: `${campaign.name} has not started`,
            description: "Add businesses to its queue and press Start on the campaign page, then come back to dial.",
            label: "Finish setup",
          }
        : null;
  if (blocked) {
    return (
      <PageShell width="narrow">
        <EmptyState
          bordered
          icon={blocked.icon}
          title={blocked.title}
          description={blocked.description}
          action={
            <Button asChild>
              <Link href={`/calling/${campaign.id}`}>{blocked.label}</Link>
            </Button>
          }
        />
      </PageShell>
    );
  }

  return (
    <PageShell width="full">
      {agent ? (
        <Dialer
          key={agent}
          agent={agent}
          campaign={{
            id: campaign.id,
            name: campaign.name,
            status: campaign.status,
            pauseReason: campaign.pauseReason,
            script: campaign.script,
            timezone: campaign.timezone,
            maxAttempts: campaign.maxAttempts,
          }}
        />
      ) : (
        <div className="py-10">
          <AgentNameForm campaignName={campaign.name} />
        </div>
      )}
    </PageShell>
  );
}
