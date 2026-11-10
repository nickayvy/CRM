"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useConfirm } from "@/components/primitives/confirm-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { LeadStatus } from "@/db/schema";
import {
  addLeadsToCallCampaignAction,
  addLeadsToEmailCampaignAction,
  bulkRemoveLeadsAction,
  createCallCampaignForLeadsAction,
  removeLeadAction,
  updateLeadAction,
} from "@/features/leads/actions";
import type { CallHistoryRow, CampaignTarget, LeadMetricsData, LeadRow } from "@/features/leads/types";
import type { CampaignKind } from "./add-to-campaign-dialog";
import { CallHistoryTable } from "./call-history-table";
import { LeadMetrics } from "./lead-metrics";
import { LeadQueueTable } from "./lead-queue-table";

export type LeadsPanelProps = {
  leads: LeadRow[];
  metrics: LeadMetricsData;
  history: CallHistoryRow[];
  campaigns: { call: CampaignTarget[]; email: CampaignTarget[] };
};

type Override = Partial<Pick<LeadRow, "status" | "notes">> | "removed";

/**
 * /leads panel: metric tiles, Pipeline / History tabs. Edits apply
 * optimistically on top of the server rows, roll back on failure, and
 * `router.refresh()` pulls the persisted state afterwards.
 */
export function LeadsPanel({ leads: serverLeads, metrics, history, campaigns }: LeadsPanelProps) {
  const router = useRouter();
  const { confirm, dialog } = useConfirm();
  const [overrides, setOverrides] = React.useState<Map<string, Override>>(() => new Map());
  // Fresh server rows (after router.refresh) are the truth: drop the overlay.
  const [seen, setSeen] = React.useState(serverLeads);
  if (seen !== serverLeads) {
    setSeen(serverLeads);
    setOverrides(new Map());
  }

  const leads = React.useMemo(() => {
    const out: LeadRow[] = [];
    for (const l of serverLeads) {
      const o = overrides.get(l.id);
      if (o === "removed") continue;
      out.push(o ? { ...l, ...o } : l);
    }
    return out;
  }, [serverLeads, overrides]);

  // Lead counts follow the optimistic rows; calls come from the server.
  const liveMetrics: LeadMetricsData = {
    total: leads.length,
    queued: leads.filter((l) => l.status === "queued").length,
    success: leads.filter((l) => l.status === "success").length,
    calls7d: metrics.calls7d,
  };

  function apply(ids: string[], o: Override) {
    setOverrides((prev) => {
      const next = new Map(prev);
      for (const id of ids) {
        const cur = next.get(id);
        next.set(id, o === "removed" || cur === "removed" || !cur ? o : { ...cur, ...o });
      }
      return next;
    });
  }

  function rollback(snapshot: Map<string, Override>, ids: string[]) {
    setOverrides((prev) => {
      const next = new Map(prev);
      for (const id of ids) {
        const old = snapshot.get(id);
        if (old === undefined) next.delete(id);
        else next.set(id, old);
      }
      return next;
    });
  }

  async function update(id: string, patch: { status?: LeadStatus; notes?: string | null }, success: string) {
    const snapshot = overrides;
    apply([id], patch);
    const r = await updateLeadAction(id, patch);
    if (!r.ok) {
      rollback(snapshot, [id]);
      toast.error(r.message ?? "Could not update the lead.");
      return;
    }
    toast.success(success);
    router.refresh();
  }

  async function remove(ids: string[]): Promise<boolean> {
    if (ids.length === 0) return false;
    const snapshot = overrides;
    apply(ids, "removed");
    const r = ids.length === 1 ? await removeLeadAction(ids[0]) : await bulkRemoveLeadsAction(ids);
    if (!r.ok) {
      rollback(snapshot, ids);
      toast.error(r.message ?? "Could not remove.");
      return false;
    }
    toast.success(ids.length === 1 ? "Lead removed" : `Removed ${ids.length} leads`);
    router.refresh();
    return true;
  }

  async function bulkRemove(ids: string[]): Promise<boolean> {
    const yes = await confirm({
      title: `Remove ${ids.length} lead${ids.length === 1 ? "" : "s"}?`,
      description: "They leave your pipeline. The businesses and their call history stay.",
      tone: "danger",
      confirmLabel: "Remove",
    });
    return yes ? remove(ids) : false;
  }

  async function addToCampaign(kind: CampaignKind, campaignId: string, ids: string[]): Promise<boolean> {
    const r =
      kind === "call" ? await addLeadsToCallCampaignAction(campaignId, ids) : await addLeadsToEmailCampaignAction(campaignId, ids);
    if (!r.ok) {
      toast.error(r.message ?? "Could not add to the campaign.");
      return false;
    }
    const verb = kind === "call" ? "Added" : "Enrolled";
    const why = kind === "call" ? "already queued, do not call, or no phone" : "already enrolled, do not email, or no owner email";
    const href = `${kind === "call" ? "/calling" : "/email"}/${campaignId}`;
    // Nothing went in: say so plainly instead of a green "Added 0".
    (r.data.added > 0 ? toast.success : toast.info)(`${verb} ${r.data.added} to ${r.data.campaignName}`, {
      description: r.data.skipped ? `${r.data.skipped} skipped (${why}).` : undefined,
      action: { label: "Open campaign", onClick: () => router.push(href) },
    });
    router.refresh();
    return true;
  }

  async function createCallCampaign(name: string): Promise<string | null> {
    const r = await createCallCampaignForLeadsAction(name);
    if (!r.ok) {
      toast.error(r.message ?? "Could not create the campaign.");
      return null;
    }
    return r.data.id;
  }

  return (
    <div
      data-testid="leads-panel"
      className="flex min-h-0 min-w-0 flex-1 flex-col gap-6 overflow-hidden rounded-lg bg-surface-elevated p-4 shadow-[var(--shadow-elevated)] sm:p-6"
    >
      {dialog}
      <LeadMetrics metrics={liveMetrics} />

      <Tabs defaultValue="pipeline" className="flex min-h-0 min-w-0 flex-1 flex-col gap-6">
        <div className="flex w-full items-center gap-4">
          <TabsList variant="line" className="w-fit shrink-0">
            <TabsTrigger value="pipeline">Pipeline</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="pipeline" className="dossier-scroll mt-0 min-h-0 min-w-0 flex-1 overflow-auto">
          {leads.length > 0 ? (
            <LeadQueueTable
              leads={leads}
              campaigns={campaigns}
              onUpdateStatus={(id, status) =>
                void update(id, { status }, status === "skipped" ? "Lead skipped" : "Status updated")
              }
              onSaveNotes={(id, notes) => void update(id, { notes }, "Notes saved")}
              onRemove={(id) => void remove([id])}
              onBulkRemove={bulkRemove}
              onAddToCampaign={addToCampaign}
              onCreateCallCampaign={createCallCampaign}
            />
          ) : (
            <div className="flex flex-col items-center justify-center rounded-lg bg-surface py-16" data-testid="pipeline-empty">
              <p className="font-serif text-lg text-muted-foreground">Pipeline empty</p>
              <p className="mt-3 text-sm text-muted-foreground">
                Add businesses from{" "}
                <Link href="/lookup" className="text-primary underline">
                  Lookup
                </Link>
                .
              </p>
            </div>
          )}
        </TabsContent>

        <TabsContent value="history" className="dossier-scroll mt-0 min-h-0 min-w-0 flex-1 overflow-auto">
          <CallHistoryTable calls={history} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
