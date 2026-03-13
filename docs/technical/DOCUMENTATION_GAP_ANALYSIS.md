# Documentation Gap Analysis

**Date:** 2026-03-13
**Scope:** Complete audit of night-watch-cli codebase documentation coverage

**Method:** Team-based analysis with 3 specialized agents:
- `codebase-explorer` - Cataloged all features, modules, CLI commands
- `doc-finder` - Found all existing documentation
- `gap-analyzer` - Cross-referenced and identified specific gaps

---

## Quick Reference: Missing Config Fields (HIGH PRIORITY)

The following configuration fields exist in the codebase but are **completely missing** from `docs/configuration.md`:

```json
{
  // Queue & Concurrency
  "queueMode": "provider-aware",  // "conservative" | "provider-aware" | "auto"
  "providerBuckets": { /* provider-specific bucket config */ },

  // Scheduling
  "scheduleBundleId": "always-on",
  "cronScheduleOffset": 0,
  "schedulingPriority": 50,

  // Runtime
  "sessionMaxRuntime": 3600,  // Per-session override

  // Provider Fallback
  "primaryFallbackPreset": "claude",
  "secondaryFallbackPreset": "codex",

  // Reviewer
  "reviewerMaxRetries": 3,
  "reviewerRetryDelay": 60,
  "reviewerMaxPrsPerRun": 5,

  // Jobs
  "jobProviders": {
    "analytics": "claude-opus-4-6",
    "planner": "claude"
  },

  // DEPRECATED (not marked as such)
  "providerLabel": "custom"  // Deprecated
}
```

**Built-in Provider Presets (undocumented):**
- `claude`, `codex`, `glm-47`, `glm-5`, `claude-sonnet-4-6`, `claude-opus-4-6`

---

## Executive Summary

The codebase has solid user-facing documentation (README, walkthrough, configuration) and some developer documentation (DEV-ONBOARDING, architecture-overview). However, there are significant gaps in:

1. **API reference documentation** - Core package APIs are undocumented
2. **Internal architecture details** - Data flows, state management, job execution
3. **Board provider system** - New kanban/roadmap integration
4. **Job registry system** - Extensible job framework
5. **Analytics integration** - Amplitude tracking
6. **Technical reference** - DI container, repositories, utilities

---

## 1. CRITICAL GAPS (Completely Undocumented)

| Gap | Location | Who Needs It | Priority |
|-----|----------|--------------|----------|
| **Board Provider System** | `packages/core/src/board/` | Users, Developers | HIGH |
| **Job Registry & Extensibility** | `packages/core/src/jobs/` | Developers | HIGH |
| **Scheduling System** | `packages/core/src/utils/scheduling.ts` | Users, Developers | HIGH |
| **Provider Presets** | `packages/core/src/config.ts` | Users | MEDIUM |
| **Analytics Integration** | `packages/core/src/analytics/` | Developers | MEDIUM |
| **Roadmap Scanner** | `packages/core/src/utils/roadmap-scanner.ts` | Users | MEDIUM |

### 1.1 Board Provider System (HIGH)

**What:** Kanban board integration (GitHub Projects, local) for tracking PRD execution status

**Location:**
- `packages/core/src/board/types.ts`
- `packages/core/src/board/factory.ts`
- `packages/core/src/board/providers/github-graphql.ts`
- `packages/core/src/board/providers/github-projects.ts`
- `packages/core/src/board/providers/local-kanban.ts`

**Missing:**
- How board providers work
- How to configure GitHub Projects integration
- Board status mapping (Draft → Ready → In Progress → Review → Done)
- Label management and sync
- Local kanban provider for testing

### 1.2 Job Registry System (HIGH)

**What:** Extensible job framework for adding new job types

**Location:**
- `packages/core/src/jobs/job-registry.ts`
- `packages/core/src/jobs/index.ts`

**Missing:**
- How to register custom jobs
- Job interface and lifecycle
- Job queue system (`packages/core/src/utils/job-queue.ts`)
- Provider-aware job routing

### 1.3 Scheduling System (HIGH)

**What:** Cron-based job scheduling with templates and pressure-based routing

**Location:**
- `packages/core/src/utils/scheduling.ts`
- `packages/core/src/utils/crontab.ts`
- `packages/core/src/utils/roadmap-scanner.ts`

**Missing:**
- Schedule templates (always-on, business-hours, etc.)
- Pressure model for weighted scheduling
- Cron offset and timezone handling
- Schedule bundle configuration

### 1.4 Provider Presets (MEDIUM → HIGH)

**What:** Pre-configured provider settings for different job types

**Location:** Configuration in `packages/core/src/config.ts`

**Built-in Presets (undocumented):**
- `claude` - Default Claude
- `codex` - Default Codex
- `glm-47` - GLM-4.7 model
- `glm-5` - GLM-5 model
- `claude-sonnet-4-6` - Claude Sonnet 4.6
- `claude-opus-4-6` - Claude Opus 4.6

**Missing:**
- Complete list of available presets
- How to create custom presets
- Preset inheritance and override behavior
- Model-specific options per preset

### 1.5 Analytics Job & Command (HIGH)

**What:** Analytics tracking via Amplitude + dedicated CLI command

**Location:**
- `packages/cli/src/commands/analytics.ts`
- `packages/core/src/analytics/`
- Job registry entry for 'analytics' job

**Missing:**
- What events are tracked
- How to disable analytics
- Privacy considerations
- CLI command usage (`night-watch analytics`)
- Per-job provider configuration for analytics

### 1.6 Queue Modes (HIGH)

**What:** Different queue execution strategies

**Location:** Configuration types

**Modes (undocumented):**
- `conservative` - Sequential execution
- `provider-aware` - Provider-aware bucketed queue (NEW)
- `auto` - Automatic mode selection

**Missing:**
- How each mode works
- When to use each mode
- `providerBuckets` configuration
- Queue behavior differences

### 1.7 Session-level Configuration (HIGH)

**What:** Per-session runtime overrides

**Missing Fields:**
- `sessionMaxRuntime` - Override max runtime for a single run

### 1.8 Advanced Fallback Options (MEDIUM)

**What:** Granular fallback preset configuration

**Missing Fields:**
- `primaryFallbackPreset` - First fallback preset
- `secondaryFallbackPreset` - Second fallback preset

### 1.9 Scheduling Priority (MEDIUM)

**What:** Job execution priority weighting

**Missing Field:**
- `schedulingPriority` - Priority for job scheduling

### 1.10 Reviewer Configuration (MEDIUM)

**What:** Reviewer job behavior controls

**Missing Fields:**
- `reviewerMaxRetries` - Max retry attempts
- `reviewerRetryDelay` - Delay between retries
- `reviewerMaxPrsPerRun` - Max PRs per reviewer run

### 1.11 Analytics Integration (LOW - covered in 1.5)

**What:** Amplitude analytics tracking

**Location:**
- `packages/core/src/analytics/index.ts`
- `packages/core/src/analytics/amplitude-client.ts`
- `packages/core/src/analytics/analytics-runner.ts`

**Missing:**
- What events are tracked
- How to disable analytics
- Privacy considerations

### 1.6 Roadmap Scanner (MEDIUM)

**What:** Scans ROADMAP.md for new PRD candidates

**Location:** `packages/core/src/utils/roadmap-scanner.ts`

**Missing:**
- How roadmap parsing works
- Configuration options
- Integration with PRD creation

---

## 2. PARTIAL GAPS (Mentioned but Incomplete)

| Gap | Existing Docs | Missing Detail | Priority |
|-----|--------------|----------------|----------|
| **CLI Commands** | `docs/commands.md` | New board commands, dashboard tabs | MEDIUM |
| **Server API** | `docs/server-api.md` | SSE endpoints, new routes | MEDIUM |
| **Web UI** | `docs/WEB-UI.md` | New dashboard tabs (Parallelism, Schedules) | MEDIUM |
| **Configuration** | `docs/configuration.md` | New options (scheduleBundleId, templatesDir, boardProvider, jobProviders, autoMerge) | HIGH |

### 2.1 CLI Commands

**Existing:** `docs/commands.md`

**New/Undocumented Commands:**
- `night-watch board create-prd` - Create PRD from board item
- `night-watch board sync` - Sync board status
- `night-watch plan` - New planning command
- `night-watch analytics` - Analytics-related commands
- Dashboard subcommands: `tab-actions`, `tab-schedules`, `tab-logs`, `tab-status`, `tab-config`

### 2.2 Server API

**Existing:** `docs/server-api.md`

**Missing:**
- SSE endpoints for real-time updates
- Roadmap routes (`packages/server/src/routes/roadmap.routes.ts`)
- PRD routes updates
- New middleware (project resolver, SSE)

### 2.3 Web UI

**Existing:** `docs/WEB-UI.md`

**Missing Settings Tabs:**
- **Advanced Tab** - Advanced configuration options
- **AiRuntimeTab** - AI runtime settings (provider, model, presets)
- **IntegrationsTab** - Third-party integrations (webhooks, etc.)
- **JobsTab** - Job configuration and scheduling
- **SchedulesTab** - Schedule templates and cron settings
- **Parallelism Tab** - Provider-aware queue configuration
- **Actions Tab** - Action history and management
- **Logs Tab** - Execution logs viewing
- **Config Tab** - General configuration
- **Status Tab** - System status overview

**Missing Dashboard Features:**
- Queue mode selection (conservative/provider-aware/auto)
- Provider bucket configuration UI
- Schedule template management
- Per-job provider assignment

### 2.4 Configuration

**Existing:** `docs/configuration.md`

**Missing Fields:**
- `scheduleBundleId` - Persisted schedule template
- `cronScheduleOffset` - Minute offset for cron
- `templatesDir` - Custom template override directory
- `boardProvider` - Board provider configuration
- `jobProviders` - Per-job provider configuration
- `autoMerge` - Enable automatic PR merging
- `autoMergeMethod` - Git merge method (squash/merge/rebase)
- `sessionMaxRuntime` - Per-session runtime override
- `primaryFallbackPreset` - First fallback preset
- `secondaryFallbackPreset` - Second fallback preset
- `providerBuckets` - Queue bucket configuration
- `schedulingPriority` - Job priority weighting
- `reviewerMaxRetries` - Reviewer max retry attempts
- `reviewerRetryDelay` - Reviewer retry delay
- `reviewerMaxPrsPerRun` - Reviewer max PRs per run
- `queueMode` - conservative | provider-aware | auto

**Deprecated Fields (not marked as such):**
- `providerLabel` - Deprecated but not documented as such

---

## 2.5 Environment Variables (HIGH)

**Missing from `docs/configuration.md`:**

| Variable | Purpose |
|----------|---------|
| `NIGHT_WATCH_HOME` | Override Night Watch home directory (useful for testing) |

---

## 2.6 Per-Job Provider Configuration (HIGH)

**What:** Assign specific providers to specific job types

**Missing from documentation:**
- How to configure `jobProviders` in config
- Available job types for per-job provider assignment
- Example: `jobProviders: { analytics: "claude-opus-4-6", planner: "claude" }`

---

## 3. DEVELOPER DOCS GAPS

| Gap | Location | Priority |
|-----|----------|----------|
| **DI Container Pattern** | `packages/core/src/di/container.ts` | HIGH |
| **Repository Pattern** | `packages/core/src/storage/repositories/` | HIGH |
| **State Management** | `packages/core/src/utils/*-state.ts` | MEDIUM |
| **Testing Patterns** | `src/__tests__/` | MEDIUM |
| **Build Pipeline Details** | `build.mjs`, `packages/cli/build.mjs` | MEDIUM |

### 3.1 DI Container (tsyringe)

**Location:** `packages/core/src/di/container.ts`

**Missing:**
- How tokens are registered
- How to inject dependencies
- Repository singleton pattern
- `getRepositories()` factory usage

### 3.2 Repository Pattern

**Locations:**
- `packages/core/src/storage/repositories/interfaces.ts`
- `packages/core/src/storage/repositories/sqlite/`

**Missing:**
- Repository interface definition
- SQLite implementation details
- Migration system (`packages/core/src/storage/sqlite/migrations.ts`)
- How to add new repositories

### 3.3 State Management

**Locations:**
- `packages/core/src/utils/roadmap-state.ts`
- `packages/core/src/utils/prd-states.ts`
- `packages/core/src/utils/execution-history.ts`

**Missing:**
- State transition diagrams
- State persistence strategy
- State migration (`packages/core/src/storage/json-state-migrator.ts`)

### 3.4 Testing Patterns

**Locations:** All `src/__tests__/` directories

**Missing:**
- Test setup patterns
- DI testing patterns (`container.reset()`)
- Temp directory usage for DB isolation
- Mock patterns

### 3.5 Build Pipeline

**Locations:**
- `build.mjs` (root)
- `packages/cli/build.mjs`

**Missing:**
- esbuild configuration details
- Why `import.meta.url` points to bundle location
- How `reflect-metadata` banner is added
- When to delete `.tsbuildinfo`

---

## 4. USER DOCS GAPS

| Gap | Priority |
|-----|----------|
| **Board Mode Walkthrough** | HIGH |
| **Dashboard Guide** | MEDIUM |
| **Troubleshooting Updates** | MEDIUM |

### 4.1 Board Mode Walkthrough

**Missing:** End-to-end guide for using GitHub Projects board workflow instead of PRD files

### 4.2 Dashboard Guide

**Missing:** Guide for using the web dashboard, especially new tabs (Schedules, Parallelism, Logs)

### 4.3 Troubleshooting Updates

**Existing:** `docs/troubleshooting.md`

**Needs:** Issues related to:
- Board sync failures
- GitHub Projects API rate limits
- Multi-provider scheduling

---

## 5. OUTDATED DOCS

| Doc | Issue | Priority |
|-----|-------|----------|
| `CLAUDE.md` | Mentions removed `packages/slack/` | HIGH |
| `ROADMAP.md` | Mentions "Legacy Code Pending Removal" - may be outdated | MEDIUM |

### 5.1 CLAUDE.md Memory File

**Issue:** States "What Was Deleted" includes `packages/slack/` which is historical but the file should be verified for current accuracy

---

## 6. RECOMMENDED NEW DOCS FOR `docs/technical/`

1. **board-providers.md** - Board provider system architecture
2. **job-registry.md** - Job extensibility framework
3. **scheduling-system.md** - Cron scheduling and pressure model
4. **di-container.md** - Dependency injection patterns
5. **repository-pattern.md** - Data access layer patterns
6. **state-management.md** - State persistence and transitions
7. **testing-guide.md** - Testing patterns and utilities
8. **build-system.md** - Build pipeline details (esbuild, tsc-alias)
9. **provider-presets.md** - Provider configuration presets (ALL built-in presets)
10. **queue-modes.md** - Queue execution strategies (conservative/provider-aware/auto)
11. **analytics.md** - Analytics integration details
12. **per-job-providers.md** - Job-specific provider assignment guide

---

## 7. RECOMMENDED DOC UPDATES

1. **docs/configuration.md** - Add missing config fields
2. **docs/commands.md** - Add new board and dashboard commands
3. **docs/server-api.md** - Add SSE and new routes
4. **docs/WEB-UI.md** - Document new dashboard tabs
5. **docs/walkthrough.md** - Add board mode variant
6. **README.md** - Update with board mode mentions
7. **CLAUDE.md** - Verify accuracy, remove stale references

---

## 8. DOCUMENTATION STRUCTURE RECOMMENDATION

```
docs/
├── technical/           # NEW: Deep-dive technical docs
│   ├── board-providers.md
│   ├── job-registry.md
│   ├── scheduling-system.md
│   ├── di-container.md
│   ├── repository-pattern.md
│   ├── state-management.md
│   ├── testing-guide.md
│   ├── build-system.md
│   ├── provider-presets.md
│   └── analytics.md
├── user/                # NEW: User-facing guides (reorg existing)
│   ├── walkthrough.md
│   ├── board-mode-guide.md
│   ├── dashboard-guide.md
│   └── configuration.md
├── developer/           # NEW: Dev-focused docs (reorg existing)
│   ├── DEV-ONBOARDING.md
│   ├── architecture-overview.md
│   ├── contributing.md
│   └── troubleshooting.md
└── PRDs/                # Keep as-is
```

---

## Summary by Priority

### HIGH (Address First)
1. **Configuration docs update** - Add ~15 missing config fields (queueMode, providerBuckets, schedulingPriority, reviewerMaxRetries, sessionMaxRuntime, etc.)
2. **Provider Presets documentation** - All built-in presets (claude, codex, glm-47, glm-5, claude-sonnet-4-6, claude-opus-4-6)
3. **Queue Modes documentation** - conservative/provider-aware/auto
4. **Per-Job Provider configuration** - How to assign providers to specific jobs
5. **Board Provider System documentation**
6. **Job Registry documentation**
7. **Web UI Settings tabs** - All 10 tabs documented
8. **DI Container pattern docs**
9. **Repository pattern docs**

### MEDIUM
1. Scheduling system documentation
2. CLI commands update (board, plan, analytics, dashboard tabs)
3. Server API update (SSE, roadmap routes)
4. State management documentation
5. Testing guide
6. Build system documentation
7. Analytics job/command documentation
8. Board mode walkthrough

### LOW
1. Analytics privacy documentation
2. Custom preset creation guide
3. Dashboard guide
4. Troubleshooting updates
