# PM playbook

Templates and judgment calls for the project-manager role. Everything here is
in service of one property: a senior engineer who reads only their package
file should be able to build the right thing, and the PM who reads only the
acceptance criteria should be able to tell whether they did.

## Contents

1. Writing checkable acceptance criteria
2. Sizing work packages
3. Template: `docs/team/spec.md`
4. Template: `docs/team/architecture.md`
5. Template: `docs/team/work-packages/WP-NN-<slug>.md`
6. Template: `docs/team/status.md`
7. Template: `docs/team/reviews/WP-NN.md`
8. Template: `docs/team/summary.md`
9. Review judgment: accept vs revise

---

## 1. Writing checkable acceptance criteria

A criterion is good when two people would reach the same pass/fail verdict
without talking. Write the check, not the aspiration.

| Weak | Checkable |
|---|---|
| "Contacts can be searched" | "`GET /api/contacts?q=ada` returns only contacts whose name or email contains `ada`, case-insensitive; covered by a test in `tests/contacts.test.ts`" |
| "Good error handling" | "Submitting the form with an empty email shows the message `Email is required` under the field and does not call the API" |
| "Fast" | "`npm run bench:list` reports p95 under 200 ms on the 10k-row fixture" |
| "Works on mobile" | "At 375 px wide the contacts table collapses to cards; no horizontal scroll (screenshot in the PR)" |

Each criterion should name the command, request, or screen that proves it.
If you cannot write that sentence, the requirement is not understood well
enough yet; resolve it now, not after an Opus agent has spent an hour on it.

## 2. Sizing work packages

A package is the unit one senior delivers as one PR. Aim for:

- **A few hours of focused work.** Too small and the overhead of a worktree
  and review dominates; too big and the review becomes unreadable and the
  blast radius of a wrong decision grows.
- **Disjoint files.** Parallel seniors must not edit the same files. When two
  packages need the same file, either put them in sequential waves or merge
  them.
- **Explicit inputs and outputs.** The package names the interfaces it
  consumes (already merged or specified in `architecture.md`) and the ones it
  produces. A senior should never need to guess what the package next to
  theirs is doing.
- **A standalone verification.** The senior can prove the package works
  without the rest of the system existing: tests against the interface, a
  fixture, a stub.

Typical shapes: "data model + migrations + repository layer", "API routes for
resource X", "UI for screen Y against the API contract", "auth middleware +
session handling", "CI + test harness". Four to six packages is normal for a
feature; if you have more than ten, the spec is probably describing several
features.

Waves: wave 1 is everything with no dependencies (usually schema, scaffolding,
shared types). Wave 2 depends on wave 1, and so on. Keep the dependency graph
shallow; three waves is plenty.

## 3. Template: `docs/team/spec.md`

```markdown
# <Project or feature name> — Spec

**Status:** draft | approved by user on <date>
**PM:** Fable 5.1

## Goal
One paragraph. What the user gets when this is done, in their words.

## Non-goals
Bullet list of things a reasonable engineer might assume are in scope but are
not. This is where most scope creep is prevented.

## Users and scenarios
- As a <role>, I <do X> so that <Y>.  (3–8 of these)

## Functional requirements
Numbered, one behavior each. Reference scenarios where useful.
R1. ...
R2. ...

## Acceptance criteria
Numbered, each checkable (see playbook §1). Each maps to one or more
requirements and will be assigned to a package.
AC1. ...
AC2. ...

## Decisions made by the PM
Defaults chosen so the user can object rather than be asked:
- <decision>: <choice> — <one-line why>

## Open questions
Only things the PM truly cannot decide. Empty is the goal.
```

## 4. Template: `docs/team/architecture.md`

```markdown
# <Name> — System architecture

## Overview
A paragraph and, if it helps, an ASCII box diagram of components and the
arrows between them.

## Components
### <Component>
- Responsibility:
- Lives in: `<path>`
- Depends on:
- Exposes: (interface summary; link to the section below)

## Data model
Entities, fields, types, relationships, and constraints. If there is a DB,
write the schema here in the DDL or ORM syntax the project uses.

## Interfaces
Every boundary a package will build against. Be exact: routes with request
and response shapes, function signatures, event names and payloads, env vars.
Seniors treat these as frozen; changing one requires coming back to the PM.

## Technology choices
| Concern | Choice | Why (one line) |

## Cross-cutting conventions
Error format, logging, auth propagation, naming, test layout, how env is
loaded. Anything two packages must agree on.

## Deliberately undecided
Things left to the senior's judgment inside their package. Say so explicitly
so seniors know where they have latitude.
```

## 5. Template: `docs/team/work-packages/WP-NN-<slug>.md`

```markdown
# WP-NN: <Title>

**Wave:** 1 | 2 | 3
**Depends on:** WP-xx, WP-yy (must be merged first) | none
**Owns files:** `<glob or list>` — no other package edits these
**Delivers:** branch `wp-NN-<slug>` / PR titled "WP-NN: <Title>"

## Objective
Two or three sentences. What exists when this is done that does not exist now.

## Context the engineer needs
- Project stack, test command, lint command, how to run locally
- Relevant sections of `architecture.md` (quote the interfaces, do not just link)
- Existing code to follow as a pattern, by path

## Scope
### In
- ...
### Out
- ... (and which package owns it instead)

## Interfaces
### Consumes
Exact shapes from `architecture.md`.
### Produces
Exact shapes; these are what later packages will build against.

## Acceptance criteria
Copied from the spec with the WP's own additions. Each one names its proof.
AC-NN.1 ...
AC-NN.2 ...

## Delegation guidance
Which parts look like good junior tasks (tests, QA pass, pattern-following
CRUD) and which the senior should keep. The senior decides; this is advice.

## Reporting
Use the completion-report format from the senior brief.
```

## 6. Template: `docs/team/status.md`

```markdown
# Team status

| WP | Title | Wave | Agent | Branch / PR | State | Review |
|---|---|---|---|---|---|---|
| WP-01 | ... | 1 | <agent name> | wp-01-... | spawned / delivered / revising (round N) / accepted / merged | reviews/WP-01.md |

## Log
- <timestamp> spawned WP-01, WP-02 (wave 1)
- <timestamp> WP-01 delivered; review started
```

Update it at every state change; it is the user's view of the run.

## 7. Template: `docs/team/reviews/WP-NN.md`

```markdown
# Review: WP-NN <Title> — round N

**Branch / PR:** ...
**Reviewed at:** <timestamp>
**Test command output:** (paste the tail, or path to a saved log)

## Acceptance criteria
| AC | Verdict | Evidence |
|---|---|---|
| AC-NN.1 | pass | `npm test` → 14 passed; see tests/x.test.ts:12 |
| AC-NN.2 | FAIL | Expected 400 on empty email, got 500: `curl ...` output below |

## Scope check
- Files outside `Owns files` touched: none | <list and why it matters>
- Interface changes: none | <list>

## Delegation review
What the senior delegated, and whether its review notes are credible given
the diff (spot-check at least one junior change yourself).

## Verdict
ACCEPT | REVISE

## Required changes (if REVISE)
Numbered, each tied to an AC or a scope item, each stating observed vs
expected. This section is sent verbatim to the senior.
```

## 8. Template: `docs/team/summary.md`

```markdown
# <Name> — Run summary

## Shipped
Per package: one line, branch/PR link, review round count.

## Cut or deferred
What was in the spec and did not ship, and why.

## Integration check
Full-suite result on main after the last merge; end-to-end AC walk.

## Open issues
Known gaps, follow-ups, anything the user should decide next.

## Cost
Agents spawned by tier (approximate), rounds of revision.
```

## 9. Review judgment: accept vs revise

Accept when every criterion passes with evidence you produced (not evidence
the senior described), scope is clean, and the delegation review holds up.
Minor style issues are not grounds for a revision round; note them in the
review and move on. The bar is "meets the contract", not "how I would have
written it".

Revise when any criterion fails, when files outside the package were changed
without explanation, or when a junior's change was clearly not reviewed (for
example, it breaks a test the senior claims passed). Send the `Required
changes` section and nothing else; the senior has the context.

After two revision rounds, stop. Either the package was mis-specified (fix
the spec, tell the user, possibly re-spawn with a corrected brief) or the
senior is stuck in a way more rounds will not fix. Bring the user a concrete
choice.
