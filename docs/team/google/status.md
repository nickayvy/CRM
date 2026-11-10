# Team status — Google Maps discovery

| WP | Title | Wave | Agent | Branch / PR | State | Review |
|---|---|---|---|---|---|---|
| WP-18 | Google Places core | 1 | senior-wp18 (Opus 5.5, medium) | wp-18-google-places-core | spawned | reviews/WP-18.md |
| WP-19 | Fast website enrichment and qualify-before-enrich | 1 | senior-wp19 (Opus 5.5, medium) | wp-19-fast-website-enrichment | spawned | reviews/WP-19.md |
| WP-20 | Google Maps search UI, actions, cron resume, docs | 2 | — | wp-20-google-search-ui | waiting on WP-18, WP-19 | reviews/WP-20.md |

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
