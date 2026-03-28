# Configuration

> Related: [Features](features.md) | [Integrations](../integrations/integrations.md) | [Commands Reference](commands.md) | [Core Package](core-package.md)

Configuration is loaded in this order (later overrides earlier):

1. **Default values** — Built-in defaults from `packages/core/src/constants.ts`
2. **Config file** — `night-watch.config.json` in project root
3. **Environment variables** — `NW_*` prefixed environment variables
4. **CLI flags** — Command-line arguments override everything

## Quick Start

Initialize with defaults:

```bash
night-watch init
```

This creates `night-watch.config.json` with sensible defaults.

## Complete Configuration Reference

### Basic Settings

| Field           | Type   | Default                    | Description                                  |
| --------------- | ------ | -------------------------- | -------------------------------------------- |
| `defaultBranch` | string | `""` (auto-detect)         | Default branch name (e.g., `main`, `master`) |
| `prdDir`        | string | `"docs/prds"`              | Directory containing PRD files               |
| `templatesDir`  | string | `".night-watch/templates"` | Custom template overrides directory          |
| `projectName`   | string | (from package.json)        | Project display name                         |

### Executor Configuration

| Field               | Type         | Default         | Description                              |
| ------------------- | ------------ | --------------- | ---------------------------------------- |
| `executorEnabled`   | boolean      | `true`          | Enable the PRD executor                  |
| `maxRuntime`        | number       | `7200`          | Max runtime in seconds for PRD execution |
| `sessionMaxRuntime` | number\|null | `null`          | Per-session runtime for checkpointing    |
| `cronSchedule`      | string       | `"5 */2 * * *"` | Cron schedule for executor               |

**Session Checkpointing:**

When `sessionMaxRuntime` is set, the executor checkpoints progress at session boundaries and re-queues for continuation:

```json
{
  "maxRuntime": 7200,
  "sessionMaxRuntime": 1800
}
```

This allows long-running PRDs to be processed in 30-minute chunks while preserving progress.

### Reviewer Configuration

| Field                  | Type    | Default          | Description                                            |
| ---------------------- | ------- | ---------------- | ------------------------------------------------------ |
| `reviewerEnabled`      | boolean | `true`           | Enable the PR reviewer                                 |
| `reviewerMaxRuntime`   | number  | `3600`           | Max runtime in seconds for PR reviewer                 |
| `reviewerSchedule`     | string  | `"25 */3 * * *"` | Cron schedule for reviewer                             |
| `reviewerMaxRetries`   | number  | `2`              | Max retry attempts for reviewer fix iterations per run |
| `reviewerRetryDelay`   | number  | `30`             | Delay in seconds between reviewer retry attempts       |
| `reviewerMaxPrsPerRun` | number  | `0`              | Max PRs reviewer processes per run (`0` = unlimited)   |

**Retry Loop:**

The reviewer will fix issues iteratively until:

- The review score passes `minReviewScore` threshold, OR
- `reviewerMaxRetries` is reached

**PR Limits:**

Use `reviewerMaxPrsPerRun` to control batch size in projects with many open PRs.

### Branch Configuration

| Field            | Type     | Default                     | Description                                           |
| ---------------- | -------- | --------------------------- | ----------------------------------------------------- |
| `branchPrefix`   | string   | `"night-watch"`             | Prefix for created branches                           |
| `branchPatterns` | string[] | `["feat/", "night-watch/"]` | Branch patterns for PR reviewer                       |
| `minReviewScore` | number   | `80`                        | Min review score (out of 100) to consider PR complete |

### Review Quality Settings

| Field        | Type   | Default  | Description                               |
| ------------ | ------ | -------- | ----------------------------------------- |
| `maxLogSize` | number | `524288` | Max log file size in bytes (512 KB)       |
| `maxRetries` | number | `3`      | Retry attempts for rate-limited API calls |

### Scheduling Configuration

| Field                | Type         | Default | Description                                               |
| -------------------- | ------------ | ------- | --------------------------------------------------------- |
| `scheduleBundleId`   | string\|null | `null`  | Persisted schedule template ID from Settings UI           |
| `cronScheduleOffset` | number       | `0`     | Minute offset (0-59) applied to cron schedules            |
| `schedulingPriority` | number       | `3`     | Cross-project scheduling priority (higher = earlier slot) |

**Schedule Bundles:**

Pre-configured schedule templates selectable from the Web UI:

- `always-on` — Frequent execution across all jobs
- `night-surge` — Concentrated execution during off-hours

**Cross-Project Balancing:**

When multiple projects are registered:

- Jobs are distributed across available time slots
- `schedulingPriority` controls which project gets preferred slots
- `cronScheduleOffset` adds additional stagger (0-59 minutes)

### Provider Configuration

| Field             | Type         | Default    | Description                                            |
| ----------------- | ------------ | ---------- | ------------------------------------------------------ |
| `provider`        | string       | `"claude"` | AI provider preset ID                                  |
| `providerPresets` | object       | `{}`       | Custom provider preset definitions                     |
| `providerEnv`     | object       | `{}`       | Custom env vars passed to the provider CLI             |
| `providerLabel`   | string\|null | `null`     | **@deprecated** Use `providerPresets[id].name` instead |

**Built-in Presets:**

| Preset ID           | Name              | Description             |
| ------------------- | ----------------- | ----------------------- |
| `claude`            | Claude            | Standard Claude CLI     |
| `claude-sonnet-4-6` | Claude Sonnet 4.6 | Claude Sonnet 4.6 model |
| `claude-opus-4-6`   | Claude Opus 4.6   | Claude Opus 4.6 model   |
| `codex`             | Codex             | Codex CLI               |
| `glm-47`            | GLM-4.7           | GLM-4.7 via proxy       |
| `glm-5`             | GLM-5             | GLM-5 via proxy         |

**Custom Presets:**

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
        "API_KEY": "your-key",
        "API_BASE": "https://api.example.com"
      }
    }
  },
  "provider": "my-provider"
}
```

**Related:** [Provider Presets](../technical/provider-presets.md)

### Per-Job Providers

Assign different AI providers to different job types:

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

**Resolution precedence:** CLI override > schedule override > per-job provider > global provider

**Related:** [Per-Job Providers](../technical/per-job-providers.md)

### Rate-Limit Fallback

| Field                     | Type         | Default    | Description                                                |
| ------------------------- | ------------ | ---------- | ---------------------------------------------------------- |
| `fallbackOnRateLimit`     | boolean      | `true`     | Fall back to secondary preset on 429 responses             |
| `primaryFallbackPreset`   | string\|null | `null`     | First fallback preset ID for rate limit scenarios          |
| `secondaryFallbackPreset` | string\|null | `null`     | Second fallback preset ID                                  |
| `claudeModel`             | string       | `"sonnet"` | Claude model for native execution (`"sonnet"` or `"opus"`) |

**How It Works:**

1. Night Watch detects a 429 response during proxy execution
2. Immediately switches to the fallback preset
3. A Telegram warning is sent right away
4. The task runs to completion with the fallback provider

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

**Fields:**

| Field       | Type            | Description                                |
| ----------- | --------------- | ------------------------------------------ |
| `label`     | string          | Human-friendly label for this override     |
| `presetId`  | string          | Provider preset ID to use when active      |
| `days`      | DayOfWeek[]     | Days of week (0=Sunday, 6=Saturday)        |
| `startTime` | string          | Start time in 24-hour format (HH:mm)       |
| `endTime`   | string          | End time in 24-hour format (HH:mm)         |
| `jobTypes`  | JobType[]\|null | Optional job type filter (null = all jobs) |
| `enabled`   | boolean         | Whether this override is enabled           |

**Cross-Midnight Windows:**

If `endTime < startTime`, the window crosses midnight:

- At 02:00 on Thursday, the window `23:00-04:00` checks if Wednesday (day 3) is in `days`

**Related:** [PRD Provider Schedule Overrides](../PRDs/prd-provider-schedule-overrides.md)

### Notifications

```json
{
  "notifications": {
    "webhooks": [
      {
        "type": "slack",
        "url": "https://hooks.slack.com/services/...",
        "events": ["run_succeeded", "run_failed", "review_completed"]
      }
    ]
  }
}
```

**Webhook Types:**

| Type       | Required Fields                | Description                |
| ---------- | ------------------------------ | -------------------------- |
| `slack`    | `url`, `events`                | Slack incoming webhook URL |
| `discord`  | `url`, `events`                | Discord webhook URL        |
| `telegram` | `botToken`, `chatId`, `events` | Telegram Bot API           |

**Events:**

| Event                    | Fires When                           |
| ------------------------ | ------------------------------------ |
| `run_started`            | PRD executor started                 |
| `run_succeeded`          | PRD execution completed successfully |
| `run_failed`             | PRD execution failed                 |
| `run_timeout`            | PRD execution exceeded max runtime   |
| `run_no_work`            | No eligible PRDs to execute          |
| `review_completed`       | PR review cycle completed            |
| `review_ready_for_human` | PR ready for human review            |
| `rate_limit_fallback`    | Rate limit fallback triggered        |
| `pr_auto_merged`         | PR was automatically merged          |
| `qa_completed`           | QA process completed                 |

**Global Notifications:**

Configure a webhook that applies to all projects:

```bash
mkdir -p ~/.night-watch
cat > ~/.night-watch/global-notifications.json <<EOF
{
  "webhook": {
    "type": "telegram",
    "botToken": "123456:ABC-DEF...",
    "chatId": "GLOBAL_CHAT_ID",
    "events": ["run_failed", "qa_completed"]
  }
}
EOF
```

### PRD Priority

```json
{
  "prdPriority": ["critical-auth-fix", "user-onboarding"]
}
```

PRDs whose filename (without `.md` extension) matches an entry execute first.

### Roadmap Scanner (Planner)

| Field                             | Type    | Default           | Description                                       |
| --------------------------------- | ------- | ----------------- | ------------------------------------------------- |
| `roadmapScanner.enabled`          | boolean | `true`            | Enable planner runs                               |
| `roadmapScanner.roadmapPath`      | string  | `"ROADMAP.md"`    | Path to ROADMAP.md file                           |
| `roadmapScanner.autoScanInterval` | number  | `300`             | Interval in seconds between automatic scans       |
| `roadmapScanner.slicerSchedule`   | string  | `"35 */6 * * *"`  | Cron schedule for planner                         |
| `roadmapScanner.slicerMaxRuntime` | number  | `600`             | Maximum runtime in seconds for planner            |
| `roadmapScanner.priorityMode`     | string  | `"roadmap-first"` | Source priority: `roadmap-first` or `audit-first` |
| `roadmapScanner.issueColumn`      | string  | `"Draft"`         | Column for auto-created planner issues            |

### Board Provider

```json
{
  "boardProvider": {
    "enabled": true,
    "provider": "github",
    "projectNumber": 123
  }
}
```

| Field           | Type    | Default               | Description                                  |
| --------------- | ------- | --------------------- | -------------------------------------------- |
| `enabled`       | boolean | `true`                | Enable the board provider                    |
| `provider`      | string  | `"github"`            | Board provider: `github` or `local`          |
| `projectNumber` | number  | (required for GitHub) | GitHub Projects V2 project number            |
| `repo`          | string  | (auto-detected)       | `owner/repo` format (auto-detected if empty) |

### Auto-Merge

| Field             | Type    | Default    | Description                                      |
| ----------------- | ------- | ---------- | ------------------------------------------------ |
| `autoMerge`       | boolean | `false`    | Enable automatic merging of passing PRs          |
| `autoMergeMethod` | string  | `"squash"` | Git merge method: `squash`, `merge`, or `rebase` |

### QA Process (qa)

| Field                      | Type     | Default              | Description                                                         |
| -------------------------- | -------- | -------------------- | ------------------------------------------------------------------- |
| `qa.enabled`               | boolean  | `true`               | Enable the QA process                                               |
| `qa.schedule`              | string   | `"45 2,10,18 * * *"` | Cron schedule for QA execution                                      |
| `qa.maxRuntime`            | number   | `3600`               | Maximum runtime in seconds for QA tasks                             |
| `qa.branchPatterns`        | string[] | `[]`                 | Branch patterns to match (uses top-level `branchPatterns` if empty) |
| `qa.artifacts`             | string   | `"both"`             | Artifacts to capture: `screenshot`, `video`, or `both`              |
| `qa.skipLabel`             | string   | `"skip-qa"`          | GitHub label to skip QA for specific PRs                            |
| `qa.autoInstallPlaywright` | boolean  | `true`               | Auto-install Playwright browsers if missing                         |

### Code Audit (audit)

| Field                | Type    | Default        | Description                                       |
| -------------------- | ------- | -------------- | ------------------------------------------------- |
| `audit.enabled`      | boolean | `true`         | Enable the audit process                          |
| `audit.schedule`     | string  | `"50 3 * * 1"` | Cron schedule for audit execution (weekly Monday) |
| `audit.maxRuntime`   | number  | `1800`         | Maximum runtime in seconds for the audit          |
| `audit.targetColumn` | string  | `"Draft"`      | Board column for created audit issues             |

### Analytics Job (analytics)

| Field                      | Type    | Default          | Description                             |
| -------------------------- | ------- | ---------------- | --------------------------------------- |
| `analytics.enabled`        | boolean | `false`          | Enable the analytics job                |
| `analytics.schedule`       | string  | `"0 6 * * 1"`    | Cron schedule (weekly Monday 06:00)     |
| `analytics.maxRuntime`     | number  | `900`            | Maximum runtime in seconds (15 minutes) |
| `analytics.lookbackDays`   | number  | `7`              | Days of historical data to analyze      |
| `analytics.targetColumn`   | string  | `"Draft"`        | Board column for created issues         |
| `analytics.analysisPrompt` | string  | (default prompt) | Custom prompt for analysis              |

### Queue Configuration

```json
{
  "queue": {
    "enabled": true,
    "mode": "auto",
    "maxConcurrency": 1,
    "maxWaitTime": 7200,
    "priority": {
      "executor": 50,
      "reviewer": 40,
      "qa": 20,
      "audit": 10,
      "analytics": 10,
      "slicer": 30
    },
    "providerBuckets": {}
  }
}
```

| Field             | Type    | Default        | Description                                             |
| ----------------- | ------- | -------------- | ------------------------------------------------------- |
| `enabled`         | boolean | `true`         | Enable the queue system                                 |
| `mode`            | string  | `"auto"`       | Queue mode: `conservative`, `provider-aware`, or `auto` |
| `maxConcurrency`  | number  | `1`            | Global max concurrent jobs                              |
| `maxWaitTime`     | number  | `7200`         | Max wait time in seconds before job expires             |
| `priority`        | object  | (see defaults) | Job type priority for queue ordering                    |
| `providerBuckets` | object  | `{}`           | Per-provider concurrency limits (provider-aware mode)   |

**Queue Modes:**

- **`conservative`** — Jobs execute one at a time (serial)
- **`provider-aware`** — Parallel execution per-provider with custom limits
- **`auto`** — Automatically selects best mode based on configuration

**Provider Buckets:**

```json
{
  "queue": {
    "providerBuckets": {
      "claude-native": {
        "maxConcurrency": 2
      },
      "codex": {
        "maxConcurrency": 1
      }
    }
  }
}
```

**Related:** [Queue Modes](../technical/queue-modes.md)

## Environment Variables

All Night Watch environment variables are prefixed with `NW_`:

| Variable                       | Config Key                | Example                                                     |
| ------------------------------ | ------------------------- | ----------------------------------------------------------- |
| `NW_DEFAULT_BRANCH`            | `defaultBranch`           | `main`                                                      |
| `NW_PRD_DIR`                   | `prdDir`                  | `docs/prds`                                                 |
| `NW_MAX_RUNTIME`               | `maxRuntime`              | `7200`                                                      |
| `NW_SESSION_MAX_RUNTIME`       | `sessionMaxRuntime`       | `1800`                                                      |
| `NW_REVIEWER_MAX_RUNTIME`      | `reviewerMaxRuntime`      | `3600`                                                      |
| `NW_BRANCH_PREFIX`             | `branchPrefix`            | `night-watch`                                               |
| `NW_BRANCH_PATTERNS`           | `branchPatterns`          | `["feat/", "night-watch/"]` (JSON array or comma-separated) |
| `NW_MIN_REVIEW_SCORE`          | `minReviewScore`          | `80`                                                        |
| `NW_MAX_LOG_SIZE`              | `maxLogSize`              | `524288`                                                    |
| `NW_CRON_SCHEDULE`             | `cronSchedule`            | `0 * * * *`                                                 |
| `NW_REVIEWER_SCHEDULE`         | `reviewerSchedule`        | `0 */3 * * *`                                               |
| `NW_SCHEDULE_BUNDLE_ID`        | `scheduleBundleId`        | `always-on`                                                 |
| `NW_CRON_SCHEDULE_OFFSET`      | `cronScheduleOffset`      | `0`                                                         |
| `NW_SCHEDULING_PRIORITY`       | `schedulingPriority`      | `3`                                                         |
| `NW_PROVIDER`                  | `provider`                | `claude`                                                    |
| `NW_EXECUTOR_ENABLED`          | `executorEnabled`         | `true`                                                      |
| `NW_REVIEWER_ENABLED`          | `reviewerEnabled`         | `true`                                                      |
| `NW_FALLBACK_ON_RATE_LIMIT`    | `fallbackOnRateLimit`     | `true`                                                      |
| `NW_PRIMARY_FALLBACK_PRESET`   | `primaryFallbackPreset`   | `claude-sonnet-4-6`                                         |
| `NW_SECONDARY_FALLBACK_PRESET` | `secondaryFallbackPreset` | `claude-opus-4-6`                                           |
| `NW_CLAUDE_MODEL`              | `claudeModel`             | `sonnet`                                                    |
| `NW_QUEUE_ENABLED`             | `queue.enabled`           | `true`                                                      |
| `NW_QUEUE_MODE`                | `queue.mode`              | `auto`                                                      |
| `NW_NOTIFICATIONS`             | `notifications`           | JSON string                                                 |

**Job-Specific Environment Variables:**

| Variable               | Config Key          | Example |
| ---------------------- | ------------------- | ------- |
| `NW_EXECUTOR_ENABLED`  | `executorEnabled`   | `true`  |
| `NW_REVIEWER_ENABLED`  | `reviewerEnabled`   | `true`  |
| `NW_QA_ENABLED`        | `qa.enabled`        | `true`  |
| `NW_AUDIT_ENABLED`     | `audit.enabled`     | `true`  |
| `NW_ANALYTICS_ENABLED` | `analytics.enabled` | `false` |

**Job-Specific Schedule Variables:**

| Variable                | Config Key           | Example            |
| ----------------------- | -------------------- | ------------------ |
| `NW_EXECUTOR_SCHEDULE`  | `cronSchedule`       | `5 */2 * * *`      |
| `NW_REVIEWER_SCHEDULE`  | `reviewerSchedule`   | `25 */3 * * *`     |
| `NW_QA_SCHEDULE`        | `qa.schedule`        | `45 2,10,18 * * *` |
| `NW_AUDIT_SCHEDULE`     | `audit.schedule`     | `50 3 * * 1`       |
| `NW_ANALYTICS_SCHEDULE` | `analytics.schedule` | `0 6 * * 1`        |

**Job-Specific Runtime Variables:**

| Variable                   | Config Key             | Example |
| -------------------------- | ---------------------- | ------- |
| `NW_EXECUTOR_MAX_RUNTIME`  | `maxRuntime`           | `7200`  |
| `NW_REVIEWER_MAX_RUNTIME`  | `reviewerMaxRuntime`   | `3600`  |
| `NW_QA_MAX_RUNTIME`        | `qa.maxRuntime`        | `3600`  |
| `NW_AUDIT_MAX_RUNTIME`     | `audit.maxRuntime`     | `1800`  |
| `NW_ANALYTICS_MAX_RUNTIME` | `analytics.maxRuntime` | `900`   |

**Job-Specific Extra Fields:**

For jobs with extra configuration fields (QA, Analytics):

| Variable                        | Config Key                 | Example      |
| ------------------------------- | -------------------------- | ------------ |
| `NW_QA_BRANCH_PATTERNS`         | `qa.branchPatterns`        | `["feat/*"]` |
| `NW_QA_ARTIFACTS`               | `qa.artifacts`             | `both`       |
| `NW_QA_SKIP_LABEL`              | `qa.skipLabel`             | `skip-qa`    |
| `NW_QA_AUTO_INSTALL_PLAYWRIGHT` | `qa.autoInstallPlaywright` | `true`       |
| `NW_ANALYTICS_LOOKBACK_DAYS`    | `analytics.lookbackDays`   | `7`          |
| `NW_ANALYTICS_TARGET_COLUMN`    | `analytics.targetColumn`   | `Draft`      |

## CLI Flags

Flags override all other configuration:

```bash
# Executor
night-watch run --provider codex --timeout 3600

# Reviewer
night-watch review --provider claude --timeout 1800

# QA
night-watch qa --provider claude --timeout 3600

# Planner
night-watch slice --provider claude --timeout 600

# Analytics
night-watch analytics --provider claude --timeout 900
```

## Example Configurations

### Minimal Configuration

```json
{
  "provider": "claude",
  "defaultBranch": "main",
  "prdDir": "docs/prds"
}
```

### GLM-5 via Proxy Configuration

```json
{
  "provider": "glm-5",
  "providerEnv": {
    "ANTHROPIC_BASE_URL": "https://api.z.ai/api/anthropic",
    "API_TIMEOUT_MS": "3000000"
  },
  "fallbackOnRateLimit": true,
  "primaryFallbackPreset": "glm-47",
  "secondaryFallbackPreset": "claude-sonnet-4-6"
}
```

### Telegram Notifications Configuration

```json
{
  "notifications": {
    "webhooks": [
      {
        "type": "telegram",
        "botToken": "123456:ABC-DEF1234...",
        "chatId": "YOUR_CHAT_ID",
        "events": ["run_succeeded", "run_failed", "review_completed", "qa_completed"]
      }
    ]
  }
}
```

## Validation

Run `night-watch doctor` to validate your configuration:

```bash
night-watch doctor            # Run health checks
night-watch doctor --fix      # Auto-fix fixable issues
```

**What it checks:**

1. Node.js version (requires 18+)
2. Git repository
3. GitHub CLI (installed and authenticated)
4. Provider CLI (Claude or Codex)
5. Config file syntax
6. PRD directory exists
7. Logs directory exists
8. Webhook configuration (optional)
9. Crontab access (informational)

**Exit codes:**

- `0` — All checks passed
- `1` — Issues found that must be fixed before running Night Watch

## Configuration File Locations

| File                        | Location          | Purpose                                        |
| --------------------------- | ----------------- | ---------------------------------------------- |
| `night-watch.config.json`   | Project root      | Main configuration file                        |
| `global-notifications.json` | `~/.night-watch/` | Global webhook notifications                   |
| `projects.json`             | `~/.night-watch/` | Registered projects registry                   |
| `prd-states.json`           | `~/.night-watch/` | PRD state tracking                             |
| `state.db`                  | `.night-watch/`   | SQLite database (local board, queue, personas) |
