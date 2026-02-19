# Night Watch CLI Core Flow Audit

Date: 2026-02-18
Auditor: Codex (static review + runtime repro)

## App Quality Rating
**★★☆☆☆ (2/5)**

Why:
- Core runtime/status contracts are currently inconsistent, causing incorrect live-state reporting in active execution paths.
- Configurability promises (`prdDir`, `branchPrefix`) are not honored end-to-end in executor flow.
- There is one confirmed startup failure in bundled script surface (`night-watch-slicer-cron.sh`) if invoked.
- Strong automated test coverage exists, but current suite is red and exposes regressions in status/claim handling.

## Scope
- Core execution flow: `run` + `night-watch-cron.sh`
- Review flow lock behavior: `review` + `night-watch-pr-reviewer-cron.sh`
- State/visibility layer: `status` via `src/utils/status-data.ts`
- Script health check for bundled slicer wrapper

## Findings (Highest Severity First)

### 1) Critical: Lock-path contract mismatch breaks live status and can delete active claim files
Severity: **Critical**

Evidence:
- Executor lock is written to project-name path in `scripts/night-watch-cron.sh:26`:
  - `/tmp/night-watch-${PROJECT_NAME}.lock`
- Reviewer lock is written similarly in `scripts/night-watch-pr-reviewer-cron.sh:19`.
- Status layer now reads hashed runtime-key lock paths in `src/utils/status-data.ts:96`, `src/utils/status-data.ts:106`, `src/utils/status-data.ts:113`.
- When lock check fails, claim is treated as orphan and deleted in `src/utils/status-data.ts:302` to `src/utils/status-data.ts:335`.

Impact:
- `night-watch status` can report executor/reviewer as not running while jobs are active.
- Active PRDs can be reclassified from claimed/in-progress to pending.
- Claim files may be removed even while the executor is still running (state corruption in observability/control plane).

Repro evidence:
- `yarn test` currently fails with status-data/status regressions (4 failing tests).
- Manual repro against freshly built CLI (`dist`) showed:
  - existing legacy lock + fresh claim
  - status JSON reported `pending: 1, claimed: 0`
  - claim file removed (`claim_still_exists=0`)

Recommended fix direction:
- Unify one lock naming contract across scripts + TypeScript utilities.
- Do not delete claim files unless lock path contract is guaranteed consistent and PID ownership is validated.
- Add integration tests that execute bash script lock/claim lifecycle and assert status snapshots.

### 2) High: Configured `prdDir` is ignored in provider prompt (executor)
Severity: **High**

Evidence:
- Prompt hardcodes PRD path in `scripts/night-watch-cron.sh:131`:
  - `Implement the PRD at docs/PRDs/night-watch/${ELIGIBLE_PRD}`
- Config/docs state custom PRD directory is supported:
  - `docs/configuration.md:42` (`prdDir`)
  - `docs/commands.md:10` (`init --prd-dir`)

Impact:
- Non-default PRD directory setups can fail or process the wrong file because provider receives an incorrect path.
- This is part of core run flow and directly affects execution correctness for configured projects.

Recommended fix direction:
- Use `${PRD_DIR_REL}` (or a normalized worktree-relative path) inside the prompt.
- Add a run-flow test for custom `prdDir` ensuring prompt points to correct file.

### 3) High: `branchPrefix` config is not honored by executor branch creation
Severity: **High**

Evidence:
- Branch is hardcoded in `scripts/night-watch-cron.sh:73`:
  - `BRANCH_NAME="night-watch/${PRD_NAME}"`
- Config exposes branch prefix as user-configurable:
  - `docs/configuration.md:45`

Impact:
- Custom `branchPrefix` has no effect in the actual execution script.
- Downstream logic that relies on configured prefix (notifications, PR querying conventions, team workflows) can diverge from actual behavior.

Recommended fix direction:
- Pass `NW_BRANCH_PREFIX` into script env and build `BRANCH_NAME` from it.
- Add coverage for non-default branch prefix end-to-end.

## Additional Risk

### 4) Medium: Bundled slicer cron wrapper fails at startup if invoked
Severity: **Medium**

Evidence:
- `scripts/night-watch-slicer-cron.sh:35` calls `project_runtime_key`.
- `scripts/night-watch-helpers.sh` does not define that function.
- Repro: direct execution exits `127` with `project_runtime_key: command not found`.

Impact:
- Any workflow invoking this script directly will fail before lock acquisition/execution.
- Current install path appears to call `night-watch slice` directly, reducing immediate blast radius.

Recommended fix direction:
- Either implement `project_runtime_key` in helpers or remove script dependency on it.
- Add a smoke test for each shipped script entrypoint.

## Final Assessment
- Core architecture is solid and test investment is good.
- Current state has a **critical runtime/state-consistency defect** and two significant config-contract breaks in the executor path.
- Immediate priority should be lock-path unification and protection against claim-file deletion on ambiguous lock state.
