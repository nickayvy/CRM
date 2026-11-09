import { Badge } from "@/components/ui/badge";
import type { LeadStatus } from "@/db/schema";
import { LEAD_STATUS_LABELS } from "@/lib/labels";
import { cn } from "@/lib/utils";

/** gtm status-badge styles mapped onto our six lead statuses (single-accent palette). */
export const LEAD_STATUS_STYLES: Record<LeadStatus, string> = {
  queued: "bg-muted text-muted-foreground",
  contacted: "bg-primary/10 text-primary/90",
  callback: "bg-primary/10 text-primary/90",
  success: "bg-primary/20 text-primary",
  failed: "bg-destructive/20 text-destructive",
  skipped: "bg-muted text-muted-foreground/80",
};

export function StatusBadge({ status, className }: { status: LeadStatus; className?: string }) {
  return (
    <Badge
      variant="secondary"
      data-status={status}
      className={cn("text-xs", LEAD_STATUS_STYLES[status], className)}
    >
      {LEAD_STATUS_LABELS[status].label}
    </Badge>
  );
}
