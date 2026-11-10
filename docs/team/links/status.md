# Team status — external links

| WP | Title | Wave | Agent | Branch / PR | State | Review |
|---|---|---|---|---|---|---|
| WP-17 | External links pulled at scrape time | 1 | senior-wp17 (Opus 5.5, medium) | wp-17-external-links | revising (round 1) | reviews/WP-17.md |

## Log
- 2026-11-09 Root cause measured on production: 144 of 148 Trustpilot rows are bare seed rows; 0 rows have social links; `enrichFromWebsite` has no caller. Spec, architecture and WP-17 written under `docs/team/links/`.
- 2026-11-09 WP-17 spawned (wave 1, single package).
- 2026-11-09 WP-17 delivered (PR #16, 14 files, 807 → 1013 tests). PM review: all 12 criteria pass, but live testing found the plan's 10 requests/minute limit, which the spec had missed. Spec and architecture amended (R8, R9); REVISE round 1 sent.
