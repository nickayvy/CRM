# Team status — Google Maps discovery

| WP | Title | Wave | Agent | Branch / PR | State | Review |
|---|---|---|---|---|---|---|
| WP-18 | Google Places core | 1 | senior-wp18 (Opus 5.5, medium) | wp-18-google-places-core | merged (1cabd8f, no revision) | reviews/WP-18.md (ACCEPT) |
| WP-19 | Fast website enrichment and qualify-before-enrich | 1 | senior-wp19 (Opus 5.5, medium) | wp-19-fast-website-enrichment | merged (a510c2f, no revision) | reviews/WP-19.md (ACCEPT) |
| WP-20 | Google Maps search UI, actions, cron resume, docs | 2 | senior-wp20 (Opus 5.5, medium) | wp-20-google-search-ui | merged (eda0910, no revision) | reviews/WP-20.md (ACCEPT) |

## Log
- 2026-11-10 Preflight: baseline on Node 24 is typecheck clean, 1052 tests
  passed. Production has no Google variables. `places.googleapis.com` is
  reachable from the build session; `developers.google.com` is not, so the
  Places contract in the spec is from memory and the live probe is the
  authority. The two Google API keys reached the PM masked; the URL signing
  secret did not. The GitHub connector failed to connect, so deliveries are
  local branches, not PRs.
- 2026-11-10 Spec, architecture and WP-18 to WP-20 written under
  `docs/team/google/`. Supersedes `docs/team/v2/work-packages/WP-17-google-maps-discovery.md`.
- 2026-11-10 Wave 1 spawned: WP-18 and WP-19 in parallel (disjoint files).
- 2026-11-10 The build container restarted while both seniors were on their
  final verification. Both branches were committed and clean; neither
  completion report was delivered. The PM reviewed from its own runs and the
  diffs: WP-18 typecheck, lint, build clean and 1178 tests; WP-19 the same with
  1152 tests. Both ACCEPT and merged. Not yet proven: a live Google call
  (no key in the session) and a live direct fetch (the transport bypasses the
  session proxy).
- 2026-11-10 `GOOGLE_MAPS_URL_SIGNING_SECRET` added to Vercel (production and
  preview). The two API keys are still to come from the user.
- 2026-11-10 WP-18 review finding: PO-box zips double a city search's cost.
  Added to WP-20 (scope items 9 and 10, AC-20.12). Wave 2 spawned.
- 2026-11-10 `git push` refused: the Claude GitHub App has no write access to
  the repository (HTTP 403; fetch still works). The GitHub connector is down
  for the same reason. Deploy is blocked on the user reconnecting GitHub.
- 2026-11-10 Production database: migration `0005_google_places` applied
  through the Supabase connector (additive; recorded in the Drizzle table;
  RLS enabled on `api_usage`). Verified afterwards.
- 2026-11-10 The secure credential form cannot store a key sent in
  `X-Goog-Api-Key`, so no Google key reached the session and no live call was
  made.
- 2026-11-10 Second container restart while WP-20 was on its final
  verification; branch committed and clean, no report. PM review: typecheck,
  lint, build clean, 1325 tests; ACCEPT; merged `eda0910`.
- 2026-11-10 Integration on the merged branch: typecheck, lint, build clean,
  1325 tests. Run summary: summary.md. Not deployed.
- 2026-11-10 The user restored the GitHub App's access. Branch pushed; `main`
  fast-forwarded `4448acf..2335e0b`; Vercel production deployment
  `dpl_6umVyjowbDJ5AqYme7hgwVxuAPks` started from that commit.
