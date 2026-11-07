import type { Metadata } from "next";
import { InfoIcon } from "lucide-react";
import { PageHeader, PageSection, PageShell } from "@/components/primitives";
import { NewSearchForm } from "@/features/searches/components/new-search-form";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "New search" };

const FIXTURE_SLUGS = [
  { slug: "plumbing-houston", location: "Houston, TX", category: "plumbing" },
  { slug: "hvac-dallas", location: "Dallas, TX", category: "hvac" },
  { slug: "dentists-austin", location: "Austin, TX", category: "dentists" },
];

export default function Page() {
  const fixture = env.YELP_MODE === "fixture";
  return (
    <PageShell width="narrow">
      <PageHeader
        breadcrumbs={[{ label: "Searches", href: "/searches" }, { label: "New search" }]}
        title="New search"
        description="Pull businesses from Yelp by category and location. They are qualified as they arrive."
      />
      {fixture ? (
        <div role="note" className="flex items-start gap-2 rounded-lg border bg-muted/40 p-3 text-sm" data-testid="fixture-notice">
          <InfoIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          <div className="flex flex-col gap-1">
            <span>
              <strong className="font-medium">Fixture mode:</strong> no Yelp API key is set, so searches read local
              fixtures. Only these return data (first category + city):
            </span>
            <ul className="flex flex-col gap-0.5">
              {FIXTURE_SLUGS.map((f) => (
                <li key={f.slug}>
                  <code className="rounded bg-muted px-1 font-mono text-xs">{f.slug}</code>{" "}
                  <span className="text-muted-foreground">
                    — location “{f.location}”, categories “{f.category}”
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
      <PageSection className="rounded-xl border bg-card p-4 text-card-foreground">
        <NewSearchForm />
      </PageSection>
    </PageShell>
  );
}
