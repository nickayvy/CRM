"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { RotateCcw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { categoryLabel } from "@/features/lookup/graph-utils";
import { type FilterKey, hrefFor, patchLookupParams } from "@/features/lookup/search-params";

type Props = { categories: { alias: string; count: number }[]; titles?: Record<string, string> };

const ALL = "__all__";

/**
 * "Refine" panel (gtm filter-panel.tsx). Every control writes its URL param
 * and drops `offset`; search is debounced 300 ms, sliders commit on release.
 */
export function FilterPanel({ categories, titles }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const qs = searchParams.toString();

  const category = searchParams.get("category") ?? "";
  const source = searchParams.get("source") ?? "";
  const minReviews = Number(searchParams.get("minReviews") ?? "0") || 0;
  const minL30d = Number(searchParams.get("minL30d") ?? "0") || 0;
  const minRating = searchParams.get("minRating") ?? "";
  const hasPhone = searchParams.get("hasPhone") === "true";
  const urlSearch = searchParams.get("search") ?? "";

  const [searchValue, setSearchValue] = useState(urlSearch);
  const [localMinReviews, setLocalMinReviews] = useState(minReviews);
  const [localMinL30d, setLocalMinL30d] = useState(minL30d);
  // Re-sync local state when the URL changes from elsewhere (Clear, bubbles, back button).
  const [seen, setSeen] = useState({ urlSearch, minReviews, minL30d });
  if (seen.urlSearch !== urlSearch || seen.minReviews !== minReviews || seen.minL30d !== minL30d) {
    setSeen({ urlSearch, minReviews, minL30d });
    if (seen.urlSearch !== urlSearch) setSearchValue(urlSearch);
    setLocalMinReviews(minReviews);
    setLocalMinL30d(minL30d);
  }

  const update = useCallback(
    (key: FilterKey, value: string) => {
      const next = patchLookupParams(qs, { [key]: value });
      if (next === qs) return;
      router.push(hrefFor(pathname, next), { scroll: false });
    },
    [qs, router, pathname],
  );

  const updateRef = useRef(update);
  useEffect(() => {
    updateRef.current = update;
  }, [update]);

  const urlSearchRef = useRef(urlSearch);
  useEffect(() => {
    urlSearchRef.current = urlSearch;
  }, [urlSearch]);

  useEffect(() => {
    if (searchValue.trim() === urlSearchRef.current.trim()) return;
    const t = setTimeout(() => updateRef.current("search", searchValue.trim()), 300);
    return () => clearTimeout(t);
  }, [searchValue]);

  const clearAll = () => {
    setSearchValue("");
    router.push(pathname, { scroll: false });
  };

  return (
    <div className="flex h-full flex-col gap-6 p-6" data-testid="filter-panel">
      <div className="flex items-center justify-between">
        <h3 className="text-xs text-muted-foreground">Refine</h3>
        <Button variant="ghost" size="xs" onClick={clearAll} className="text-xs text-muted-foreground">
          <RotateCcw className="mr-1 h-3 w-3" />
          Clear
        </Button>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="lookup-search" className="text-xs text-muted-foreground">
          Search
        </label>
        <div className="relative">
          <Search className="absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            id="lookup-search"
            placeholder="Business name..."
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            className="h-8 pl-8 text-xs"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <span id="lookup-source-label" className="text-xs text-muted-foreground">
          Source
        </span>
        <Select value={source || ALL} onValueChange={(v) => update("source", v === ALL ? "" : v)}>
          <SelectTrigger className="h-8 w-full text-xs" aria-labelledby="lookup-source-label">
            <SelectValue placeholder="All sources" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All sources</SelectItem>
            <SelectItem value="trustpilot">Trustpilot</SelectItem>
            <SelectItem value="yelp">Yelp</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <span id="lookup-category-label" className="text-xs text-muted-foreground">
          Category
        </span>
        <Select value={category || ALL} onValueChange={(v) => update("category", v === ALL ? "" : v)}>
          <SelectTrigger className="h-8 w-full text-xs" aria-labelledby="lookup-category-label">
            <SelectValue placeholder="All categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All categories</SelectItem>
            {category && !categories.some((c) => c.alias === category) && (
              <SelectItem value={category}>{categoryLabel(category, titles)}</SelectItem>
            )}
            {categories.map((c) => (
              <SelectItem key={c.alias} value={c.alias}>
                {categoryLabel(c.alias, titles)} ({c.count})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Min reviews</span>
          <span className="text-xs text-muted-foreground tabular-nums">{localMinReviews.toLocaleString("en-US")}</span>
        </div>
        <Slider
          aria-label="Min reviews"
          min={0}
          max={10000}
          step={50}
          value={[localMinReviews]}
          onValueChange={([v]) => setLocalMinReviews(v)}
          onValueCommit={([v]) => update("minReviews", String(v))}
        />
      </div>

      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Min L30D</span>
          <span className="text-xs text-muted-foreground tabular-nums">{localMinL30d}</span>
        </div>
        <Slider
          aria-label="Min L30D"
          min={0}
          max={500}
          step={5}
          value={[localMinL30d]}
          onValueChange={([v]) => setLocalMinL30d(v)}
          onValueCommit={([v]) => update("minL30d", String(v))}
        />
      </div>

      <div className="space-y-1.5">
        <span id="lookup-rating-label" className="text-xs text-muted-foreground">
          Min rating
        </span>
        <Select value={minRating || ALL} onValueChange={(v) => update("minRating", v === ALL ? "" : v)}>
          <SelectTrigger className="h-8 w-full text-xs" aria-labelledby="lookup-rating-label">
            <SelectValue placeholder="Any rating" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Any rating</SelectItem>
            {[1, 2, 3, 4, 5].map((r) => (
              <SelectItem key={r} value={String(r)}>
                {r}+ stars
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center gap-2">
        <Checkbox id="has-phone" checked={hasPhone} onCheckedChange={(c) => update("hasPhone", c === true ? "true" : "")} />
        <label htmlFor="has-phone" className="cursor-pointer text-xs text-muted-foreground">
          Has phone number
        </label>
      </div>
    </div>
  );
}
