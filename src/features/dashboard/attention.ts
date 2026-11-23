// The "Up next" list on the overview: what the signed-in user should act on,
// most urgent first. Pure, so the ordering and wording are unit-tested
// (tests/dashboard-ui.test.ts).
import type { CampaignStats } from "@/db/repo/call-campaigns";
import type { CallCampaign, EmailCampaign } from "@/db/schema";
import type { Tone } from "@/lib/labels";

export type AttentionIcon = "dial" | "paused" | "leads" | "review" | "draft" | "search" | "campaign";

export type AttentionItem = {
  key: string;
  tone: Tone;
  icon: AttentionIcon;
  title: string;
  detail: string;
  href: string;
  /** Button text: says what happens, e.g. "Open dialer". */
  cta: string;
};

export type AttentionInput = {
  callCampaigns: (Pick<CallCampaign, "id" | "name" | "status" | "mode" | "pauseReason" | "dailyCap"> &
    Pick<CampaignStats, "pending" | "completedToday">)[];
  emailCampaigns: Pick<EmailCampaign, "id" | "name" | "status" | "pauseReason">[];
  /** The signed-in user's leads that nobody has contacted yet. */
  queuedLeads: number;
  /** Every user's leads. */
  leadsTotal: number;
  businessesTotal: number;
  businessesReview: number;
};

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** At most this many rows: a to-do list that needs scrolling stops being read. */
export const ATTENTION_LIMIT = 6;

/**
 * Order: work that is ready right now (a running queue), things that are
 * stuck (manually paused campaigns), backlogs (leads nobody contacted,
 * businesses waiting for a decision, drafts), then what to set up next when
 * the workspace is still empty. Campaigns paused by the daily cap or calling
 * hours resume on their own, so they are not listed.
 */
export function buildAttention(input: AttentionInput): AttentionItem[] {
  const items: AttentionItem[] = [];

  for (const c of input.callCampaigns) {
    if (c.status !== "running" || c.mode !== "human" || c.pending === 0) continue;
    const today = c.dailyCap ? `${c.completedToday} of ${c.dailyCap} calls done today` : `${plural(c.completedToday, "call", "calls")} done today`;
    items.push({
      key: `dial-${c.id}`,
      tone: "info",
      icon: "dial",
      title: `Continue ${c.name}`,
      detail: `${c.pending.toLocaleString("en-US")} waiting in the queue · ${today}`,
      href: `/calling/${c.id}/dial`,
      cta: "Open dialer",
    });
  }

  for (const c of input.callCampaigns) {
    if (c.status !== "paused" || c.pauseReason !== "manual") continue;
    items.push({
      key: `paused-call-${c.id}`,
      tone: "warning",
      icon: "paused",
      title: `${c.name} is paused`,
      detail: c.pending ? `${c.pending.toLocaleString("en-US")} still waiting in the queue. Resume it when you are ready.` : "Paused by hand. Resume it when you are ready.",
      href: `/calling/${c.id}`,
      cta: "Open campaign",
    });
  }
  for (const c of input.emailCampaigns) {
    if (c.status !== "paused" || c.pauseReason !== "manual") continue;
    items.push({
      key: `paused-email-${c.id}`,
      tone: "warning",
      icon: "paused",
      title: `${c.name} is paused`,
      detail: "No emails go out until it is resumed.",
      href: `/email/${c.id}`,
      cta: "Open campaign",
    });
  }

  if (input.queuedLeads > 0) {
    items.push({
      key: "queued-leads",
      tone: "neutral",
      icon: "leads",
      title: `${plural(input.queuedLeads, "lead", "leads")} not contacted yet`,
      detail: "Add them to a call or email campaign to start outreach.",
      href: "/leads",
      cta: "Open leads",
    });
  }

  if (input.businessesReview > 0) {
    items.push({
      key: "review",
      tone: "neutral",
      icon: "review",
      title: `${plural(input.businessesReview, "business needs", "businesses need")} a decision`,
      detail: "Borderline matches: your rules could not qualify or reject them.",
      href: "/businesses?qualification=review",
      cta: "Review",
    });
  }

  for (const c of input.callCampaigns) {
    if (c.status !== "draft") continue;
    items.push({
      key: `draft-call-${c.id}`,
      tone: "neutral",
      icon: "draft",
      title: `${c.name} is still a draft`,
      detail: "Add businesses and start it to begin calling.",
      href: `/calling/${c.id}`,
      cta: "Finish setup",
    });
  }
  for (const c of input.emailCampaigns) {
    if (c.status !== "draft") continue;
    items.push({
      key: `draft-email-${c.id}`,
      tone: "neutral",
      icon: "draft",
      title: `${c.name} is still a draft`,
      detail: "Add steps and enroll businesses to start sending.",
      href: `/email/${c.id}`,
      cta: "Finish setup",
    });
  }

  // Getting started: only the next missing step, never all three at once.
  if (input.businessesTotal === 0) {
    items.push({
      key: "setup-discover",
      tone: "info",
      icon: "search",
      title: "Find your first businesses",
      detail: "Search Google Maps by niche and area, or paste a Trustpilot link.",
      href: "/lookup",
      cta: "Open Lookup",
    });
  } else if (input.leadsTotal === 0) {
    items.push({
      key: "setup-leads",
      tone: "info",
      icon: "leads",
      title: "Build your lead list",
      detail: "Open a business in Lookup and add it to your leads.",
      href: "/lookup",
      cta: "Open Lookup",
    });
  } else if (input.callCampaigns.length + input.emailCampaigns.length === 0) {
    items.push({
      key: "setup-campaign",
      tone: "info",
      icon: "campaign",
      title: "Start your first campaign",
      detail: "Put your leads in a call queue or an email sequence.",
      href: "/calling/new",
      cta: "New campaign",
    });
  }

  return items.slice(0, ATTENTION_LIMIT);
}
