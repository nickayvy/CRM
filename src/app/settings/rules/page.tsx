import type { Metadata } from "next";
import { PageHeader, PageShell } from "@/components/primitives";
import { getDb } from "@/db/client";
import { getRules } from "@/db/repo/rules";
import { RequalifyButton } from "@/features/rules/components/requalify-button";
import { RulesForm } from "@/features/rules/components/rules-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Qualification rules" };

export default async function Page() {
  const rules = await getRules(getDb());
  return (
    <PageShell width="narrow">
      <PageHeader
        title="Qualification rules"
        description="Rules applied to every business the next time it is qualified."
        breadcrumbs={[{ label: "Settings", href: "/settings" }, { label: "Qualification rules" }]}
        actions={<RequalifyButton />}
      />
      <RulesForm rules={rules} />
    </PageShell>
  );
}
