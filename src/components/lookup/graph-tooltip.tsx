"use client";

import type { GraphNode } from "@/db/repo/discovery";

/** Hover card for a graph node, fixed at (x+12, y-12) (gtm graph-tooltip.tsx). */
export function GraphTooltip({ node, x, y }: { node: GraphNode | null; x: number; y: number }) {
  if (!node) return null;
  return (
    <div
      role="tooltip"
      className="pointer-events-none fixed z-50 rounded-lg bg-surface-elevated px-3 py-2 shadow-[var(--shadow-floating)]"
      style={{ left: x + 12, top: y - 12 }}
    >
      <p className="text-sm font-medium">{node.name}</p>
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="tabular-nums">{node.totalReviews.toLocaleString("en-US")} reviews</span>
        {node.rating !== null && <span className="tabular-nums">{node.rating.toFixed(1)}&#9733;</span>}
      </div>
    </div>
  );
}
