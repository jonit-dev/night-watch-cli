# Night Watch CLI - Documentation Research Report

Comprehensive extraction of information from existing documentation files. Organized by topic for easy reference.

---

## 1. Architecture Insights

### High-Level System Design

Night Watch is a **cron-driven PRD execution system** for well-scoped engineering work:

```
PRD Files → Night Watch CLI → AI Provider (Claude/Codex) → Git Implementation → GitHub PR → Review/QA/Audit Cycles
```

**Key Characteristics:**

- Async executor: "repo night shift" not general-purpose coding assistant
- AI provider agnostic: spawns Claude or Codex CLI with PRD as prompt
- Multi-stage pipeline: Executor → Reviewer → QA → Audit
- Web dashboard + REST API for visibility
- Webhook notifications to Slack/Telegram/Discord

### Monorepo Structure

```
night-watch-cli/
├── packages/
│   ├── core/      # Domain logic (private)
│   ├── cli/       # Commander.js entry point (published as @jonit-dev/night-watch-cli)
│   └── server/    # Express REST API (private)
├── web/           # React + Vite SPA (standalone build)
├── scripts/       # Bash cron scripts
├── templates/     # PRD templates
└── docs/          # Documentation + PRDs
```

**Package Dependency Graph:**

```
CLI ─┬─→ Core
     └─→ Server ─→ Core
```

### Core Architectural Patterns

1. **Bash Scripts for Execution Layer**
   - `night-watch-cron.sh` - PRD executor
   - `night-watch-pr-reviewer-cron.sh` - PR reviewer
   - `night-watch-qa-cron.sh` - QA runner
   - `night-watch-audit-cron.sh` - Code audit
   - `night-watch-slicer-cron.sh` - Roadmap → PRD slicer
   - `night-watch-helpers.sh` - Shared functions

2. **Node.js Wrapper**
   - CLI: thin wrapper that configures env vars and spawns bash scripts
   - Commander.js framework with 24 commands
   - TypeScript strict mode with tsyringe DI

3. **Repository Pattern with Boundary Enforcement**
   - All SQL confined to `packages/core/src/storage/**`
   - ESLint rule blocks `better-sqlite3` imports outside storage layer
   - SQLite for state: `~/.night-watch/state.db` (global) or `.night-watch/state.db` (per-project)

4. **Dependency Injection (tsyringe)**
   - Token-based registration in `packages/core/src/di/container.ts`
   - All repositories registered as singletons
   - `@injectable()` on classes, `@inject('Token')` for non-class deps

### Data Flow Diagrams

**PRD Execution Flow:**

```
Cron → CLI → Config → Script → Lock → Find PRD → Create Worktree → Spawn AI → Create PR → Mark Done → Cleanup
```

**PR Review Flow:**

```
Cron → CLI → Script → Lock → List PRs → Check CI → Review → Fix (retry loop) → Push → Cleanup
```

**Configuration Cascade:**

```
Hardcoded Defaults → Config File → Environment Variables (NW_*) → CLI Flags
       (lowest)                                                    (highest)
```

**Provider Abstraction:**

```
PROVIDER_COMMANDS map:
  claude → --dangerously-skip-permissions -p '/night-watch'
  codex → --quiet --yolo --prompt '...'
```

---

## 2. CLI Commands Reference

All 24 commands organized by category:

### Core Execution (5 commands)

| Command  | Purpose                         | Script                            |
| -------- | ------------------------------- | --------------------------------- |
| `run`    | Execute next eligible PRD       | `night-watch-cron.sh`             |
| `review` | Review + fix open PRs           | `night-watch-pr-reviewer-cron.sh` |
| `qa`     | Generate tests for reviewed PRs | `night-watch-qa-cron.sh`          |
| `audit`  | AI-driven code quality scan     | `night-watch-audit-cron.sh`       |
| `slice`  | Convert roadmap items to PRDs   | `night-watch-slicer-cron.sh`      |

### Cron Management (2 commands)

| Command     | Purpose                                     |
| ----------- | ------------------------------------------- |
| `install`   | Add crontab entries for automated execution |
| `uninstall` | Remove crontab entries                      |

### Status & Monitoring (4 commands)

| Command   | Purpose                                          |
| --------- | ------------------------------------------------ |
| `status`  | Show project status (processes, PRDs, PRs, logs) |
| `logs`    | View executor/reviewer log output                |
| `history` | Query execution history (used by bash scripts)   |
| `doctor`  | Validate environment setup                       |

### Configuration (2 commands)

| Command  | Purpose                          |
| -------- | -------------------------------- |
| `init`   | Interactive project setup wizard |
| `update` | Update config field values       |

### PRD Management (4 commands)

| Command     | Purpose                             |
| ----------- | ----------------------------------- |
| `prd`       | Create, list, remove, claim PRDs    |
| `prds`      | Query multiple PRDs with filtering  |
| `prd-state` | Query PRD claim/workflow states     |
| `retry`     | Move PRD from done/ back to pending |

### PR Management (2 commands)

| Command  | Purpose                                    |
| -------- | ------------------------------------------ |
| `prs`    | List open PRs with status                  |
| `cancel` | Cancel running executor/reviewer processes |

### Web UI & Dashboard (2 commands)

| Command     | Purpose                                  |
| ----------- | ---------------------------------------- |
| `serve`     | Start Express API server (web dashboard) |
| `dashboard` | Terminal UI dashboard (blessed)          |

### Board & State (2 commands)

| Command | Purpose                             |
| ------- | ----------------------------------- |
| `board` | GitHub Projects board integration   |
| `state` | State management + SQLite migration |

### Queue (1 command)

| Command | Purpose                                                     |
| ------- | ----------------------------------------------------------- |
| `queue` | Manage job queue (status, dispatch, enqueue, clear, expire) |

---

## 3. Configuration Options

### Configuration Loading Priority

1. **Defaults** - `packages/core/src/constants.ts`
2. **Config File** - `night-watch.config.json`
3. **Environment Variables** - `NW_*` prefix
4. **CLI Flags** - Highest priority

### Basic Settings

| Field           | Type   | Default                    | Description               |
| --------------- | ------ | -------------------------- | ------------------------- |
| `defaultBranch` | string | `""` (auto-detect)         | Git default branch        |
| `prdDir`        | string | `"docs/prds"`              | PRD file directory        |
| `templatesDir`  | string | `".night-watch/templates"` | Custom template overrides |
| `projectName`   | string | (from package.json)        | Project display name      |

### Executor Configuration

| Field               | Type         | Default         | Description                    |
| ------------------- | ------------ | --------------- | ------------------------------ |
| `executorEnabled`   | boolean      | `true`          | Enable PRD executor            |
| `maxRuntime`        | number       | `7200`          | Max runtime (seconds)          |
| `sessionMaxRuntime` | number\|null | `null`          | Per-session checkpoint runtime |
| `cronSchedule`      | string       | `"5 */2 * * *"` | Executor cron schedule         |

**Session Checkpointing:** When `sessionMaxRuntime` is set, executor checkpoints at session boundaries and re-queues for continuation.

### Reviewer Configuration

| Field                  | Type    | Default          | Description                     |
| ---------------------- | ------- | ---------------- | ------------------------------- |
| `reviewerEnabled`      | boolean | `true`           | Enable PR reviewer              |
| `reviewerMaxRuntime`   | number  | `3600`           | Max reviewer runtime (seconds)  |
| `reviewerSchedule`     | string  | `"25 */3 * * *"` | Reviewer cron schedule          |
| `reviewerMaxRetries`   | number  | `2`              | Max retry attempts per run      |
| `reviewerRetryDelay`   | number  | `30`             | Delay between retries (seconds) |
| `reviewerMaxPrsPerRun` | number  | `0`              | Max PRs per run (0=unlimited)   |

### Branch Configuration

| Field            | Type     | Default                     | Description                         |
| ---------------- | -------- | --------------------------- | ----------------------------------- |
| `branchPrefix`   | string   | `"night-watch"`             | Created branch prefix               |
| `branchPatterns` | string[] | `["feat/", "night-watch/"]` | PR reviewer patterns                |
| `minReviewScore` | number   | `80`                        | Min score (0-100) for PR completion |

### Provider Configuration

**Built-in Presets:**

- `claude` - Standard Claude CLI
- `claude-sonnet-4-6` - Claude Sonnet 4.6
- `claude-opus-4-6` - Claude Opus 4.6
- `codex` - Codex CLI
- `glm-47` - GLM-4.7 via proxy
- `glm-5` - GLM-5 via proxy

**Custom Presets Example:**

```json
{
  "providerPresets": {
    "my-provider": {
      "name": "My Provider",
      "command": "my-cli",
      "promptFlag": "--prompt",
      "autoApproveFlag": "--yes",
      "modelFlag": "--model",
      "model": "my-model-v1",
      "envVars": {
        "API_KEY": "your-key"
      }
    }
  }
}
```

**Per-Job Providers:**

```json
{
  "provider": "claude",
  "jobProviders": {
    "executor": "claude-sonnet-4-6",
    "reviewer": "claude-opus-4-6",
    "qa": "codex",
    "audit": "claude-sonnet-4-6",
    "analytics": "claude-opus-4-6",
    "slicer": "claude-sonnet-4-6"
  }
}
```

**Rate-Limit Fallback:**
| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `fallbackOnRateLimit` | boolean | `true` | Fall back on 429 responses |
| `primaryFallbackPreset` | string\|null | `null` | First fallback preset |
| `secondaryFallbackPreset` | string\|null | `null` | Second fallback preset |
| `claudeModel` | string | `"sonnet"` | Native Claude model |

### Schedule Overrides

Temporarily switch providers based on time windows:

```json
{
  "providerScheduleOverrides": [
    {
      "label": "Night Surge - Claude Opus",
      "presetId": "claude-opus-4-6",
      "days": [0, 1, 2, 3, 4, 5, 6],
      "startTime": "23:00",
      "endTime": "04:00",
      "jobTypes": ["executor", "reviewer"],
      "enabled": true
    }
  ]
}
```

### Notifications

**Webhook Types:** `slack`, `discord`, `telegram`

**Events:**

- `run_started` - PRD executor started
- `run_succeeded` - PRD execution completed
- `run_failed` - PRD execution failed
- `run_timeout` - Max runtime exceeded
- `run_no_work` - No eligible PRDs
- `review_completed` - PR review cycle done
- `review_ready_for_human` - PR ready for human review
- `rate_limit_fallback` - Fallback triggered
- `pr_auto_merged` - PR auto-merged
- `qa_completed` - QA process done

**Example:**

```json
{
  "notifications": {
    "webhooks": [
      {
        "type": "slack",
        "url": "https://hooks.slack.com/services/...",
        "events": ["run_succeeded", "run_failed"]
      }
    ]
  }
}
```

### Queue Configuration

| Field             | Type    | Default    | Description                              |
| ----------------- | ------- | ---------- | ---------------------------------------- |
| `enabled`         | boolean | `true`     | Enable queue system                      |
| `mode`            | string  | `"auto"`   | `conservative`, `provider-aware`, `auto` |
| `maxConcurrency`  | number  | `1`        | Global max concurrent jobs               |
| `maxWaitTime`     | number  | `7200`     | Max wait (seconds) before expiry         |
| `priority`        | object  | (defaults) | Job type priority                        |
| `providerBuckets` | object  | `{}`       | Per-provider limits                      |

**Default Job Priorities:**
| Job Type | Priority |
|----------|----------|
| executor | 50 |
| reviewer | 40 |
| slicer | 30 |
| qa | 20 |
| audit | 10 |
| analytics | 10 |

### QA Process Configuration

| Field                      | Type     | Default              | Description                      |
| -------------------------- | -------- | -------------------- | -------------------------------- |
| `qa.enabled`               | boolean  | `true`               | Enable QA                        |
| `qa.schedule`              | string   | `"45 2,10,18 * * *"` | QA cron schedule                 |
| `qa.maxRuntime`            | number   | `3600`               | Max QA runtime (seconds)         |
| `qa.branchPatterns`        | string[] | `[]`                 | Branch patterns to match         |
| `qa.artifacts`             | string   | `"both"`             | `screenshot`, `video`, or `both` |
| `qa.skipLabel`             | string   | `"skip-qa"`          | Label to skip QA                 |
| `qa.autoInstallPlaywright` | boolean  | `true`               | Auto-install browsers            |

### Audit Configuration

| Field              | Type    | Default        | Description                 |
| ------------------ | ------- | -------------- | --------------------------- |
| `audit.enabled`    | boolean | `true`         | Enable audit                |
| `audit.schedule`   | string  | `"50 3 * * 1"` | Audit cron (weekly Monday)  |
| `audit.maxRuntime` | number  | `1800`         | Max audit runtime (seconds) |

### Analytics Configuration

| Field                      | Type    | Default       | Description             |
| -------------------------- | ------- | ------------- | ----------------------- |
| `analytics.enabled`        | boolean | `false`       | Enable analytics        |
| `analytics.schedule`       | string  | `"0 6 * * 1"` | Analytics cron          |
| `analytics.maxRuntime`     | number  | `900`         | Max runtime (15 min)    |
| `analytics.lookbackDays`   | number  | `7`           | Historical data days    |
| `analytics.targetColumn`   | string  | `"Draft"`     | Board column for issues |
| `analytics.analysisPrompt` | string  | (default)     | Custom analysis prompt  |

### Roadmap Scanner Configuration

| Field                             | Type    | Default           | Description                      |
| --------------------------------- | ------- | ----------------- | -------------------------------- |
| `roadmapScanner.enabled`          | boolean | `true`            | Enable planner                   |
| `roadmapScanner.roadmapPath`      | string  | `"ROADMAP.md"`    | Roadmap file path                |
| `roadmapScanner.autoScanInterval` | number  | `300`             | Auto-scan interval (seconds)     |
| `roadmapScanner.slicerSchedule`   | string  | `"35 */6 * * *"`  | Slicer cron schedule             |
| `roadmapScanner.slicerMaxRuntime` | number  | `600`             | Slicer max runtime               |
| `roadmapScanner.priorityMode`     | string  | `"roadmap-first"` | `roadmap-first` or `audit-first` |
| `roadmapScanner.issueColumn`      | string  | `"Draft"`         | Column for created issues        |

### Board Provider Configuration

```json
{
  "boardProvider": {
    "enabled": true,
    "provider": "github",
    "projectNumber": 123
  }
}
```

### Auto-Merge Configuration

| Field             | Type    | Default    | Description                    |
| ----------------- | ------- | ---------- | ------------------------------ |
| `autoMerge`       | boolean | `false`    | Enable auto-merge              |
| `autoMergeMethod` | string  | `"squash"` | `squash`, `merge`, or `rebase` |

### Environment Variables (NW\_\* prefix)

**Core Variables:**

- `NW_PROVIDER` - AI provider
- `NW_PRD_DIR` - PRD directory
- `NW_MAX_RUNTIME` - Max executor runtime
- `NW_DEFAULT_BRANCH` - Git default branch
- `NW_BRANCH_PREFIX` - Branch prefix
- `NW_MIN_REVIEW_SCORE` - Min review score
- `NW_QUEUE_ENABLED` - Enable queue
- `NW_QUEUE_MODE` - Queue mode

**Job-Specific Variables:**

- `NW_EXECUTOR_ENABLED` - Enable executor
- `NW_REVIEWER_ENABLED` - Enable reviewer
- `NW_QA_ENABLED` - Enable QA
- `NW_AUDIT_ENABLED` - Enable audit
- `NW_ANALYTICS_ENABLED` - Enable analytics

---

## 4. Development Setup & Conventions

### Prerequisites

| Tool         | Version   | Check              |
| ------------ | --------- | ------------------ |
| Node.js      | >= 22.0.0 | `node -v`          |
| Yarn         | 1.22.x    | `yarn -v`          |
| Git          | any       | `git --version`    |
| GitHub CLI   | any       | `gh auth status`   |
| Claude/Codex | latest    | `claude --version` |

### Quick Setup Commands

```bash
# Clone and install
git clone https://github.com/jonit-dev/night-watch-cli.git
cd night-watch-cli
yarn install

# Build all packages
yarn build

# Type-check + lint
yarn verify

# Run tests
yarn test

# Link CLI globally
yarn local
```

### Development Commands

```bash
yarn verify          # Type-check + lint (no emit)
yarn test            # Run all tests
yarn test:watch      # Watch mode
yarn build           # Build all packages
yarn dev -- <cmd>    # Run CLI from source (no build)
yarn dev:web         # Start web UI in dev mode
yarn local           # Build + link global
yarn unlink          # Remove global symlink
```

### Code Conventions

**File Naming:**

- kebab-case: `agent-persona.repository.ts`, `soul-compiler.ts`
- Tests: `*.test.ts` in `src/__tests__/`

**TypeScript:**

- Strict mode enabled
- Use `interface` (not `type`) for object shapes (enforced)
- Prefix interfaces with `I`: `IAgentPersona`, `INightWatchConfig`
- Unused vars: prefix with `_`
- Prefer const arrays over enums: `['claude', 'codex'] as const`

**Imports:**

- Use `@night-watch/core/module.js` for cross-package
- Use `@/*` path alias for core internals
- Always use `.js` extensions (compiled output)
- `sort-imports` enforced (sort specifiers, not declarations)
- Separate `export type { }` from value exports

**Constants:**

- Centralized in `constants.ts`
- Prefix with `DEFAULT_*` or `VALID_*`

**DI (tsyringe):**

- `@injectable()` on classes
- `@inject('Token')` for non-class deps
- Import `reflect-metadata` only at entrypoints
- Token-based registration in `packages/core/src/di/container.ts`

### Testing

- **Framework:** Vitest with `forks` pool
- **Location:** `src/__tests__/` in each package
- **Test files:** `*.test.ts`
- **DI in tests:** Import `reflect-metadata` first, call `container.reset()` between tests
- **DB isolation:** Use temp directories, clean up in `afterEach`

### Build Pipeline

```
tsc --build → tsc-alias → node build.mjs (esbuild) → dist/cli.js (bundle)
```

**esbuild bundling:**

- Inlines workspace packages (@night-watch/core, @night-watch/server)
- Keeps npm dependencies external (better-sqlite3, express, etc.)
- Banner: `import 'reflect-metadata'` for tsyringe
- Output: single `dist/cli.js` file

### Adding New Components

**New CLI Command:**

1. Create `packages/cli/src/commands/my-command.ts`
2. Export function `myCommand(program: Command)`
3. Import and call in `packages/cli/src/cli.ts`
4. Add tests

**New Repository:**

1. Define interface in `packages/core/src/storage/repositories/interfaces.ts`
2. Implement in `packages/core/src/storage/repositories/sqlite/`
3. Add migration in `packages/core/src/storage/sqlite/migrations.ts`
4. Register in `packages/core/src/di/container.ts`

**New API Endpoint:**

1. Create/edit route in `packages/server/src/routes/`
2. Wire in `packages/server/src/index.ts`
3. Add API function in `web/api.ts`

---

## 5. Integrations

### Notification Integrations

**Slack:**

- Incoming webhooks
- Setup: https://api.slack.com/apps
- Config: `type: "slack"`, `url`, `events`

**Discord:**

- Webhooks
- Setup: Server Settings → Integrations → Webhooks
- Config: `type: "discord"`, `url`, `events`

**Telegram:**

- Bot API
- Setup: @BotFather → /newbot
- Config: `type: "telegram"`, `botToken`, `chatId`, `events`
- Structured notifications with PR details, screenshots, retry info

**Global Notifications:**

- Config file: `~/.night-watch/global-notifications.json`
- Applies to all projects

### Avatar Generation (Replicate Flux)

**API Token Location:** `../myimageupscaler.com/.env.api` as `REPLICATE_API_TOKEN`

**Built-in Persona Portraits:**

- Maya - South Asian woman, charcoal blazer, black turtleneck
- Carlos - Hispanic man, navy henley
- Priya - Indian woman, olive cardigan, tortoiseshell glasses
- Dev - East Asian man, gray crewneck

**Hosting:** GitHub CDN at `https://raw.githubusercontent.com/jonit-dev/night-watch-cli/main/web/public/avatars/{name}.webp`

### Analytics Integration (Amplitude)

**Required Env Vars:**

- `AMPLITUDE_API_KEY`
- `AMPLITUDE_SECRET_KEY`

**What It Does:**

- Fetches analytics for `lookbackDays`
- Runs AI analysis via `analysisPrompt`
- Creates board issues for findings
- Runs on schedule (default: weekly Monday 06:00)

### Project Management Integrations

**GitHub Projects V2:**

- Auto-create board during init
- Track PRD status across columns
- Labels: priority (P0, P1, P2) and category
- Roadmap sync support

**GitHub CLI (gh):**

- PR creation and management
- CI status checks
- PR details for notifications
- Board issue management

**Local SQLite:**

- Database: `.night-watch/state.db`
- Tables: projects, execution_history, prd_states, roadmap_states, kanban_issues, job_queue, job_runs, agent_personas

---

## 6. Key Design Decisions

| Decision             | Choice                        | Rationale                                |
| -------------------- | ----------------------------- | ---------------------------------------- |
| CLI framework        | Commander.js                  | Lightweight, single dependency           |
| Core logic           | Bash scripts                  | Battle-tested for process management     |
| Node.js wrapper      | TypeScript                    | Distribution via npm, type safety        |
| Scheduling           | System crontab                | No daemon, works on any Unix             |
| Isolation            | Git worktrees                 | Parallel execution without conflicts     |
| Concurrency          | PID lock files                | Simple, reliable, auto-cleanup           |
| Provider abstraction | Strategy pattern              | Easy to add new AI CLIs                  |
| Config hierarchy     | Defaults < File < Env < Flags | Standard precedence, 12-factor           |
| Persistence          | SQLite via repository         | Structured state, architectural boundary |
| DI container         | tsyringe                      | Decorator-based, TypeScript-native       |

---

## 7. Database Schema

**Location:** `~/.night-watch/state.db` or `.night-watch/state.db`

**Tables:**

- `projects` - Registered project paths
- `execution_history` - PRD execution records, cooldown tracking
- `prd_states` - Per-PRD workflow state
- `roadmap_states` - Roadmap scan metadata
- `kanban_issues` - Board issue tracking
- `job_queue` - Global job queue
- `job_runs` - Job execution records (analytics)
- `agent_personas` - Persona definitions
- `schema_meta` - Schema version + encryption keys

**SQLite Pragmas:** `journal_mode = WAL`, `busy_timeout = 5000`

---

## 8. Web UI Structure

**Global Layout:**

- Sidebar (collapsible) - Navigation + project selector
- Top bar - Project name, status, search, notifications
- Main content - Page-specific content
- Toast system - Bottom-right notifications

**Pages:**

1. Dashboard (`/`) - Overview cards, PRD pipeline, activity feed
2. PRDs (`/prds`) - PRD list, detail, creation modal
3. Pull Requests (`/prs`) - PR table, CI status, review scores
4. Actions (`/actions`) - Action cards, live output, run history
5. Logs (`/logs`) - Log viewer with follow mode
6. Settings (`/settings`) - Tabs: General, Runtime, Schedules, Notifications, Provider

**Server Modes:**

- Single-project: `night-watch serve` (localhost:7575)
- Multi-project: `night-watch serve --global`

**API Endpoints:**

- `/api/status` - Current status snapshot
- `/api/status/events` - SSE stream (real-time)
- `/api/actions/*` - Trigger actions
- `/api/config` - Config management
- `/api/board/*` - Board operations
- `/api/roadmap/*` - Roadmap operations
- `/api/logs/:name` - Log files
- `/api/doctor` - Health checks

---

## 9. Default Schedules

| Job       | Schedule           | Description   |
| --------- | ------------------ | ------------- |
| Executor  | `5 */2 * * *`      | Every 2 hours |
| Reviewer  | `25 */3 * * *`     | Every 3 hours |
| QA        | `45 2,10,18 * * *` | 3x daily      |
| Slicer    | `35 */6 * * *`     | Every 6 hours |
| Audit     | `50 3 * * 1`       | Weekly Monday |
| Analytics | `0 6 * * 1`        | Weekly Monday |

---

## 10. Troubleshooting Quick Reference

**Common Issues:**

| Issue                  | Fix                                                  |
| ---------------------- | ---------------------------------------------------- |
| Lock file exists       | `night-watch cancel` or `rm /tmp/night-watch-*.lock` |
| Provider CLI not found | Check PATH, install claude/codex CLI                 |
| No eligible PRDs       | Check dependencies, PR status, cooldown              |
| Rate limit 429         | Enable fallback, wait, or switch provider            |
| Timeout                | Split PRD, increase maxRuntime                       |
| Worktree issues        | `git worktree prune`, `git worktree remove --force`  |
| Build stale            | Delete `*.tsbuildinfo`, rebuild                      |

**Diagnostic Commands:**

```bash
night-watch doctor           # Health check
night-watch status --verbose # Detailed status
night-watch run --dry-run    # Preview execution
night-watch logs -n 200      # Recent logs
```

**Log File Locations:**

- Executor: `logs/executor.log`
- Reviewer: `logs/reviewer.log`
- QA: `logs/qa.log`
- Audit: `logs/audit.log`
- Server: `logs/server.log`

---

## 11. PRD Lifecycle

```
Pending → Claimed → PR Opened → Done
   ↓
Blocked (unmet dependencies)
```

**States:** `ready`, `blocked`, `in-progress`, `pending-review`, `done`

**PRD Frontmatter Example:**

```yaml
---
title: Feature Name
status: ready
priority: P1
category: product
depends: [other-feature]
---
```

---

## 12. Agent Personas (Historical Note)

The agent personas (Maya, Carlos, Priya, Dev) were defined in the codebase but are **not currently active**. The Slack multi-agent deliberation system was removed in commit 46637a0. Personas remain available for future use.

**Persona Storage:** `agent_personas` table in SQLite

**Persona Components:**

- `soul` - Worldview, opinions, expertise
- `style` - Communication patterns
- `skill` - Behavioral modes

---

## 13. File Reference Summary

**Architecture Docs:**

- `architecture-overview.md` - High-level system diagrams
- `scheduler-architecture.md` - Global job queue details
- `build-pipeline.md` - Compilation and bundling

**Reference Docs:**

- `features.md` - Feature overview
- `configuration.md` - Complete config reference
- `commands.md` - CLI command reference
- `bash-scripts.md` - Bash script architecture
- `core-package.md` - Core package details
- `cli-package.md` - CLI package details
- `server-api.md` - REST API reference

**Guides:**

- `DEV-ONBOARDING.md` - Developer onboarding
- `walkthrough.md` - 5-minute quick start
- `local-testing.md` - Local CLI testing
- `troubleshooting.md` - Common issues
- `contributing.md` - Contribution guidelines

**Integrations:**

- `WEB-UI.md` - Web UI specification
- `integrations.md` - Third-party integrations
- `agent-personas.md` - Agent persona definitions

---

End of Research Report
