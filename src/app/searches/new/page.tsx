import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, PageSection, PageShell } from "@/components/primitives";
import { googleConfigured } from "@/features/google/actions";
import { GoogleNotConfigured } from "@/features/google/components/google-not-configured";
import { GoogleSearchForm } from "@/features/google/components/google-search-form";
import { NewSearchForm } from "@/features/searches/components/new-search-form";
import { YelpNotConfigured } from "@/features/searches/components/yelp-not-configured";
import { env } from "@/lib/env";
import { requireUser } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";
// The start action runs the first 240 s of a Google job behind after() on this page's function.
export const maxDuration = 300;

export const metadata: Metadata = { title: "New search" };

type Source = "google" | "yelp";
type Props = { searchParams?: Promise<Record<string, string | string[] | undefined>> };

const DESCRIPTIONS: Record<Source, string> = {
  google:
    "Search Google Maps for a niche in every zip code of an area. The plan and its cost show before anything is spent; businesses are qualified as they arrive.",
  yelp: "Pull businesses from Yelp by category and location. They are qualified as they arrive.",
};

export default async function Page({ searchParams }: Props = {}) {
  await requireUser();
  const sp = (await searchParams) ?? {};
  const google = googleConfigured();
  const yelp = !!env.YELP_API_KEY;
  const asked = Array.isArray(sp.source) ? sp.source[0] : sp.source;
  // Google is the default when it is configured (or when Yelp is not either).
  const source: Source = asked === "google" || asked === "yelp" ? asked : google || !yelp ? "google" : "yelp";

  return (
    <PageShell width="narrow">
      <PageHeader
        breadcrumbs={[{ label: "Searches", href: "/searches" }, { label: "New search" }]}
        title="New search"
        description={DESCRIPTIONS[source]}
      />
      <nav aria-label="Search source" className="inline-flex w-fit gap-1 rounded-lg bg-surface p-1 shadow-[var(--shadow-elevated)]">
        {(["google", "yelp"] as const).map((s) => (
          <Link
            key={s}
            href={`/searches/new?source=${s}`}
            aria-current={s === source ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              s === source ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {s === "google" ? "Google Maps" : "Yelp"}
          </Link>
        ))}
      </nav>
      {source === "google" ? (
        google ? (
          <PageSection className="rounded-lg bg-surface p-5 shadow-[var(--shadow-elevated)]">
            <GoogleSearchForm />
          </PageSection>
        ) : (
          <GoogleNotConfigured />
        )
      ) : yelp ? (
        <PageSection className="rounded-lg bg-surface p-5 shadow-[var(--shadow-elevated)]">
          <NewSearchForm />
        </PageSection>
      ) : (
        <YelpNotConfigured />
      )}
    </PageShell>
  );
}
