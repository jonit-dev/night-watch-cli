# PRD: Kanban Provider Defaults & PR Count Bug Fix

**Complexity: 4 → MEDIUM mode**

---

## 1. Context

**Problem:** Three board/Kanban improvements: (1) local Kanban should be the default provider instead of GitHub, (2) GitHub (and local) Kanban creates issues in "Draft" column by default but should default to "Ready" with the column being configurable via JSON config, and (3) the Dashboard "Open PRs" stat always shows "1" even when no PRs are open.

**Files Analyzed:**
- `packages/core/src/board/types.ts` — `IBoardProviderConfig`, `ICreateIssueInput`, `BoardColumnName`
- `packages/core/src/constants.ts` — `DEFAULT_BOARD_PROVIDER` (currently `provider: 'github'`)
- `packages/core/src/config.ts` — `normalizeConfig()`, `mergeConfigs()`, `getDefaultConfig()`
- `packages/core/src/board/providers/github-projects.ts` — `createIssue()` line 752: `const targetColumn = input.column ?? "Draft"`
- `packages/core/src/board/providers/local-kanban.ts` — `createIssue()` line 37: `columnName: input.column ?? 'Draft'`
- `packages/core/src/board/factory.ts` — `createBoardProvider(config, cwd)` — local provider doesn't receive config
- `packages/core/src/utils/status-data.ts` — `collectPrInfo()`, `fetchStatusSnapshot()`
- `web/pages/Dashboard.tsx` — `openPrs = currentStatus.prs.length` (line 85)
- `night-watch.config.json` — active config: `boardProvider.provider: 'github'`, `projectNumber: 41`

**Current Behavior:**
- `DEFAULT_BOARD_PROVIDER.provider = 'github'` — new installs require manual config to use local Kanban
- Both providers default to `'Draft'` when `input.column` is not provided in `createIssue()`
- No `defaultIssueColumn` config key exists in `IBoardProviderConfig`
- Dashboard PR card shows `currentStatus.prs.length` which always displays "1" despite no open PRs

---

## 2. Solution

**Approach:**
1. Change `DEFAULT_BOARD_PROVIDER.provider` to `'local'` in `constants.ts`
2. Add `defaultIssueColumn?: BoardColumnName` to `IBoardProviderConfig` with runtime default of `'Ready'`
3. Wire `defaultIssueColumn` through `config.ts` normalizer and merger
4. Update both `GitHubProjectsProvider` and `LocalKanbanProvider` to use `config.defaultIssueColumn ?? 'Ready'` as column fallback
5. Pass `IBoardProviderConfig` to `LocalKanbanProvider` in factory (currently only receives `repo`)
6. Investigate `collectPrInfo` — trace why 1 PR is always returned; fix the root cause

**Key Decisions:**
- `defaultIssueColumn` defaults to `'Ready'` for both providers — issues should be immediately actionable
- `LocalKanbanProvider` receives `IBoardProviderConfig` as second constructor param for config parity with GitHub provider
- The `mergeConfigs()` board spread already handles new optional keys; only `normalizeConfig()` needs a new read

**Data Changes:** None — existing SQLite schema unchanged; JSON config gains optional `boardProvider.defaultIssueColumn`

---

## 3. Integration Points

```markdown
**How will this feature be reached?**
- [x] Entry point: `board issue create` CLI command → `createBoardProvider()` → provider `createIssue()`
- [x] Caller file: `packages/core/src/board/factory.ts` passes `IBoardProviderConfig` to providers
- [x] Config wiring: `loadConfig()` in `config.ts` → `normalizeConfig()` reads new key

**Is this user-facing?**
- [x] YES — `defaultIssueColumn` appears in `night-watch.config.json` and affects all board issue creation

**Full user flow:**
1. User runs `night-watch board issue create --title "My task"`
2. CLI calls `createBoardProvider(config.boardProvider, cwd)` → `provider.createIssue({ title, body })`
3. Provider falls back to `config.defaultIssueColumn ?? 'Ready'` when no column is given
4. Issue appears in the "Ready" column on the board
```

---

## 4. Execution Phases

### Phase 1: Local Default + Configurable DefaultIssueColumn — "Issues land in Ready by default"

**Files (max 5):**
- `packages/core/src/board/types.ts` — add `defaultIssueColumn?: BoardColumnName` to `IBoardProviderConfig`
- `packages/core/src/constants.ts` — change provider default to `'local'`; add `DEFAULT_BOARD_ISSUE_COLUMN`
- `packages/core/src/config.ts` — parse `defaultIssueColumn` in `normalizeConfig()`
- `packages/core/src/board/providers/github-projects.ts` — use `this.config.defaultIssueColumn ?? 'Ready'`
- `packages/core/src/board/providers/local-kanban.ts` + `factory.ts` — pass config; use `config.defaultIssueColumn ?? 'Ready'`

**Implementation:**

- [ ] **`board/types.ts`**: add optional field to `IBoardProviderConfig`:
  ```typescript
  /** Default column for new issues when none is specified. Defaults to 'Ready'. */
  defaultIssueColumn?: BoardColumnName;
  ```

- [ ] **`constants.ts`**: two changes:
  ```typescript
  export const DEFAULT_BOARD_ISSUE_COLUMN: BoardColumnName = 'Ready';

  export const DEFAULT_BOARD_PROVIDER: IBoardProviderConfig = {
    enabled: true,
    provider: 'local' as const,  // was 'github'
  };
  ```

- [ ] **`config.ts`** `normalizeConfig()` — inside the `if (rawBoardProvider)` block, after building `bp`, add:
  ```typescript
  const rawDefaultCol = readString(rawBoardProvider.defaultIssueColumn);
  if (rawDefaultCol && BOARD_COLUMNS.includes(rawDefaultCol as BoardColumnName)) {
    bp.defaultIssueColumn = rawDefaultCol as BoardColumnName;
  }
  ```
  Import `BOARD_COLUMNS` from `'./board/types.js'` (already imported as `BoardProviderType`; add `BOARD_COLUMNS` to the same import).

- [ ] **`github-projects.ts`** — in `createIssue()`, change line 752 from:
  ```typescript
  const targetColumn = input.column ?? "Draft";
  ```
  to:
  ```typescript
  const targetColumn = input.column ?? this.config.defaultIssueColumn ?? 'Ready';
  ```

- [ ] **`local-kanban.ts`** — update constructor and `createIssue()`:
  ```typescript
  constructor(
    private readonly repo: IKanbanIssueRepository,
    private readonly config: IBoardProviderConfig = { enabled: true, provider: 'local' },
  ) {}

  async createIssue(input: ICreateIssueInput): Promise<IBoardIssue> {
    const row = this.repo.create({
      title: input.title,
      body: input.body,
      columnName: input.column ?? this.config.defaultIssueColumn ?? 'Ready',
      labels: input.labels,
    });
    return toIBoardIssue(row);
  }
  ```

- [ ] **`factory.ts`** — pass `config` to `LocalKanbanProvider`:
  ```typescript
  case 'local': {
    const repo = container.resolve(SqliteKanbanIssueRepository);
    return new LocalKanbanProvider(repo, config);
  }
  ```

**Tests Required:**

| Test File | Test Name | Assertion |
|-----------|-----------|-----------|
| `packages/core/src/__tests__/local-kanban.provider.test.ts` | `should create issue in Ready column when no column specified` | `expect(issue.column).toBe('Ready')` |
| `packages/core/src/__tests__/local-kanban.provider.test.ts` | `should create issue in specified column when column is provided` | `expect(issue.column).toBe('In Progress')` |
| `packages/core/src/__tests__/local-kanban.provider.test.ts` | `should use defaultIssueColumn from config` | config `defaultIssueColumn: 'Draft'` → `expect(issue.column).toBe('Draft')` |

**User Verification:**
- Action: Run `night-watch board issue create --title "Test issue"` without `boardProvider` in config
- Expected: Issue created in local Kanban in `Ready` column
- Config override: Add `"boardProvider": { "defaultIssueColumn": "Draft" }` → issue lands in Draft

---

### Phase 2: PR Count Bug Fix — "Dashboard shows 0 PRs when none are open"

**Files (max 5):**
- `packages/core/src/utils/status-data.ts` — `collectPrInfo()` investigation and fix

**Implementation:**

- [ ] **Step 1 — Diagnose**: Run `gh pr list --state open --json headRefName,number,title` in the project dir; confirm exact output. If a PR with a branch starting with `feat/` or `night-watch/` is genuinely open (e.g., a draft PR), that explains the "1".

- [ ] **Step 2 — Guard empty output**: Add early-return guard before `JSON.parse`:
  ```typescript
  const trimmed = output.trim();
  if (!trimmed || trimmed === '[]') return [];
  const prs: IGhPr[] = JSON.parse(trimmed);
  ```

- [ ] **Step 3 — Fix if filter issue**: If `branchPatterns.startsWith` is too broad (e.g., pattern `'feat/'` matching a legacy open PR), evaluate whether adding `--head` flag or a stricter match makes sense. Document finding in a code comment.

- [ ] **Step 4 — Handle stale SSE**: If root cause is the SSE stream delivering a cached snapshot with old PR data, ensure the server-side `fetchStatusSnapshot` always calls `collectPrInfo` fresh (verify no in-memory caching in the status route).

**Tests Required:**

| Test File | Test Name | Assertion |
|-----------|-----------|-----------|
| `packages/core/src/__tests__/utils/status-data.test.ts` | `should return empty array when gh pr list returns empty array` | mock returns `[]` → `expect(result).toEqual([])` |
| `packages/core/src/__tests__/utils/status-data.test.ts` | `should filter out PRs whose branches don't match patterns` | PR with branch `'dependabot/npm/foo'` not returned |

**User Verification:**
- Action: Open Dashboard with no open PRs
- Expected: "Open PRs" card shows `0`

---

## 5. Checkpoint Protocol

After completing each phase, spawn the `prd-work-reviewer` agent:

```
Task({
  subagent_type: 'prd-work-reviewer',
  prompt: 'Review checkpoint for phase [N] of PRD at docs/PRDs/night-watch/kanban-defaults-and-pr-fix.md',
  description: 'Review phase N checkpoint',
})
```

**Continue to next phase only when agent reports PASS.**

---

## 6. Verification Strategy

**Phase 1:**
- Unit tests: `packages/core/src/__tests__/local-kanban.provider.test.ts` (3 new tests)
- `yarn verify` must pass

**Phase 2:**
- Unit tests: `packages/core/src/__tests__/utils/status-data.test.ts` (2 new/updated tests)
- Manual: Load Dashboard, confirm PR count shows `0`
- `yarn verify` must pass

---

## 7. Acceptance Criteria

- [ ] `boardProvider.provider` defaults to `'local'` when not configured
- [ ] GitHub and local Kanban create issues in `'Ready'` column by default
- [ ] `boardProvider.defaultIssueColumn` in `night-watch.config.json` overrides the default
- [ ] Dashboard "Open PRs" card shows `0` when no PRs are open
- [ ] All tests pass (`yarn test`)
- [ ] `yarn verify` passes
- [ ] All automated checkpoint reviews pass
