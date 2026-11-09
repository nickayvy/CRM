# WP-15: Leads UI (pipeline, history, bulk to campaigns)

**Wave:** 2 (v2)
**Depends on:** WP-11, WP-12 (merged)
**Owns files:** `src/app/leads/**`, `src/features/leads/**`, `src/components/leads/**`, `src/lib/export-csv.ts`, `tests/leads-ui*.test.ts(x)`, `tests/leads-actions*.test.ts`
**Delivers:** branch `wp-15-leads-ui` / PR "WP-15: Leads UI"

## Objective
Port gtm's Leads panel (non-voice parts) as a real `/leads` route: metric tiles, Pipeline/History tabs, the lead queue table with filters, selection, bulk actions into our call campaigns and email sequences, inline notes, status changes, skip/remove, CSV export; History shows this user's dialer call activities.

## Context the engineer needs
- Read `docs/team/v2/gtm-inventory.md` §Leads view, then gtm `components/leads/leads-panel.tsx`, `lead-queue-table.tsx`, `status-badge.tsx`, `lib/export-csv.ts`, `hooks/use-leads.ts`. Exclude everything voice-related.
- Data: architecture §Leads consumes; statuses `queued, contacted, callback, success, failed, skipped` with `LEAD_STATUS_LABELS`. The user comes from `requireUser()` in the page and in every action.
- Metric tiles (four): Leads (total), Queued, Success, Calls (7d) = call activities on this user's lead businesses in the last 7 days.
- Bulk "Add to call campaign…" → `addBusinessesToCampaign(db, campaignId, businessIds)`; "Add to email sequence…" → `enrollBusinesses`; dialogs list non-completed campaigns (reuse the WP-07 pattern in `src/features/businesses/campaign-actions.ts`).
- History tab: `listActivities` of type `call` for the user's lead businesses, newest first, with business name, outcome badge, agent, relative time; empty "No conversations yet".

## Scope
### In
- `/leads` page, `LeadsPanel`, `LeadMetrics`, `LeadQueueTable` (line tabs All/Queued/Contacted/Success/Failed; search; category select when > 1; select-all; selection actions "Add to call campaign…", "Add to email sequence…", "Remove"; right "N leads" + Export CSV), `StatusBadge` (lead), `NotesCell` (inline edit, saves on blur/Enter), actions `updateLeadAction`, `removeLeadAction`, `bulkRemoveLeadsAction`, `addLeadsToCallCampaignAction`, `addLeadsToEmailCampaignAction`, `exportLeadsCsv` (client-side blob: name, phone, website, category, city, rating, reviews, l30d, status, notes).
- Empty pipeline card "Pipeline empty" / "Add businesses from Lookup." linking to `/lookup`.
- Tests: actions scoped by user (a user cannot update another user's lead); bulk add returns counts; CSV builder; table render with tabs/filters (jsdom).
### Out
- Voice agents. Lookup (WP-14).

## Acceptance criteria
AC-15.1 Two users (create via Supabase or insert leads for two uuids in a script): each sees only their own leads on `/leads`.
AC-15.2 Status select, skip, remove, and notes edits persist across reload; tabs and search filter client-side; Export CSV downloads a file with one row per visible lead.
AC-15.3 Select 2 leads → "Add to call campaign…" → the chosen campaign's queue grows by the number of new, callable businesses (check `/calling/[id]`); "Add to email sequence…" enrolls those with emails.
AC-15.4 Recording a dialer outcome `interested` on a lead's business flips the lead to `success` (WP-12 hook) and the History tab shows the call.
AC-15.5 375 px: table scrolls inside its container, selection actions wrap; no horizontal page overflow. Screenshots.
AC-15.6 `npm test`, typecheck, lint, build exit 0.

## Delegation guidance
Juniors: `export-csv.ts` + test, StatusBadge, metric tiles, History tab. Keep: table, actions, bulk dialogs.
