import type {
  BusinessStatus,
  CallOutcome,
  CampaignStatus,
  EnrollmentState,
  JobStatus,
  MessageStatus,
  PauseReason,
  Qualification,
  QueueState,
} from "@/db/schema";

export type Tone = "neutral" | "info" | "success" | "warning" | "danger";
export type Label = { label: string; tone: Tone };

export const STATUS_LABELS: Record<BusinessStatus, Label> = {
  new: { label: "New", tone: "neutral" },
  contacted: { label: "Contacted", tone: "info" },
  interested: { label: "Interested", tone: "success" },
  callback: { label: "Callback", tone: "warning" },
  not_interested: { label: "Not interested", tone: "neutral" },
  do_not_call: { label: "Do not call", tone: "danger" },
  converted: { label: "Converted", tone: "success" },
};

export const QUALIFICATION_LABELS: Record<Qualification, Label> = {
  qualified: { label: "Qualified", tone: "success" },
  review: { label: "Review", tone: "warning" },
  rejected: { label: "Rejected", tone: "danger" },
};

// Order matches the dialer's keyboard shortcuts: digits 1–8.
export const OUTCOME_LABELS: Record<CallOutcome, Label> = {
  no_answer: { label: "No answer", tone: "neutral" },
  voicemail: { label: "Voicemail", tone: "neutral" },
  busy: { label: "Busy", tone: "neutral" },
  interested: { label: "Interested", tone: "success" },
  not_interested: { label: "Not interested", tone: "warning" },
  callback: { label: "Callback", tone: "info" },
  wrong_number: { label: "Wrong number", tone: "warning" },
  do_not_call: { label: "Do not call", tone: "danger" },
};

export const CAMPAIGN_STATUS_LABELS: Record<CampaignStatus, Label> = {
  draft: { label: "Draft", tone: "neutral" },
  running: { label: "Running", tone: "success" },
  paused: { label: "Paused", tone: "warning" },
  completed: { label: "Completed", tone: "info" },
};

export const PAUSE_REASON_LABELS: Record<PauseReason, Label> = {
  manual: { label: "Paused manually", tone: "warning" },
  daily_cap: { label: "Daily cap reached", tone: "warning" },
  outside_hours: { label: "Outside calling hours", tone: "info" },
  exhausted: { label: "Waiting on callbacks", tone: "info" },
};

export const QUEUE_STATE_LABELS: Record<QueueState, Label> = {
  pending: { label: "Pending", tone: "neutral" },
  claimed: { label: "In progress", tone: "info" },
  completed: { label: "Completed", tone: "success" },
  skipped: { label: "Skipped", tone: "neutral" },
  callback: { label: "Callback", tone: "warning" },
};

export const JOB_STATUS_LABELS: Record<JobStatus, Label> = {
  pending: { label: "Pending", tone: "neutral" },
  running: { label: "Running", tone: "info" },
  completed: { label: "Completed", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
};

export const ENROLLMENT_STATE_LABELS: Record<EnrollmentState, Label> = {
  active: { label: "Active", tone: "info" },
  completed: { label: "Completed", tone: "success" },
  replied: { label: "Replied", tone: "success" },
  unsubscribed: { label: "Unsubscribed", tone: "danger" },
  bounced: { label: "Bounced", tone: "danger" },
  paused: { label: "Paused", tone: "warning" },
};

export const MESSAGE_STATUS_LABELS: Record<MessageStatus, Label> = {
  queued: { label: "Queued", tone: "neutral" },
  sent: { label: "Sent", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
  dry_run: { label: "Dry run", tone: "info" },
};
