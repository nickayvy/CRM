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
  /** The signed-in user's queued leads whose business is in no call queue and no email sequence. */
  unassignedLeads: number;
  /** Every user's leads. */
  leadsTotal: number;
  businessesTotal: number;
  businessesReview: number;
  /** False when no discovery source (Google Maps, Trustpilot, Yelp) has a key, so Lookup cannot find anything yet. */
  discoveryConfigured: boolean;
};

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** Dialer rows shown one per campaign; beyond this they fold into one row. */
export const DIAL_ROWS = 3;

/** "A", "A and B", "A, B and 2 more". */
function names(list: { name: string }[]): string {
  if (list.length <= 2) return list.map((c) => c.name).join(" and ");
  return `${list[0].name}, ${list[1].name} and ${list.length - 2} more`;
}

/**
 * Order: work that is ready right now (running dialer queues), the next
 * setup step when the workspace has no businesses or no leads (nothing below
 * it can be done without them), things that are stuck (manually paused
 * campaigns), backlogs (leads in no campaign, businesses waiting for a
 * decision), drafts, then "start a campaign" when there is none.
 *
 * Several campaigns of one kind share a row, so the list cannot grow without
 * bound and nothing is silently dropped. Campaigns paused by the daily cap
 * or calling hours resume on their own and are not listed. Callbacks have
 * their own panel next to this list.
 */
export function buildAttention(input: AttentionInput): AttentionItem[] {
  const items: AttentionItem[] = [];

  const dialable = input.callCampaigns.filter((c) => c.status === "running" && c.mode === "human" && c.pending > 0);
  for (const c of dialable.slice(0, DIAL_ROWS)) {
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
  if (dialable.length > DIAL_ROWS) {
    const rest = dialable.slice(DIAL_ROWS);
    items.push({
      key: "dial-more",
      tone: "info",
      icon: "dial",
      title: `${plural(rest.length, "more queue is", "more queues are")} ready to dial`,
      detail: names(rest),
      href: "/calling",
      cta: "All campaigns",
    });
  }

  // Getting started: only the next missing step, and before anything that depends on it.
  if (input.businessesTotal === 0) {
    items.push(
      input.discoveryConfigured
        ? {
            key: "setup-discover",
            tone: "info",
            icon: "search",
            title: "Find your first businesses",
            detail: "Search by niche and area, or paste a Trustpilot link, in Lookup.",
            href: "/lookup",
            cta: "Open Lookup",
          }
        : {
            key: "setup-sources",
            tone: "warning",
            icon: "search",
            title: "Connect a source to find businesses",
            detail: "No Google Maps, Trustpilot or Yelp key is set yet, so Lookup has nothing to search.",
            href: "/settings",
            cta: "Open Settings",
          },
    );
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
  }

  const pausedCalls = input.callCampaigns.filter((c) => c.status === "paused" && c.pauseReason === "manual");
  const pausedEmails = input.emailCampaigns.filter((c) => c.status === "paused" && c.pauseReason === "manual");
  if (pausedCalls.length + pausedEmails.length === 1) {
    const call = pausedCalls[0];
    const c = call ?? pausedEmails[0];
    items.push({
      key: call ? `paused-call-${c.id}` : `paused-email-${c.id}`,
      tone: "warning",
      icon: "paused",
      title: `${c.name} is paused`,
      detail: !call
        ? "No emails go out until it is resumed."
        : call.pending
          ? `${call.pending.toLocaleString("en-US")} still waiting in the queue. Resume it when you are ready.`
          : "Paused by hand. Resume it when you are ready.",
      href: call ? `/calling/${c.id}` : `/email/${c.id}`,
      cta: "Open campaign",
    });
  } else if (pausedCalls.length + pausedEmails.length > 1) {
    const all = [...pausedCalls, ...pausedEmails];
    items.push({
      key: "paused",
      tone: "warning",
      icon: "paused",
      title: `${all.length} campaigns are paused`,
      detail: `${names(all)}. Nothing goes out until they are resumed.`,
      href: pausedCalls.length ? "/calling" : "/email",
      cta: pausedCalls.length ? "Call campaigns" : "Email campaigns",
    });
  }

  if (input.unassignedLeads > 0) {
    items.push({
      key: "unassigned-leads",
      tone: "neutral",
      icon: "leads",
      title: `${plural(input.unassignedLeads, "lead is", "leads are")} not in any campaign`,
      detail: "Queued, with no call queue or email sequence to reach them. Add them to one to start outreach.",
      href: "/leads?status=queued",
      cta: "Open queued leads",
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

  const draftCalls = input.callCampaigns.filter((c) => c.status === "draft");
  const draftEmails = input.emailCampaigns.filter((c) => c.status === "draft");
  if (draftCalls.length + draftEmails.length === 1) {
    const call = draftCalls[0];
    const c = call ?? draftEmails[0];
    items.push({
      key: call ? `draft-call-${c.id}` : `draft-email-${c.id}`,
      tone: "neutral",
      icon: "draft",
      title: `${c.name} is still a draft`,
      detail: call ? "Add businesses and start it to begin calling." : "Add steps and enroll businesses to start sending.",
      href: call ? `/calling/${c.id}` : `/email/${c.id}`,
      cta: "Finish setup",
    });
  } else if (draftCalls.length + draftEmails.length > 1) {
    const all = [...draftCalls, ...draftEmails];
    items.push({
      key: "drafts",
      tone: "neutral",
      icon: "draft",
      title: `${all.length} campaigns are still drafts`,
      detail: `${names(all)}. Finish setup to start them.`,
      href: draftCalls.length ? "/calling" : "/email",
      cta: draftCalls.length ? "Call campaigns" : "Email campaigns",
    });
  }

  if (input.businessesTotal > 0 && input.leadsTotal > 0 && input.callCampaigns.length + input.emailCampaigns.length === 0) {
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

  return items;
}
