import type { Metadata } from "next";
import { LeadsPanel } from "@/components/leads/leads-panel";
import { getDb } from "@/db/client";
import { loadLeadsView } from "@/features/leads/data";
import { requireUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Leads" };

export default async function LeadsPage() {
  const user = await requireUser();
  const view = await loadLeadsView(getDb(), user.id);
  return (
    <div className="flex h-full min-h-[560px] min-w-0 flex-col p-2 sm:p-4">
      <h1 className="sr-only">Leads</h1>
      <LeadsPanel leads={view.leads} metrics={view.metrics} history={view.history} campaigns={view.campaigns} />
    </div>
  );
}
