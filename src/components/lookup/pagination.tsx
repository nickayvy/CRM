"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { PAGE_SIZE, pageInfo } from "@/features/lookup/search-params";

type Props = { offset: number; total: number; onPage: (offset: number) => void };

const BTN =
  "inline-flex items-center justify-center rounded-md p-2 text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground disabled:pointer-events-none disabled:opacity-50";

/** Footer "1–50 of N" + chevrons + "Page X of Y" (gtm lookup page). Hidden when there are no rows. */
export function Pagination({ offset, total, onPage }: Props) {
  if (total <= 0) return null;
  const p = pageInfo(offset, total);
  return (
    <div className="flex shrink-0 items-center justify-between gap-4 border-t border-white/5 px-4 py-3" data-testid="pagination">
      <p className="text-sm text-muted-foreground tabular-nums">
        {p.start}–{p.end} of {total.toLocaleString("en-US")}
      </p>
      <div className="flex items-center gap-1">
        <button type="button" className={BTN} disabled={!p.hasPrev} aria-label="Previous page" onClick={() => onPage(Math.max(0, offset - PAGE_SIZE))}>
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="min-w-[4rem] text-center text-sm text-muted-foreground tabular-nums">
          Page {p.page} of {p.pages}
        </span>
        <button type="button" className={BTN} disabled={!p.hasNext} aria-label="Next page" onClick={() => onPage(offset + PAGE_SIZE)}>
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
