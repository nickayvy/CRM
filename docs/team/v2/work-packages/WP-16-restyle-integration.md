# WP-16: Restyle v1 screens, overview, integration

**Wave:** 3 (v2)
**Depends on:** WP-13, WP-14, WP-15 (merged)
**Owns files:** `src/app/businesses/**`, `src/app/searches/**`, `src/app/calling/**`, `src/app/email/**`, `src/app/settings/**`, `src/app/overview/**` (move the v1 dashboard from `src/app/page.tsx` here; `/` keeps redirecting), `src/features/businesses/**`, `src/features/searches/**`, `src/features/rules/**`, `src/features/calling/**`, `src/features/email/**`, `src/features/dashboard/**`, `src/components/command-palette.tsx`, `src/components/shell/**` (nav tweaks only), `docs/deploy.md`, `README.md` (deploy section), `tests/**` for the files above
**Delivers:** branch `wp-16-restyle` / PR "WP-16: Restyle and integration"

## Objective
Every remaining v1 screen is composed in the Leadwire language under the new shell: businesses table and detail, searches (Yelp, with a clear "not configured" state), calling list, campaign, dialer, email list, campaign, messages, settings, rules, and the overview (old dashboard). Copy and labels follow Leadwire's tone. Nothing references fixtures or the old theme.

## Context the engineer needs
- Read `docs/team/v2/gtm-inventory.md` §Visual language and the merged WP-11/14/15 code for the house style (metric tiles, panels, tables, badges, micro-labels). Use the restyled primitives; replace leftover `Card`-heavy layouts with `bg-surface` panels and shadows; serif display numerals on metric tiles; dialer keeps its keyboard workflow but adopts the dark panel look (outcome buttons as `bg-surface` tiles with primary accents).
- Businesses table: add a Source column/filter (Yelp/Trustpilot) and the L30D column; detail page shows Trustpilot fields (trust score, socials, logo) when present and the v1 Yelp fields when present.
- Searches: when `YELP_API_KEY` is missing show an EmptyState "Yelp search is not configured" with the env var name; no fixture notice.
- Overview: v1 dashboard moved to `/overview`, tiles restyled, charts on the blue ramp `--chart-1..5`; add Leads by status and Businesses by source tiles.
- Command palette: pages list = Lookup, Leads, Calling, Email, Overview, Settings, Design; include leads in search results? (no — businesses + campaigns are enough).
- `docs/deploy.md`: add Supabase Auth setup (Site URL `https://<vercel-domain>`, Redirect URL `/api/auth/callback`, email confirmation), env table additions (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `FIRECRAWL_API_KEY`), the single daily cron, and "no demo data" note.

## Scope
### In
- Restyle of every listed route and its feature components; `/overview`; palette and nav wiring; docs.
- Responsive sweep of all routes at 375 px.
### Out
- New data model or new features beyond the Source column/filter and the overview tiles.

## Acceptance criteria
AC-16.1 Every route (`/lookup, /leads, /businesses, /businesses/[id], /searches, /searches/new, /calling, /calling/new, /calling/[id], /calling/[id]/dial, /email, /email/new, /email/[id], /email/[id]/messages, /settings, /settings/rules, /overview, /design`) renders under the shell in the Leadwire language with no console errors (screenshots of at least 8).
AC-16.2 `grep -rn "fixture\|Built in WP\|next-themes" src | wc -l` = 0.
AC-16.3 Businesses table filters by Source and sorts by L30D; detail shows Trustpilot fields for a Trustpilot row.
AC-16.4 `/searches/new` without a Yelp key shows the not-configured state and no form submission is possible.
AC-16.5 `/overview` tiles equal independent SQL in `tests/dashboard.test.ts` (extend the v1 test for the two new tiles).
AC-16.6 375 px: every route has no horizontal page overflow (list checked routes).
AC-16.7 `npm test`, typecheck, lint, build (0 warnings) exit 0; `docs/deploy.md` updated.

## Delegation guidance
Juniors: settings/rules restyle, searches restyle, email messages page, responsive QA sweep, deploy doc. Keep: businesses table/detail, dialer, overview.
