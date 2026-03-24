# PRD: PR Conflict Solver — Automated Conflict Resolution & Ready-to-Merge Management

**Complexity: 8 → HIGH mode** (+3 touches 10+ files, +2 new module from scratch, +2 multi-package, +1 external API integration)

## 1. Context

**Problem:** Open PRs drift out of date as the default branch evolves. Merge conflicts accumulate and block PRs from being pushed or merged. Currently, there is no automated job to keep PRs rebased and conflict-free. The existing reviewer job reviews PRs and posts comments — it does not resolve conflicts or make any git changes.

**Files Analyzed:**

- `packages/core/src/jobs/job-registry.ts` — existing job definitions (6 types)
- `packages/core/src/types.ts` — `JobType`, `INightWatchConfig`, `IJobProviders`, `NotificationEvent`
- `packages/core/src/constants.ts` — defaults, queue priority
- `packages/core/src/utils/github.ts` — `gh` CLI wrappers for PR operations
- `packages/core/src/utils/git-utils.ts` — branch detection, timestamps
- `packages/core/src/utils/worktree-manager.ts` — worktree creation/cleanup
- `packages/cli/src/commands/review.ts` — reviewer pattern (closest analogue)
- `packages/cli/src/commands/shared/env-builder.ts` — shared env building
- `packages/cli/scripts/night-watch-helpers.sh` — `build_provider_cmd()`, `ensure_provider_on_path()`
- `packages/cli/scripts/night-watch-pr-reviewer-cron.sh` — reviewer bash script pattern

**Current Behavior:**

- PRs accumulate merge conflicts silently; developers must manually rebase
- No label/signal to indicate a PR is conflict-free and ready-to-merge
- The reviewer job only reviews PRs and posts comments — does not touch git or resolve anything
- Auto-merge exists but only triggers after reviewer score threshold; no conflict resolution step

## 2. Solution

**Approach:**

1. Register a new **`pr-resolver`** job type in the job registry with its own cron schedule (3x daily), CLI command, lock file, and queue priority
2. The job iterates **all open PRs** in the repo, with **merge conflict resolution as the primary goal**: check out the PR branch in a worktree, attempt `git rebase` on default branch. If git auto-merge fails, invoke the configured AI provider to resolve conflicts intelligently, then force-push the rebased branch
3. **Secondarily** (when `aiReviewResolution` is enabled): after resolving conflicts, address unresolved GitHub review comments using the AI provider — implementing the suggested changes, committing, and pushing
4. When a PR is conflict-free, add a **`ready-to-merge`** GitHub label

**Architecture Diagram:**

```mermaid
flowchart TB
    subgraph CLI["night-watch resolve"]
        CMD[resolve command] --> ENV[buildEnvVars]
        ENV --> SCRIPT[night-watch-pr-resolver-cron.sh]
    end

    subgraph Script["Bash Script"]
        SCRIPT --> FETCH[gh pr list --state open]
        FETCH --> LOOP[For each PR]
        LOOP --> CONFLICT{Has conflicts?}
        CONFLICT -->|Yes| REBASE[git rebase default branch]
        REBASE --> AUTO{Auto-resolved?}
        AUTO -->|No| AI_RESOLVE[AI provider resolves conflicts]
        AUTO -->|Yes| PUSH[force-push rebased branch]
        AI_RESOLVE --> PUSH
        PUSH --> REVIEW{aiReviewResolution?}
        CONFLICT -->|No| REVIEW
        REVIEW -->|Yes| UNRESOLVED{Unresolved reviews?}
        UNRESOLVED -->|Yes| AI_FIX[AI provider implements suggestions]
        AI_FIX --> RE_REVIEW[Request re-review]
        UNRESOLVED -->|No| LABEL
        REVIEW -->|No| LABEL[Add ready-to-merge label]
        RE_REVIEW --> LABEL
    end

    subgraph Core["@night-watch/core"]
        REG[Job Registry] --> CMD
        CONFIG[INightWatchConfig] --> CMD
    end
```

**Key Decisions:**

- **Primary goal: conflict resolution** — the job exists to resolve merge conflicts that block PRs; review comment resolution is opt-in secondary behavior
- **No redundancy with reviewer job** — reviewer reads code and posts comments; pr-resolver fixes conflicts and optionally implements those comments
- **Uses configured AI provider** via `build_provider_cmd()` (same as all other jobs) — respects presets, schedule overrides, fallback chains
- **Scope: all open PRs** — not limited to night-watch branches; configurable via `branchPatterns` extra field if user wants to narrow scope
- **Force-push after rebase** — necessary for rebased branches; the job only force-pushes branches it has actively rebased (never the default branch)
- **`ready-to-merge` label** — added when PR is conflict-free; removed if new conflicts appear
- **Bash script pattern** — follows the same `night-watch-*-cron.sh` pattern as all other jobs for consistency

**Data Changes:**

- `JobType` union gains `'pr-resolver'` value
- `IJobProviders` gains optional `prResolver?: Provider`
- New `IPrResolverConfig` interface extending `IBaseJobConfig` with extra fields
- New notification events: `pr_resolver_completed`, `pr_resolver_conflict_resolved`, `pr_resolver_failed`
- Job registry gains `pr-resolver` entry

## 3. Sequence Flow

```mermaid
sequenceDiagram
    participant Cron as Cron / CLI
    participant Script as pr-resolver-cron.sh
    participant GH as GitHub (gh CLI)
    participant AI as AI Provider
    participant Git as Git

    Cron->>Script: night-watch resolve
    Script->>GH: gh pr list --state open --json ...
    GH-->>Script: [PR1, PR2, ...]

    loop Each PR
        Script->>GH: gh pr view PR --json mergeable,reviewThreads
        alt Has merge conflicts (PRIMARY)
            Script->>Git: git worktree add + git rebase
            alt Rebase succeeds (auto-merge)
                Script->>Git: git push --force-with-lease
            else Rebase fails (conflicts)
                Script->>AI: "Resolve merge conflicts in these files: ..."
                AI-->>Script: Conflict resolution applied
                Script->>Git: git add + git rebase --continue
                Script->>Git: git push --force-with-lease
            end
        end

        alt aiReviewResolution=true AND has unresolved review comments (SECONDARY)
            Script->>GH: gh api /repos/.../pulls/N/reviews
            Script->>AI: "Implement these review suggestions: ..."
            AI-->>Script: Changes applied
            Script->>Git: git commit + git push
            Script->>GH: gh pr edit --add-reviewer (request re-review)
        end

        alt Conflict-free
            Script->>GH: gh pr edit --add-label ready-to-merge
            Script->>Script: log "PR #N is ready to merge"
        else Still has conflicts
            Script->>GH: gh pr edit --remove-label ready-to-merge
        end
    end

    Script-->>Cron: emit_result with summary
```

## 4. Execution Phases

### Phase 1: Core Registration — Job Type & Config

**User-visible outcome:** `pr-resolver` job type exists in the registry, config normalizes correctly, and `night-watch resolve --dry-run` shows configuration.

**Files (5):**

- `packages/core/src/types.ts` — add `'pr-resolver'` to `JobType`, `IPrResolverConfig` interface, new notification events, `prResolver` to `IJobProviders`
- `packages/core/src/jobs/job-registry.ts` — add `pr-resolver` entry to `JOB_REGISTRY`
- `packages/core/src/constants.ts` — add `DEFAULT_PR_RESOLVER_*` constants
- `packages/core/src/config.ts` — wire `pr-resolver` config normalization (follows existing pattern)
- `packages/core/src/index.ts` — export new types if needed

**Implementation:**

- [ ] Add `'pr-resolver'` to the `JobType` union type
- [ ] Add `prResolver?: Provider` to `IJobProviders`
- [ ] Define `IPrResolverConfig` extending `IBaseJobConfig`:
  ```typescript
  interface IPrResolverConfig extends IBaseJobConfig {
    /** Branch patterns to match (empty = all open PRs) */
    branchPatterns: string[];
    /** Max PRs to process per run (0 = unlimited) */
    maxPrsPerRun: number;
    /** Max runtime per individual PR in seconds */
    perPrTimeout: number;
    /** Whether to attempt AI conflict resolution (vs skip conflicted PRs) */
    aiConflictResolution: boolean;
    /** Whether to also address unresolved review comments (secondary behavior) */
    aiReviewResolution: boolean;
    /** Label to add when PR is conflict-free and ready to merge */
    readyLabel: string;
  }
  ```
- [ ] Add default constants:
  ```typescript
  DEFAULT_PR_RESOLVER_ENABLED = true;
  DEFAULT_PR_RESOLVER_SCHEDULE = '15 6,14,22 * * *'; // 3x daily: 6:15, 14:15, 22:15
  DEFAULT_PR_RESOLVER_MAX_RUNTIME = 3600; // 1 hour
  DEFAULT_PR_RESOLVER_MAX_PRS_PER_RUN = 0; // unlimited
  DEFAULT_PR_RESOLVER_PER_PR_TIMEOUT = 600; // 10 min per PR
  DEFAULT_PR_RESOLVER_AI_CONFLICT_RESOLUTION = true;
  DEFAULT_PR_RESOLVER_AI_REVIEW_RESOLUTION = false; // opt-in; reviewer job handles comments
  DEFAULT_PR_RESOLVER_READY_LABEL = 'ready-to-merge';
  ```
- [ ] Add `pr-resolver` entry to `JOB_REGISTRY`:
  ```typescript
  {
    id: 'pr-resolver',
    name: 'PR Conflict Solver',
    description: 'Resolves merge conflicts via AI rebase; optionally addresses review comments and labels PRs ready-to-merge',
    cliCommand: 'resolve',
    logName: 'pr-resolver',
    lockSuffix: '-pr-resolver.lock',
    queuePriority: 35,  // between reviewer (40) and slicer (30)
    envPrefix: 'NW_PR_RESOLVER',
    extraFields: [
      { name: 'branchPatterns', type: 'string[]', defaultValue: [] },
      { name: 'maxPrsPerRun', type: 'number', defaultValue: 0 },
      { name: 'perPrTimeout', type: 'number', defaultValue: 600 },
      { name: 'aiConflictResolution', type: 'boolean', defaultValue: true },
      { name: 'aiReviewResolution', type: 'boolean', defaultValue: false },
      { name: 'readyLabel', type: 'string', defaultValue: 'ready-to-merge' },
    ],
    defaultConfig: { enabled: true, schedule: '15 6,14,22 * * *', maxRuntime: 3600, ... }
  }
  ```
- [ ] Add `'pr_resolver_completed' | 'pr_resolver_conflict_resolved' | 'pr_resolver_failed'` to `NotificationEvent` union

**Tests Required:**
| Test File | Test Name | Assertion |
|-----------|-----------|-----------|
| `packages/core/src/__tests__/jobs/job-registry.test.ts` | `should include pr-resolver in job registry` | `expect(getJobDef('pr-resolver')).toBeDefined()` |
| `packages/core/src/__tests__/jobs/job-registry.test.ts` | `pr-resolver has correct defaults` | schedule, maxRuntime, queuePriority checks |
| `packages/core/src/__tests__/jobs/job-registry.test.ts` | `normalizeJobConfig handles pr-resolver extra fields` | all extra fields normalized with defaults |

**Verification Plan:**

1. **Unit Tests:** Registry lookup, config normalization for pr-resolver
2. **Evidence:** `yarn verify` passes, `yarn test` passes

---

### Phase 2: CLI Command — `night-watch resolve`

**User-visible outcome:** Running `night-watch resolve --dry-run` displays pr-resolver configuration, open PRs with conflict status, and provider info. Running `night-watch resolve` executes the bash script.

**Files (4):**

- `packages/cli/src/commands/resolve.ts` — **NEW** — CLI command implementation (follows review.ts pattern)
- `packages/cli/src/cli.ts` — register `resolveCommand`
- `packages/cli/src/commands/shared/env-builder.ts` — no changes needed (generic `buildBaseEnvVars` handles new job type)
- `packages/cli/src/commands/install.ts` — add `--no-pr-resolver` / `--pr-resolver` flags

**Implementation:**

- [ ] Create `resolve.ts` following the reviewer command pattern:
  - `IResolveOptions`: `{ dryRun, timeout, provider }`
  - `buildEnvVars(config, options)`: calls `buildBaseEnvVars(config, 'pr-resolver', options.dryRun)` + resolver-specific env vars:
    - `NW_PR_RESOLVER_MAX_RUNTIME`
    - `NW_PR_RESOLVER_MAX_PRS_PER_RUN`
    - `NW_PR_RESOLVER_PER_PR_TIMEOUT`
    - `NW_PR_RESOLVER_AI_CONFLICT_RESOLUTION`
    - `NW_PR_RESOLVER_AI_REVIEW_RESOLUTION`
    - `NW_PR_RESOLVER_READY_LABEL`
    - `NW_PR_RESOLVER_BRANCH_PATTERNS`
  - `applyCliOverrides(config, options)`: timeout + provider overrides
  - Dry-run mode: show config table, list open PRs with conflict status, env vars, command
  - Execute mode: spinner + `executeScriptWithOutput` calling `night-watch-pr-resolver-cron.sh`
  - Notification sending after completion
- [ ] Register in `cli.ts`: `resolveCommand(program)`
- [ ] Add `--no-pr-resolver` / `--pr-resolver` flags to install command for cron schedule control

**Tests Required:**
| Test File | Test Name | Assertion |
|-----------|-----------|-----------|
| `packages/cli/src/__tests__/commands/resolve.test.ts` | `buildEnvVars includes pr-resolver-specific vars` | env var keys present |
| `packages/cli/src/__tests__/commands/resolve.test.ts` | `applyCliOverrides applies timeout override` | config mutated |

**Verification Plan:**

1. **Unit Tests:** env var building, config overrides
2. **Manual:** `night-watch resolve --dry-run` outputs valid config
3. **Evidence:** `yarn verify` passes

---

### Phase 3: Bash Script — Core Resolver Logic

**User-visible outcome:** `night-watch resolve` iterates open PRs, detects conflicts, attempts git rebase, and invokes AI provider for unresolvable conflicts. Optionally addresses review comments. Adds/removes `ready-to-merge` label.

**Files (2):**

- `packages/cli/scripts/night-watch-pr-resolver-cron.sh` — **NEW** — main resolver bash script
- `packages/cli/scripts/night-watch-helpers.sh` — add any shared helper functions if needed (likely none)

**Implementation:**

- [ ] Script structure (following reviewer pattern):
  ```bash
  #!/usr/bin/env bash
  set -euo pipefail
  # Usage: night-watch-pr-resolver-cron.sh /path/to/project
  ```
- [ ] Parse env vars:
  - `NW_PR_RESOLVER_MAX_RUNTIME`, `NW_PR_RESOLVER_MAX_PRS_PER_RUN`, `NW_PR_RESOLVER_PER_PR_TIMEOUT`
  - `NW_PR_RESOLVER_AI_CONFLICT_RESOLUTION`, `NW_PR_RESOLVER_AI_REVIEW_RESOLUTION`
  - `NW_PR_RESOLVER_READY_LABEL`, `NW_PR_RESOLVER_BRANCH_PATTERNS`
  - Standard provider vars via `NW_PROVIDER_CMD`, etc.
- [ ] Source `night-watch-helpers.sh` for `build_provider_cmd`, `log`, `emit_result`, `acquire_lock`, `release_lock`, `rotate_log`, `ensure_provider_on_path`
- [ ] Lock file acquisition: `/tmp/night-watch-pr-resolver-${PROJECT_RUNTIME_KEY}.lock`
- [ ] **PR Discovery:**
  ```bash
  gh pr list --state open --json number,title,headRefName,mergeable,reviewDecision,statusCheckRollup
  ```

  - Filter by `NW_PR_RESOLVER_BRANCH_PATTERNS` if set (comma-separated)
  - Respect `NW_PR_RESOLVER_MAX_PRS_PER_RUN`
- [ ] **Per-PR processing loop:**
  1. **Conflict detection (PRIMARY):** Check `mergeable` status from `gh pr view`
  2. **Rebase attempt:**
     - Create worktree on the PR branch via `prepare_branch_worktree` or manual `git worktree add`
     - `git fetch origin ${DEFAULT_BRANCH}` then `git rebase origin/${DEFAULT_BRANCH}`
     - If rebase succeeds cleanly: `git push --force-with-lease origin ${BRANCH}`
     - If rebase fails with conflicts and `NW_PR_RESOLVER_AI_CONFLICT_RESOLUTION=1`:
       - Abort rebase: `git rebase --abort`
       - Build AI prompt: "You are in a git repository. The branch `{branch}` has merge conflicts with `{default_branch}`. Please rebase this branch onto `origin/{default_branch}` and resolve all merge conflicts. After resolving, ensure the code compiles and tests pass. Use `git rebase origin/{default_branch}` and resolve conflicts, then `git push --force-with-lease origin {branch}`."
       - Invoke AI via `build_provider_cmd` + `timeout`
     - If rebase fails and AI resolution is disabled: skip PR, log warning
  3. **Review comment resolution — SECONDARY (only if `NW_PR_RESOLVER_AI_REVIEW_RESOLUTION=1`):**
     - Check for unresolved review threads: `gh api repos/{owner}/{repo}/pulls/{number}/reviews`
     - If unresolved threads exist:
       - Build AI prompt: "You are in a git repository on branch `{branch}`. This PR has unresolved review comments from GitHub reviewers. Please read the review comments using `gh pr view {number} --comments`, understand the requested changes, implement them, commit with a descriptive message, and push."
       - Invoke AI via `build_provider_cmd` + `timeout`
  4. **Ready-to-merge labeling:**
     - After processing, re-check: `gh pr view {number} --json mergeable`
     - If conflict-free:
       - `gh pr edit {number} --add-label ${READY_LABEL}`
       - Log: "PR #{number} marked as ready-to-merge"
     - Else:
       - `gh pr edit {number} --remove-label ${READY_LABEL}` (ignore error if label not present)
  5. **Worktree cleanup** after each PR
- [ ] **Result emission:**
  - Track: `prs_processed`, `conflicts_resolved`, `reviews_addressed`, `prs_ready`, `prs_failed`
  - `emit_result "success" "prs_processed=${PROCESSED} conflicts_resolved=${CONFLICTS} reviews_addressed=${REVIEWS} prs_ready=${READY}"`
- [ ] **Timeout handling:** per-PR timeout via `NW_PR_RESOLVER_PER_PR_TIMEOUT`, global timeout via `NW_PR_RESOLVER_MAX_RUNTIME`

**Tests Required:**
| Test File | Test Name | Assertion |
|-----------|-----------|-----------|
| `packages/cli/scripts/test-helpers.bats` | `pr-resolver lock acquisition` | lock file created/released |

**Verification Plan:**

1. **Manual test:** Run `night-watch resolve --dry-run` in a project with open PRs
2. **Manual test:** Run `night-watch resolve` on a repo with a known conflicted PR
3. **Evidence:** Log output shows PR iteration, conflict detection, resolution attempt

---

### Phase 4: Notifications & Install Integration

**User-visible outcome:** PR resolver job sends notifications on completion/failure. `night-watch install` includes resolver cron schedule. Summary command includes resolver data.

**Files (5):**

- `packages/core/src/utils/notify.ts` — add pr-resolver notification event formatting
- `packages/cli/src/commands/install.ts` — add pr-resolver cron entry generation
- `packages/cli/src/commands/uninstall.ts` — handle pr-resolver cron removal
- `packages/cli/src/commands/resolve.ts` — wire notification sending in execute flow
- `packages/core/src/utils/summary.ts` — include resolver stats in morning briefing

**Implementation:**

- [ ] Add notification message formatting for `pr_resolver_completed`, `pr_resolver_conflict_resolved`, `pr_resolver_failed` events
- [ ] `install.ts`:
  - Add `--no-pr-resolver` flag to `IInstallOptions`
  - Generate cron entry for pr-resolver using config schedule (same pattern as reviewer/qa)
  - Format: `{schedule} cd {projectDir} && {nightWatchBin} resolve >> {logDir}/pr-resolver.log 2>&1`
- [ ] `uninstall.ts`: remove pr-resolver cron entries in cleanup
- [ ] `resolve.ts`: after script execution, build notification context and call `sendNotifications()`
  - Include `prsProcessed`, `conflictsResolved`, `reviewsAddressed`, `prsReady` in context
- [ ] `summary.ts`: resolver stats in the action items / summary data:
  - "N PRs are ready to merge" or "N PRs have unresolved conflicts"

**Tests Required:**
| Test File | Test Name | Assertion |
|-----------|-----------|-----------|
| `packages/cli/src/__tests__/commands/resolve.test.ts` | `sends pr_resolver_completed notification on success` | notification mock called |
| `packages/cli/src/__tests__/commands/install.test.ts` | `includes pr-resolver cron entry` | crontab contains resolver schedule |

**Verification Plan:**

1. **Unit Tests:** notification formatting, install output
2. **Manual:** `night-watch install` shows pr-resolver in crontab, `night-watch summary` includes resolver data
3. **Evidence:** `yarn verify` + `yarn test` pass

---

### Phase 5: Edge Cases, Idempotency & Hardening

**User-visible outcome:** PR resolver handles edge cases gracefully — protected branches, draft PRs, concurrent runs, AI resolution failures — without breaking existing PRs.

**Files (3):**

- `packages/cli/scripts/night-watch-pr-resolver-cron.sh` — edge case handling
- `packages/cli/src/commands/resolve.ts` — preflight checks
- `packages/core/src/__tests__/commands/resolve.test.ts` — edge case tests

**Implementation:**

- [ ] **Skip draft PRs:** filter out PRs with `isDraft: true`
- [ ] **Skip PRs with `skip-resolver` label:** configurable skip label
- [ ] **Protected branch safety:** never force-push to the default branch; verify branch name before push
- [ ] **Idempotent label management:** don't fail if `ready-to-merge` label doesn't exist yet (auto-create via `gh label create` if missing, ignore errors)
- [ ] **AI resolution failure handling:** if AI provider fails or times out, skip the PR, log error, continue to next PR
- [ ] **Force-with-lease safety:** always use `--force-with-lease` instead of `--force` to avoid overwriting concurrent pushes
- [ ] **Rate limiting:** respect `NW_PR_RESOLVER_MAX_PRS_PER_RUN` and global timeout
- [ ] **Re-check after rebase:** after force-pushing, wait briefly for GitHub to update mergeable status before labeling
- [ ] **Concurrent run protection:** lock file prevents multiple resolver instances

**Tests Required:**
| Test File | Test Name | Assertion |
|-----------|-----------|-----------|
| `packages/cli/src/__tests__/commands/resolve.test.ts` | `skips draft PRs` | draft PRs excluded from processing |
| `packages/cli/src/__tests__/commands/resolve.test.ts` | `skips PRs with skip-resolver label` | labeled PRs excluded |
| `packages/cli/src/__tests__/commands/resolve.test.ts` | `handles AI resolution failure gracefully` | continues to next PR |

**Verification Plan:**

1. **Unit Tests:** edge case filtering
2. **Integration test:** Run against a repo with draft PRs, labeled PRs, and conflicted PRs
3. **Evidence:** `yarn verify` + `yarn test` pass, no data loss in any scenario

## 5. Acceptance Criteria

- [ ] All 5 phases complete
- [ ] All specified tests pass
- [ ] `yarn verify` passes
- [ ] All automated checkpoint reviews passed
- [ ] `night-watch resolve --dry-run` shows configuration and PR conflict status
- [ ] `night-watch resolve` processes open PRs and resolves merge conflicts via AI rebase
- [ ] `ready-to-merge` label added to PRs that are conflict-free
- [ ] `night-watch install` includes pr-resolver cron schedule
- [ ] Notifications sent on completion/failure
- [ ] `night-watch summary` includes resolver stats
- [ ] No force-push to protected/default branches
- [ ] Draft PRs and skip-labeled PRs are excluded
- [ ] AI resolution failures are handled gracefully (skip + continue)
- [ ] Job integrates with global queue system
- [ ] Review comment resolution is opt-in (`aiReviewResolution: false` by default) — does not duplicate reviewer job behavior
