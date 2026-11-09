import type { Metadata } from "next";
import { PageHeader, PageSection, PageShell } from "@/components/primitives";
import { NewSearchForm } from "@/features/searches/components/new-search-form";
import { YelpNotConfigured } from "@/features/searches/components/yelp-not-configured";
import { env } from "@/lib/env";
import { requireUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "New search" };

export default async function Page() {
  await requireUser();
  const configured = !!env.YELP_API_KEY;
  return (
    <PageShell width="narrow">
      <PageHeader
        breadcrumbs={[{ label: "Searches", href: "/searches" }, { label: "New search" }]}
        title="New search"
        description="Pull businesses from Yelp by category and location. They are qualified as they arrive."
      />
      {configured ? (
        <PageSection className="rounded-lg bg-surface p-5 shadow-[var(--shadow-elevated)]">
          <NewSearchForm />
        </PageSection>
      ) : (
        <YelpNotConfigured />
      )}
    </PageShell>
  );
}
