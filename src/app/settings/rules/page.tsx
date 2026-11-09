import type { Metadata } from "next";
import { PageHeader, PageShell } from "@/components/primitives";
import { getDb } from "@/db/client";
import { getRules } from "@/db/repo/rules";
import { RequalifyButton } from "@/features/rules/components/requalify-button";
import { RulesForm } from "@/features/rules/components/rules-form";
import { requireUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Qualification rules" };

export default async function Page() {
  await requireUser();
  const rules = await getRules(getDb());
  return (
    <PageShell width="narrow">
      <PageHeader
        title="Qualification rules"
        description="Rules applied to every business, Trustpilot and Yelp, the next time it is qualified."
        breadcrumbs={[{ label: "Settings", href: "/settings" }, { label: "Qualification rules" }]}
        actions={<RequalifyButton />}
      />
      <div className="rounded-lg bg-surface p-5 shadow-[var(--shadow-elevated)]">
        <RulesForm rules={rules} />
      </div>
    </PageShell>
  );
}
