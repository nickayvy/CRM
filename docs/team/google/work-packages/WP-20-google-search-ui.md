# WP-20: Google Maps search UI, actions, cron resume, docs

**Wave:** 2
**Depends on:** WP-18 and WP-19 merged
**Owns files:**
- `src/features/google/**` except `run.ts` (new: `actions.ts`,
  `server-actions.ts`, components)
- `src/features/searches/**`, `src/app/searches/**`, `src/app/api/searches/**`
- `src/features/lookup/**`, `src/components/lookup/**`
- `src/app/settings/page.tsx`
- `src/app/api/cron/daily/route.ts`
- `src/lib/labels.ts`, `src/components/command-palette.tsx` (only to add the
  entry point)
- `.env.example`, `docs/deploy.md`, `README.md`
- tests for the files above (new `tests/google-ui.test.tsx`,
  `tests/google-actions.test.ts`; existing `tests/lookup-*.test.tsx`,
  `tests/routes-render.test.tsx`, cron tests)

**Do not edit:** `src/lib/google-places/**` (except `zips.ts`, see scope item
9), `src/features/google/run.ts`, `src/db/**`, `src/lib/qualify/**`,
`src/lib/web/**`, `src/lib/firecrawl/**`. If one of them needs a change,
report it under "Needs PM decision".

**Delivers:** branch `wp-20-google-search-ui`

## Objective
A signed-in user can plan, start, watch, continue and re-run a Google Maps
search from the app, and find the resulting businesses in Lookup with their
Google details. The daily cron finishes jobs nobody is watching.

## Context the engineer needs
- Stack and commands: Next.js 16.4.5 (read `AGENTS.md` and the docs in
  `node_modules/next/dist/docs/` before writing actions or routes), React 19,
  Tailwind 4, shadcn components in `src/components/ui`, primitives in
  `src/components/primitives`. `export PATH=/opt/node24/bin:$PATH`; `npm ci`;
  `npm test`; `npm run typecheck`; `npm run lint`; `npm run build`.
- What WP-18 gave you (see `docs/team/google/architecture.md`, Interfaces):
  `planGoogleSearch`, `NICHES`, limits, `PRICE_PER_1000_REQUESTS_USD`,
  `createPlacesClient`, `GOOGLE_NOT_CONFIGURED`, `createGoogleJob`,
  `listUnfinishedGoogleJobs`, `getUsage`, `runGoogleJobSlice`,
  `SliceOutcome`, the new `search_jobs` columns (`source`, `plan`,
  `queriesTotal`, `queriesDone`, `newCount`, `matchedCount`,
  `leaseExpiresAt`), `businesses.googlePlaceId` / `googleMapsUrl`,
  `env.GOOGLE_PLACES_API_KEY`, `env.GOOGLE_PLACES_MONTHLY_REQUEST_CAP`.
- What WP-19 gave you: `createPageSource`, and `enrichPendingLinks` that runs
  fast without Firecrawl.
- Patterns to copy: `src/features/ingest/actions.ts` (`startSearchAction`:
  zod parse, `after()` background run), `src/features/searches/**` (form, job
  progress, polling hook, table), `src/features/discovery/server-actions.ts`
  (`after()` with a wall-clock budget), `src/components/lookup/manual-scrape-input.tsx`
  (the discovery strip), `src/components/lookup/dossier-modal.tsx` (link
  tiles), `src/features/searches/components/yelp-not-configured.tsx`.
- `/searches` is not in the top navigation today; it is reached from the
  command palette and the businesses pages. Lookup is the home screen.

## Scope
### In
1. **Actions** (`src/features/google/server-actions.ts`, re-exported from
   `actions.ts` next to a synchronous `googleConfigured()`), signatures as in
   the architecture. All call `requireUser()`.
   - `previewGoogleSearchAction`: runs `planGoogleSearch` (with the geocoder
     when a geocoding key exists), returns the numbers plus this month's
     usage and the cap. Makes no Places request.
   - `startGoogleSearchAction`: validates, refuses without a key, refuses when
     the cap is already reached, creates the job, then in `after()` loops
     `runGoogleJobSlice` until 240 s have passed or the outcome is not `more`.
     When the job completes inside that task and time remains, it drains link
     enrichment for the job's rows with `enrichPendingLinks` through
     `createPageSource` in the remaining budget.
   - `continueGoogleSearchAction`: same loop for an existing unfinished job;
     returns `queued` at once; a held lease simply makes the slice `busy`.
   - `rerunGoogleSearchAction`: new job from a finished job's plan.
2. **Form** on `/searches/new`: a source switch, Google Maps (default when
   configured) and Yelp (the existing form, unchanged). Google form fields:
   niche select (fills the terms), terms as an editable comma-separated field,
   area, pages per search (1 to 3, default 3). A plan line updates on change
   (debounced call to the preview action): `3 terms × 12 zips = 36 searches ·
   up to 108 requests · about $3.78 at most · 892 of 1,000 requests left this
   month`. Submit is disabled while the plan is invalid, over a limit, or
   larger than the requests left; the reason is shown. Helper text under the
   area field gives the three accepted forms. Not configured → the
   `GOOGLE_NOT_CONFIGURED` notice in the style of the Yelp one.
3. **Job page** `/searches/[id]` for `source = google`: searches done of
   total with a progress bar, new / matched to existing / qualified / review /
   rejected counts, Google requests and estimated cost so far, saturated
   searches count with a one-line explanation ("these returned the full 60;
   more may exist, try narrower terms"), skipped searches, the pause reason
   when `status = running` and `error` is set, a **Continue** button, a **Run
   again** button when completed, and a link to Lookup filtered to Google.
   While the page is open and the job is running with no live lease
   (`leaseExpiresAt` null or past), it calls `continueGoogleSearchAction`
   automatically, at most once every 20 s, and never when the pause reason is
   the monthly cap. Yelp jobs render as before.
4. **Searches table**: a Source column; Google rows show searches done/total.
5. **Lookup**: a "Google Maps" button in the discovery strip linking to
   `/searches/new?source=google` and a "Search history" link to `/searches`;
   Source filter gains Google; `LookupBusiness` gains `googleMapsUrl`,
   `address` (street, city, state zip) ; cards show a Google source badge like
   the existing ones; the dossier shows a Google Maps tile and the address,
   and its "refresh links" action works for Google rows.
6. **Settings**: Google Maps configured yes/no and "N of CAP requests used
   this month".
7. **Cron**: the `google` stage as in the architecture (60 s budget, oldest
   unfinished first, skipped without the key), placed after `emails`, inside
   the existing discovery budget accounting.
8. **Docs**: `.env.example` (three variables with comments), `docs/deploy.md`
   (variables table, how to get a key: enable "Places API (New)" and
   optionally "Geocoding API" on the key's project, restrict the key to those
   APIs; the cap; the cron stage; migration `0005`), `README.md` (one
   paragraph and the CLI commands).

9. **PM-authorised fix in a WP-18 file** (found in the WP-18 review):
   `src/lib/google-places/zips.ts` `resolveArea`. For the "City, ST", the
   "<zip> +<n>mi" and the geocoded forms, zips that share a centre (PO-box and
   single-building zips sit on the city centroid: Dallas has 120 zips but 60
   distinct centres) are collapsed to one zip per centre, the lowest zip
   number. They all run the same query at the same point, so they only add
   cost. An explicit zip list is kept exactly as typed. Update
   `tests/google-plan.test.ts` to match.
10. **Run again on failed jobs** as well as completed ones (a database error
    inside a slice marks a job failed, and a failed job cannot be continued).

### Out
- Any other change to plan arithmetic, the runner, storage or qualification.
- A map view. Review text. Bulk "add all to leads".

## Interfaces
### Consumes
Everything listed under "What WP-18 / WP-19 gave you".
### Produces
The four actions and `googleConfigured()`; the cron `google` key.

## Acceptance criteria
AC-20.1 Not configured: `/searches/new` renders the notice for the Google
  source; `startGoogleSearchAction` fails with `GOOGLE_NOT_CONFIGURED` and a
  fake client records no request (test).
AC-20.2 Preview action: for niche `roofing` and `"75201, 75202"` returns
  `zipCount: 2`, the terms, `queries`, `maxRequests`, `estMaxUsd`,
  `usedThisMonth`, `cap`; an unresolvable area returns `ok: false` with a
  field error on `area`; no Places request is made (test).
AC-20.3 Start action: creates a `source = google` job and schedules the run
  (test with `after` mocked, as the existing action tests do); with usage at
  the cap it fails with a message naming the cap and creates no job.
AC-20.4 Form (component test): choosing a niche fills the terms; the plan
  line shows searches, requests, cost and requests left from a mocked preview;
  submit is disabled and explains itself when the preview is over a limit or
  exceeds the requests left.
AC-20.5 Job page (component test): a running Google job shows "N of M
  searches", the counts and the cost; a job with `status: running` and an
  `error` shows the pause message; a cap pause does not auto-continue; an
  idle running job triggers one continue call and not a second inside 20 s
  (fake timers); a completed job shows Run again.
AC-20.6 Lookup (component tests): the source filter lists Google; a Google
  row's card shows the Google badge; its dossier has a link whose href is the
  row's `googleMapsUrl` and shows the address; the strip has the Google Maps
  button.
AC-20.7 Cron (test): with an unfinished Google job and a fake client the
  response has `google.jobs >= 1`; with none it reports `jobs: 0` and the fake
  records no request; without the key it reports `skipped`.
AC-20.8 Auth: each of the four actions rejects when `requireUser` throws
  (test).
AC-20.12 Zips: `resolveArea("Dallas, TX")` returns at most 70 zips with no two
  sharing a centre and still includes 75201; `resolveArea("75201, 75222")`
  returns both; a failed Google job's page shows Run again (tests).
AC-20.9 `/searches/new`, `/searches`, `/searches/[id]` and `/lookup` still
  pass `tests/routes-render.test.tsx`; the Yelp form test is unchanged.
AC-20.10 `npm test`, `npm run typecheck`, `npm run lint`, `npm run build` exit
  0. Paste the test count.
AC-20.11 Screenshots at 1440 px and 390 px of the Google form with a plan
  line and of a running job page, saved under `docs/team/google/screens/`
  (run `next dev` on PGlite; if sign-in blocks you locally, render the
  components in a throwaway route or story and say so).

## Delegation guidance
Good junior tasks: the searches table column, the settings rows, docs, the
component tests once the components exist, the screenshots.
Keep: the actions and their budget loop, the auto-continue logic, the cron
stage.

## Reporting
Use the completion-report format from the senior brief.
