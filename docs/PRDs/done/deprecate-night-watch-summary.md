# Deprecate NIGHT-WATCH-SUMMARY.md

**Complexity:** 3 → LOW mode

**Depends on:** None

## 1. Context

**Problem:** `NIGHT-WATCH-SUMMARY.md` is a manually-maintained markdown file that duplicates state already tracked by the file system (pending vs `done/`), claim files, the execution history ledger (`~/.night-watch/history.json`), and the `night-watch prds` command. It adds maintenance burden to the agent template, clutters init output, and requires exclusion filters in every file-listing codepath.

**Files Analyzed:**
- `templates/night-watch.md` (lines 5, 70, 92)
- `scripts/night-watch-helpers.sh` (line 212)
- `src/commands/init.ts` (lines 219-236, 344-347, 444)
- `src/commands/prd.ts` (lines 49, 277)
- `src/commands/prds.ts` (line 160)
- `src/commands/run.ts` (line 125)
- `src/utils/checks.ts` (line 184)
- `src/utils/status-data.ts` — no direct reference (already uses file-system + claims)
- `docs/commands.md` (line 16)
- `src/__tests__/commands/init.test.ts` (lines 373-415)
- `src/__tests__/commands/prd.test.ts` (lines 71-73)
- `src/__tests__/commands/prds.test.ts` (lines 311-317)
- `src/__tests__/utils/checks.test.ts` (lines 166-177)
- `docs/PRDs/night-watch/NIGHT-WATCH-SUMMARY.md` (the file itself)

**Current Behavior:**
- `night-watch init` creates `NIGHT-WATCH-SUMMARY.md` inside the PRD directory.
- The agent template (`templates/night-watch.md`) instructs the agent to update it after each PRD (step k) and on failure (step 5).
- Every command that lists `.md` files in the PRD directory has a `!== "NIGHT-WATCH-SUMMARY.md"` filter.
- The `night-watch prds` command already computes status from the file system + claims + open PRs — making the summary file redundant.

## 2. Solution

**Approach:**
- Remove all references to `NIGHT-WATCH-SUMMARY.md` across the codebase.
- Remove the `createSummaryFile()` function and its call during `init`.
- Remove agent template steps that instruct updating the summary file.
- Remove all `!== "NIGHT-WATCH-SUMMARY.md"` filters (they become unnecessary once the file no longer exists).
- Update docs and tests accordingly.
- Delete the actual `docs/PRDs/night-watch/NIGHT-WATCH-SUMMARY.md` file.

**Key Decisions:**
- No replacement file needed — `night-watch prds` already serves as the single source of truth.
- The execution history ledger (`~/.night-watch/history.json`) already captures outcomes. No enrichment needed for this PRD — the metadata the summary was tracking (PR URL, branch, files changed) is already available via `gh pr list` and computed on-the-fly by the `prds` command.
- This is a pure removal/cleanup — no new features.

## 3. Execution Phases

### Phase 1: Remove summary file creation and references from source code

**Files:**
1. `src/commands/init.ts` — Remove `createSummaryFile()` function, its call (step 5), and the summary line in the init output table. Adjust step numbering.
2. `src/commands/prd.ts` — Remove `f !== "NIGHT-WATCH-SUMMARY.md"` filters (lines 49, 277).
3. `src/commands/prds.ts` — Remove `.filter(prd => !prd.name.toLowerCase().includes("night-watch-summary"))` (line 159-161).
4. `src/commands/run.ts` — Remove `entry.name !== "NIGHT-WATCH-SUMMARY.md"` filter (line 125).
5. `src/utils/checks.ts` — Remove `f !== "NIGHT-WATCH-SUMMARY.md"` filter (line 184).

**Implementation:**
- [ ] Delete the `createSummaryFile` function from `init.ts`
- [ ] Remove step 5 (summary creation) from the init action and renumber subsequent steps (total steps decreases from 10 to 9)
- [ ] Remove the `['Summary File', ...]` row from the filesTable
- [ ] Remove `NIGHT-WATCH-SUMMARY.md` exclusion from `prd.ts` `getNextPrdNumber()` and `prd list` action
- [ ] Remove `night-watch-summary` filter from `prds.ts`
- [ ] Remove `NIGHT-WATCH-SUMMARY.md` exclusion from `run.ts` `scanPrdDirectory()`
- [ ] Remove `NIGHT-WATCH-SUMMARY.md` exclusion from `checks.ts` `checkPrdDirectory()`

**Tests Required:**
| Test File | Test Name | Assertion |
|-----------|-----------|-----------|
| `src/__tests__/commands/init.test.ts` | Remove `should create NIGHT-WATCH-SUMMARY.md` describe block | Delete entire test block (lines 373-416) |
| `src/__tests__/commands/prd.test.ts` | Update `should ignore NIGHT-WATCH-SUMMARY.md` test | Remove or update — a file named `NIGHT-WATCH-SUMMARY.md` would just be treated as a regular PRD file now, but since we're deleting the file it won't exist |
| `src/__tests__/commands/prds.test.ts` | Remove `should exclude NIGHT-WATCH-SUMMARY.md file` test | Delete the test |
| `src/__tests__/utils/checks.test.ts` | Update `should exclude NIGHT-WATCH-SUMMARY.md from count` test | Delete the test |

**Verification:**
- `yarn verify` passes
- `yarn test` passes

### Phase 2: Remove from templates, scripts, and docs

**Files:**
1. `templates/night-watch.md` — Remove the exclusion note in step 1, remove step k entirely, update step 5 failure instructions.
2. `scripts/night-watch-helpers.sh` — Remove `! -name 'NIGHT-WATCH-SUMMARY.md'` from the `find` command (line 212).
3. `docs/commands.md` — Remove the summary file line from the "What it creates" list (line 16).
4. `docs/PRDs/night-watch/NIGHT-WATCH-SUMMARY.md` — Delete this file.

**Implementation:**
- [ ] In `templates/night-watch.md` step 1: change `(exclude \`NIGHT-WATCH-SUMMARY.md\` and the \`done/\` directory)` to `(exclude the \`done/\` directory)`
- [ ] Remove step k (lines 70-84) and its trailing blank line. Re-letter subsequent steps (l→k, m→l, n→m).
- [ ] In step 5: change "Log the failure in NIGHT-WATCH-SUMMARY.md with status "Failed" and the reason." to "Log the failure. Clean up worktree and **stop**."
- [ ] In `scripts/night-watch-helpers.sh` line 212: remove `! -name 'NIGHT-WATCH-SUMMARY.md'` from the find command
- [ ] In `docs/commands.md`: remove the `- \`docs/PRDs/night-watch/NIGHT-WATCH-SUMMARY.md\` — Progress tracking file` line
- [ ] Delete `docs/PRDs/night-watch/NIGHT-WATCH-SUMMARY.md`

**Verification:**
- `yarn verify` passes
- Template reads cleanly with correct step lettering
- `scripts/night-watch-helpers.sh` still correctly finds PRD files (only `.md` in prd dir, excluding `done/`)

## 4. Acceptance Criteria

- [ ] No references to `NIGHT-WATCH-SUMMARY` exist in the codebase (`grep -r "NIGHT.WATCH.SUMMARY" . --include='*.ts' --include='*.sh' --include='*.md'` returns nothing except this PRD and done/ PRDs)
- [ ] `night-watch init` no longer creates the summary file
- [ ] Agent template no longer instructs updating the summary file
- [ ] All tests pass (`yarn test`)
- [ ] `yarn verify` passes
- [ ] The `night-watch prds` command continues to work as the single source of truth for PRD status
