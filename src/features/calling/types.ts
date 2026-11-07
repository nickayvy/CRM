// Client-safe types and constants for the calling feature.
import type { Activity, Business, CallCampaign, CallOutcome, CallQueueItem, PauseReason } from "@/db/schema";

/** Outcome order = dialer digit shortcuts 1–8. */
export const CALL_OUTCOMES = [
  "no_answer",
  "voicemail",
  "busy",
  "interested",
  "not_interested",
  "callback",
  "wrong_number",
  "do_not_call",
] as const satisfies readonly CallOutcome[];

export type ClaimFailureReason = "paused" | "completed" | "draft" | "empty" | "agent_limit";

/** What the dialer needs for one claimed call. */
export type DialerCall = {
  item: CallQueueItem;
  business: Business;
  /** Earlier call activities for this business in this campaign (newest first). */
  history: Activity[];
  /** Last 5 activities of any kind for this business. */
  recent: Activity[];
};

export type DialerClaim =
  | ({ ok: true } & DialerCall)
  | { ok: false; reason: ClaimFailureReason; pauseReason?: PauseReason; campaign: DialerCampaign };

/** Campaign fields the dialer shows. */
export type DialerCampaign = Pick<
  CallCampaign,
  "id" | "name" | "status" | "pauseReason" | "script" | "timezone" | "maxAttempts"
>;

export type CampaignStatusPayload = {
  campaign: Pick<CallCampaign, "id" | "name" | "status" | "pauseReason" | "dailyCap" | "updatedAt">;
  stats: {
    pending: number;
    claimed: number;
    completed: number;
    skipped: number;
    callback: number;
    completedToday: number;
    activeAgents: number;
  };
  /** ISO time the payload was built. */
  at: string;
};
