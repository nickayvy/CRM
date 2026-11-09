# WP-11: Leadwire theme, shell, and Supabase Auth

**Wave:** 1 (v2)
**Depends on:** none (v1 main)
**Owns files:** `src/app/globals.css`, `src/app/layout.tsx`, `src/app/template.tsx`, `src/app/page.tsx`, `src/app/login/**`, `src/app/signup/**`, `src/app/api/auth/**` (delete v1 login/logout routes, add `callback`), `src/app/lookup/page.tsx` and `src/app/leads/page.tsx` (placeholders only), `src/app/design/**`, `src/proxy.ts`, `src/lib/supabase/**`, `src/components/shell/**`, `src/components/ui/**`, `src/components/primitives/**` (restyle only, no API changes), `src/lib/motion/**` (tokens only if needed), `public/**`, `README.md`, `package.json`/lockfile (add `@supabase/ssr`, `@supabase/supabase-js`; remove `next-themes`), `tests/primitives*.test.tsx`, `tests/shell*.test.tsx`
**Does not touch:** `src/lib/env.ts`, `src/db/**`, `src/lib/yelp/**`, `src/lib/qualify/**`, `tests/` other than listed (WP-12 owns those in the same wave)
**Delivers:** branch `wp-11-theme-shell-auth` / PR "WP-11: Leadwire theme, shell, auth"

## Objective
The app looks and navigates like Leadwire and is protected by Supabase Auth. Tokens, fonts, utilities, shell, auth pages, and the primitives' styling are ported from `/Users/nick/Documents/projects/gtm`; the v1 shared-password gate is gone; `/` redirects to `/lookup`; `/lookup` and `/leads` exist as styled placeholders for wave 2.

## Context the engineer needs
- Read `docs/team/v2/spec.md`, `docs/team/v2/architecture.md` (§Auth, §Routes, §Cross-cutting), `docs/team/v2/gtm-inventory.md`, then the gtm files themselves: `app/globals.css`, `app/layout.tsx`, `app/(dashboard)/layout.tsx`, `components/layout/topbar.tsx`, `app/(auth)/**`, `components/auth/**`, `components/ui/**`, `lib/supabase/**`, `middleware.ts`, `app/api/auth/callback/route.ts`.
- Supabase project: URL `https://aszvhaanfiiofmzvzfub.supabase.co`, publishable key `sb_publishable_toAV9lj4RpCpchmybCfMPw_QlbRioKE` (public by design). Put both in `.env.local` for your own browser checks (do not commit `.env.local`). `@supabase/ssr` accepts the publishable key where the anon key is expected.
- Our stack differs from gtm: shadcn `radix-nova` style, Tailwind v4, `motion`, TanStack table inside `DataTable`. Keep our primitive APIs (names, props) exactly; change only classes/tokens so wave-2/3 packages keep compiling.
- The v1 `src/lib/env.ts` still exports `APP_PASSWORD`/`APP_SESSION_SECRET` until WP-12 removes them; do not reference them anywhere after your change.

## Scope
### In
- `globals.css`: port the token blocks (dark only), `--surface*`, shadows, radius, `.main-depth`, `.surface-*`, `.card-glow`, `.dossier-scroll`; keep our `--tone-*` tokens but re-tune them to the Leadwire palette (success/warning as blue tints or restrained green/amber; destructive #ef4444); `tabular-nums` on body; `duration-300 ease-out` defaults where we had 200 ms.
- `layout.tsx`: Space Grotesk + Source Serif 4 via `next/font/google` (`--font-space-grotesk`, `--font-serif-display`), `<html lang="en" class="dark">`, Toaster `richColors position="bottom-right"`, no ThemeProvider.
- Shell: top bar only (remove the sidebar and `[` shortcut): left brand (copy `gtm/public/logo.png` to `public/logo.png`, "Leadwire" serif, tagline "Turn market noise into signal."), center nav `LOOKUP` (LayoutGrid) `/lookup`, `LEADS` (GitBranch) `/leads`, `CALLING` (Phone) `/calling`, `EMAIL` (Mail) `/email`, `OVERVIEW` (LayoutDashboard) `/overview`; active = `bg-muted/60 text-foreground`; right: user menu (User icon + email) with "Settings" (`/settings`) and "Sign out". Keep the command-palette trigger (⌘K) in the right cluster; keep `?` shortcuts dialog. `<main class="main-depth flex-1 overflow-auto">`. Phone layout: nav collapses into a `Menu` dropdown.
- Auth: `src/lib/supabase/{config,client,server,middleware}.ts` per architecture; `src/proxy.ts` → `updateSession`; `/login`, `/signup` pages ported from gtm (card-glow card, serif title, email+password, loading text, footer link); `/api/auth/callback` exchanging the code; sign out from the user menu. Delete the v1 password gate (`/api/auth/login`, `/api/auth/logout`, the `crm_session` logic, the logout button code).
- `/` → `redirect('/lookup')`. Placeholders `/lookup` and `/leads` (PageShell + "Built in WP-14/WP-15", styled).
- Primitives restyle: `PageShell/PageHeader/PageSection`, `StatCard` (metric tile look: `bg-surface shadow-[var(--shadow-elevated)]`, serif `text-4xl` value), `DataTable` (gtm table row/head/cell classes, wrapper `rounded-lg bg-surface shadow-[var(--shadow-elevated)]`), `FilterBar`, `StatusBadge`/`ReasonChip` (gtm badge recipe), `EmptyState`, `SidePanel` (`surface-floating`), `Timeline`, `ScoreRing`, `ProgressBar`, `ChartCard`, `Kbd`, `Toolbar`, `ConfirmDialog`. shadcn `ui/*`: apply gtm's Input `surface-inset`, Dialog `surface-floating`, Tabs line variant with primary underline, Tooltip light-on-dark, Slider track/range.
- `/design` refreshed to show the new look (same sections).
- README: replace the gate section with Supabase Auth setup (env vars, Site URL + redirect URL `https://<domain>/api/auth/callback`, email confirmation note).
### Out
- Any DB/schema/env.ts changes (WP-12). Lookup/Leads content (WP-14/15). Restyling feature pages' internals (WP-16) — but they must still render under the new shell.

## Interfaces
### Consumes: nothing new.
### Produces: `src/lib/supabase/*` per architecture; the restyled primitives with unchanged APIs; shell with the five nav items.

## Acceptance criteria
AC-11.1 Clean clone: `npm ci && npm run db:migrate && npm run db:seed && npm test && npm run typecheck && npm run lint && npm run build` exit 0 (with no Supabase env, build must still pass).
AC-11.2 Token parity: a script or test compares the `:root` block values of our `globals.css` with gtm's for background, foreground, card, primary, secondary, muted, muted-foreground, accent, border, input, ring, radius, surface, surface-elevated, shadow-elevated, shadow-floating — all equal. `font-sans`/`font-serif` resolve to Space Grotesk / Source Serif 4 (grep the layout).
AC-11.3 With `.env.local` holding the Supabase URL + publishable key and `npm run dev`: unauthenticated `/lookup` → 307 `/login`; `/login` renders the Leadwire card; sign up with a test address (use a mailbox you control or an address like `pm+test@example.com` and note that confirmation is required), or sign in with a user you create in the Supabase dashboard; after sign-in `/lookup` shows the shell with five nav items and the user menu; "Sign out" returns to `/login`. Screenshots light? No — dark only; screenshots of `/login`, `/lookup` placeholder, `/design`.
AC-11.4 `/` → `/lookup`; `/api/cron/*` and `/api/auth/*` are reachable without a session (curl 401 from cron without bearer, not a redirect).
AC-11.5 `/design` renders every primitive in the new language with zero console errors; 375 px: no horizontal overflow; nav collapses to a menu.
AC-11.6 No references remain to `APP_PASSWORD`, `APP_SESSION_SECRET`, `crm_session`, `next-themes`, `ThemeToggle` (grep).

## Delegation guidance
Juniors: port `ui/*` class changes, the `/design` refresh, token-parity test, README. Keep: globals tokens, shell, Supabase auth plumbing, primitives restyle decisions.
