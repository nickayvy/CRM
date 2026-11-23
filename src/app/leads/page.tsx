import type { Metadata } from "next";
import { LeadsPanel } from "@/components/leads/leads-panel";
import { getDb } from "@/db/client";
import { loadLeadsView } from "@/features/leads/data";
import { LEAD_TAB_FILTERS, type LeadTab } from "@/features/leads/types";
import { requireUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Leads" };

type Props = { searchParams?: Promise<Record<string, string | string[] | undefined>> };

/** `?status=queued|contacted|success|failed` opens the pipeline on that tab, so other pages can link to a slice of it. */
export default async function LeadsPage({ searchParams }: Props = {}) {
  const user = await requireUser();
  const raw = (await searchParams)?.status;
  const wanted = Array.isArray(raw) ? raw[0] : raw;
  const initialTab: LeadTab = LEAD_TAB_FILTERS.find((t) => t.value === wanted)?.value ?? "all";
  const view = await loadLeadsView(getDb(), user.id);
  return (
    <div className="flex h-full min-h-[560px] min-w-0 flex-col p-2 sm:p-4">
      <h1 className="sr-only">Leads</h1>
      <LeadsPanel leads={view.leads} metrics={view.metrics} history={view.history} campaigns={view.campaigns} initialTab={initialTab} />
    </div>
  );
}
