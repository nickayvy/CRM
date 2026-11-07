# WP-02: Design system — primitives and animation system

**Wave:** 2
**Depends on:** WP-01 (merged)
**Owns files:** `src/components/primitives/**`, `src/components/ui/**`, `src/lib/motion/**`, `src/app/design/**`, `src/app/globals.css`, `src/app/template.tsx`, `src/components/shell/**` (restyle only; keep nav items and the command-palette stub), `tests/primitives*.test.ts(x)`
**Delivers:** branch `wp-02-design-system` / PR "WP-02: Design system"

## Objective
Every later screen is composed from these pieces: page shells, headers,
stat cards, a capable data table, filter bar, badges, empty states, side
panels, key-value lists, timelines, and one animation system with tokens,
variants, and wrapper components. A `/design` route shows all of them with
sample data in light and dark mode. This package sets the visual language
of the product: dense, fast, keyboard-friendly, built for people who look
at it eight hours a day.

## Context the engineer needs
- Stack from WP-01: Next.js App Router, Tailwind v4, shadcn/ui (new-york,
  neutral), `motion` (`motion/react`), `next-themes`, lucide-react.
  Install TanStack Table (`@tanstack/react-table`) and `recharts` here.
  Test: `npm test`; typecheck: `npm run typecheck`; lint: `npm run lint`;
  build: `npm run build`; dev: `npm run dev` (http://localhost:3000).
- `src/lib/labels.ts` (WP-01) exports label/tone maps; `StatusBadge` consumes `tone`.
- Read architecture §Cross-cutting conventions and §Deliberately undecided (WP-02).
- Design direction: neutral palette with a single accent, 13–14 px body in
  tables, 4 px radius scale, generous but compact spacing, `tabular-nums`
  everywhere numbers appear, visible focus rings, hover states on rows.
  Dark mode first-class (tokens in `globals.css` for both schemes).

## Scope
### In
- `src/lib/motion/tokens.ts`: `durations` (`fast: 0.12`, `base: 0.2`,
  `slow: 0.32`), `easings` (`standard`, `enter`, `exit`, as cubic-bezier
  arrays), `springs` (`snappy`, `gentle`).
- `src/lib/motion/variants.ts`: `fadeIn`, `fadeInUp`, `scaleIn`,
  `listContainer` (stagger 0.03), `listItem`, `slideInRight`, `collapse`.
- `src/lib/motion/components.tsx`: `FadeIn`, `AnimatedList` + `AnimatedItem`
  (stagger, layout animations), `Presence` (AnimatePresence wrapper),
  `AnimatedNumber` (counts to value; formats via a `format` prop),
  `PageTransition` (used by `src/app/template.tsx`), `useReducedMotion`
  re-export; every component renders static when reduced motion is on.
- `src/components/primitives/`:
  - `page-shell.tsx`: `PageShell` (max width, padding, optional `width="full"` for tables), `PageHeader` (title, description, actions, breadcrumbs, optional `meta` badges), `PageSection` (title + children + optional actions).
  - `stat-card.tsx`: `StatCard` (label, value, `format`, delta with tone, icon, hint, optional `href`, loading skeleton), `StatGrid`.
  - `data-table.tsx`: generic `DataTable<T>` on TanStack Table: column defs, sorting (controlled or internal), row selection with checkbox column and a `BulkActionBar` slot rendering selected count + actions, sticky header, loading skeleton rows, `emptyState` prop, `onRowClick`, keyboard navigation (j/k or arrows move a focused row, Enter triggers `onRowClick`), `density` (`compact`|`comfortable`), pagination footer (`page`, `pageSize`, `total`, callbacks) and server-sort callbacks (`onSortChange`) so WP-04 can drive it from URL params.
  - `filter-bar.tsx`: `FilterBar` (search input with ⌘/ shortcut focus, `FilterSelect` chips, `FilterRange`, active-filter pills with clear, right-side slot).
  - `status-badge.tsx`: `StatusBadge` (tone → colors; `dot` variant), `ReasonChip` (for rejection reasons with tooltip label).
  - `empty-state.tsx`, `side-panel.tsx` (Sheet-based, title, description, footer actions), `key-value-list.tsx` (`KeyValueList`, `KeyValue`), `timeline.tsx` (`Timeline`, `TimelineItem` with icon by type, time, agent, body), `toolbar.tsx`, `kbd.tsx`, `score-ring.tsx` (0–100 radial), `progress-bar.tsx`, `confirm-dialog.tsx` (`useConfirm` hook + dialog).
  - `index.ts` barrel.
- Restyle `AppShell` with the new tokens; add collapsed-sidebar state (persisted in localStorage) and a keyboard shortcut `[` to toggle.
- `/design`: one page, sections per primitive with realistic sample data
  (businesses, campaigns), a reduced-motion toggle note, and light/dark via the shell toggle.
- Tests: `tests/primitives.test.tsx` with `@testing-library/react` (install) rendering `DataTable` (sorting, selection, empty state), `StatusBadge` tones, `AnimatedNumber` final value, `FilterBar` pill removal. Configure vitest for `jsdom` in that file (`// @vitest-environment jsdom`).
### Out
- Feature pages. Charts beyond installing recharts and exporting a thin `ChartCard` wrapper (WP-07 builds charts).

## Interfaces
### Consumes
`src/lib/labels.ts` tone type; shadcn `ui/*` components.
### Produces
The component APIs above, exported from `src/components/primitives` and
`src/lib/motion`. Document every prop with JSDoc; WP-04/05/06/07 build
against them without reading the implementation. Keep names exactly as
listed.

## Acceptance criteria
AC-02.1 `/design` renders every primitive and motion component listed above with sample data; no console errors or hydration warnings in dev (paste the dev-server log tail and a screenshot of the page in light and in dark mode).
AC-02.2 With the OS/browser `prefers-reduced-motion: reduce` emulated, elements on `/design` render immediately with no `transform`/`opacity` transitions (describe how you checked, e.g. computed styles or a `useReducedMotion` branch test).
AC-02.3 `DataTable`: sorting by a column header toggles asc/desc and calls `onSortChange`; selecting two rows shows the bulk bar with "2 selected"; empty data shows `emptyState`; arrow keys move focus and Enter calls `onRowClick` (tests in `tests/primitives.test.tsx`).
AC-02.4 `StatCard` with `format` renders `AnimatedNumber` that ends on the exact value; skeleton shown when `loading`.
AC-02.5 Shell: sidebar collapses with `[`, persists across reload; at 375 px nav is a drawer and `/design` has no horizontal scroll (screenshot).
AC-02.6 `npm test`, `npm run typecheck`, `npm run lint`, `npm run build` exit 0.

## Delegation guidance
Good junior tasks: `KeyValueList`, `Timeline`, `EmptyState`, `Kbd`,
`ProgressBar`, `ScoreRing` following the pattern of a primitive you wrote
first (e.g. `StatCard`); the `/design` showcase sections; the tests. Keep:
tokens/variants, `DataTable`, `FilterBar`, `AnimatedNumber`, shell restyle.

## Reporting
Use the completion-report format from the senior brief.
