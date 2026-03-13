# PRD: Morning Summary Command

**Complexity: 3 → LOW mode**

## Integration Points Checklist

**How will this feature be reached?**
- [x] Entry point identified: CLI command `night-watch summary`
- [x] Caller file identified: `packages/cli/src/cli.ts` registers the command
- [x] Registration/wiring needed: import + register `summaryCommand(program)` in `cli.ts`

**Is this user-facing?**
- [x] YES → CLI terminal output (table + stats)

**Full user flow:**
1. User runs: `night-watch summary` (optionally `--hours 12` or `--json`)
2. Triggers: `summaryCommand` action in `packages/cli/src/commands/summary.ts`
3. Reaches data via: `getJobRunsAnalytics()` from `job-queue.ts` + `collectPrInfo()` from `status-data.ts`
4. Result displayed in: terminal as formatted sections (jobs, PRs, failures, next actions)

---

## 1. Context

**Problem:** Night Watch executes jobs overnight, but there is no single command that answers "what happened while I was away?" — users must piece together `status`, `prs`, `logs`, and `queue` to understand overnight results.

**Files Analyzed:**
- `packages/cli/src/cli.ts` — command registration pattern
- `packages/cli/src/commands/prs.ts` — command implementation pattern (chalk, table, --json)
- `packages/cli/src/commands/status.ts` — status data aggregation
- `packages/core/src/utils/job-queue.ts` — `getJobRunsAnalytics()` returns recent runs with status/duration/provider
- `packages/core/src/utils/status-data.ts` — `collectPrInfo()` returns open PRs with CI/review status
- `packages/core/src/utils/ui.ts` — shared `header()`, `info()`, `dim()`, `createTable()` helpers
- `packages/core/src/index.ts` — public API barrel exports

**Current Behavior:**
- `night-watch status` shows live process state, PRD counts, crontab — but not recent job outcomes
- `night-watch prs` lists open PRs but doesn't correlate with job runs
- `getJobRunsAnalytics(windowHours)` already queries `job_runs` for recent runs — but is not exposed as a CLI command
- No single view combines: jobs ran, success/fail counts, PRs opened, and pending work

## 2. Solution

**Approach:**
- Add a `night-watch summary` command that aggregates data from existing sources into a single "morning briefing"
- Reuse `getJobRunsAnalytics()` for job run data (already queries `job_runs` table with configurable time window)
- Reuse `collectPrInfo()` for open PR status
- Reuse `getQueueStatus()` for pending queue items
- Format output with existing `chalk`, `createTable()`, `header()` helpers — matching the `prs` command pattern
- Support `--hours <n>` (default 12) and `--json` flags

**Key Decisions:**
- [x] No new database queries — compose from `getJobRunsAnalytics()`, `collectPrInfo()`, `getQueueStatus()`
- [x] No new dependencies — use existing chalk + cli-table3 already in the project
- [x] Default 12-hour window covers typical overnight execution
- [x] `--json` flag outputs structured data for scripting/piping

**Data Changes:** None — reads from existing `job_runs` and `job_queue` tables.

## 3. Output Format

```
Night Watch Summary (last 12h)
────────────────────────────────

Jobs Executed: 5
  ✓ 3 succeeded   ✗ 1 failed   ⏱ 1 timed out

┌──────────┬──────────┬──────────┬──────────┬──────────────┐
│ Job      │ Status   │ Project  │ Provider │ Duration     │
├──────────┼──────────┼──────────┼──────────┼──────────────┤
│ executor │ success  │ my-app   │ claude   │ 8m 32s       │
│ reviewer │ success  │ my-app   │ codex    │ 4m 15s       │
│ executor │ failure  │ my-lib   │ claude   │ 12m 01s      │
└──────────┴──────────┴──────────┴──────────┴──────────────┘

Open PRs (2)
┌────┬────────────────────────┬──────────┬───────┐
│ #  │ Title                  │ CI       │ Score │
├────┼────────────────────────┼──────────┼───────┤
│ 42 │ feat: add login page   │ pass     │ 85    │
│ 43 │ fix: memory leak       │ pending  │ -     │
└────┴────────────────────────┴──────────┴───────┘

Queue: 1 pending (executor for my-lib)

No action needed — all jobs healthy.
```

When there are failures, the bottom line becomes actionable:
```
⚠ Action needed:
  • 1 failed job — run `night-watch logs` to investigate
  • 1 PR with failing CI — check PR #43
```

---

## 4. Execution Phases

### Phase 1: Core summary data aggregator + CLI command with formatted output

**Files (5):**
- `packages/core/src/utils/summary.ts` — new file: `getSummaryData()` function that composes existing queries
- `packages/core/src/index.ts` — add export for `summary.ts`
- `packages/cli/src/commands/summary.ts` — new file: command implementation with formatted output
- `packages/cli/src/cli.ts` — register `summaryCommand`
- `packages/cli/src/__tests__/commands/summary.test.ts` — new file: unit tests

**Implementation:**

- [ ] Create `packages/core/src/utils/summary.ts` with:
  - Interface `ISummaryData` containing: `windowHours: number`, `jobRuns: IJobRunAnalytics['recentRuns']`, `counts: { total, succeeded, failed, timedOut, rateLimited, skipped }`, `openPrs: IPrInfo[]`, `pendingQueueItems: IQueueEntry[]`, `actionItems: string[]`
  - Function `getSummaryData(projectDir: string, windowHours: number, branchPatterns: string[]): Promise<ISummaryData>` that:
    1. Calls `getJobRunsAnalytics(windowHours)` to get recent runs
    2. Computes counts by filtering `recentRuns` by status
    3. Calls `collectPrInfo(projectDir, branchPatterns)` for open PRs
    4. Calls `getQueueStatus()` for pending items
    5. Builds `actionItems` array: failed jobs → suggest `night-watch logs`, failing CI PRs → suggest checking PR URL, pending queue items → inform user
    6. Returns the composed `ISummaryData`

- [ ] Add `export * from './utils/summary.js';` to `packages/core/src/index.ts`

- [ ] Create `packages/cli/src/commands/summary.ts` with:
  - Interface `ISummaryOptions` with `hours?: string` and `json?: boolean`
  - Function `summaryCommand(program: Command): void` that registers `night-watch summary`
  - Command description: `"Show a summary of recent Night Watch activity"`
  - Options: `--hours <n>` (default "12"), `--json` (structured output)
  - Action handler that:
    1. Loads config via `loadConfig(process.cwd())`
    2. Parses `hours` option to number (default 12)
    3. Calls `getSummaryData(projectDir, hours, config.branchPatterns)`
    4. If `--json`: prints `JSON.stringify(data, null, 2)` and returns
    5. Otherwise formats output using chalk + createTable:
       - Header line with time window
       - Job summary line with colored counts (green for success, red for fail, yellow for timeout)
       - Table of recent job runs (job type, status, project, provider, duration formatted as Xm Ys)
       - Open PRs section using a table (number, title, CI status, review score) — reuse the formatting logic from `prs.ts`
       - Pending queue section (count + job types)
       - Action items section at the bottom (or "No action needed" in green)

- [ ] In `packages/cli/src/cli.ts`:
  - Add import: `import { summaryCommand } from './commands/summary.js';`
  - Add registration: `summaryCommand(program);` after the existing command registrations

- [ ] Create `packages/cli/src/__tests__/commands/summary.test.ts` with tests:

**Tests Required:**

| Test File | Test Name | Assertion |
|-----------|-----------|-----------|
| `packages/cli/src/__tests__/commands/summary.test.ts` | `should display summary header with time window` | Output contains "last 12h" (or custom hours value) |
| `packages/cli/src/__tests__/commands/summary.test.ts` | `should show job counts from analytics data` | Output contains succeeded/failed counts matching mocked data |
| `packages/cli/src/__tests__/commands/summary.test.ts` | `should output valid JSON when --json flag is used` | `JSON.parse(output)` succeeds and contains expected fields |
| `packages/cli/src/__tests__/commands/summary.test.ts` | `should show "No recent activity" when no jobs ran` | Output contains "No recent activity" when recentRuns is empty |
| `packages/cli/src/__tests__/commands/summary.test.ts` | `should generate action items for failed jobs` | `actionItems` array contains entry mentioning `night-watch logs` |
| `packages/cli/src/__tests__/commands/summary.test.ts` | `should generate action items for PRs with failing CI` | `actionItems` array contains entry mentioning the failing PR |
| `packages/cli/src/__tests__/commands/summary.test.ts` | `should use default 12 hours when --hours not specified` | `getSummaryData` called with `windowHours: 12` |

**Testing approach:** Mock `getJobRunsAnalytics`, `collectPrInfo`, and `getQueueStatus` at the module level using `vi.mock()`. Test the `getSummaryData` function directly for data composition logic, and test the command output by capturing `console.log` calls.

**Verification Plan:**

1. **Unit Tests:**
   - File: `packages/cli/src/__tests__/commands/summary.test.ts`
   - Tests: all 7 tests listed above

2. **Manual Verification:**
   - Run `night-watch summary` in a project with execution history → see formatted output
   - Run `night-watch summary --hours 24` → see wider time window
   - Run `night-watch summary --json` → valid JSON output
   - Run `night-watch summary` in a fresh project with no history → see "No recent activity"

3. **Evidence Required:**
   - [ ] All tests pass via `yarn test`
   - [ ] `yarn verify` passes (type-check + lint)
   - [ ] Command appears in `night-watch --help`

---

## 5. Acceptance Criteria

- [ ] `night-watch summary` displays a formatted briefing of recent job activity
- [ ] `night-watch summary --hours 24` adjusts the time window
- [ ] `night-watch summary --json` outputs structured JSON for scripting
- [ ] Failed jobs and failing CI PRs produce actionable suggestions
- [ ] Empty state (no recent activity) is handled gracefully
- [ ] All tests pass
- [ ] `yarn verify` passes
- [ ] Command registered and visible in `night-watch --help`
