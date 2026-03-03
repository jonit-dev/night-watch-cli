# Core Flow Test Gap Audit

Date: 2026-03-03

## Scope
- Core cron flows:
  - `scripts/night-watch-cron.sh`
  - `scripts/night-watch-pr-reviewer-cron.sh`
  - `scripts/night-watch-qa-cron.sh`
  - `scripts/night-watch-audit-cron.sh`
- Main smoke coverage:
  - `packages/cli/src/__tests__/scripts/core-flow-smoke.test.ts`
- Command-level tests for run/review/qa/audit.

## Current Status
- `yarn test` is currently failing in `packages/cli` because 7 board provider tests fail (`packages/cli/src/__tests__/board/providers/github-projects.test.ts:528`, `:559`, `:575`, `:610`, `:673`, `:693`, `:752`) with `Cannot read properties of undefined (reading 'hasNextPage')` coming from `packages/core/src/board/providers/github-projects.ts:529` and `:585`.
- Isolated core smoke still passes: `yarn vitest run packages/cli/src/__tests__/scripts/core-flow-smoke.test.ts` => 10/10 tests green.

Conclusion: core smoke paths are healthy, but test confidence is incomplete and overall CI is not green.

## Coverage Matrix (Script Outcomes vs Smoke Assertions)

### Executor (`night-watch-cron.sh`)
Outcomes emitted:
- `skip_locked` (`scripts/night-watch-cron.sh:72-74`) -> not covered
- `skip_no_eligible_prd` (`scripts/night-watch-cron.sh:115`, `:143`) -> covered (`core-flow-smoke.test.ts:106-115`)
- `success_open_pr` (`scripts/night-watch-cron.sh:432`, `:434`) -> covered (`core-flow-smoke.test.ts:127-177`)
- `failure_no_pr_after_success` (`scripts/night-watch-cron.sh:462`) -> covered (`core-flow-smoke.test.ts:179-211`)
- `success_already_merged` (`scripts/night-watch-cron.sh:292`, `:295`, `:446`, `:448`) -> not covered
- `failure_finalize` (`scripts/night-watch-cron.sh:299`, `:437`, `:451`) -> not covered
- `timeout` (`scripts/night-watch-cron.sh:474`) -> not covered
- `failure` (`scripts/night-watch-cron.sh:483`) -> not covered

High-risk untested logic in same flow:
- Board mode issue intake and state transitions (`scripts/night-watch-cron.sh:92-137`, `:423-431`, `:456-480`) -> no board-mode smoke assertions.
- Rate-limit retry + fallback flow (`scripts/night-watch-cron.sh:366-418`) -> no smoke assertions.

### Reviewer (`night-watch-pr-reviewer-cron.sh`)
Outcomes emitted:
- `skip_locked` (`scripts/night-watch-pr-reviewer-cron.sh:102-104`) -> partially covered (only "not emitted" in worker race test; no direct lock-contention assertion)
- `skip_no_open_prs` (`scripts/night-watch-pr-reviewer-cron.sh:140-143`) -> covered (`core-flow-smoke.test.ts:117-125`)
- `skip_all_passing` (`scripts/night-watch-pr-reviewer-cron.sh:260`) -> not covered
- `success_reviewed` (`scripts/night-watch-pr-reviewer-cron.sh:70`) -> covered (`core-flow-smoke.test.ts:421-424`)
- `timeout` (`scripts/night-watch-pr-reviewer-cron.sh:73`) -> not covered
- `failure` (`scripts/night-watch-pr-reviewer-cron.sh:76`) -> not covered

High-risk untested logic in same flow:
- Parallel worker result aggregation (`scripts/night-watch-pr-reviewer-cron.sh:327-377`) only validated for success, not timeout/failure mixes.
- Auto-merge paths before and after reviewer run (`scripts/night-watch-pr-reviewer-cron.sh:202-258`, `:463-530`) not covered.

### QA (`night-watch-qa-cron.sh`)
Outcomes emitted:
- `skip_locked` (`scripts/night-watch-qa-cron.sh:64-66`) -> not covered
- `skip_no_open_prs` (`scripts/night-watch-qa-cron.sh:97-100`) -> covered (`core-flow-smoke.test.ts:213-221`)
- `skip_all_qa_done` (`scripts/night-watch-qa-cron.sh:152-155`) -> not covered
- `success_qa` (`scripts/night-watch-qa-cron.sh:261`, `:263`) -> not covered
- `timeout` (`scripts/night-watch-qa-cron.sh:268`, `:270`) -> not covered
- `failure` (`scripts/night-watch-qa-cron.sh:275`, `:277`) -> covered (`core-flow-smoke.test.ts:223-270`)

### Audit (`night-watch-audit-cron.sh`)
Outcomes emitted:
- `failure reason=unknown_provider` (`scripts/night-watch-audit-cron.sh:50`, `:132`) -> not covered
- `skip_locked` (`scripts/night-watch-audit-cron.sh:56-58`) -> not covered
- `skip_dry_run` (`scripts/night-watch-audit-cron.sh:68`) -> not covered
- `failure_missing_prompt` (`scripts/night-watch-audit-cron.sh:74`) -> not covered
- `failure reason=worktree_setup_failed` (`scripts/night-watch-audit-cron.sh:93`) -> not covered
- `failure_no_report` (`scripts/night-watch-audit-cron.sh:149`) -> covered (`core-flow-smoke.test.ts:272-295`)
- `skip_clean` (`scripts/night-watch-audit-cron.sh:155`) -> covered (`core-flow-smoke.test.ts:297-321`)
- `success_audit` (`scripts/night-watch-audit-cron.sh:158`) -> covered (`core-flow-smoke.test.ts:323-361`)
- `timeout` (`scripts/night-watch-audit-cron.sh:162`) -> not covered
- `failure provider_exit=...` (`scripts/night-watch-audit-cron.sh:165`) -> not covered

## Additional Gaps Outside Smoke

### Command-level behavior is mostly helper-tested
- `run`, `review`, and `qa` command tests focus on env/override helpers (`buildEnvVars` and `applyCliOverrides`), not full command action behavior:
  - `packages/cli/src/__tests__/commands/run.test.ts:101`, `:326`
  - `packages/cli/src/__tests__/commands/review.test.ts:96`, `:217`
  - `packages/cli/src/__tests__/commands/qa.test.ts:105`, `:247`
- No dedicated `audit` command test file exists under `packages/cli/src/__tests__/commands/`.

### Bats helper tests are present but not in CI path
- Helper tests exist at `scripts/test-helpers.bats`.
- CI runs `yarn test` (`.github/workflows/tests.yml` and `.github/workflows/ci.yml`), which does not execute Bats.

## Recommended Improvements (Prioritized)

### P0 (close critical confidence gaps first)
1. Add smoke tests for lock contention outcomes (`skip_locked`) across all 4 cron scripts.
2. Add smoke tests for timeout outcomes:
   - executor `timeout`
   - reviewer `timeout`
   - qa `timeout`
   - audit `timeout`
3. Add executor tests for:
   - `success_already_merged`
   - `failure_finalize`
   - generic provider `failure`
4. Add reviewer tests for:
   - `skip_all_passing`
   - `failure`
   - one mixed parallel case (one worker timeout, one success) to validate aggregation.
5. Fix current board-provider failures so `yarn test` is green again (otherwise confidence reports are noisy).

### P1 (core-flow completeness)
1. Add board-mode smoke tests for executor:
   - targeted issue (`NW_TARGET_ISSUE`)
   - non-targeted next issue path
   - move back to Ready on failure.
2. Add executor rate-limit fallback smoke:
   - simulated 429 in log
   - assert fallback marker in `NIGHT_WATCH_RESULT`.
3. Add QA idempotency smoke (`skip_all_qa_done`) and successful end-to-end QA (`success_qa`).
4. Add audit negative-path smoke:
   - unknown provider
   - missing prompt
   - worktree setup failure
   - provider non-zero failure marker.

### P2 (command-layer confidence)
1. Add `packages/cli/src/__tests__/commands/audit.test.ts` for:
   - env building
   - dry-run rendering
   - exit/notification behavior on `skip_clean`, `success_audit`, and failure paths.
2. Add action-path tests for run/review/qa commands (mock `executeScriptWithOutput`) to assert:
   - spinner success/failure messaging
   - notification suppression on `skip_*`
   - final `process.exit` code propagation.
3. Wire `scripts/test-helpers.bats` into CI (or port those tests to Vitest) so helper behavior remains guarded.

## Practical Exit Criteria
- `yarn test` fully green.
- Smoke suite asserts every emitted terminal outcome that represents a meaningful operator-visible state for each cron script.
- At least one board-mode and one timeout scenario covered per relevant flow.
- Audit command has dedicated tests (not only script smoke).
