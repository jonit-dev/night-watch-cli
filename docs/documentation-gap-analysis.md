# Documentation Gap Analysis Report

**Date:** 2025-03-13
**Analyzed:** night-watch-cli codebase vs existing documentation
**Scope:** User documentation, developer documentation, and configuration reference

---

## Executive Summary

This report identifies gaps between the night-watch-cli codebase and its documentation. The analysis covered:
- CLI commands and their options
- Configuration fields in `types.ts` and `constants.ts`
- Web UI pages and components
- Server API routes
- Job types and their configuration

**Total gaps identified:** 25+ items across critical, partial, outdated, and developer documentation categories.

---

## 1. Critical Gaps (Features/Settings Completely Undocumented)

### 1.1 Analytics Job (`night-watch analytics`)

**What's missing:**
- The `night-watch analytics` command exists but has no dedicated documentation
- Analytics configuration section is missing from `configuration.md`
- Amplitude integration setup is not documented

**Where in code:**
- `packages/cli/src/commands/analytics.ts`
- `packages/core/src/types.ts` - `IAnalyticsConfig` interface
- `packages/core/src/constants.ts` - DEFAULT_ANALYTICS_* constants
- `packages/core/src/jobs/job-registry.ts` - 'analytics' job definition

**Who needs this:** Users, Developers

**Priority:** High

**Evidence:**
- Analytics job type exists in JOB_REGISTRY with id: 'analytics'
- Command is registered but only briefly mentioned in commands.md
- Configuration fields (`enabled`, `schedule`, `maxRuntime`, `lookbackDays`, `targetColumn`, `analysisPrompt`) not documented

---

### 1.2 Provider Presets System

**What's missing:**
- Built-in provider presets (claude, codex, glm-47, glm-5, claude-sonnet-4-6, claude-opus-4-6) not documented
- Custom provider preset configuration not documented
- The `providerPresets` config field is missing from configuration.md

**Where in code:**
- `packages/core/src/types.ts` - `IProviderPreset` interface
- `packages/core/src/constants.ts` - `BUILT_IN_PRESETS` object
- `packages/core/src/config-normalize.ts` - preset resolution logic

**Who needs this:** Users

**Priority:** High

**Evidence:**
- `BUILT_IN_PRESETS` contains 6 presets (claude, codex, glm-47, glm-5, claude-sonnet-4-6, claude-opus-4-6)
- Each preset defines: name, command, subcommand, promptFlag, autoApproveFlag, workdirFlag, modelFlag, model, envVars
- Users can override built-in presets or add custom ones via `providerPresets` config

---

### 1.3 Queue Configuration (`queue` section)

**What's missing:**
- The `queue` configuration section is missing from `configuration.md`
- Queue modes (`conservative`, `provider-aware`, `auto`) not documented
- Per-bucket capacity configuration (`providerBuckets`) not documented

**Where in code:**
- `packages/core/src/types.ts` - `IQueueConfig`, `IProviderBucketConfig`, `QueueMode`
- `packages/core/src/utils/job-queue.ts` - queue implementation
- `packages/cli/src/commands/queue.ts` - CLI command

**Who needs this:** Users

**Priority:** High

**Evidence:**
- Queue config has: enabled, mode, maxConcurrency, maxWaitTime, priority, providerBuckets
- Three modes: 'conservative' (serial), 'provider-aware' (parallel per-bucket), 'auto' (automatic)
- Provider buckets allow setting maxConcurrency per provider (e.g., 'claude-native', 'codex', 'claude-proxy:api.z.ai')

---

### 1.4 Session-level Runtime Configuration

**What's missing:**
- `sessionMaxRuntime` field not documented in configuration.md
- No explanation of session checkpointing behavior

**Where in code:**
- `packages/core/src/types.ts` - `INightWatchConfig.sessionMaxRuntime`
- `packages/core/src/constants.ts` - no default set (uses maxRuntime)

**Who needs this:** Users

**Priority:** Medium

**Evidence:**
- Field comment: "Maximum runtime per executor session. When a session hits this limit it checkpoints and re-queues the issue for the next run. Defaults to maxRuntime when not set."

---

### 1.5 Advanced Fallback Configuration

**What's missing:**
- `primaryFallbackPreset` and `secondaryFallbackPreset` not documented
- Only `claudeModel` is documented for fallback configuration

**Where in code:**
- `packages/core/src/types.ts` - `primaryFallbackPreset`, `secondaryFallbackPreset` fields

**Who needs this:** Users

**Priority:** Medium

**Evidence:**
- Allows falling back from one preset to another (e.g., glm-5 to glm-47) on rate limit
- Takes precedence over primaryFallbackModel when set

---

### 1.6 Per-Job Provider Configuration (analytics, planner)

**What's missing:**
- `analytics` and `planner` (slicer) not listed in `jobProviders` documentation
- Current docs only show: executor, reviewer, qa, audit, slicer

**Where in code:**
- `packages/core/src/types.ts` - `IJobProviders` interface includes `analytics` and `planner`
- `packages/core/src/jobs/job-registry.ts` - includes both job types

**Who needs this:** Users

**Priority:** Medium

---

### 1.7 Scheduling Priority

**What's missing:**
- `schedulingPriority` field not in configuration.md
- No explanation of cross-project scheduling behavior

**Where in code:**
- `packages/core/src/types.ts` - `schedulingPriority: number`
- `packages/core/src/utils/scheduling.ts` - scheduling logic

**Who needs this:** Users

**Priority:** Medium

**Evidence:**
- Field comment: "Cross-project scheduling priority. Higher values get earlier balanced start slots and win tie-breakers under queue contention."
- Default: 3 (DEFAULT_SCHEDULING_PRIORITY)

---

### 1.8 Reviewer Retry Configuration

**What's missing:**
- `reviewerMaxRetries`, `reviewerRetryDelay`, `reviewerMaxPrsPerRun` not documented

**Where in code:**
- `packages/core/src/types.ts` - all three fields exist
- `packages/core/src/constants.ts` - defaults defined

**Who needs this:** Users

**Priority:** Medium

**Evidence:**
- `reviewerMaxRetries`: Maximum retry attempts for reviewer fix iterations within a single cron run (default: 2)
- `reviewerRetryDelay`: Delay in seconds between reviewer retry attempts (default: 30)
- `reviewerMaxPrsPerRun`: Maximum number of PRs the reviewer should process in a single run (default: 0 = unlimited)

---

## 2. Partial Gaps (Mentioned But Not Fully Explained)

### 2.1 Web UI Pages Documentation

**What's incomplete:**
- `docs/WEB-UI.md` exists but doesn't cover all pages
- Missing: Board, Dashboard, Logs, PRs, Roadmap, Scheduling pages details
- Settings page tabs not documented (AdvancedTab, AiRuntimeTab, IntegrationsTab, JobsTab, SchedulesTab, GeneralTab)

**Where in code:**
- `web/pages/` - Board.tsx, Dashboard.tsx, Logs.tsx, PRs.tsx, Roadmap.tsx, Scheduling.tsx, Settings.tsx
- `web/pages/settings/` - individual tab components

**Who needs this:** Users

**Priority:** Medium

---

### 2.2 Server API Documentation

**What's incomplete:**
- `docs/server-api.md` exists but may be incomplete
- API routes: action.routes.ts, board.routes.ts, config.routes.ts, doctor.routes.ts, log.routes.ts, prd.routes.ts, queue.routes.ts, roadmap.routes.ts, status.routes.ts

**Where in code:**
- `packages/server/src/routes/` - all route files

**Who needs this:** Developers

**Priority:** Medium

---

### 2.3 Analytics Integration

**What's incomplete:**
- Amplitude API key configuration only mentioned in code
- No setup guide for Amplitude integration

**Where in code:**
- `packages/cli/src/commands/analytics.ts` - uses AMPLITUDE_API_KEY and AMPLITUDE_SECRET_KEY from providerEnv

**Who needs this:** Users

**Priority:** Low

---

## 3. Outdated Docs (Documentation That Doesn't Match Current Code)

### 3.1 Deprecated `providerLabel` Field

**What's outdated:**
- `providerLabel` field is marked `@deprecated` in code but not mentioned as deprecated in documentation
- Docs should mention using `providerPresets[id].name` instead

**Where in code:**
- `packages/core/src/types.ts` - `providerLabel` with @deprecated tag

**Who needs this:** Users, Developers

**Priority:** Low

---

### 3.2 Scheduler Architecture Doc

**What's potentially outdated:**
- `docs/scheduler-architecture.md` may not reflect provider-aware queue mode
- Queue modes (conservative/provider-aware/auto) added after initial scheduler design

**Where in code:**
- `packages/core/src/utils/job-queue.ts` - current implementation

**Who needs this:** Developers

**Priority:** Medium

---

## 4. Developer Documentation Gaps

### 4.1 NIGHT_WATCH_HOME Environment Variable

**What's missing:**
- `NIGHT_WATCH_HOME` env var for overriding global config directory
- Used for testing but not documented

**Where in code:**
- `packages/core/src/utils/job-queue.ts` - `getStateDbPath()` function
- Various files that use GLOBAL_CONFIG_DIR

**Who needs this:** Developers, Testers

**Priority:** Low

---

### 4.2 Job Registry System

**What's missing:**
- `packages/core/src/jobs/job-registry.ts` not documented
- Single source of truth for job metadata, defaults, and config patterns
- Adding new job types requires only adding an entry to JOB_REGISTRY

**Who needs this:** Developers

**Priority:** Medium

---

### 4.3 Provider Resolution Logic

**What's missing:**
- How `resolveJobProvider()`, `resolvePreset()`, `resolveProviderBucketKey()` work
- Provider bucket key resolution for queue capacity checks

**Where in code:**
- `packages/core/src/config.ts` - provider resolution functions
- `packages/core/src/constants.ts` - `resolveProviderBucketKey()` function

**Who needs this:** Developers

**Priority:** Low

---

### 4.4 Template Customization

**What's missing:**
- `templatesDir` configuration option documented but no guide on customizing templates
- Template files in `packages/core/src/templates/` not documented

**Where in code:**
- `packages/core/src/templates/prd-template.ts`
- `packages/core/src/templates/slicer-prompt.ts`

**Who needs this:** Users, Developers

**Priority:** Low

---

## 5. User Documentation Gaps

### 5.1 Execution Timeline UI

**What's missing:**
- Execution Timeline page mentioned in README but not documented
- Shows scheduled agent runs across projects

**Where in code:**
- Referenced in README with screenshot, likely part of Scheduling.tsx

**Who needs this:** Users

**Priority:** Low

---

### 5.2 Parallelism Tab (New)

**What's missing:**
- New "Parallelism" tab mentioned in recent commits
- Shows provider bucket capacity and running jobs

**Where in code:**
- Recent commits: "feat: add auto dispatch mode and dedicated Parallelism tab"

**Who needs this:** Users

**Priority:** Medium

---

### 5.3 Queue CLI Command

**What's missing:**
- `night-watch queue` command has no dedicated user guide
- Subcommands: status, list, clear, enqueue, dispatch, complete, can-start, expire

**Where in code:**
- `packages/cli/src/commands/queue.ts`
- Briefly documented in commands.md but needs expansion

**Who needs this:** Users

**Priority:** Low

---

## 6. Configuration Field Reference Gaps

The following configuration fields exist in `INightWatchConfig` but are not documented in `docs/configuration.md`:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `sessionMaxRuntime` | number | (maxRuntime) | Max runtime per executor session before checkpointing |
| `schedulingPriority` | number | 3 | Cross-project scheduling priority |
| `reviewerMaxRetries` | number | 2 | Max reviewer fix iterations per cron run |
| `reviewerRetryDelay` | number | 30 | Delay between reviewer retries (seconds) |
| `reviewerMaxPrsPerRun` | number | 0 | Max PRs to review per run (0 = unlimited) |
| `providerPresets` | object | (built-in) | Custom provider preset definitions |
| `primaryFallbackPreset` | string | undefined | Preset ID for primary fallback |
| `secondaryFallbackPreset` | string | undefined | Preset ID for secondary fallback |
| `queue` | object | (see below) | Global job queue configuration |
| `queue.enabled` | boolean | true | Enable global queue |
| `queue.mode` | string | 'auto' | Dispatch mode: conservative/provider-aware/auto |
| `queue.maxConcurrency` | number | 1 | Max concurrent jobs |
| `queue.maxWaitTime` | number | 7200 | Max wait before expiration (seconds) |
| `queue.priority` | object | (computed) | Job type priority mapping |
| `queue.providerBuckets` | object | {} | Per-bucket capacity config |

## 7. Recommendations

### High Priority
1. Add Analytics job documentation (commands + configuration)
2. Document Provider Presets system in configuration.md
3. Add Queue configuration section to configuration.md
4. Document sessionMaxRuntime and checkpointing behavior

### Medium Priority
1. Complete WEB-UI.md with all pages and Settings tabs
2. Document schedulingPriority and cross-project behavior
3. Update scheduler-architecture.md for provider-aware mode
4. Document reviewer retry/max PRs configuration

### Low Priority
1. Add NIGHT_WATCH_HOME to developer documentation
2. Document Job Registry system for contributors
3. Add template customization guide
4. Document Parallelism tab (new feature)

---

## Appendix: File Locations Reference

**Core Types & Constants:**
- `packages/core/src/types.ts` - All interfaces and types
- `packages/core/src/constants.ts` - Default values and built-in presets
- `packages/core/src/config-normalize.ts` - Config normalization logic

**Job Registry:**
- `packages/core/src/jobs/job-registry.ts` - Job type definitions

**CLI Commands:**
- `packages/cli/src/commands/` - All CLI command implementations

**Web UI:**
- `web/pages/` - Main pages
- `web/pages/settings/` - Settings tab components

**Server API:**
- `packages/server/src/routes/` - API route handlers

**Documentation:**
- `docs/` - All user documentation
- `docs/configuration.md` - Configuration reference
- `docs/commands.md` - CLI commands reference
- `docs/WEB-UI.md` - Web UI documentation
- `CLAUDE.md` - Project conventions (for contributors)
