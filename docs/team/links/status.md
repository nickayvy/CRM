# Team status — external links

| WP | Title | Wave | Agent | Branch / PR | State | Review |
|---|---|---|---|---|---|---|
| WP-17 | External links pulled at scrape time | 1 | senior-wp17 (Opus 5.5, medium) | wp-17-external-links | merged (PR #16, 1 revision round) | reviews/WP-17.md (ACCEPT) |

## Log
- 2026-11-09 Root cause measured on production: 144 of 148 Trustpilot rows are bare seed rows; 0 rows have social links; `enrichFromWebsite` has no caller. Spec, architecture and WP-17 written under `docs/team/links/`.
- 2026-11-09 WP-17 spawned (wave 1, single package).
- 2026-11-09 WP-17 delivered (PR #16, 14 files, 807 → 1013 tests). PM review: all 12 criteria pass, but live testing found the plan's 10 requests/minute limit, which the spec had missed. Spec and architecture amended (R8, R9); REVISE round 1 sent.
- 2026-11-09 WP-17 round 1 delivered (16 files, 1033 tests): pacing to FIRECRAWL_REQUESTS_PER_MINUTE (default 10), typed 429, drains wait or stop. PM review round 2: ACCEPT (own run green; live 429 mapped to FirecrawlRateLimited). Merged to main.
- 2026-11-09 Pushed main (575a11b); production deploy READY. Production backfill of the 148 existing rows written through the Supabase MCP (six md5-guarded batches). Trustpilot rows now: 154 with website, 129 with social links, 103 with email, 80 with phone, 4 pending. Production enriched its own 6 new rows after the deploy. Run summary: summary.md.
