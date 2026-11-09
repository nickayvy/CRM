"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { hrefFor, patchLookupParams } from "@/features/lookup/search-params";
import type { LookupBusiness } from "@/features/lookup/types";
import { BusinessGrid } from "./business-grid";
import { useLookupSelect } from "./lookup-view";
import { Pagination } from "./pagination";

type Props = { rows: LookupBusiness[]; total: number; offset: number; filtered: boolean };

/** Grid body + pagination footer for one server-loaded page. */
export function GridIsland({ rows, total, offset, filtered }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const qs = useSearchParams().toString();
  const select = useLookupSelect();
  const go = (query: string) => router.push(hrefFor(pathname, query), { scroll: false });
  return (
    <>
      <div className="min-h-0 flex-1 overflow-hidden">
        <BusinessGrid businesses={rows} onSelect={select} filtered={filtered} onClearFilters={() => go("")} />
      </div>
      <Pagination offset={offset} total={total} onPage={(o) => go(patchLookupParams(qs, { offset: o > 0 ? String(o) : null }))} />
    </>
  );
}
