# Google Maps discovery — Spec

**Status:** approved by standing instruction ("write the spec, delegate, push to prod"), 2026-11-10
**PM:** Fable 5.2

## Goal
LAR finds local businesses on Google Maps through Google's own Places API
(New), so the lead list reaches the trades, clinics, shops and restaurants that
are on neither Yelp nor Trustpilot. A user picks a niche and an area; LAR
searches every name the niche goes by in every zip code of the area, cleans
and dedupes what comes back, qualifies it with the existing rules, and feeds
it to the same Lookup, Leads, Calling and Email screens as every other source.

The method follows the referenced Pipeline.tech article where it fits this
app: several category names per market, zip-by-zip searches to get under
Google's 60-result cap, a query count and cost shown before anything is spent,
business-level then email-level dedupe, qualification before paid enrichment,
emails read from the business's own website, and re-running an area later.

## Non-goals
- Third-party Maps scrapers (Serper, Apify, OpenWeb Ninja). Google's API only.
- Google review text, review mining and intent scoring (Places "Atmosphere"
  SKU). Review count and rating are stored; review bodies are not fetched.
- LLM name cleaning or LLM website agents. Cleaning is deterministic code.
- Paid email waterfalls, email verification, mobile-number lookup.
- Sending changes (Gmail inboxes, weekend sends, separate sender accounts).
- Countries other than the US (zip codes).
- Unifying Yelp and Trustpilot rows under one category scheme (only Google
  rows are mapped onto the 22 top-level categories here).
- A queue or workflow service. Long jobs resume through the browser and the
  daily cron.

## Users and scenarios
- As a rep, I choose "Roofing" and "Dallas, TX" and see "3 terms × 61 zips =
  183 searches, up to 549 requests, about $19 at most, 1,000 left this month"
  before I start.
- As a rep, I start the search and watch it progress; when I come back
  tomorrow it has finished on its own.
- As a rep, I open Lookup, filter Source = Google, and the new businesses are
  there with phone, website, address, rating, review count and a Google Maps
  link, already qualified or rejected with reasons.
- As a rep, a roofer that was already in LAR from Trustpilot does not appear
  twice; its row gains the Google listing.
- As a rep, the second and third listings of the same company (same phone,
  same website or same email) are rejected with a reason, so one owner gets
  one call and one email.
- As a rep, new Google businesses with a website get their email and social
  links within minutes, not weeks.
- As the owner, Google spend cannot exceed a monthly request cap I control.
- As an operator, I can run the same search from a terminal
  (`npm run google:search`).

## Functional requirements
R1. **Configuration.** `GOOGLE_PLACES_API_KEY` enables Google search; without
    it every Google entry point shows "Google Maps search is not configured:
    set GOOGLE_PLACES_API_KEY" and makes no request.
R2. **Niches.** A built-in list of niches, each with the search terms the
    market uses (for example Roofing: "roofer", "roofing contractor", "roofing
    company") and the Google place types that count as on-target. Users can
    edit the terms or type their own.
R3. **Area.** The area is zip codes, however typed: a list of zips, a
    "City, ST", or a zip plus a radius in miles. Resolution is offline from a
    bundled US zip dataset. Text that cannot be resolved offline is geocoded
    when a geocoding key is present, else rejected with a clear message.
R4. **Plan and cost.** Before a job starts, LAR shows terms × zips = searches,
    the maximum API requests, an estimated maximum cost, and the requests left
    under the monthly cap. Hard limits: 200 zips and 500 searches per job.
R5. **Search.** One Text Search per term and zip, up to 3 pages (60 results).
    A search that fills all pages is recorded as saturated.
R6. **Resumable jobs.** A job runs in slices inside the platform's function
    limit, records its position after every search, and can be continued by
    the open job page, by a button, by the daily cron, or by the CLI. Two
    slices never run at once for the same job.
R7. **Spend cap.** Every Google request is counted per calendar month. When
    `GOOGLE_PLACES_MONTHLY_REQUEST_CAP` (default 1000) is reached, no further
    request is made; the job pauses and says why.
R8. **Normalising.** A place becomes a `businesses` row: cleaned name, phone,
    website, street address, city, state, zip, coordinates, rating, review
    count, closed flag, Google Maps URL, Google's types, and one of the 22
    top-level categories. The raw place is kept.
R9. **Name cleaning.** Shouting, taglines and tacked-on locations are removed:
    "BEST ROOFING DALLAS TX - Free Estimates" becomes "Best Roofing".
R10. **Business-level dedupe.** The same Google place is one row however many
    searches return it. A place whose phone or website domain matches an
    existing Yelp or Trustpilot row is attached to that row, not inserted.
R11. **Duplicate flags.** A row that shares a website domain or an email
    address with an earlier row is rejected with its own reason, like the
    existing shared-phone rule. Free hosts (facebook.com, wixsite.com and the
    like) and free-mail domains never count as a shared website.
R12. **Qualification.** Google rows go through the existing engine. Places
    whose Google types are off-target for the niche are rejected as a category
    mismatch; permanently closed places are rejected as closed.
R13. **Qualify before enrich.** Rows rejected for a reason that a website
    visit cannot cure are not sent to link enrichment.
R14. **Fast website enrichment.** Link enrichment reads the business's own
    website with a direct HTTP fetch first and falls back to Firecrawl only
    when the direct fetch fails or returns a shell. It works without a
    Firecrawl key. Server-side fetching refuses private and internal addresses.
R15. **Screens.** A Google Maps search form next to the Yelp one; a job page
    with live progress; Source = Google in Lookup; a Google Maps link and the
    street address on the card and dossier; a "Run again" button on a finished
    job; configuration and monthly usage on Settings.
R16. **Cron.** The daily cron continues unfinished Google jobs inside a fixed
    budget.
R17. **Review history.** Each sync stores a review-count snapshot (at most one
    a day per business) so review velocity builds up across re-runs.

## Acceptance criteria
Each is assigned to a package and restated there with its proof.
AC1 (R1) Without the key: the form shows the not-configured message, the start
    action fails with it, and a fake client records zero requests. WP-18, WP-20.
AC2 (R2, R3, R4) `planGoogleSearch` for niche `roofing` and `"75201, 75202"`
    returns 2 zips, the niche's terms, `queries = terms × 2`, `maxRequests =
    queries × 3`. "Dallas, TX" resolves to more than 20 zips offline. 201 zips
    or 501 searches is refused. WP-18.
AC3 (R5, R6) A job of 6 searches run with a budget that fits 2 searches per
    slice finishes in 3 slices with every search run exactly once; a second
    slice started while the first holds the lease returns `busy`. WP-18.
AC4 (R7) With the cap at 5, the sixth request is never sent; the job stays
    `running` with a pause message; raising the cap lets the next slice
    continue from the same search. WP-18.
AC5 (R8, R9) Table-driven tests: at least 25 name-cleaning cases including the
    one in R9; a fixture place maps to every column in R8. WP-18.
AC6 (R10) The same place from two searches is one row. A place whose phone
    matches an existing Trustpilot row, and another whose domain matches,
    attach `google_place_id` to those rows and insert nothing. WP-18.
AC7 (R11) Two Google rows sharing a domain: the later one is rejected with
    `duplicate_website`; sharing `facebook.com` rejects neither; a row that
    gains an email already on an earlier row is rejected with
    `duplicate_email` on its next qualification. WP-18.
AC8 (R12) In a `roofing` job, a place typed `hardware_store` is rejected with
    `category_mismatch`; a `CLOSED_PERMANENTLY` place with `closed`. WP-18.
AC9 (R13) A row rejected for `category_mismatch` is not returned by
    `listPendingLinkIds`; a row rejected only for `no_phone` is. WP-19.
AC10 (R14) With a fake direct fetcher that succeeds, a 10-row drain makes zero
    Firecrawl calls; when the direct fetch fails the row is retried through
    Firecrawl; with no Firecrawl key the drain still enriches. Requests to
    `http://127.0.0.1`, `http://169.254.169.254` and a hostname resolving to
    `10.0.0.5` are refused before any connection. WP-19.
AC11 (R15) Component tests: the Google form renders the plan line and blocks
    submit over the limits; the job page shows searches done of total and the
    pause message; Lookup's source filter lists Google; a Google row's dossier
    has a Google Maps link. WP-20.
AC12 (R16) The cron response has a `google` stage reporting jobs continued;
    with no unfinished job it reports zero and makes no request. WP-20.
AC13 `npm test`, `npm run typecheck`, `npm run lint` and `npm run build` exit 0
    on the merged result. All packages; PM at integration.
AC14 One live Text Search through the CLI probe, recorded in the WP-18 review,
    confirms the field mapping against Google's real response. PM (needs the
    key in this session).

## Decisions made by the PM
- **Google's own Places API (New), Text Search.** The user supplied a key for
  it; no scraper terms-of-service exposure and no extra vendor.
- **Enterprise field mask, no Atmosphere fields.** Phone, website, rating and
  review count are needed to qualify; review text is not worth the higher SKU
  in this pass.
- **Zip-by-zip with a location bias on the zip's centre.** Matches the article
  and needs no geocoding for the common case.
- **Default monthly cap of 1,000 requests.** Believed to be the free monthly
  allowance of the Enterprise Text Search SKU; the price constant ($35 per
  1,000) and this figure are from memory, because Google's pricing page could
  not be reached from the build session. The UI calls the cost an estimate.
- **Flag duplicates, do not delete them.** Same idiom as the existing
  shared-phone rule; the user can see why a row was cut.
- **Cross-source matches attach, same-source duplicates are flagged.** A
  Trustpilot row and a Google place for the same domain are one company; two
  Google places with one domain are two locations, and the earlier one stands
  for the company.
- **Reuse `search_jobs`** with a `source` column instead of a new jobs table,
  so `/searches` lists both kinds.
- **No new infrastructure for long jobs.** Slices plus a lease; the job page
  and the daily cron continue them.
- **The URL signing secret is stored in Vercel but unused.** Text Search does
  not use it; it is there for a later Static Maps thumbnail.
- **Supersedes** `docs/team/v2/work-packages/WP-17-google-maps-discovery.md`,
  which planned the same source through Firecrawl's maps provider and was
  never built.

## Open questions
- **Storing Google Maps content.** Google's Places policies let place IDs be
  kept indefinitely and restrict caching other place content (coordinates up
  to 30 days). LAR stores name, phone, website, address and rating in its own
  database, as every Maps lead tool does. The user asked for this with their
  own key; the PM flags it in the run summary rather than blocking on it. The
  "Run again" action keeps stored rows fresh.
