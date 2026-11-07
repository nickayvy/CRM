# WP-05: Call campaigns, queue runner, dialer

**Wave:** 3
**Depends on:** WP-02, WP-03 (merged)
**Owns files:** `src/app/calling/**`, `src/app/api/cron/campaigns/**`, `src/app/api/calling/**`, `src/features/calling/**`, `src/db/repo/call-campaigns.ts`, `src/lib/agent-cookie.ts`, `tests/calling*.test.ts(x)`
**Delivers:** branch `wp-05-calling` / PR "WP-05: Calling"

## Objective
Concurrent calling campaigns with isolated queues, a claim path that is
safe across many agents and serverless instances, automatic pause/resume
by daily cap and calling hours, and a keyboard-first dialer workspace
that lets an agent work a queue without touching the mouse.

## Context the engineer needs
- Read architecture §Campaign automation and concurrency in full; it is
  the contract (claim SQL, outcome transitions, evaluation rules), and
  §Interfaces for `src/db/repo/call-campaigns.ts`.
- Data you consume: `listBusinesses`/`listBusinessIds`/`getBusiness`/
  `updateBusinessCrm` (WP-03), `logActivity` (WP-01), schema tables
  `call_campaigns`, `call_queue_items`.
- Primitives (WP-02) for every screen. Markdown for scripts: `react-markdown`.
- Timezones: use `date-fns-tz` for "same local day" and "within hours".
- PGlite is single-connection, so `FOR UPDATE SKIP LOCKED` cannot be
  contention-tested there; test the semantics (no double claims across
  sequential calls, lease expiry re-queue) and keep the SQL exactly as
  specified so it is correct on Supabase.

## Scope
### In
- Repo per interface. `claimNext` must be one `UPDATE … WHERE id = (SELECT … FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *` executed through `db.execute(sql\`…\`)` (or Drizzle's equivalent) inside a transaction after `evaluateCampaign`.
- `src/lib/agent-cookie.ts`: `getAgentName()` / `setAgentName()` on cookie `crm_agent`.
- Server actions `src/features/calling/actions.ts`: create/update campaign
  (zod: name required, dailyCap ≥ 1 or empty, hours both-or-neither,
  timezone must be a valid IANA zone, maxConcurrentAgents 1–50,
  maxAttempts 1–10), `addBusinessesAction(campaignId, filter | ids)`,
  `pauseAction`, `resumeAction`, `startAction` (draft → running),
  `claimNextAction(campaignId)`, `recordOutcomeAction(itemId, prev, formData)`,
  `skipAction(itemId)`, `setAgentAction`.
- `/calling`: campaign cards/table with status badge (+ pause reason),
  queue counts, completed today / cap, active agents, "Open dialer" and
  "Manage" buttons; "New campaign".
- `/calling/new` and `/calling/[id]/settings`: form (name, description,
  script textarea with token help: `{{business_name}}`, `{{owner_first_name}}`,
  `{{city}}`, `{{category}}`, `{{rating}}`, `{{review_count}}`; daily cap;
  calling hours start/end + timezone select; max agents; max attempts).
- `/calling/[id]`: stats (`StatGrid`), controls (start/pause/resume),
  "Add businesses" `SidePanel` with the business filter (qualification
  default qualified, has phone, exclude do-not-call, city, category, min
  score, text) showing a live count then "Add N"; queue `DataTable`
  (position, business, state, attempts, last outcome, claimed by, callback
  at; remove button for pending); due callbacks section; outcome
  breakdown for this campaign; auto-refresh via `GET /api/calling/[id]/status` every 5 s.
- `/calling/[id]/dial`: if no agent cookie, inline name form; otherwise
  the workspace: top bar (campaign, agent, session counter of outcomes
  recorded this visit, pause status), "Next" (`N` key) → claims; business
  card (name, phone large with `tel:`, city, category, rating·reviews,
  owner, score, previous outcomes for this item, last 5 activities),
  script rendered with tokens filled, notes textarea, outcome buttons in
  this order with digit shortcuts 1–8: no_answer, voicemail, busy,
  interested, not_interested, callback, wrong_number, do_not_call;
  callback opens a datetime picker (default tomorrow 10:00 local); after
  an outcome the next item is claimed automatically (toggle "auto-next",
  default on); `S` skips (release). When the campaign is not running,
  show the reason and a Resume button (if manual) instead of Next.
  Transitions use `Presence`/`FadeIn`.
- `GET /api/cron/campaigns`: bearer check when `CRON_SECRET`, calls
  `evaluateAllCampaigns`, returns `{ evaluated: n }`.
- Tests `tests/calling.test.ts` covering every item in AC-05.1–05.4.
### Out
- Business editing (WP-04). Dashboard aggregation (WP-07; expose
  `countCallsByOutcome`, `listDueCallbacks`, and `listCallCampaigns` stats for it).

## Interfaces
### Consumes
WP-03 business repo; WP-01 activities, env, labels (`OUTCOME_LABELS`); WP-02 primitives.
### Produces
`src/db/repo/call-campaigns.ts` exactly as architecture §Interfaces; the
actions above; `src/features/calling/components/add-businesses-panel.tsx`
exporting `AddBusinessesPanel({ campaignId, kind: 'call' })` is NOT shared —
WP-06 builds its own; WP-07 will call `addBusinessesToCampaign` directly.

## Acceptance criteria
AC-05.1 Claiming: seed a campaign with 3 pending items; `claimNext(db, c, 'ann')` and `claimNext(db, c, 'bob')` return different items in position order; a third claim by 'cat' returns the last; a fourth returns `{ ok:false, reason:'empty' }`… unless `maxConcurrentAgents` = 2, in which case the third returns `agent_limit`. Expiring ann's lease (set `leaseExpiresAt` in the past) makes her item claimable by 'dan'.
AC-05.2 Outcomes: `no_answer` ×3 with `maxAttempts` 3 → item `skipped` and business status `contacted`; `interested` → completed + status interested; `callback` with a date → state callback and not claimable until that time, then claimable first (before pending items); `do_not_call` → business `doNotCall` true, status `do_not_call`, and its pending item in a second campaign deleted. Every outcome creates one `activities` row with `type:'call'`, the outcome, agent, campaignId.
AC-05.3 Evaluation: `dailyCap` 2 and two outcomes today → paused `daily_cap`; `evaluateCampaign` at a `now` on the next local day → running again; hours 09:00–17:00 America/Chicago evaluated at 08:00 local → paused `outside_hours`, at 09:00 → running; manual pause then any evaluation → still paused `manual`; zero available items and no future callbacks → completed; zero available but a future callback → paused `exhausted`, and at the callback time → running.
AC-05.4 Isolation: two running campaigns sharing a business; claims on campaign A never return campaign B's items; `getCampaignStats` counts are per campaign.
AC-05.5 Browser: on the seeded running campaign, open the dialer, enter agent name, press `N` → business shown; press `3` → busy recorded, next business appears; press `6`, pick a time, submit → the campaign page queue shows that item in `callback`; session counter shows 2; pause the campaign from its page → dialer shows "Paused (manual)" and no Next. Screenshots.
AC-05.6 "Add businesses" panel with filter qualified + has phone + city Houston shows a count and adds that many (minus already-present and do-not-call); the queue table grows accordingly.
AC-05.7 `curl -H "Authorization: Bearer x" /api/cron/campaigns` with `CRON_SECRET=x` → `{ evaluated: n }`; without the header → 401.
AC-05.8 At 375 px the dialer is usable: outcome buttons wrap into a grid, no horizontal scroll (screenshot). `npm test`, typecheck, lint, build exit 0.

## Delegation guidance
Good junior tasks: campaign list/settings pages after you build one form,
the status JSON route, `tests/calling.test.ts` cases AC-05.2 after you
write AC-05.1, the cron route. Keep: `claimNext`, `evaluateCampaign`,
`recordOutcome`, the dialer.

## Reporting
Completion-report format from the senior brief.
