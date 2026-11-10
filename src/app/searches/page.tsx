import type { Metadata } from "next";
import Link from "next/link";
import { PlusIcon } from "lucide-react";
import { PageHeader, PageShell } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import { getDb } from "@/db/client";
import { listSearchJobs } from "@/db/repo/search-jobs";
import { googleConfigured } from "@/features/google/actions";
import { SearchesTable } from "@/features/searches/components/searches-table";
import { toJobJson } from "@/features/searches/format";
import { env } from "@/lib/env";
import { requireUser } from "@/lib/supabase/server";
import { YelpNotConfigured } from "@/features/searches/components/yelp-not-configured";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Searches" };

export default async function Page() {
  await requireUser();
  const jobs = await listSearchJobs(getDb(), 200);
  const yelp = !!env.YELP_API_KEY;
  const google = googleConfigured();
  const configured = yelp || google;
  return (
    <PageShell width="full">
      <PageHeader
        title="Searches"
        description="Google Maps and Yelp search jobs and what each one brought in. Trustpilot discovery lives in Lookup."
        actions={
          configured ? (
            <Button asChild size="sm">
              <Link href="/searches/new">
                <PlusIcon /> New search
              </Link>
            </Button>
          ) : undefined
        }
      />
      {!configured ? <YelpNotConfigured /> : null}
      {configured || jobs.length > 0 ? <SearchesTable jobs={jobs.map(toJobJson)} /> : null}
    </PageShell>
  );
}
