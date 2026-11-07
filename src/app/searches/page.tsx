import type { Metadata } from "next";
import Link from "next/link";
import { PlusIcon } from "lucide-react";
import { PageHeader, PageShell } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import { getDb } from "@/db/client";
import { listSearchJobs } from "@/db/repo/search-jobs";
import { SearchesTable } from "@/features/searches/components/searches-table";
import { toJobJson } from "@/features/searches/format";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Searches" };

export default async function Page() {
  const jobs = await listSearchJobs(getDb(), 200);
  return (
    <PageShell width="full">
      <PageHeader
        title="Searches"
        description="Yelp search jobs and what each one brought in."
        actions={
          <Button asChild size="sm">
            <Link href="/searches/new">
              <PlusIcon /> New search
            </Link>
          </Button>
        }
      />
      <SearchesTable jobs={jobs.map(toJobJson)} />
    </PageShell>
  );
}
