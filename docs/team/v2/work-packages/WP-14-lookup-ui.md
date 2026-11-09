# WP-14: Lookup UI (network graph, grid, filters, dossier)

**Wave:** 2 (v2)
**Depends on:** WP-11, WP-12 (merged). Builds against WP-13's frozen action signatures (merged in the same wave; until then stub-compile against the architecture types).
**Owns files:** `src/app/lookup/**`, `src/app/api/lookup/**`, `src/features/lookup/**`, `src/components/lookup/**`, `tests/lookup*.test.ts(x)`, `package.json`/lockfile (`d3`, `@types/d3`)
**Delivers:** branch `wp-14-lookup-ui` / PR "WP-14: Lookup UI"

## Objective
A faithful port of gtm's Lookup screen onto our data: category bubbles, d3 network graph, filter panel, business grid with cards, pagination, the manual Trustpilot URL input plus a seed-category control, and the dossier modal with "Add to Lead List" and in-place navigation across similar companies.

## Context the engineer needs
- Read `docs/team/v2/gtm-inventory.md` §Lookup page in full, then port from gtm `app/(dashboard)/lookup/page.tsx`, `components/lookup/*`, `hooks/use-businesses.ts`, `hooks/use-graph-data.ts`. Keep class strings and layout proportions (30 % / flex-5 / flex-2).
- Data: architecture §Lookup consumes. Use server components for the first render and a small JSON route for the graph; filters live in the URL (`search, category, source, minReviews, minL30d, minRating, hasPhone, offset`), page size 50.
- Our businesses have both sources; show a tiny source chip (Yelp/Trustpilot) on cards and in the dossier; the filter panel gets a Source select (All/Trustpilot/Yelp).
- Dossier "Last synced" must use `lastScrapedAt` (or `updatedAt`) via `formatRelative`, never a placeholder. "Add to Lead List" uses your `addToLeadsAction(businessId)` → `addLead(db, requireUser().id, id)`; toast "Lead added" / "Already in your leads".
- Velocity badge tiers via `velocityTier`. Rejection reasons: show the v1 `ReasonChip`s in the dossier metrics area when `qualification !== 'qualified'`.
- When `!discoveryConfigured()`, the URL input and seed control render disabled with the message "Set FIRECRAWL_API_KEY to enable discovery"; the empty graph state says "No businesses yet" with that hint. Never render sample nodes.

## Scope
### In
- `/lookup` page (server shell + client islands), `GET /api/lookup/graph`.
- Components: `category-bubbles.tsx`, `network-graph.tsx` (d3 v7, exactly the gtm forces/radius/colors/labels/zoom/drag/hover), `graph-tooltip.tsx`, `filter-panel.tsx`, `business-grid.tsx`, `business-card.tsx`, `manual-scrape-input.tsx` (+ seed-category Select with the 22 categories → `seedCategoryAction`), `dossier-modal.tsx`, `grid-skeleton.tsx`, `pagination.tsx`.
- Server actions: `addToLeadsAction`.
- Tests (jsdom): filter panel writes URL params and resets offset; business card renders tiers and fallbacks; dossier renders sections and "NO DATA" tiles; graph utilities (radius clamp, top-50 subset, link trimming) as pure functions with unit tests.
### Out
- Leads page (WP-15). Firecrawl internals (WP-13).

## Acceptance criteria
AC-14.1 Browser (signed in, DB with ≥ 1 Trustpilot and ≥ 1 Yelp business you create via the actions or a one-off script in the worktree): `/lookup` shows bubbles (top 8), graph nodes colored by category with labels for big nodes, hover tooltip, click → dossier; grid cards with logo fallback chain, category badge, reviews, L30D + tier, rating; filters update the URL and the grid; pagination text correct.
AC-14.2 Dossier: header with real "Last synced"; overview; metrics box; "Add to Lead List" creates a lead (verify via `listLeads` in a script or the WP-15 page if merged) and second click says already added; external links tiles with "NO DATA"; similar list navigates in place.
AC-14.3 Paste a Trustpilot URL → `scrapeUrlAction` (with the fake or a real key) → toast and the grid refreshes; seed category select → action → toast with counts. Without a key both controls are disabled with the message.
AC-14.4 Empty DB state: graph empty state and grid empty state render, no sample data anywhere.
AC-14.5 375 px: panels stack (graph panel collapses to a toggleable section), no horizontal overflow. Screenshots.
AC-14.6 `npm test`, typecheck, lint, build exit 0.

## Delegation guidance
Juniors: graph tooltip, pagination, grid skeleton, pure-function tests, the seed-category select. Keep: d3 graph, dossier, URL-state filter panel, page composition.
