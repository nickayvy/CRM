import { Suspense } from "react";
import type { Metadata } from "next";
import { GridIsland } from "@/components/lookup/grid-island";
import { GridSkeleton } from "@/components/lookup/grid-skeleton";
import { LookupView } from "@/components/lookup/lookup-view";
import { getDb } from "@/db/client";
import { listCategories } from "@/db/repo/businesses";
import { loadGraph, loadGrid } from "@/features/lookup/data";
import { discoveryConfigured } from "@/features/lookup/discovery-bridge";
import { type LookupQuery, type RawSearchParams, parseLookupQuery } from "@/features/lookup/search-params";
import { requireUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Lookup" };

type Props = { searchParams: Promise<RawSearchParams> };

export default async function LookupPage({ searchParams }: Props) {
  await requireUser();
  const sp = await searchParams;
  const query = parseLookupQuery(sp);
  const db = getDb();
  const [graph, categories, enabled] = await Promise.all([loadGraph(db), listCategories(db), Promise.resolve(discoveryConfigured())]);
  const key = JSON.stringify(query);
  return (
    <LookupView graph={graph} categories={categories} discoveryEnabled={enabled}>
      <Suspense key={key} fallback={<GridSkeleton />}>
        <GridSection query={query} />
      </Suspense>
    </LookupView>
  );
}

async function GridSection({ query }: { query: LookupQuery }) {
  const { rows, total } = await loadGrid(getDb(), query);
  return <GridIsland rows={rows} total={total} offset={query.offset} filtered={Object.keys(query.filter).length > 0} />;
}
