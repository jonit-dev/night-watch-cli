# PRD: Migrate Bash Business Logic to TypeScript

## Context

`scripts/night-watch-helpers.sh` (603 lines) contains business logic (claim management, PRD discovery, lock acquisition, git branch detection, worktree orchestration) that is hard to test — only a small bats test file covers claims. The rest of the codebase is TypeScript with comprehensive vitest coverage. The project already established a migration pattern: `night-watch history` and `night-watch board` subcommands moved bash logic to TypeScript and the bash scripts now call CLI commands. This PRD continues that pattern for the remaining helpers.

**Complexity: 9 (HIGH)** — 10+ files, new module, multi-package, concurrency logic.

---

## Integration Points

- **Entry point**: New `night-watch cron <subcommand>` CLI group
- **Caller**: Bash cron scripts call via `"${NW_CLI}" cron <subcommand>` (same as `night_watch_history`)
- **Registration**: `cronCommand(program)` in `packages/cli/src/cli.ts`
- **Internal-only**: These subcommands are called by bash scripts, not directly by users

---

## Solution

1. Create core utility modules with pure business logic (testable with vitest)
2. Create `night-watch cron` CLI subcommand group as thin wrappers (exit-code signaling for bash)
3. Replace bash helper calls with CLI calls in cron scripts
4. Delete migrated bash functions and bats tests

**Key decisions:**
- **Batched `find-eligible` command** — internalizes the PRD scanning loop (calls `isInCooldown()`, `isClaimed()` directly instead of N subprocess calls)
- **Git ops via `execFileSync('git', ...)`** — testable via real temp git repos (pattern from `execution-history.test.ts`)
- **Claims stay file-based** — SQLite would be over-engineering for cron-level concurrency
- **`validate_provider()` not migrated** — already handled by TS caller via Commander `.choices()`
- **Telegram calls not migrated as CLI subcommands** — move to TS callers (`run.ts`, `audit.ts`, etc.) using existing `notify.ts`

---

## Phases

### Phase 1: Git Utilities

**Files:**
- `packages/core/src/utils/git-utils.ts` (NEW)
- `packages/core/src/__tests__/utils/git-utils.test.ts` (NEW)
- `packages/core/src/index.ts` (add export)

**Implementation:**
- `getBranchTipTimestamp(projectDir, branch): number | null` — replaces `get_branch_tip_timestamp()`
- `detectDefaultBranch(projectDir): string` — replaces `detect_default_branch()`
- `resolveWorktreeBaseRef(projectDir, defaultBranch): string | null` — replaces `resolve_worktree_base_ref()`
- All use `execFileSync('git', [...], { cwd })` with try/catch

**Tests:** Create temp git repos with `git init`, make commits on main/master, verify detection. Test local-only repos, repos with only master, detached HEAD.

---

### Phase 2: Worktree Management

**Files:**
- `packages/core/src/utils/worktree-manager.ts` (NEW)
- `packages/core/src/__tests__/utils/worktree-manager.test.ts` (NEW)
- `packages/core/src/index.ts` (add export)

**Implementation:**
- `prepareBranchWorktree({ projectDir, worktreeDir, branchName, defaultBranch }): IPrepareWorktreeResult`
- `prepareDetachedWorktree({ projectDir, worktreeDir, defaultBranch }): IPrepareWorktreeResult`
- `cleanupWorktrees(projectDir, scope?): string[]` — returns removed paths

**Tests:** Create bare repo + clone, test worktree creation/cleanup, stale directory handling.

---

### Phase 3: Lock & Claim Management

**Files:**
- `packages/core/src/utils/status-data.ts` (extend with `acquireLock`, `releaseLock`)
- `packages/core/src/utils/claim-manager.ts` (NEW)
- `packages/core/src/__tests__/utils/claim-manager.test.ts` (NEW)
- `packages/core/src/__tests__/utils/status-data.test.ts` (add lock tests)
- `packages/core/src/index.ts` (add export)

**Implementation:**
- `acquireLock(lockPath, pid?): boolean` — extends existing `checkLockFile()`, writes PID
- `releaseLock(lockPath): void`
- `claimPrd(prdDir, prdFile, pid?): void` — writes JSON claim file
- `releaseClaim(prdDir, prdFile): void`
- `isClaimed(prdDir, prdFile, maxRuntime): boolean` — removes stale claims
- `readClaimInfo(prdDir, prdFile, maxRuntime): IClaimInfo | null`

**Tests:** Temp directories, verify claim JSON format, stale claim expiry, lock acquisition/release.

---

### Phase 4: PRD Discovery

**Files:**
- `packages/core/src/utils/prd-discovery.ts` (NEW)
- `packages/core/src/__tests__/utils/prd-discovery.test.ts` (NEW)
- `packages/core/src/index.ts` (add export)

**Implementation:**
- `findEligiblePrd({ prdDir, projectDir, maxRuntime, prdPriority? }): string | null`
  - Scans PRD files, applies priority ordering
  - Calls `isClaimed()` from Phase 3 directly (no subprocess)
  - Calls `isInCooldown()` from `execution-history.ts` directly
  - Calls `parsePrdDependencies()` from `status-data.ts` directly
  - Queries open branches via `execFileSync('gh', ['pr', 'list', ...])`
  - Returns first eligible PRD filename or null
- `findEligibleBoardIssue({ projectDir, maxRuntime }): IEligibleBoardIssue | null`

**Tests:** Temp PRD dirs with claim files, mock `gh pr list`, execution history records for cooldown.

---

### Phase 5: Remaining Helpers

**Files:**
- `packages/core/src/utils/log-utils.ts` (NEW)
- `packages/core/src/__tests__/utils/log-utils.test.ts` (NEW)
- `packages/core/src/utils/prd-utils.ts` (add `markPrdDone`)
- `packages/core/src/__tests__/utils/prd-utils.test.ts` (extend)
- `packages/core/src/index.ts` (add export)

**Implementation:**
- `rotateLog(logFile, maxSize?): boolean` — replaces `rotate_log()`
- `checkRateLimited(logFile, startLine?): boolean` — replaces `check_rate_limited()`
- `markPrdDone(prdDir, prdFile): boolean` — replaces `mark_prd_done()`

---

### Phase 6: CLI Subcommands

**Files:**
- `packages/cli/src/commands/cron.ts` (NEW)
- `packages/cli/src/__tests__/commands/cron.test.ts` (NEW)
- `packages/cli/src/cli.ts` (register `cronCommand`)

**Subcommands** (following `history.ts` exit-code signaling pattern):
```
cron detect-branch [projectDir]           → stdout: branch name
cron acquire-lock <lockFile>              → exit 0=acquired, 1=locked
cron find-eligible <projectDir>           → stdout: PRD filename or JSON
cron claim <prdDir> <prdFile>             → exit 0=claimed
cron release-claim <prdDir> <prdFile>     → exit 0=released
cron is-claimed <prdDir> <prdFile>        → exit 0=claimed, 1=not
cron mark-done <prdDir> <prdFile>         → exit 0=done, 1=failed
cron prepare-worktree <proj> <wt>         → exit 0=created, 1=failed
cron cleanup-worktrees <projectDir>       → exit 0=cleaned
cron check-rate-limit <logFile>           → exit 0=limited, 1=not
cron rotate-log <logFile>                 → exit 0=rotated
```

---

### Phase 7: Bash Script Migration

Replace `source night-watch-helpers.sh` function calls with `"${NW_CLI}" cron <subcommand>` calls.

**Order** (simplest to most complex):
1. `night-watch-slicer-cron.sh` — only uses `rotate_log`, `acquire_lock`
2. `night-watch-audit-cron.sh` — adds `detect_default_branch`, worktrees
3. `night-watch-qa-cron.sh` — similar to audit
4. `night-watch-cron.sh` — full: `find_eligible_prd`, claims, worktrees, rate limit
5. `night-watch-pr-reviewer-cron.sh` — parallel workers, worktrees

Keep `resolve_night_watch_cli()`, `log()`, `emit_result()` in bash (inherently shell-native). Keep `night-watch-helpers.sh` as a minimal file with only those functions.

---

### Phase 8: Cleanup

- Slim `scripts/night-watch-helpers.sh` to only remaining bash-native functions
- Delete `scripts/test-helpers.bats` (replaced by vitest tests)
- Verify all cron scripts work end-to-end
- `yarn verify` passes

---

## Dependency Graph

```
Phase 1 (git-utils) ──┐
Phase 3 (lock+claim) ─┤── Phase 4 (prd-discovery)
Phase 5 (log/misc) ───┘         │
Phase 2 (worktree) ─────────────┤
                                 ├── Phase 6 (CLI commands) → Phase 7 (bash migration) → Phase 8 (cleanup)
```

Phases 1, 2, 3, 5 can run in parallel. Phase 4 depends on Phase 3. Phase 6 depends on 1-5. Phase 7 depends on 6.

---

## Verification

After each phase:
1. `yarn verify` (typecheck + lint)
2. `yarn test` for changed packages
3. Phase 6: test CLI subcommands via `node dist/cli.js cron <cmd>` with temp dirs
4. Phase 7: dry-run each cron script (`NW_DRY_RUN=1`) to verify no bash errors
5. Phase 8: full integration — run executor/reviewer with `--dry-run` against a test project
