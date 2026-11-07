# WP-04: Businesses, searches, and rules UI

**Wave:** 3
**Depends on:** WP-02, WP-03 (merged)
**Owns files:** `src/app/businesses/**`, `src/app/searches/**`, `src/app/settings/**`, `src/app/api/searches/**`, `src/features/businesses/**`, `src/features/searches/**`, `src/features/rules/**`, `tests/ui-businesses*.test.ts(x)`, `tests/businesses-actions*.test.ts`
**Delivers:** branch `wp-04-businesses-ui` / PR "WP-04: Businesses UI"

## Objective
The core screens a list builder and sales rep live in: a fast filterable
businesses table, a complete business detail page with CRM editing and
activity timeline, the searches workflow with live progress, and the
rules editor with re-qualify. Built entirely from WP-02 primitives on top
of WP-03 repos and actions.

## Context the engineer needs
- Stack per README. Primitives: `src/components/primitives` and
  `src/lib/motion` (read their JSDoc and `/design`). Data: architecture
  §Interfaces for `src/db/repo/businesses.ts`, `search-jobs.ts`,
  `features/ingest/run.ts` and `actions.ts`, `repo/activities.ts`, `repo/rules.ts`.
- Labels: `src/lib/labels.ts`; reason labels: `REASON_LABELS` from `src/lib/qualify`.
- Conventions: pages `force-dynamic`; filters/sort/page live in URL search
  params so views are shareable; actions return `ActionResult`.

## Scope
### In
- `/businesses`: `PageShell width="full"`, header with counts
  (`StatGrid`: total, qualified, review, rejected via `countByQualification`),
  `FilterBar` (q, qualification multi, status multi, city, category, min
  score, has phone, has email) → URL params; `DataTable` columns: name
  (link), score (`ScoreRing` small), qualification badge + reason chips,
  status badge, category, city/state, rating · reviews, phone (formatted,
  `tel:` link), last contacted; server-side sort + pagination (25/50/100);
  row selection with `BulkActionBar` offering "Set status…", "Add tag…",
  "Mark do-not-call" (bulk actions implemented here; "Add to campaign" is
  added by WP-07 — leave a clearly marked extension point: a
  `bulkActions` prop array on your table wrapper component).
- `/businesses/[id]`: header (name, badges, score ring, Yelp link, enrich
  button, delete with confirm); two-column layout → stacks on mobile:
  left: "Why this result" panel (qualification, score breakdown is not
  required but reasons must be in plain English with `ReasonChip`), Yelp
  data (`KeyValueList`: categories, rating/reviews, price, address with
  map link `https://www.google.com/maps/search/?api=1&query=lat,lng`,
  phone, website, claimed, hours table, photos strip, transactions),
  source job link; right: CRM form (status select, owner name, owner
  email, tags input, do-not-call, do-not-email, next follow-up, notes)
  saved by `updateBusinessCrmAction` with `useActionState`; note form
  (`logNoteAction`) above a `Timeline` of activities (all types, newest
  first, agent/outcome shown).
- Status changes log an `activities(type:'status_change')` row with
  `metadata { from, to }`.
- `/searches`: table of jobs (location, categories, status badge,
  fetched/qualified/review/rejected, API calls, created, duration) and a
  "New search" button; `/searches/new`: form (term, location, categories
  comma-separated with hint of common aliases, radius, max results; a
  notice when `YELP_MODE=fixture` listing the three fixture slugs that
  return data) → `startSearchAction` → redirect to `/searches/[id]`;
  `/searches/[id]`: progress panel polling `GET /api/searches/[id]` every
  1.5 s while pending/running (`ProgressBar` fetched/maxResults,
  `AnimatedNumber` counts), then a "View businesses" link to
  `/businesses?sourceJobId=…` and the error if failed.
- `/settings` (links) and `/settings/rules`: form for every rule field,
  chain patterns as a textarea (one per line), save via
  `updateRulesAction`; "Re-qualify all" button with confirm → shows the
  returned counts in a toast.
- Tests: `tests/businesses-actions.test.ts` (CRM update action validates
  email, status change logs activity; note action requires body),
  `tests/ui-businesses.test.tsx` (render the table component with fake
  rows: columns present, reason chips rendered — jsdom).
### Out
- Campaign membership display and "Add to campaign" (WP-07). Dashboard (WP-07).

## Interfaces
### Consumes
WP-02 primitives; WP-03 repos and actions; WP-01 activities/rules repos.
### Produces
`src/features/businesses/actions.ts`: `updateBusinessCrmAction(id, prev, formData)`,
`logNoteAction(id, prev, formData)`, `bulkUpdateStatusAction(ids, status)`,
`bulkAddTagAction(ids, tag)`, `bulkDoNotCallAction(ids)`,
`deleteBusinessAction(id)`. `src/features/businesses/components/businesses-table.tsx`
exporting `BusinessesTable` with a `bulkActions?: BulkAction[]` prop where
`BulkAction = { label: string; icon?: ReactNode; onSelect: (ids: string[]) => void | Promise<void> }`.

## Acceptance criteria
AC-04.1 `/businesses` on seeded data shows the stat grid with numbers equal to `countByQualification`; filters change the URL and the rows (check `?qualification=rejected` shows only rejected rows with reason chips; `?q=roto` shows the Roto-Rooter row; `?minScore=80` only rows ≥ 80); sort by score desc reorders; page size change works. Screenshots.
AC-04.2 Detail page for "Roto-Rooter Plumbing & Water Cleanup" shows "Matches a known chain or franchise name" (or your `REASON_LABELS` text) and score; for a qualified business shows hours after clicking Enrich (fixture detail file) and `isClaimed`.
AC-04.3 CRM form: invalid owner email → `Enter a valid email` under the field, nothing saved; valid save persists after reload; changing status adds a `status_change` timeline entry; note form with empty body → `Body is required`; valid note appears at the top of the timeline.
AC-04.4 Bulk: select 3 rows → "Set status → contacted" updates all three (visible after refresh) and logs 3 activities.
AC-04.5 `/searches/new` with location "Houston, TX" and categories `plumbing` in fixture mode redirects to the job page, counts animate to 40 fetched / 31 qualified / 9 rejected, status becomes completed, "View businesses" shows 40 rows filtered by job.
AC-04.6 `/settings/rules`: set min rating 4.5, save, "Re-qualify all" → toast with counts; `/businesses` stat grid reflects the new counts.
AC-04.7 At 375 px: table scrolls horizontally inside its container only (page itself has no horizontal scroll), detail page stacks. Screenshots.
AC-04.8 `npm test`, typecheck, lint, build exit 0.

## Delegation guidance
Good junior tasks: `/settings/rules` form (pattern: your CRM form), the
searches list page, tests, the polling hook once you define its shape.
Keep: table wrapper + URL state, detail page layout, bulk actions.

## Reporting
Completion-report format from the senior brief.
