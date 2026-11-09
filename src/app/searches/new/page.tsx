import type { Metadata } from "next";
import { PageHeader, PageSection, PageShell } from "@/components/primitives";
import { NewSearchForm } from "@/features/searches/components/new-search-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "New search" };

export default function Page() {
  return (
    <PageShell width="narrow">
      <PageHeader
        breadcrumbs={[{ label: "Searches", href: "/searches" }, { label: "New search" }]}
        title="New search"
        description="Pull businesses from Yelp by category and location. They are qualified as they arrive."
      />
      <PageSection className="rounded-xl border bg-card p-4 text-card-foreground">
        <NewSearchForm />
      </PageSection>
    </PageShell>
  );
}
