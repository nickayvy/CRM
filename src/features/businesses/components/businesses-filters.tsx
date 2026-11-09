"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { FilterBar, FilterRange, FilterSelect, type ActiveFilter, type RangeValue } from "@/components/primitives";
import type { BusinessFilter } from "@/db/repo/businesses";
import type { BusinessSource, BusinessStatus, Qualification } from "@/db/schema";
import { QUALIFICATION_LABELS, STATUS_LABELS } from "@/lib/labels";
import { SOURCES, patchSearchParams } from "../search-params";

const SOURCE_LABELS: Record<BusinessSource, string> = { trustpilot: "Trustpilot", yelp: "Yelp" };

export type BusinessesFiltersProps = {
  filter: BusinessFilter;
  cities: { city: string; state: string; count: number }[];
  categories: { alias: string; count: number }[];
  qualificationCounts: Record<Qualification, number>;
  statusCounts: Record<BusinessStatus, number>;
  /** Rows per source (unfiltered), for the Source options. */
  sourceCounts?: Partial<Record<BusinessSource, number>>;
  /** Category alias → display title. */
  categoryTitles?: Record<string, string>;
  /** Right-aligned slot. */
  actions?: React.ReactNode;
};

const BOOL_OPTIONS = [
  { value: "1", label: "Yes" },
  { value: "0", label: "No" },
];

function boolValue(v: boolean | undefined): string[] {
  return v === undefined ? [] : [v ? "1" : "0"];
}

/** Filter bar for /businesses: every change is written to the URL (and resets to page 1). */
export function BusinessesFilters({
  filter,
  cities,
  categories,
  qualificationCounts,
  statusCounts,
  sourceCounts,
  categoryTitles,
  actions,
}: BusinessesFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = React.useTransition();

  const set = React.useCallback(
    (patch: Parameters<typeof patchSearchParams>[1]) => {
      const qs = patchSearchParams(searchParams?.toString() ?? "", patch);
      startTransition(() => router.push(`${pathname}${qs}`, { scroll: false }));
    },
    [router, pathname, searchParams],
  );

  const score: RangeValue = [filter.minScore ?? null, filter.maxScore ?? null];

  const active: ActiveFilter[] = [
    ...(filter.source
      ? [{ id: "source", label: `Source: ${SOURCE_LABELS[filter.source]}`, onRemove: () => set({ source: null }) }]
      : []),
    ...(filter.qualification ?? []).map((q) => ({
      id: `qualification:${q}`,
      label: `Qualification: ${QUALIFICATION_LABELS[q].label}`,
      onRemove: () => set({ qualification: (filter.qualification ?? []).filter((x) => x !== q) }),
    })),
    ...(filter.status ?? []).map((s) => ({
      id: `status:${s}`,
      label: `Status: ${STATUS_LABELS[s].label}`,
      onRemove: () => set({ status: (filter.status ?? []).filter((x) => x !== s) }),
    })),
    ...(filter.city ? [{ id: "city", label: `City: ${filter.city}`, onRemove: () => set({ city: null }) }] : []),
    ...(filter.state ? [{ id: "state", label: `State: ${filter.state}`, onRemove: () => set({ state: null }) }] : []),
    ...(filter.category
      ? [{ id: "category", label: `Category: ${categoryTitles?.[filter.category] ?? filter.category}`, onRemove: () => set({ category: null }) }]
      : []),
    ...(filter.minScore !== undefined || filter.maxScore !== undefined
      ? [
          {
            id: "score",
            label: `Score: ${filter.minScore ?? 0}–${filter.maxScore ?? 100}`,
            onRemove: () => set({ minScore: null, maxScore: null }),
          },
        ]
      : []),
    ...(filter.hasPhone !== undefined
      ? [{ id: "hasPhone", label: filter.hasPhone ? "Has phone" : "No phone", onRemove: () => set({ hasPhone: null }) }]
      : []),
    ...(filter.hasEmail !== undefined
      ? [{ id: "hasEmail", label: filter.hasEmail ? "Has email" : "No email", onRemove: () => set({ hasEmail: null }) }]
      : []),
    ...(filter.tag ? [{ id: "tag", label: `Tag: ${filter.tag}`, onRemove: () => set({ tag: null }) }] : []),
    ...(filter.sourceJobId
      ? [{ id: "sourceJobId", label: "From one search", onRemove: () => set({ sourceJobId: null }) }]
      : []),
  ];

  return (
    <FilterBar
      search={{
        value: filter.q ?? "",
        onChange: (v) => set({ q: v.trim() || null }),
        placeholder: "Search name, phone or domain…",
        "aria-label": "Search businesses",
      }}
      activeFilters={active}
      onClearAll={() =>
        set({
          q: null,
          source: null,
          qualification: null,
          status: null,
          city: null,
          state: null,
          category: null,
          minScore: null,
          maxScore: null,
          hasPhone: null,
          hasEmail: null,
          tag: null,
          sourceJobId: null,
        })
      }
      actions={actions}
    >
      <FilterSelect
        label="Source"
        multiple={false}
        options={SOURCES.map((s) => ({ value: s, label: SOURCE_LABELS[s], count: sourceCounts?.[s] }))}
        value={filter.source ? [filter.source] : []}
        onChange={(v) => set({ source: v[0] ?? null })}
      />
      <FilterSelect
        label="Qualification"
        options={(Object.keys(QUALIFICATION_LABELS) as Qualification[]).map((q) => ({
          value: q,
          label: QUALIFICATION_LABELS[q].label,
          count: qualificationCounts[q],
        }))}
        value={filter.qualification ?? []}
        onChange={(v) => set({ qualification: v })}
      />
      <FilterSelect
        label="Status"
        options={(Object.keys(STATUS_LABELS) as BusinessStatus[]).map((s) => ({
          value: s,
          label: STATUS_LABELS[s].label,
          count: statusCounts[s],
        }))}
        value={filter.status ?? []}
        onChange={(v) => set({ status: v })}
      />
      <FilterSelect
        label="City"
        multiple={false}
        searchable
        options={cities.map((c) => ({ value: c.city, label: [c.city, c.state].filter(Boolean).join(", "), count: c.count }))}
        value={filter.city ? [filter.city] : []}
        onChange={(v) => set({ city: v[0] ?? null })}
      />
      <FilterSelect
        label="Category"
        multiple={false}
        searchable
        options={categories.map((c) => ({ value: c.alias, label: categoryTitles?.[c.alias] ?? c.alias, count: c.count }))}
        value={filter.category ? [filter.category] : []}
        onChange={(v) => set({ category: v[0] ?? null })}
      />
      <FilterRange
        label="Score"
        min={0}
        max={100}
        step={5}
        value={score}
        onChange={([min, max]) => set({ minScore: min, maxScore: max })}
      />
      <FilterSelect
        label="Has phone"
        multiple={false}
        options={BOOL_OPTIONS}
        value={boolValue(filter.hasPhone)}
        onChange={(v) => set({ hasPhone: v[0] ?? null })}
      />
      <FilterSelect
        label="Has email"
        multiple={false}
        options={BOOL_OPTIONS}
        value={boolValue(filter.hasEmail)}
        onChange={(v) => set({ hasEmail: v[0] ?? null })}
      />
    </FilterBar>
  );
}
