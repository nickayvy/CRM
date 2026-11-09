import type { Metadata } from "next";
import Link from "next/link";
import { LayoutGridIcon, SearchIcon } from "lucide-react";
import { PageHeader, PageShell, StatCard, StatGrid } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import { getDb } from "@/db/client";
import {
  countByQualification,
  countByStatus,
  listBusinesses,
  listCategories,
  listCities,
} from "@/db/repo/businesses";
import { listCallCampaigns } from "@/db/repo/call-campaigns";
import { listEmailCampaigns } from "@/db/repo/email-campaigns";
import { getSearchJob } from "@/db/repo/search-jobs";
import { BusinessesFilters } from "@/features/businesses/components/businesses-filters";
import { BusinessesTable } from "@/features/businesses/components/businesses-table";
import { parseBusinessesQuery, patchSearchParams, type RawSearchParams } from "@/features/businesses/search-params";
import { toBusinessRow } from "@/features/businesses/types";
import { countBusinessesBySource } from "@/features/dashboard/data";
import { loadCategoryTitles } from "@/features/lookup/data";
import { requireUser } from "@/lib/supabase/server";
import type { CampaignStatus } from "@/db/schema";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Businesses" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

function toQueryString(sp: RawSearchParams): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (Array.isArray(v)) v.forEach((x) => u.append(k, x));
    else if (v !== undefined) u.set(k, v);
  }
  return u.toString();
}

export default async function Page({ searchParams }: Props) {
  await requireUser();
  const sp = await searchParams;
  const { filter, sort, page, pageSize } = parseBusinessesQuery(sp);
  const db = getDb();
  // The stat grid counts every qualification within the other active filters.
  const { qualification: _qualification, ...filterWithoutQualification } = filter;
  void _qualification;
  const [
    { rows, total },
    qualCounts,
    statusCounts,
    cities,
    categories,
    job,
    callCampaigns,
    emailCampaigns,
    sourceCounts,
    categoryTitles,
  ] = await Promise.all([
    listBusinesses(db, filter, { sort, limit: pageSize, offset: (page - 1) * pageSize }),
    countByQualification(db, filterWithoutQualification),
    countByStatus(db),
    listCities(db),
    listCategories(db),
    filter.sourceJobId ? getSearchJob(db, filter.sourceJobId) : Promise.resolve(null),
    listCallCampaigns(db),
    listEmailCampaigns(db),
    countBusinessesBySource(db),
    loadCategoryTitles(db),
  ]);
  // Targets for the "Add to … campaign" bulk actions: every campaign that is not completed.
  const toTarget = (c: { id: string; name: string; status: CampaignStatus }) => ({ id: c.id, name: c.name, status: c.status });
  const campaignTargets = {
    call: callCampaigns.filter((c) => c.status !== "completed").map(toTarget),
    email: emailCampaigns.filter((c) => c.status !== "completed").map(toTarget),
  };
  const all = qualCounts.qualified + qualCounts.review + qualCounts.rejected;
  const qs = toQueryString(sp);
  const qualHref = (q: string | null) => `/businesses${patchSearchParams(qs, { qualification: q })}`;

  return (
    <PageShell width="full">
      <PageHeader
        title="Businesses"
        description={
          job
            ? `From the search “${job.categoryAliases.join(", ")}” in ${job.location}.`
            : "Every business discovered on Trustpilot or pulled from Yelp, qualified by your rules."
        }
        actions={
          <>
            <Button asChild size="sm" variant="outline">
              <Link href="/lookup">
                <LayoutGridIcon /> Lookup
              </Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/searches/new">
                <SearchIcon /> Yelp search
              </Link>
            </Button>
          </>
        }
      />
      <StatGrid columns={4}>
        <StatCard label="Total" value={all} href={qualHref(null)} />
        <StatCard label="Qualified" value={qualCounts.qualified} href={qualHref("qualified")} />
        <StatCard label="Review" value={qualCounts.review} href={qualHref("review")} />
        <StatCard label="Rejected" value={qualCounts.rejected} href={qualHref("rejected")} />
      </StatGrid>
      <BusinessesFilters
        filter={filter}
        cities={cities}
        categories={categories}
        qualificationCounts={qualCounts}
        statusCounts={statusCounts}
        sourceCounts={Object.fromEntries(sourceCounts.map((s) => [s.source, s.count]))}
        categoryTitles={categoryTitles}
      />
      <BusinessesTable
        rows={rows.map(toBusinessRow)}
        total={total}
        page={page}
        pageSize={pageSize}
        sort={{ id: sort.field, desc: sort.dir === "desc" }}
        campaignTargets={campaignTargets}
      />
    </PageShell>
  );
}
