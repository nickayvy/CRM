# Google Maps discovery — Run summary

**Date:** 2026-11-10 · **PM:** Fable 5.2

## State in one line
Built, reviewed, merged and pushed. `main` is at `2335e0b` (fast-forward from
`4448acf`) and live in production: Vercel deployment
`dpl_6umVyjowbDJ5AqYme7hgwVxuAPks` is READY, `/login` answers 200 and there are
no runtime errors in the hour after the deploy. The production database was
migrated beforehand. No Google request has been made yet: the two API
keys reached the session masked, and `GOOGLE_PLACES_API_KEY` is not in Vercel,
so production shows "Google Maps search is not configured" until it is added.

## Shipped
- **WP-18 Google Places core** — `wp-18-google-places-core`, merged `1cabd8f`,
  no revision round.
  - Places API (New) Text Search client; key in the header only, redacted
    from every error.
  - 28 niches, each with the names the market uses and the Google place types
    that count as on-target.
  - Offline US zip resolution: zip lists, "City, ST", "zip +N mi"; geocoding
    only for other text.
  - Plan with cost before anything is spent; limits of 200 zips, 500 searches
    and 12 terms per job.
  - Resumable job runner: slices, a database lease, a cursor saved after every
    search, a monthly request cap checked before every request.
  - Normalising: cleaned names, phone, website, address, coordinates, rating,
    reviews, closed flag, Maps link, one of the 22 top-level categories.
  - Cross-source dedupe (a Google place attaches to an existing Yelp or
    Trustpilot row by phone or website domain) and two new rejection reasons,
    `duplicate_website` and `duplicate_email`.
  - `npm run google:search` (plan, dry run, probe, resume).
- **WP-19 Fast website enrichment** — `wp-19-fast-website-enrichment`, merged
  `a510c2f`, no revision round.
  - Business websites are fetched directly; Firecrawl is only the fallback.
    The links step now runs without a Firecrawl key.
  - Server-side fetch guard against private and internal addresses on every
    redirect hop, with the connection pinned to the checked address.
  - Rows rejected for a reason a website cannot cure are not enriched.
  - Drain concurrency 6; daily cron link limit 40 → 300.
- **WP-20 UI, actions, cron, docs** — `wp-20-google-search-ui`, merged
  `eda0910`, no revision round.
  - Google Maps tab on `/searches/new` with a live plan and cost line.
  - Job page with progress, counts, cost so far, pause reason, Continue, Run
    again; continues by itself while open.
  - Lookup: Google source filter and badge, Maps link and address on cards
    and the dossier, a Google Maps button in the discovery strip.
  - Settings: configured yes/no and requests used this month.
  - Daily cron continues unfinished Google jobs (60 s).
  - PO-box zips collapsed: Dallas went from 120 zips to 60 for the same
    coverage, which halves the cost of a city search.

Code change, excluding docs and generated files: 80 files, +8267 / −112.

## Production changes already made
- **Database:** migration `0005_google_places` applied through the Supabase
  connector and recorded in `drizzle.__drizzle_migrations`, so `db:migrate`
  will skip it. Additive only; the code deployed today is unaffected.
  Checked afterwards: enum is `yelp, trustpilot, google`; `website_domain`
  is set on all 153 rows that have a website; no existing rows share a domain
  or an email, so the new duplicate reasons reject nothing that is there now.
  Row level security is enabled on the new `api_usage` table, like every
  other table (the Drizzle SQL file does not do this; a fresh database needs
  it enabled by hand).
- **Vercel:** `GOOGLE_MAPS_URL_SIGNING_SECRET` added (production and preview).
  The app does not read it; Text Search has no use for it.

## Still to do, in order
1. **Add to Vercel** (production): `GOOGLE_PLACES_API_KEY`; optionally
   `GOOGLE_GEOCODING_API_KEY` and `GOOGLE_PLACES_MONTHLY_REQUEST_CAP`, then
   redeploy. The key's Google Cloud project needs "Places API (New)" enabled.
2. **First live search**, small: one niche, one zip, one page (1 request).
   This is the first real test of the field mapping (spec AC14).

## Cut or deferred
- Review text, review mining and intent scoring.
- LLM name cleaning and website agents; email verification; paid waterfalls.
- Sending changes from the article (Gmail inboxes, weekend sends).
- A map view; bulk "add all to leads" from a job.

## Integration check
- Merged branch, PM's own run: typecheck clean, lint 0 problems,
  **1325 tests passed** (1052 before the run), `npm run build` succeeded.
- CLI dry run on the merged branch: roofing in Dallas, TX → 3 terms × 60 zips
  = 180 searches, up to 540 requests, about $18.90 at most.
- Not checked: any live Google response; a direct website fetch from
  production; the screens in a signed-in production browser.

## Open issues
- **The Places contract is from memory.** Google's documentation site was
  unreachable from the build session. Endpoint, headers, field names, the
  60-result cap, the $35 per 1,000 price and the 1,000 free requests a month
  are unverified until the first live call and a look at the billing page.
- **Speed is unmeasured and likely slow.** Each place costs about a dozen
  database round trips, and the Vercel functions run in `iad1` (US East)
  while the Supabase project is in `us-west-1`. A slice may finish only a few
  searches; the job still completes through the open page and the daily cron.
  Moving the functions next to the database would speed up the whole app.
- **Storing Google Maps content.** Google's policy allows keeping place IDs
  and restricts caching other place content. LAR stores names, phones,
  websites, addresses and ratings. This is the user's call with their own key.
- A database error inside a slice marks the job failed; Run again restarts it
  from the first search.
- Phone matching is by digit string; a 10-digit Trustpilot phone does not
  match Google's 11-digit form (production has 41 ten-digit and 38
  eleven-digit numbers). The website-domain match covers those rows.
- A Firecrawl rate limit on one row's fallback still pauses the whole link
  drain.
- All three seniors lost their completion reports to container restarts; the
  reviews rest on the PM's own runs and diff reading, and what each senior
  delegated to juniors is unknown.

## Cost
- Agents: 3 seniors (Opus 5.5, medium), plus whatever juniors they spawned
  (unreported); 1 research agent (Sonnet 5.5). No revision rounds.
- Google: $0, no request made. Firecrawl: 0 credits.
