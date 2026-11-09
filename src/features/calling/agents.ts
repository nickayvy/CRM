// Per-campaign ElevenLabs agents. Server only: an AI campaign gets its own
// copy of the template agent (ELEVENLABS_AGENT_ID) so its calls, history and
// tuning stay separate, and the copy is deleted with the campaign. When the
// copy cannot be made the campaign falls back to the shared template.
import type { DbOrTx } from "@/db/repo/call-campaigns";
import { updateCallCampaign } from "@/db/repo/call-campaigns";
import type { CallCampaign } from "@/db/schema";
import { env } from "@/lib/env";
import { type AgentManager, ElevenLabsError, missingAgentConfig } from "@/lib/elevenlabs/client";

export const AGENT_NAME_PREFIX = "LAR · ";
const AGENT_NAME_MAX = 100;

/** Dashboard name for a campaign's agent. */
export function agentNameFor(campaignName: string): string {
  return `${AGENT_NAME_PREFIX}${campaignName.trim()}`.slice(0, AGENT_NAME_MAX);
}

/**
 * Gives an AI campaign its own agent when it has none and ElevenLabs is
 * configured. Returns the stored agent id, or null when nothing was made
 * (human campaign, already provisioned, unconfigured, or the API refused:
 * that last case is logged and the campaign keeps using the shared agent).
 */
export async function provisionCampaignAgent(db: DbOrTx, campaign: CallCampaign, agents: AgentManager): Promise<string | null> {
  if (campaign.mode !== "ai" || campaign.elevenlabsAgentId) return null;
  if (missingAgentConfig().length) return null;
  try {
    const agentId = await agents.duplicateAgent(env.ELEVENLABS_AGENT_ID!, agentNameFor(campaign.name));
    await updateCallCampaign(db, campaign.id, { elevenlabsAgentId: agentId });
    return agentId;
  } catch (err) {
    console.error(`[calling] could not create an agent for campaign ${campaign.id}; using the shared agent`, err);
    return null;
  }
}

/** Keeps the agent's dashboard name in step with the campaign name. Failures are logged, not raised. */
export async function syncCampaignAgentName(campaign: CallCampaign, previousName: string, agents: AgentManager): Promise<void> {
  if (!campaign.elevenlabsAgentId || campaign.name === previousName || missingAgentConfig().length) return;
  try {
    await agents.renameAgent(campaign.elevenlabsAgentId, agentNameFor(campaign.name));
  } catch (err) {
    console.error(`[calling] could not rename the agent for campaign ${campaign.id}`, err);
  }
}

/**
 * Deletes the campaign's agent. Throws ElevenLabsError when the API refuses,
 * so the caller can keep the campaign rather than orphan the agent. A missing
 * API key also throws: the agent exists and cannot be removed blind.
 */
export async function releaseCampaignAgent(campaign: CallCampaign, agents: AgentManager): Promise<void> {
  if (!campaign.elevenlabsAgentId) return;
  if (!env.ELEVENLABS_API_KEY) throw new ElevenLabsError("ELEVENLABS_API_KEY is not set, so the campaign's agent cannot be deleted.");
  await agents.deleteAgent(campaign.elevenlabsAgentId);
}
