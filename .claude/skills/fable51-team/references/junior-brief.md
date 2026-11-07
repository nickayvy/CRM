# Junior engineer brief

Used by a **senior engineer** to delegate a bounded task to a junior, and the
checklist the senior applies when the junior's work comes back. The PM does
not normally spawn juniors; it only does so on a senior's behalf when the
senior's environment cannot.

## What makes a good junior task

A junior (Sonnet 5.5, high effort) does excellent work when the target is
unambiguous and the pattern is visible. It does poorly when it has to decide
what "right" means. So delegate tasks where you, the senior, can write down
the finish line in one or two sentences and point at an example in the repo.

Good:
- "Write tests for `src/contacts/repo.ts` covering create, list with filter,
  and delete; follow the style of `tests/accounts.test.ts`; all must pass."
- "QA pass: walk acceptance criteria AC-03.1 through AC-03.4 against the
  running app, record pass/fail with evidence, fix nothing."
- "Bug: `POST /api/deals` returns 500 on a missing `stage` field (repro:
  `curl ...`). Make it return 400 with the standard error body; add a test."
- "Add the `notes` resource to the API following exactly the structure of
  the `tasks` resource in `src/api/tasks/`: routes, validation, repo, tests."

Keep for yourself:
- Anything where two reasonable engineers would build it differently.
- Changes that cross a module or package boundary.
- Anything touching the interfaces in `architecture.md`.
- Work whose spec you had to interpret; if you had to think about what it
  means, the junior will guess.

## Spawn call

```
Agent
  subagent_type: "general-purpose"
  model: "sonnet"
  effort: "high"
  description: "<junior task, 3–5 words>"
  prompt: <the brief below, filled in>
```

No `isolation`: the junior works in your worktree. Run one junior at a time
on a given set of files, and do not edit those files yourself while the
junior is on them.

## Brief template

```markdown
You are a junior engineer working under a senior engineer. You have one task
with a clear finish line. Do that task well, verify it, and report back; do
not expand scope.

## Repo
- Root: <absolute path of the worktree>
- Branch: `wp-NN-<slug>` (already checked out; commit nothing — the senior
  commits after review)
- Stack: <...>   Test: `<command>`   Lint/typecheck: `<command>`

## Task
<One or two sentences. What exists when you are done.>

## Finish line
<Checkable: "all tests in X pass", "curl Y returns Z", "pages A and B render
with no console errors">

## Follow this pattern
<path to the file or module to copy the structure/style of, and why>

## Boundaries
- Edit only: <files/dirs>
- Do not touch: <files/dirs>, and do not change any exported signature in
  <module>.
- If the task turns out to need something outside these boundaries, stop and
  report what you found instead of working around it.

## Report back with
1. Files changed (list).
2. The exact command(s) you ran to verify, with output.
3. Anything you were unsure about or had to assume.
Keep it short; the senior will read the diff.
```

## Senior's review checklist

Apply this to every junior result before committing or building on it. The
point is not distrust; it is that the PR carries your name and the PM will
spot-check junior changes against your review notes.

1. **Read the whole diff** (`git diff` in the worktree), not the junior's
   summary of it.
2. **Run the verification yourself**: the test command, the curl, the page.
   A junior's "all tests pass" is a claim until you see it.
3. **Check boundaries**: did it edit only the files you allowed? Did any
   exported signature change?
4. **Check against the task, not against "is this fine"**: does it hit the
   finish line you wrote? Partial completion reported as done is the most
   common failure.
5. **Check the pattern**: does it match the example you pointed at? Drift in
   structure or naming is cheap to fix now and expensive after merge.
6. **Look for the usual Sonnet-at-speed misses**: error paths not handled,
   tests that assert the implementation rather than the behavior, mocked
   things that should be real, leftover debug output.

Then one of:
- **Accept**: commit it (your commit, your message).
- **Fix**: small issues you can resolve faster than explaining; fix, then
  commit. Note it in your completion report's delegation table.
- **Send back**: `SendMessage` to the junior's agent name with the specific
  gap. One round; if the second result still misses, do it yourself.

Record the outcome per task in your completion report so the PM's delegation
review has something to check.
