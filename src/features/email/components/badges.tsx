import { StatusBadge } from "@/components/primitives";
import type { CampaignStatus, PauseReason } from "@/db/schema";
import { CAMPAIGN_STATUS_LABELS, PAUSE_REASON_LABELS } from "@/lib/labels";

export function CampaignStatusBadge({ status, pauseReason }: { status: CampaignStatus; pauseReason: PauseReason | null }) {
  const base = CAMPAIGN_STATUS_LABELS[status];
  if (status === "paused" && pauseReason) {
    return <StatusBadge tone={base.tone} title={PAUSE_REASON_LABELS[pauseReason].label}>{`Paused (${pauseReason})`}</StatusBadge>;
  }
  return <StatusBadge label={base} />;
}

export function SenderBadge({ kind }: { kind: "resend" | "dry_run" }) {
  return kind === "dry_run" ? (
    <StatusBadge tone="info" title="RESEND_API_KEY is not set; messages are recorded but not delivered">
      Dry run
    </StatusBadge>
  ) : (
    <StatusBadge tone="success">Resend</StatusBadge>
  );
}
