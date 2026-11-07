# WP-06: Email campaigns and sequence runner

**Wave:** 3
**Depends on:** WP-02, WP-03 (merged)
**Owns files:** `src/app/email/**`, `src/app/api/cron/email/**`, `src/features/email/**`, `src/db/repo/email-campaigns.ts`, `src/lib/email/**`, `tests/email*.test.ts(x)`
**Delivers:** branch `wp-06-email` / PR "WP-06: Email"

## Objective
Cold-email sequences in the Origami style: ordered steps with delays and
personalization tokens, enrollment of businesses that have an email, a
runner that sends what is due within a daily cap through Resend or a
dry-run sender, manual reply/unsubscribe handling, pause/resume, and a
message log.

## Context the engineer needs
- Architecture §Interfaces for `src/db/repo/email-campaigns.ts` and
  `src/lib/email/sender.ts`; §Campaign automation (email runner paragraph).
  Tables: `email_campaigns`, `email_steps`, `email_enrollments`, `email_messages`.
- Install `resend`. `ResendSender` is only constructed when
  `env.RESEND_API_KEY` is set; never call the network in tests (inject a
  fake `EmailSender`).
- Consume `listBusinesses`/`listBusinessIds`/`getBusiness`/`updateBusinessCrm`
  (WP-03), `logActivity` (WP-01), primitives (WP-02).

## Scope
### In
- `renderTemplate` with the token list in architecture (`{{owner_first_name}}`
  = first word of `ownerName`, empty if none).
- Repo per interface; `enrollBusinesses` sets `nextSendAt = now` and
  `currentStep = 0`; `processDueSends` per the runner paragraph;
  `processAllDue` iterates running campaigns; pause/resume with
  `pauseReason` `manual`; a campaign with no active enrollments after a
  run becomes `completed`.
- Actions `src/features/email/actions.ts`: create/update campaign with
  steps (zod: name, fromName, fromEmail valid, dailyCap 1–1000, ≥ 1 step,
  each subject/body non-empty, delayDays 0–60, first step delay 0),
  `enrollAction(campaignId, filter | ids)`, `processNowAction(campaignId)`,
  `markRepliedAction`, `unsubscribeAction`, `pauseAction`, `resumeAction`,
  `startAction` (draft → running, runs `processDueSends` immediately).
- `/email`: list with status badge, enrollment stats, sent today/cap,
  sender kind badge ("Dry run" when no Resend key).
- `/email/new`, `/email/[id]/settings`: campaign form + steps editor (add,
  remove, reorder, per-step subject/body/delay, token help, live preview
  rendered against a seeded business of the user's choosing via a select).
- `/email/[id]`: stats, controls (start/pause/resume/process now), "Enroll
  businesses" side panel (filter: qualified, has email, exclude
  do-not-email, city, category) with count then "Enroll N"; enrollments
  `DataTable` (business, email, state badge, step x/N, next send, last
  sent; row actions: Mark replied, Unsubscribe); `/email/[id]/messages`:
  log table (time, to, subject, status badge, step) with a body preview
  `SidePanel`.
- `GET /api/cron/email`: bearer check; `processAllDue`; returns `{ sent: n }`.
- Tests `tests/email.test.ts` for AC-06.1–06.4; `tests/email-template.test.ts`.
### Out
- Real inbound reply detection. Business editing. Dashboard (expose `countEmailsSent`, `listEmailCampaigns` stats).

## Interfaces
### Consumes
WP-03 business repo; WP-01 activities, env; WP-02 primitives.
### Produces
`src/db/repo/email-campaigns.ts` and `src/lib/email/sender.ts` exactly as architecture; the actions above.

## Acceptance criteria
AC-06.1 Runner: campaign with steps (delay 0, 2, 4), dailyCap 50, two enrollments at `now` → `processDueSends` sends 2 step-1 messages (dry-run sender records them with `status:'dry_run'`, rendered subject/body contain the business name), sets `currentStep` 1 and `nextSendAt = now + 2 days`; running again at `now + 1 day` sends nothing; at `now + 2 days` sends step 2; after step 3 the enrollment is `completed`.
AC-06.2 Cap: dailyCap 1 with three due enrollments → one sent per run per local day; the next day the next one sends.
AC-06.3 Skips: enrollment whose business lost its email or has `doNotEmail` → not sent, enrollment `paused`, a `system` activity logged; `markReplied` → state `replied`, no further sends; `unsubscribe` → state `unsubscribed` and business `doNotEmail` true.
AC-06.4 `enrollBusinesses` skips businesses without `ownerEmail`, with `doNotEmail`, or already enrolled, and reports `{ enrolled, skipped }`; `renderTemplate` replaces every documented token and blanks unknown ones.
AC-06.5 Browser: create a 3-step campaign, enroll via the panel (filter has email) → N enrollments; Start → messages page shows N `dry_run` rows with rendered subjects; Mark replied on one → state replied; Pause → status paused (manual). Screenshots.
AC-06.6 `curl` the cron route with and without the bearer as in WP-05.
AC-06.7 At 375 px the steps editor and enrollments table are usable with no page-level horizontal scroll. `npm test`, typecheck, lint, build exit 0.

## Delegation guidance
Good junior tasks: `renderTemplate` + its test, the messages log page,
the cron route, the list page, test cases AC-06.2–06.4 after you write
AC-06.1. Keep: runner, steps editor, enrollment panel.

## Reporting
Completion-report format from the senior brief.
