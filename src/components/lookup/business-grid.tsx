"use client";

import { SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { LookupBusiness } from "@/features/lookup/types";
import { BusinessCard } from "./business-card";

type Props = {
  businesses: LookupBusiness[];
  onSelect: (id: string) => void;
  onClearFilters?: () => void;
  /** True when any filter is active: the empty state then offers "Clear all filters". */
  filtered?: boolean;
};

/** Card grid (gtm business-grid.tsx) with the filter and empty-database empty states. */
export function BusinessGrid({ businesses, onSelect, onClearFilters, filtered = false }: Props) {
  if (businesses.length === 0) {
    return (
      <div className="flex h-full min-h-48 items-center justify-center p-6" data-testid="grid-empty">
        <div className="flex flex-col items-center gap-3 text-center">
          <SearchX className="h-10 w-10 text-muted-foreground/50" aria-hidden />
          {filtered ? (
            <>
              <p className="text-sm text-muted-foreground">No businesses match your filters</p>
              {onClearFilters && (
                <Button variant="ghost" size="sm" onClick={onClearFilters}>
                  Clear all filters
                </Button>
              )}
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">No businesses yet</p>
              <p className="max-w-[280px] text-xs text-muted-foreground/80">
                Paste a Trustpilot URL or seed a category to start building your network.
              </p>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="dossier-scroll h-full overflow-y-auto">
      <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-2">
        {businesses.map((b) => (
          <BusinessCard key={b.id} business={b} onSelect={onSelect} />
        ))}
      </div>
    </div>
  );
}
