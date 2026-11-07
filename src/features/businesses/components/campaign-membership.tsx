import Link from "next/link";
import { MailIcon, PhoneIcon } from "lucide-react";
import { EmptyState, StatusBadge } from "@/components/primitives";
import type { BusinessMemberships } from "@/db/repo/dashboard";
import type { CallOutcome } from "@/db/schema";
import { ENROLLMENT_STATE_LABELS, OUTCOME_LABELS, QUEUE_STATE_LABELS } from "@/lib/labels";

/**
 * Business detail: every call queue item and email enrollment of this
 * business, with links to the campaigns. Data from `listBusinessMemberships`.
 */
export function CampaignMembership({ memberships }: { memberships: BusinessMemberships }) {
  const { calls, emails } = memberships;
  if (calls.length + emails.length === 0) {
    return (
      <EmptyState
        size="compact"
        title="Not in any campaign"
        description="Select it on the Businesses page and use “Add to call campaign…” or “Add to email campaign…”."
      />
    );
  }
  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="campaign-membership">
      {calls.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <h3 className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <PhoneIcon className="size-3.5" aria-hidden /> Call campaigns
          </h3>
          <ul className="flex flex-col divide-y rounded-md border">
            {calls.map((c) => (
              <li key={c.id} className="flex flex-col gap-1 px-3 py-2 text-sm" data-testid="membership-call">
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <Link href={`/calling/${c.campaignId}`} className="min-w-0 truncate font-medium hover:underline">
                    {c.campaignName}
                  </Link>
                  <StatusBadge label={QUEUE_STATE_LABELS[c.state]} />
                </div>
                <p className="text-xs text-muted-foreground">
                  {c.attempts} attempt{c.attempts === 1 ? "" : "s"}
                  {c.lastOutcome ? <> · last: {OUTCOME_LABELS[c.lastOutcome as CallOutcome].label}</> : null}
                  {" · "}#{c.position} in queue
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {emails.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <h3 className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <MailIcon className="size-3.5" aria-hidden /> Email campaigns
          </h3>
          <ul className="flex flex-col divide-y rounded-md border">
            {emails.map((e) => (
              <li key={e.id} className="flex flex-col gap-1 px-3 py-2 text-sm" data-testid="membership-email">
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <Link href={`/email/${e.campaignId}`} className="min-w-0 truncate font-medium hover:underline">
                    {e.campaignName}
                  </Link>
                  <StatusBadge label={ENROLLMENT_STATE_LABELS[e.state]} />
                </div>
                <p className="text-xs text-muted-foreground">
                  Step {Math.min(e.currentStep, e.stepCount)} of {e.stepCount} sent
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
