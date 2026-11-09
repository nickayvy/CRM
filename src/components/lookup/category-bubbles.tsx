"use client";

import { useMemo } from "react";
import type { GraphNode } from "@/db/repo/discovery";
import { MAX_BUBBLES, categoryColor, categoryCounts, categoryLabel } from "@/features/lookup/graph-utils";

type Props = {
  nodes: Pick<GraphNode, "category">[];
  /** Canonical order shared with the graph so colors match. */
  order: readonly string[];
  selectedCategory: string | null;
  onCategoryClick: (category: string | null) => void;
  className?: string;
};

/** "All" + the top 8 categories by node count (gtm category-bubbles.tsx); clicking the selected one clears it. */
export function CategoryBubbles({ nodes, order, selectedCategory, onCategoryClick, className = "" }: Props) {
  const top = useMemo(() => categoryCounts(nodes).slice(0, MAX_BUBBLES), [nodes]);
  if (top.length === 0) return null;
  return (
    <div className={`flex flex-col gap-1.5 px-4 py-3 ${className}`} data-testid="category-bubbles">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onCategoryClick(null)}
          aria-pressed={selectedCategory === null}
          className={`rounded-full px-2 py-1 text-[10px] transition-colors ${
            selectedCategory === null ? "bg-white/20 text-slate-200" : "bg-white/5 text-slate-500 hover:bg-white/10 hover:text-slate-400"
          }`}
        >
          All
        </button>
        {top.map(({ category, count }) => {
          const color = categoryColor(category, order);
          const selected = selectedCategory === category;
          const label = categoryLabel(category);
          return (
            <button
              key={category}
              type="button"
              aria-pressed={selected}
              onClick={() => onCategoryClick(selected ? null : category)}
              className="flex items-center gap-1.5 rounded-full border px-1.5 py-0.5 transition-colors focus:ring-1 focus:ring-white/30 focus:outline-none"
              style={{ borderColor: selected ? color : "transparent", backgroundColor: selected ? `${color}20` : "transparent" }}
              title={`${label}: ${count} business${count !== 1 ? "es" : ""}. Click to filter.`}
            >
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color, opacity: 0.9 }} />
              <span className="text-[10px] text-slate-400">
                {label} <span className="text-slate-500 tabular-nums">({count})</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
