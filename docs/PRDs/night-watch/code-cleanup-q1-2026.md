# PRD: Code Cleanup Q1 2026

**Complexity:** 4 → MEDIUM

## Context

**Problem:** Three distinct code quality issues add maintenance burden and will compound as the codebase grows: (1) `buildEnvVars` and `getTelegramStatusWebhooks` are copy-pasted across four command files, (2) `mergeConfigs` in `config.ts` manually copies ~25 properties twice, and (3) a stale doc file describes a deleted system and misleads readers (including AI agents).

**Files Analyzed:**

- `packages/cli/src/commands/run.ts`
- `packages/cli/src/commands/review.ts`
- `packages/cli/src/commands/qa.ts`
- `packages/cli/src/commands/slice.ts`
- `packages/core/src/config.ts`
- `docs/slack-agent-system-architecture.md`

**Current Behavior:**

- `buildEnvVars` exists independently in all 4 command files with overlapping logic: `NW_PROVIDER_CMD`, `NW_DEFAULT_BRANCH`, `providerEnv` injection, `NW_DRY_RUN`, and `NW_EXECUTION_CONTEXT='agent'` are built identically in each
- `getTelegramStatusWebhooks` is copy-pasted verbatim in both `qa.ts` and `slice.ts`
- `mergeConfigs` in `config.ts` (lines 427–512) manually checks ~25 config properties twice — once for `fileConfig`, once for `envConfig` — ~85 lines of repetition
- `docs/slack-agent-system-architecture.md` describes `packages/slack` which was deleted in commit `46637a0`; it already has a DEPRECATED banner but still pollutes the docs directory and confuses AI agents reading the codebase

## Solution

**Approach:**

- Extract shared env-var building logic into `packages/cli/src/commands/shared/env-builder.ts` — a `buildBaseEnvVars(config, isDryRun)` function that handles the 5 always-identical fields, then each command calls it and extends with job-specific vars
- Extract `getTelegramStatusWebhooks` into the same shared module (it's identical in qa.ts and slice.ts)
- Replace the two-pass manual merge in `mergeConfigs` with a generic `mergeConfigLayer` helper that iterates over defined keys from a partial config — eliminating the duplication while preserving exact semantics (shallow-merge for nested objects, spread for arrays)
- Delete `docs/slack-agent-system-architecture.md`

**Key Decisions:**

- No behavior changes — pure refactor. Output of `buildEnvVars` in each command must be bit-for-bit identical after the change
- Keep each command's `buildEnvVars` as a named export (tests may reference them); just have them delegate to the shared base
- `mergeConfigLayer` stays private to `config.ts` — not exported — since it's an implementation detail

**Data Changes:** None

## Integration Points

```
Entry points: run, review, qa, slice CLI commands (unchanged)
Shared module: packages/cli/src/commands/shared/env-builder.ts
  └── called by: run.ts, review.ts, qa.ts, slice.ts
config.ts mergeConfigLayer: private helper, called only inside mergeConfigs
```

---

## Phase 1: Extract shared env-var utilities

**User-visible outcome:** No behavior change; `buildEnvVars` in each command delegates to a shared base, removing ~40 lines of duplication.

**Files (max 5):**

- `packages/cli/src/commands/shared/env-builder.ts` — new file: `buildBaseEnvVars` + `getTelegramStatusWebhooks`
- `packages/cli/src/commands/run.ts` — call `buildBaseEnvVars`, remove duplicate logic
- `packages/cli/src/commands/review.ts` — call `buildBaseEnvVars`, remove duplicate logic
- `packages/cli/src/commands/qa.ts` — call `buildBaseEnvVars` + imported `getTelegramStatusWebhooks`
- `packages/cli/src/commands/slice.ts` — call `buildBaseEnvVars` + imported `getTelegramStatusWebhooks`

**Implementation:**

`buildBaseEnvVars` should set exactly these 5 fields shared by all jobs:

```ts
env.NW_PROVIDER_CMD = PROVIDER_COMMANDS[resolveJobProvider(config, jobType)];
if (config.defaultBranch) env.NW_DEFAULT_BRANCH = config.defaultBranch;
if (config.providerEnv) Object.assign(env, config.providerEnv);
if (isDryRun) env.NW_DRY_RUN = '1';
env.NW_EXECUTION_CONTEXT = 'agent';
```

Signature:

```ts
export function buildBaseEnvVars(
  config: INightWatchConfig,
  jobType: 'executor' | 'reviewer' | 'qa' | 'slicer' | 'audit',
  isDryRun: boolean,
): Record<string, string>;
```

Each command's `buildEnvVars` becomes:

```ts
export function buildEnvVars(config, options): Record<string, string> {
  const env = buildBaseEnvVars(config, 'executor', options.dryRun);
  // ... job-specific fields only
  return env;
}
```

`getTelegramStatusWebhooks` (identical in qa.ts and slice.ts):

```ts
export function getTelegramStatusWebhooks(
  config: INightWatchConfig,
): Array<{ botToken: string; chatId: string }>;
```

- [ ] Create `packages/cli/src/commands/shared/env-builder.ts` with `buildBaseEnvVars` and `getTelegramStatusWebhooks`
- [ ] Update `run.ts` to import and use `buildBaseEnvVars`
- [ ] Update `review.ts` to import and use `buildBaseEnvVars`
- [ ] Update `qa.ts` to import `buildBaseEnvVars` and `getTelegramStatusWebhooks`, remove local copy
- [ ] Update `slice.ts` to import `buildBaseEnvVars` and `getTelegramStatusWebhooks`, remove local copy

**Tests Required:**
| Test File | Test Name | Assertion |
|-----------|-----------|-----------|
| `packages/cli/src/__tests__/commands/shared/env-builder.test.ts` | `should set NW_PROVIDER_CMD from config` | `expect(env.NW_PROVIDER_CMD).toBe('claude')` |
| `packages/cli/src/__tests__/commands/shared/env-builder.test.ts` | `should set NW_DRY_RUN when isDryRun is true` | `expect(env.NW_DRY_RUN).toBe('1')` |
| `packages/cli/src/__tests__/commands/shared/env-builder.test.ts` | `should not set NW_DRY_RUN when isDryRun is false` | `expect(env.NW_DRY_RUN).toBeUndefined()` |
| `packages/cli/src/__tests__/commands/shared/env-builder.test.ts` | `should always set NW_EXECUTION_CONTEXT to agent` | `expect(env.NW_EXECUTION_CONTEXT).toBe('agent')` |
| `packages/cli/src/__tests__/commands/shared/env-builder.test.ts` | `should inject providerEnv into result` | `expect(env.MY_API_KEY).toBe('test-key')` |
| `packages/cli/src/__tests__/commands/shared/env-builder.test.ts` | `should skip NW_DEFAULT_BRANCH when not set` | `expect(env.NW_DEFAULT_BRANCH).toBeUndefined()` |
| `packages/cli/src/__tests__/commands/shared/env-builder.test.ts` | `getTelegramStatusWebhooks should return only telegram webhooks with botToken and chatId` | array length check |

**Checkpoint:** `yarn verify && yarn test --filter=@jonit-dev/night-watch-cli`

---

## Phase 2: Simplify mergeConfigs in config.ts

**User-visible outcome:** No behavior change; `mergeConfigs` reduces from ~90 lines to ~30 by using a generic `mergeConfigLayer` helper.

**Files (max 5):**

- `packages/core/src/config.ts` — replace lines 427–512 with `mergeConfigLayer` helper

**Implementation:**

Add a private helper before `mergeConfigs`:

```ts
/**
 * Apply a partial config layer onto a base, skipping undefined values.
 * Nested objects are shallow-merged; arrays are spread (not concatenated).
 */
function mergeConfigLayer(base: INightWatchConfig, layer: Partial<INightWatchConfig>): void {
  for (const _key of Object.keys(layer) as Array<keyof INightWatchConfig>) {
    const value = layer[_key];
    if (value === undefined) continue;

    // Keys needing special (shallow) merge semantics
    if (_key === 'providerEnv' || _key === 'boardProvider') {
      (base as Record<string, unknown>)[_key] = {
        ...(base[_key] as object),
        ...(value as object),
      };
    } else if (
      _key === 'roadmapScanner' ||
      _key === 'qa' ||
      _key === 'audit' ||
      _key === 'jobProviders'
    ) {
      (base as Record<string, unknown>)[_key] = {
        ...(base[_key] as object),
        ...(value as object),
      };
    } else if (_key === 'branchPatterns' || _key === 'prdPriority') {
      (base as Record<string, unknown>)[_key] = [...(value as string[])];
    } else {
      (base as Record<string, unknown>)[_key] = value;
    }
  }
}
```

Then `mergeConfigs` becomes:

```ts
function mergeConfigs(
  base: INightWatchConfig,
  fileConfig: Partial<INightWatchConfig> | null,
  envConfig: Partial<INightWatchConfig>,
): INightWatchConfig {
  const merged: INightWatchConfig = { ...base };
  if (fileConfig) mergeConfigLayer(merged, fileConfig);
  mergeConfigLayer(merged, envConfig);

  merged.maxRetries = sanitizeMaxRetries(merged.maxRetries, DEFAULT_MAX_RETRIES);
  merged.reviewerMaxRetries = sanitizeReviewerMaxRetries(
    merged.reviewerMaxRetries,
    DEFAULT_REVIEWER_MAX_RETRIES,
  );
  merged.reviewerRetryDelay = sanitizeReviewerRetryDelay(
    merged.reviewerRetryDelay,
    DEFAULT_REVIEWER_RETRY_DELAY,
  );

  return merged;
}
```

- [ ] Add `mergeConfigLayer` private helper above `mergeConfigs`
- [ ] Replace the two-pass manual merge in `mergeConfigs` with two `mergeConfigLayer` calls
- [ ] Verify all existing config tests still pass

**Tests Required:**

The existing `packages/core/src/__tests__/config.test.ts` suite covers this fully — no new tests needed, but all existing tests must pass. Run them to confirm identical behavior.

**Checkpoint:** `yarn verify && yarn test --filter=@night-watch/core`

---

## Phase 3: Delete stale docs

**User-visible outcome:** `docs/slack-agent-system-architecture.md` is removed; AI agents and developers reading the codebase no longer encounter documentation for a deleted system.

**Files:**

- `docs/slack-agent-system-architecture.md` — delete

**Implementation:**

- [ ] Delete `docs/slack-agent-system-architecture.md`
- [ ] Verify no other doc links to it (check `docs/*.md` for references)

**Tests Required:** None — documentation only.

**Checkpoint:** `yarn verify`

---

## Acceptance Criteria

- [ ] All phases complete
- [ ] `yarn verify` passes
- [ ] All config tests pass (behavior of `mergeConfigs` is unchanged)
- [ ] New env-builder tests pass
- [ ] `docs/slack-agent-system-architecture.md` deleted
- [ ] No new files created beyond `packages/cli/src/commands/shared/env-builder.ts`
