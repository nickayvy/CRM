// Pure helpers for the Lookup network graph and category bubbles (ported from
// gtm components/lookup/network-graph.tsx, category-bubbles.tsx and the
// lookup page's top-50 subset).
import type { GraphNode } from "@/db/repo/discovery";
import type { GraphLink } from "./types";

/** gtm CATEGORY_COLORS; index 5 (gray) doubles as the uncategorized color. */
export const CATEGORY_COLORS = ["#6b8cb5", "#b57070", "#7a9e7a", "#8e7a9e", "#b59a6b", "#6b6b6b"] as const;
export const UNCATEGORIZED_COLOR = CATEGORY_COLORS[5];
export const ACCENT_COLOR = "#5a8fc9";
export const MAX_GRAPH_NODES = 50;
export const MAX_BUBBLES = 8;
export const LABEL_MIN_RADIUS = 10;

/** `clamp(sqrt(reviews) * 0.5 + 5, 4, 30)`. */
export function nodeRadius(totalReviews: number): number {
  const r = Math.sqrt(Math.max(0, totalReviews)) * 0.5 + 5;
  return Math.min(Math.max(r, 4), 30);
}

/** Labels are drawn only for nodes with radius ≥ 10. */
export function hasLabel(totalReviews: number): boolean {
  return nodeRadius(totalReviews) >= LABEL_MIN_RADIUS;
}

/** Names longer than 16 chars become the first 14 + "...". */
export function truncateLabel(name: string): string {
  return name.length > 16 ? `${name.slice(0, 14)}...` : name;
}

/** Non-null categories by node count desc, then name: the canonical color order. */
export function categoryCounts(nodes: Pick<GraphNode, "category">[]): { category: string; count: number }[] {
  const by = new Map<string, number>();
  for (const n of nodes) if (n.category) by.set(n.category, (by.get(n.category) ?? 0) + 1);
  return [...by.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));
}

export function categoryOrder(nodes: Pick<GraphNode, "category">[]): string[] {
  return categoryCounts(nodes).map((c) => c.category);
}

/** Color for a category by its position in `order`; unknown/null → gray. */
export function categoryColor(category: string | null, order: readonly string[]): string {
  if (!category) return UNCATEGORIZED_COLOR;
  const i = order.indexOf(category);
  return i >= 0 ? CATEGORY_COLORS[i % CATEGORY_COLORS.length] : UNCATEGORIZED_COLOR;
}

/**
 * Nodes in `category` (all when null), top `max` by total reviews, and only
 * the links whose two ends both survived. `total` counts the pre-cap nodes.
 */
export function graphSubset(
  nodes: GraphNode[],
  links: GraphLink[],
  opts: { category?: string | null; max?: number } = {},
): { nodes: GraphNode[]; links: GraphLink[]; total: number } {
  const max = opts.max ?? MAX_GRAPH_NODES;
  const inCategory = opts.category ? nodes.filter((n) => n.category === opts.category) : nodes;
  const capped = [...inCategory]
    .sort((a, b) => b.totalReviews - a.totalReviews || a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    .slice(0, max);
  return { nodes: capped, links: trimLinks(links, capped), total: inCategory.length };
}

/** Links whose source and target are both in `nodes`, without duplicates or self-loops. */
export function trimLinks(links: GraphLink[], nodes: Pick<GraphNode, "id">[]): GraphLink[] {
  const ids = new Set(nodes.map((n) => n.id));
  const seen = new Set<string>();
  const out: GraphLink[] = [];
  for (const l of links) {
    if (l.source === l.target || !ids.has(l.source) || !ids.has(l.target)) continue;
    const key = `${l.source}>${l.target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ source: l.source, target: l.target });
  }
  return out;
}

/** "home_services" / "home-services" / "plumbing" → "Home Services" / "Plumbing"; mixed-case titles pass through. */
export function categoryLabel(category: string): string {
  if (category !== category.toLowerCase()) return category;
  return category
    .split(/[_-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
