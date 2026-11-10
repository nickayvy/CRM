# WP-17: Google Maps discovery, "Add a business" modal, unified categories

**Wave:** 4 (v2)
**Depends on:** WP-13 (Trustpilot discovery), WP-14 (Lookup UI) merged; current `main` (link enrichment in `src/features/discovery/server-actions.ts`)
**Owns files:** `src/lib/google-maps/**` (new), `src/lib/categories/**` (new), `src/features/discovery/**`, `src/db/repo/discovery.ts`, `src/db/repo/businesses.ts` (new upsert only), `src/db/schema.ts` + one new migration in `drizzle/`, `src/components/lookup/add-business-modal.tsx` (new), `src/components/lookup/manual-scrape-input.tsx` (retired or folded into the modal), `src/components/lookup/lookup-view.tsx`, `src/components/lookup/dossier-modal.tsx` (Find competitors button), `src/features/lookup/**`, `scripts/backfill-categories.ts` (new), `tests/**` for the files above
**Delivers:** branch `wp-17-google-maps` / PR "WP-17: Google Maps discovery and unified categories"

## Objective
Users add local businesses (restaurants, med spas, trades) from Google Maps without pasting links: they search by name and place, pick results, and the businesses land in the Lookup graph already categorised and already connected by edges. Every business, whatever its source (Trustpilot, Yelp, Google), sits in one of the same 22 categories so the graph reads as one dataset.

## Context the engineer needs
- **Data source:** Firecrawl's Alexandria provider `firecrawl-maps`, capability `businesses/search`, called with the existing `FIRECRAWL_API_KEY`. No Google API key, no Google billing.
  - Input: `query` (required; name and/or category with a location, e.g. `"med spa La Jolla"`, `"pho 92101"`), optional `latitude`/`longitude`, `cursor` (from `next_cursor`), `country` (default `us`), `language` (default `en`).
  - Output: `results[]` with `place_id`, `feature_id`, `name`, `categories: string[]` (display labels, e.g. `["Pizza restaurant", "Italian restaurant"]`, first is the primary), `address`, `address_lines`, `latitude`, `longitude`, `phone`, `phone_e164`, `website`, `rating`, `review_count`, `price_level`, `maps_url`, `editorial_summary`, `timezone`; plus `has_more`, `next_cursor`. 20 results per page; pages can repeat a place, so dedupe by `feature_id`/`place_id`.
  - This contract was read from the published catalogue, not from a live call. **First task: make one live call and confirm the fields**, especially that `categories[0]` is the primary label.
  - `src/lib/firecrawl/client.ts` only exposes `scrapeJson`/`scrapePage` on `FirecrawlLike`. Add a method for Alexandria capability calls (check how the installed Firecrawl SDK exposes Alexandria; fall back to a direct HTTP call if it does not) and keep the fake-injectable seam for tests.
- **Rate limits:** the Firecrawl plan allows 10 requests/min and 2 concurrent. Reuse the existing pacer (`requestPacer`, `FIRECRAWL_CONCURRENCY`, `FIRECRAWL_DELAY_MS`) and `FirecrawlRateLimited` handling. No search-as-you-type.
- **Licensing:** the data is Google Maps content. Before merging, the PM confirms with the user that storing it long term is acceptable. Do not block development on it.
- **Existing patterns to copy:** `scrapeTrustpilotBusiness` (upsert by external id, edges, `qualifyOne`), `seedCategoryAction` (validate inline, heavy work in `after()`), `scrapeUrlAction` (link enrichment via `enrichBusinessLinks` after the add), `LookupView.onDiscovered` (staggered `router.refresh()`).
- **Graph rules today:** nodes = every `businesses` row (`listGraphNodes`), edges = `business_relations`; the client shows the top 50 by `reviewCount` (`graphSubset`), coloured and bubbled by `primaryCategory`.

## Design

### 1. Unified categories (`src/lib/categories/`)
Two levels for every business:

| Field | Meaning | Example |
|---|---|---|
| `primaryCategory` | One of the 22 Trustpilot slugs in `TRUSTPILOT_CATEGORIES` (graph bubble, colour, filter), or `null` when unresolved | `restaurants_bars` |
| `subcategory` | The source's own primary label | `Pizza restaurant` |
| `categories` | All source labels as `{ alias: categoryAlias(title), title }` | `[{alias:"pizza_restaurant", title:"Pizza restaurant"}, …]` |

`resolveCategory(labels: string[]): string | null` tries each label in order (primary first) and returns at the first hit:
1. **Exact table** (`exact-map.ts`): label alias → slug, for common labels and for labels the keyword rules would get wrong (e.g. `medical_spa` → `beauty_wellbeing`, `dermatologist` → `health_medical`, `car_wash` → `vehicles_transportation`, `day_spa` → `beauty_wellbeing`).
2. **Keyword rules** (`keyword-rules.ts`): an ordered list of `{ pattern: RegExp, slug }`, matched against the lowercased label. Starting set (extend as needed; order matters, more specific first):
   - `restaurant|cafe|coffee|bakery|\bbar\b|pub|pizza|diner|bistro|brewery|food truck|deli` → `restaurants_bars`
   - `med ?spa|aesthetic|laser|botox|skin care|\bspa\b|salon|nail|barber|lash|brow|waxing|tanning|massage` → `beauty_wellbeing`
   - `dentist|dental|orthodont|clinic|doctor|physician|chiropract|physiotherap|physical therap|optometr|medical|urgent care|pharmacy|veterinar` → `health_medical` (put `veterinar` → `animals_pets` above this rule)
   - `plumb|roof|hvac|heating|air conditioning|electrician|landscap|hardscap|contractor|cleaning|pest|locksmith|handyman|painter|moving` → `home_services`
   - `auto|tire|mechanic|car dealer|body shop|car wash|towing` → `vehicles_transportation`
   - `gym|fitness|yoga|pilates|martial arts|crossfit|boxing` → `sports`
   - `lawyer|attorney|law firm|notary` → `legal_services_government`
   - `accountant|accounting|tax|insurance|bank|credit union|financial` → `money_insurance`
   - `school|tutor|academy|driving school` → `education_training`
   - `hotel|motel|travel agency|tour` → `travel_vacation`
   - `pet|groom|kennel` → `animals_pets`
   - `store|shop|boutique|retail` → `shopping_fashion` (last: generic words)
3. **Unresolved:** return `null` and record the label in a new `unmapped_categories` table (`label` PK, `alias`, `count`, `first_seen_at`, `last_seen_at`), upserting `count + 1`. No LLM fallback in this package.

Decision baked in: med spas go to `beauty_wellbeing` (user can move them by editing the exact table).

The same resolver is used for Google rows, for Trustpilot profile scrapes (replace the current `primaryCategory: categoryAlias(p.categories[0])` in `scrapeTrustpilotBusiness`) and for Yelp rows (titles from `categories[].title` in `normalizeYelpBusiness`). Trustpilot seed rows already store a top-level slug and stay as they are.

**Niches** (`niches.ts`) sit under the 22 and drive searching only:
```ts
{ id: "med_spa", label: "Med spa", category: "beauty_wellbeing", terms: ["med spa", "medical spa", "aesthetics clinic", "botox", "laser hair removal"] }
{ id: "roofing", label: "Roofing", category: "home_services", terms: ["roofer", "roofing contractor", "roofing company"] }
```
Seed a starter list (about 15 niches across restaurants, beauty, health, home services, auto, fitness). A business's category always comes from its labels, never from the niche that found it.

### 2. Schema (one migration)
- `business_source` enum: add `google`.
- `businesses.google_place_id text unique`, `businesses.google_feature_id text`.
- `unmapped_categories` table (above).
- Index on `businesses.website` domain is optional; dedupe can normalise in SQL.
- `business_relations.relation_type` gains the value `competes_with` (text column, no migration needed).

### 3. Google ingest (`src/lib/google-maps/`)
- `searchPlaces(fc, { query, lat?, lng?, cursor? })` → typed page of results.
- `normalizePlace(result)` → `NewBusiness` with `source: "google"`, `googlePlaceId`, `googleFeatureId`, name, `nameNormalized`, phone/`phoneDigits`, website, address/city/state/zip (parse `address_lines`), lat/lng, rating, `reviewCount`, `categories`, `subcategory`, `primaryCategory` (from `resolveCategory`), `logoUrl` via the favicon helper, `raw`, `lastScrapedAt`.
- `upsertBusinessByGooglePlaceId` in `src/db/repo/businesses.ts`, same CRM-field protection as `upsertBusinessByYelpId`.
- **Cross-source dedupe** (`findExistingBusiness`): before inserting, match on `google_place_id`, then `phoneDigits`, then normalised website domain. On a match, attach `google_place_id` to the existing row and fill only empty fields; do not create a second node.
- After insert or attach: `qualifyOne`, then `enrichBusinessLinks` (same timeout as the Trustpilot add).
- Review snapshot via `addSnapshot` so velocity builds up over time.

### 4. Edges
- When businesses are added from a search, every pair of results from that **same search** that both exist in the DB after the add gets a `competes_with` relation (one direction, from the added business to each other result; `addRelation` already ignores duplicates and self-links).
- The dossier's **Find competitors** search links its results to the business it was started from.

### 5. Server actions (`src/features/discovery/`)
- `searchGoogleAction(query, cursor?)` → results annotated with `existingBusinessId` when the dedupe matches (for the "Already in graph" badge). Does not write.
- `addGoogleBusinessesAction(searchId | results, selectedPlaceIds)` → inserts/attaches, adds edges, enriches; returns the added ids. Keep the search results server-side (short-lived cache keyed by a search id) or re-validate what the client sends; never trust client-sent business data blindly.
- `seedNicheAction(nicheId, zips: string[])` → validates, shows nothing heavy inline; in `after()` runs `terms × zips` searches through the pacer, inserting new rows and `competes_with` edges per search. Hard cap 25 searches per run and the 240 s budget already used by the Trustpilot seed; the remainder is reported, not silently dropped.
- `findCompetitorsAction(businessId)` → resolves the business's niche from its `subcategory`/category (fallback: its `subcategory` text as the term), searches near its lat/lng, returns results like `searchGoogleAction`.

### 6. UI
- **Button "Add a business"** on `/lookup` (replaces the inline paste strip and the seed dropdown) opens `add-business-modal.tsx` with two tabs:
  - **Add:** one input. A Trustpilot review URL runs the existing `scrapeUrlAction`; anything else runs `searchGoogleAction` on Enter / Search button. Helper text: "Paste a Trustpilot link, or search Google Maps by name and city." Results list: name, address, rating, review count, Google's primary label, resolved category chip, checkbox; "Already in graph" rows link to the dossier instead of a checkbox; "Load more" uses `next_cursor`. Add button adds the ticked rows.
  - **Seed an area:** source switch Trustpilot (the 22 categories, existing action) or Google (niche picker + zip/city input). Google shows the cost before starting: `terms × zips = N searches, about N/10 min`.
- **After an add:** select the new business's category bubble and highlight its node (or open its dossier) so a low-review business outside the top 50 is still visible; staggered refresh as in `onDiscovered`.
- **Dossier:** "Find competitors nearby" opens the same results list pre-linked to that business.
- Disabled state with `DISCOVERY_DISABLED_HINT` when `FIRECRAWL_API_KEY` is missing, as today.

### 7. Backfill
`scripts/backfill-categories.ts`: re-run `resolveCategory` over every Trustpilot profile row and Yelp row (labels from `categories[].title`), set `primaryCategory`/`subcategory`, log unmapped labels. Dry-run flag prints the before/after counts per category. The prod DB is reachable only through the Supabase MCP, so the script must also be expressible as SQL updates the PM can run there; ship the generated SQL alongside.

## Scope
### In
Everything above: categories module, schema migration, Google ingest and dedupe, edges, actions, modal, Find competitors, backfill.
### Out
- Yelp paste-a-URL (separate package if wanted).
- Yelp "People also viewed" (Firecrawl refuses yelp.com; not possible with current tools).
- Google reviews / rating-trend signals, owner email waterfalls, LLM category fallback.
- Re-scraping Google rows on the daily cron (follow-up; `syncStale` stays Trustpilot-only).

## Acceptance criteria
AC-17.1 `resolveCategory` unit tests: at least 40 real Google labels (from the live call plus the catalogue example) map to the expected slug; `Medical spa` → `beauty_wellbeing`, `Veterinarian` → `animals_pets`, an unknown label → `null` and an `unmapped_categories` row with `count` incremented on repeat.
AC-17.2 Migration applies on PGlite and a fresh Postgres; `business_source` includes `google`; `google_place_id` is unique.
AC-17.3 Adding the same place twice creates one row; adding a place whose phone or website domain matches an existing Trustpilot/Yelp row attaches `google_place_id` to that row (tests with a fake Firecrawl).
AC-17.4 Adding 3 results from one search creates `competes_with` edges among them and they appear as links in `loadGraph`.
AC-17.5 Modal: Trustpilot URL routes to `scrapeUrlAction`; text routes to the Google search; "Already in graph" rows cannot be re-added; after adding, the new node's category is selected (UI tests in `tests/lookup-ui.test.tsx`).
AC-17.6 `seedNicheAction` never exceeds 25 searches per run, respects the pacer, and reports the remainder.
AC-17.7 Backfill dry run on the test DB prints per-category counts; after a real run no Trustpilot profile or Yelp row has a `primaryCategory` outside the 22 slugs or `null`.
AC-17.8 One live `firecrawl-maps` search recorded in the PR description (query, result count, a sample row) confirming the field mapping.
AC-17.9 `npm test`, typecheck, lint, build exit 0; screenshots of the modal (both tabs, results list with an "Already in graph" row) and the graph after an add.

## Open items for the PM to confirm with the user
- Storing Google Maps data long term (licensing).
- Med spa category (`beauty_wellbeing` assumed).
- Starter niche list contents.

## Delegation guidance
Juniors: keyword rules + exact table + their tests, `unmapped_categories` repo, backfill script and SQL, modal tab layout and empty/disabled states. Keep: Alexandria client seam, dedupe, edges, seed runner and its budget, the post-add graph focus.
