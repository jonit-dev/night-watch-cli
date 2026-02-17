# Night Watch CLI: Scalability and Code Quality Audit

Date: 2026-02-16

## Scope and Method

This audit reviewed the current TypeScript CLI and Bash runtime scripts for:

- Scalability foundations (maintainability as features grow)
- Code quality and consistency
- Practical lint/test safeguards (without overengineering)
- Alignment with SRP, DRY, KISS, YAGNI, and SOLID

Validation commands run:

- `npm run verify` (passes)
- `npm test` (passes: 16 files, 260 tests)
- `npx vitest run --coverage` (fails: missing `@vitest/coverage-v8`)

## Executive Summary

The project is in a healthy early-stage state: strict TypeScript, broad test coverage for current CLI behavior, and clear separation between Node CLI orchestration and Bash execution scripts.

The highest risks are not architectural complexity; they are **consistency and safeguard gaps**:

1. Configurable paths are partially bypassed in runtime scripts.
2. Log file contract is inconsistent across scripts and CLI commands.
3. Lint/type/test gates are strong for `src/`, but incomplete for tests/scripts and not CI-enforced.

Fixing these gives the best leverage with minimal overhead.

## What Is Working Well

- Strong baseline type safety with `strict: true` (`tsconfig.json:8`).
- Good test breadth for command behavior and utilities (`npm test` green with 260 tests).
- Bash scripts use defensive mode (`set -euo pipefail`) (`scripts/night-watch-cron.sh:2`, `scripts/night-watch-pr-reviewer-cron.sh:2`).
- Shared utility modules already exist (`src/utils/*`), which is a good base for DRY refactors.

## Findings (Prioritized)

### 1) High: Configurable PRD directory is bypassed in executor script

- Evidence:
  - Runtime supports custom `NW_PRD_DIR` (`scripts/night-watch-cron.sh:17`-`22`)
  - Prompt hardcodes default PRD path (`scripts/night-watch-cron.sh:83`)
  - Post-success `git add` hardcodes default PRD path (`scripts/night-watch-cron.sh:157`)
- Impact:
  - Custom `prdDir` setups can execute against one path and commit another.
  - Breaks correctness and portability as adopters customize project layout.
- Principles affected: DRY, SRP, KISS
- Recommendation:
  - Use a single source of truth for PRD path in the script (derived from `PRD_DIR_REL` / `PRD_DIR`) for prompt and git-add operations.

### 2) High: Log contract is inconsistent between scripts and CLI commands

- Evidence:
  - Scripts write to `night-watch.log` and `night-watch-pr-reviewer.log` (`scripts/night-watch-cron.sh:24`, `scripts/night-watch-pr-reviewer-cron.sh:17`)
  - CLI status/logs/install use `executor.log` and `reviewer.log` (`src/commands/install.ts:132`-`133`, `src/commands/logs.ts:77`-`78`, `src/commands/status.ts:113`-`114`)
- Impact:
  - Observability confusion: `night-watch logs`/`status` may miss actual runtime logs.
  - Operational debugging cost rises as usage grows.
- Principles affected: KISS, DRY
- Recommendation:
  - Define one canonical pair of log names and reuse everywhere (TS + Bash + docs).

### 3) High: Safeguard coverage is partial and not CI-enforced

- Evidence:
  - `verify` checks only TypeScript source (`package.json:23`)
  - ESLint ignores tests and scripts (`eslint.config.js:31`)
  - TypeScript excludes tests (`tsconfig.json:18`)
  - No repo CI workflow present (`.github/workflows` absent)
- Impact:
  - Regressions can pass locally depending on contributor behavior.
  - Test quality and script quality can drift silently.
- Principles affected: SRP (quality responsibility), KISS (predictable gates)
- Recommendation:
  - Add a minimal CI pipeline: `npm run verify` + `npm test`.
  - Add separate lint/type checks for tests and script lint checks for Bash.

### 4) Medium: SRP/DRY pressure from large command modules and repeated helpers

- Evidence:
  - Large modules: `src/commands/init.ts` (517 lines), `src/config.ts` (371), `src/utils/status-data.ts` (445)
  - `getProjectName` implemented in 4 places:
    - `src/commands/init.ts:112`
    - `src/commands/install.ts:81`
    - `src/commands/uninstall.ts:29`
    - `src/utils/status-data.ts:72`
  - Similar override/env-building flow duplicated between run/review commands.
- Impact:
  - Higher change fan-out and inconsistency risk.
  - Harder onboarding as command complexity grows.
- Principles affected: SRP, DRY, SOLID (single responsibility)
- Recommendation:
  - Extract only the repeated primitives now (project metadata, provider/env building, log naming).
  - Keep architecture flat; avoid introducing deep service layers prematurely.

### 5) Medium: Shell command construction is brittle in some paths

- Evidence:
  - Dynamic shell string assembly in `src/commands/review.ts:85`-`90`
  - Multiple `execSync("which ...")` checks across modules
- Impact:
  - Harder to reason about escaping and cross-platform behavior.
  - Edge-case config input can break command execution.
- Principles affected: KISS, robustness
- Recommendation:
  - Prefer `spawn`/`execFile` with argument arrays for dynamic arguments.
  - Validate CLI provider flag values before casting (`run.ts`, `review.ts`).

### 6) Medium: Notification success metrics can report false positives

- Evidence:
  - `fetch` response is not checked for `ok` in `sendWebhook` (`src/utils/notify.ts:256`-`260`)
  - `sendNotifications` counts fulfilled promises as “sent” (`src/utils/notify.ts:279`-`283`)
- Impact:
  - Operators may believe notifications were delivered when endpoint returned error.
- Principles affected: KISS (truthful telemetry)
- Recommendation:
  - Treat non-2xx responses as failures and include status codes in warnings.

### 7) Low: Coverage reporting is configured but not executable

- Evidence:
  - Coverage configured (`vitest.config.ts:9`-`13`)
  - `vitest --coverage` fails due missing `@vitest/coverage-v8`
- Impact:
  - No quantitative coverage baseline for future changes.
- Recommendation:
  - Add missing dev dependency and run coverage in CI optionally (can start non-blocking).

### 8) Low: Dashboard command is scaffold-level while exposed as production command

- Evidence:
  - `--interval` option parsed but unused (`src/commands/dashboard.ts:17`-`18`)
  - Command renders static panes only.
- Impact:
  - Feature expectation mismatch.
- Recommendation:
  - Mark as experimental until live data refresh is wired.

## Practical Safeguards (Early-Stage, Non-Overengineered)

### Must Have Now

1. Unify PRD path handling and log filename contract across Bash + TS.
2. Add minimal CI with:
   - `npm run verify`
   - `npm test`
3. Add script-level quality checks:
   - `shellcheck scripts/*.sh`
   - `bats scripts/test-helpers.bats` (or document as optional until bats is installed)

### Next (After Stability)

1. Expand lint/type checks to include tests (keep warnings low-noise).
2. Enable working coverage reports and set modest thresholds.
3. Extract duplicated helpers into shared modules (paths/project/provider/env) without introducing heavy architecture.

## Recommended Lint/Quality Profile

Keep rules focused on correctness and maintainability:

- Keep existing ESLint config as baseline.
- Add selectively:
  - `@typescript-eslint/switch-exhaustiveness-check` (`error`)
  - `@typescript-eslint/no-floating-promises` (`error`)
  - `@typescript-eslint/consistent-type-imports` (`error`)
  - `complexity` (`warn`, e.g. 15) for hotspots only
- Add Shell tooling:
  - `shellcheck` for `.sh`
  - `shfmt -d` for formatting consistency (optional but useful)

Avoid adding broad/noisy rule packs at this stage.

## 30-Day Foundational Plan

### Week 1

- Fix the two high-impact consistency bugs:
  - PRD path hardcoding
  - Log filename mismatch
- Add minimal CI gates.

### Week 2

- Add Bash lint/test wiring (`shellcheck` + `bats`).
- Add working coverage dependency and generate first baseline report.

### Week 3-4

- Perform targeted DRY refactor:
  - `getProjectName` single utility
  - shared env/provider builder for run/review
  - centralized log path helpers

This keeps the project simple while strengthening scale-readiness.

