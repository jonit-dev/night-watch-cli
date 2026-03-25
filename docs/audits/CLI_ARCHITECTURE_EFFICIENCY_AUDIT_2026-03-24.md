# Night Watch CLI Audit: Execution Inefficiencies and Architectural Gaps

Date: 2026-03-24

## Scope

- `packages/cli`
- `packages/core`
- `scripts`
- `docs`

## Method

- Static audit of CLI entrypoints, queue orchestration, reviewer flow, and scheduler behavior.
- Focus on wasted schedules, control-flow dead ends, and configuration/architecture mismatches.
- No code changes were made.

## Direct Answer to the Reviewer Example

The reviewer does **not** stop at the first PR that needs no work. It scans all matching open PRs first, accumulates the ones needing action, and only exits with `skip_all_passing` after the full scan:

- `scripts/night-watch-pr-reviewer-cron.sh:620-677`
- `scripts/night-watch-pr-reviewer-cron.sh:679-742`

However, there is a more important waste case: a PR with **no review score yet** is currently treated as "good enough", so a review run can burn its schedule and exit with `skip_all_passing` without creating the initial review:

- `scripts/night-watch-pr-reviewer-cron.sh:668-680`
- `instructions/night-watch-pr-reviewer.md:24`
- `docs/prds/reviewer-review-first-fix-later.md:7-33`

## Findings

### ✅ H3. Reviewer runs still waste schedules on unrated PRs because "no score yet" is treated as "nothing to do" — ⭐⭐⭐⭐⭐

Why it matters:

- The reviewer only marks a PR as needing work when there are merge conflicts, failed CI checks, or a review score below threshold.
- A PR with no review score falls through as non-actionable.
- If all matching PRs are clean-but-unrated, the entire review run exits `skip_all_passing`.

Evidence:

- Scan loop only flips `NEEDS_WORK` when score exists and is below threshold: `scripts/night-watch-pr-reviewer-cron.sh:660-673`
- Early exit explicitly treats "or no score yet" as all-good: `scripts/night-watch-pr-reviewer-cron.sh:679-742`
- Prompt repeats the same rule: `instructions/night-watch-pr-reviewer.md:24`
- This gap is already acknowledged in an open PRD: `docs/prds/reviewer-review-first-fix-later.md:7-33`

Recommendation:

- Implement the open PRD.
- First-run behavior should be "review-first", not "skip".
- Add a smoke test for "no score exists" so this case cannot silently regress again.

### ✅ M2. Queued jobs do not preserve CLI override semantics consistently — ⭐⭐⭐⭐

Why it matters:

- The docs say CLI flags override everything.
- That is only true for immediate execution.
- When a run is queued, the dispatcher rebuilds env from disk config and only replays a narrow allowlist of persisted `NW_*` markers.
- Result: queued execution can differ from the command the user actually invoked.

Evidence:

- Docs claim CLI flags are highest precedence: `docs/reference/configuration.md:5-10`
- Commands apply overrides in-memory before building env:
  - Executor: `packages/cli/src/commands/run.ts:393-403`
  - Reviewer: `packages/cli/src/commands/review.ts:218-232`
  - QA: `packages/cli/src/commands/qa.ts:129-139`
- Dispatcher rebuilds queued env from the saved project config: `packages/cli/src/commands/queue.ts:254-272`
- `buildQueuedJobEnv()` reloads config and does not know about CLI overrides: `packages/cli/src/commands/shared/env-builder.ts:168-176`
- Only a small marker allowlist is replayed later: `packages/cli/src/commands/queue.ts:385-420`

Concrete examples:

- `night-watch run --timeout ...` loses the timeout when queued because `NW_MAX_RUNTIME` is not replayed.
- `night-watch qa --timeout ...` loses the timeout when queued because `NW_QA_MAX_RUNTIME` is not replayed.
- `--provider` overrides are rebuilt from config and therefore lost for queued runs.
- Reviewer timeout survives because `NW_REVIEWER_MAX_RUNTIME` happens to be in the allowlist, but reviewer provider override still does not.

Recommendation:

- Persist a structured "effective runtime overrides" object with the queue entry.
- Reconstruct the queued env from that object, not from a partial `NW_*` allowlist.
- Add explicit tests for queued `--provider` and `--timeout` behavior.

### ✅ H2. The "global" queue policy is not actually global; dispatch behavior depends on whichever project happens to call `queue dispatch` — ⭐⭐⭐⭐

Why it matters:

- The queue database is shared across projects, but the queue policy is loaded from the caller's current project at dispatch time.
- This makes `maxConcurrency`, `mode`, and `providerBuckets` effectively nondeterministic in multi-project setups.
- Two projects with different queue configs can observe different dispatch behavior depending on who finished last.

Evidence:

- `queue dispatch` loads config from `process.cwd()`: `packages/cli/src/commands/queue.ts:232-239`
- `queue can-start` does the same: `packages/cli/src/commands/queue.ts:350-355`
- `queue claim` instead loads config from the target project path: `packages/cli/src/commands/queue.ts:304-326`

Impact:

- Project A can enqueue/claim under one queue policy.
- Project B can later dispatch the shared queue under a different policy.
- That breaks the core mental model of a single global scheduler.

Recommendation:

- Move queue policy to one canonical source for the global DB, not `cwd`.
- If per-project queue configs are required, define a merge rule explicitly and persist the effective policy with the queue entry.
- Document the policy source clearly; today the behavior is implicit and unstable.

### ✅ H1. The global queue allows duplicate pending rows for the same project/job, so repeated cron triggers can create a backlog of redundant no-op runs — ⭐⭐⭐⭐

Why it matters:

- When a job cannot claim a slot, the bash layer always enqueues it.
- The queue insert path does not dedupe by `project_path` + `job_type`.
- The dispatcher only considers the first pending row per project, so duplicates sit behind the head entry and drain later one by one.
- Result: if cron keeps firing while a project is busy, the queue can accumulate stale reruns that later consume slots just to no-op.

Evidence:

- Claim failure always falls through to enqueue: `scripts/night-watch-helpers.sh:1069-1090`
- Enqueue path is an unconditional `INSERT`: `packages/core/src/utils/job-queue.ts:249-280`
- Dispatcher only keeps one pending head per project: `packages/core/src/utils/job-queue.ts:171-227`

Example failure mode:

1. Project A reviewer is running.
2. The next 2-3 reviewer crons for Project A fire before the first one finishes.
3. Each failed claim inserts another pending row.
4. After the first run completes, the queue dispatches the next stale reviewer entry anyway.

Recommendation:

- Add idempotent enqueue semantics for active states (`pending`, `dispatched`, `running`) per `project_path + job_type`.
- Prefer "refresh existing pending row" over creating a new one.
- Add a regression test for repeated `claim_or_enqueue` on the same project/job under contention.

### ✅ M1. Cross-project scheduling delay ignores actual cron equivalence and can delay unrelated jobs — ⭐⭐⭐

Why it matters:

- The docs say balancing applies when projects share the same job type and cron schedule.
- The implementation only checks whether the job type is enabled, not whether the schedules actually collide.
- That means a project can be delayed by unrelated peers even when their cron expressions are different.

Evidence:

- Docs claim "same job type and cron schedule": `docs/architecture/scheduler-architecture.md:117-125`
- Peer collection only checks `isJobTypeEnabled(...)`: `packages/core/src/utils/scheduling.ts:67-109`
- Delay is computed from total enabled peers, regardless of schedule: `packages/core/src/utils/scheduling.ts:111-137`

Secondary issue:

- The delay is applied in the CLI before the bash script reaches queue claim/enqueue, so the queue cannot see or manage that waiting time:
  - `packages/cli/src/commands/shared/env-builder.ts:138-154`

Recommendation:

- Filter peers by normalized schedule, not just job type.
- If the intention is to balance all same-job peers globally, update the docs to say that explicitly.
- Consider moving the delay to enqueue time or install-time cron generation instead of a long-lived pre-claim sleep.

### ✅ M3. The reviewer wrapper duplicates GitHub work and its "needs work" preview is not the same logic as the real script — ⭐⭐⭐

Why it matters:

- The TypeScript wrapper performs its own PR listing and preflight checks before launching the real bash flow.
- That adds extra GitHub CLI calls on every review run.
- The wrapper's "Open PRs Needing Work" label is misleading because the helper does not actually evaluate merge state, labels, review score, or the full bash selection logic.

Evidence:

- `getOpenPrsNeedingWork()` only lists open PRs and returns them directly: `packages/cli/src/commands/review.ts:316-344`
- Dry-run presents that list as "Open PRs Needing Work": `packages/cli/src/commands/review.ts:407-418`
- Non-dry-run preflight then calls `gh pr checks` for each listed PR: `packages/cli/src/commands/review.ts:442-460`
- The bash script performs its own full scan again, including label skip, merge state, failed checks, and review-score analysis: `scripts/night-watch-pr-reviewer-cron.sh:620-742`

Additional note:

- Local `gh pr list --help` describes `--head` as filtering by head branch, so the wrapper's repeated `--head <pattern>` usage is not obviously equivalent to the bash script's regex-based branch-prefix filtering.

Recommendation:

- Make the bash script the single source of truth for dry-run selection output.
- If preflight visibility is still desired, extract shared selection logic into one reusable layer instead of maintaining parallel heuristics.

### ✅ L1. Reference docs drift on scheduling defaults and queue semantics — ⭐⭐

Why it matters:

- The docs still communicate behaviors that no longer line up with the current code.
- This raises operator error risk because schedules and override precedence are operational, not cosmetic.

Evidence:

- `commands.md` still documents old install defaults:
  - Docs: `docs/reference/commands.md:124-138`
  - Current defaults: `packages/core/src/constants.ts:39-41`
  - Install uses config schedules, not the documented legacy values: `packages/cli/src/commands/install.ts:201-210`
- `configuration.md` says CLI flags override everything, but queued jobs do not preserve that guarantee: `docs/reference/configuration.md:5-10` plus the evidence in M2 above.

Recommendation:

- Update the docs after fixing M2.
- Treat queue/dispatch behavior as architecture docs, not incidental implementation detail.

## Priority Remediation Order

1. ⭐⭐⭐⭐⭐ Fix reviewer "no score yet" behavior so review schedules do real work.
2. ⭐⭐⭐⭐ Preserve CLI overrides in queued jobs explicitly.
3. ⭐⭐⭐⭐ Define a single authoritative source for global queue policy.
4. ⭐⭐⭐⭐ Add queue dedupe for active entries by project/job.
5. ⭐⭐⭐ Fix scheduler peer filtering to check schedule equivalence.
6. ⭐⭐⭐ Make dry-run/preflight reuse the real reviewer selection logic.
7. ⭐⭐ Align scheduler docs with implementation.

## Bottom Line

The CLI generally avoids hard-stop failures on no-op work, and the reviewer does continue scanning past a clean PR. The bigger efficiency problems are architectural: queue entries are not idempotent, queue policy is not truly global, unrated PRs are skipped instead of reviewed, and the scheduler/dry-run layers each have their own version of reality. Those are the places where schedules and operator intent are currently being lost.
