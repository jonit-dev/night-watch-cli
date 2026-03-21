# Features

> Related: [Agent Personas](../agents/agent-personas.md) | [Configuration](configuration.md) | [Commands Reference](commands.md)

Night Watch CLI is an AI-powered development automation tool that manages PRDs, executes implementations, reviews code, runs QA tests, and orchestrates jobs across multiple projects.

## Core Features

### PRD Execution (`run`)

The executor implements PRDs (Product Requirement Documents) by:

- Scanning your PRD directory for eligible documents
- Reading requirements and understanding existing codebase patterns
- Creating implementation branches with descriptive names
- Generating code that follows your project's conventions
- Opening pull requests with detailed descriptions

**Key capabilities:**

- Checkpoint/resume on timeout — progress is saved and execution continues on next run
- Dependency-aware execution — respects `@depends` tags in PRD frontmatter
- Priority ordering — executes high-priority PRDs first via `prdPriority` config
- Session-based runtime — configurable `sessionMaxRuntime` for fine-grained control

**Related:** [Configuration: Executor Settings](configuration.md#executor-configuration)

### PR Review (`review`)

The automated PR reviewer:

- Finds open PRs on configured branch patterns (`night-watch/*`, `feat/*`)
- Checks CI status (via GitHub CLI)
- Evaluates code quality with AI-powered review
- Fixes issues iteratively up to `reviewerMaxRetries` per run
- Posts detailed review comments with scores

**Key capabilities:**

- Score-based approval — merges when `minReviewScore` threshold is met
- Retry loop — fixes issues until score passes or max retries reached
- Configurable limits — `reviewerMaxPrsPerRun` to control batch size
- Retry delay — `reviewerRetryDelay` seconds between attempts

**Related:** [Configuration: Reviewer Settings](configuration.md#reviewer-configuration)

### QA Automation (`qa`)

The QA process runs end-to-end tests using Playwright:

- Scans for open PRs matching `qa.branchPatterns`
- Generates test code based on PR changes
- Runs tests in headless browser
- Captures screenshots and/or videos
- Posts results as PR comments

**Artifacts:**

- `screenshot` — Capture screenshots of test failures
- `video` — Record test execution videos
- `both` — Capture both screenshots and videos (default)

**Configuration:**

```json
{
  "qa": {
    "enabled": true,
    "schedule": "45 2,10,18 * * *",
    "maxRuntime": 3600,
    "branchPatterns": [],
    "artifacts": "both",
    "skipLabel": "skip-qa",
    "autoInstallPlaywright": true
  }
}
```

**Related:** [Configuration: QA Settings](configuration.md#qa-process-qa)

### Code Audit (`audit`)

The auditor performs automated code quality and security reviews:

- Scans codebase for quality issues
- Generates findings in `logs/audit-report.md`
- Creates board issues for actionable items
- Runs on configurable schedule (default: weekly Monday 03:50)

**Related:** [Configuration: Audit Settings](configuration.md#code-audit-audit)

### Analytics Job (`analytics`)

Processes Amplitude product analytics and creates issues for findings:

- Fetches analytics data for configurable lookback period
- Runs AI analysis to identify trends and anomalies
- Creates board issues for actionable insights
- Supports custom analysis prompts

**Related:** [Configuration: Analytics Settings](configuration.md#analytics-job-analytics)

### Planner / Slicer (`slice`)

Generates PRDs from roadmap items:

- Reads `ROADMAP.md` for unchecked items
- Creates structured PRD files using AI
- Optionally creates GitHub Project issues
- Marks items as processed
- Falls back to audit findings when roadmap is exhausted

**Priority modes:**

- `roadmap-first` — Prioritize roadmap items over audit findings (default)
- `audit-first` — Prioritize audit findings over roadmap items

**Related:** [Configuration: Planner Settings](configuration.md#planner-roadmapscanner)

## Project Management

### Board Integration

Track PRDs and their status using GitHub Projects or local SQLite:

**GitHub Projects:**

- Auto-creates issues from PRDs
- Tracks status across columns (Draft, Ready, In Progress, Done, Closed)
- Supports priority labels (P0, P1, P2)
- Supports category labels (product, quality, reliability, tech-debt, documentation)

**Local SQLite:**

- Same issue tracking without GitHub dependency
- Stored in project's `.night-watch/state.db`

**Configuration:**

```json
{
  "boardProvider": {
    "enabled": true,
    "provider": "github",
    "projectNumber": 123
  }
}
```

**Commands:**

- `night-watch board status` — View board status
- `night-watch board next-issue` — Get next issue from Ready column
- `night-watch board create-prd` — Create new issue
- `night-watch board sync-roadmap` — Sync ROADMAP.md to board

### Roadmap Integration

Night Watch reads `ROADMAP.md` to:

- Auto-generate PRDs from unchecked items
- Track which items have been processed
- Maintain version state between scans
- Sync roadmap items to GitHub Project issues

**Roadmap format:**

```markdown
# Roadmap

## Short-term

- [ ] Feature A - Description
- [x] Feature B - Already done

## Medium-term

- [ ] Feature C - Description
```

### Auto-Merge

Automatically merge PRs that pass CI and meet review score threshold:

```json
{
  "autoMerge": true,
  "autoMergeMethod": "squash"
}
```

**Merge methods:**

- `squash` — Squash all commits into one (default)
- `merge` — Create a merge commit
- `rebase` — Rebase commits onto target branch

## Scheduling & Automation

### Cron Installation

Install automated execution via crontab:

```bash
night-watch install
```

**Default schedules:**

- Executor: Every 2 hours (`5 */2 * * *`)
- Reviewer: Every 3 hours (`25 */3 * * *`)
- QA: 3x daily (`45 2,10,18 * * *`)
- Slicer: Every 6 hours (`35 */6 * * *`)
- Audit: Weekly Monday (`50 3 * * 1`)
- Analytics: Weekly Monday (`0 6 * * 1`)

### Global Job Queue

The queue system controls job execution concurrency and scheduling:

**Queue modes:**

- `conservative` — Jobs execute one at a time (serial)
- `provider-aware` — Parallel execution per-provider with custom limits
- `auto` — Automatically selects best mode based on configuration

**Configuration:**

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

**Related:** [Queue Modes](../technical/queue-modes.md)

### Schedule Bundles

Pre-configured schedule templates selectable from the Web UI:

- `always-on` — Frequent execution across all jobs
- `night-surge` — Concentrated execution during off-hours
- Custom schedules via manual configuration

### Cross-Project Balancing

When multiple projects are registered:

- Jobs are distributed across available time slots
- `schedulingPriority` controls which project gets preferred slots (higher = earlier)
- `cronScheduleOffset` adds additional stagger (0-59 minutes)

## Provider System

### Provider Presets

Built-in support for multiple AI providers:

| Preset ID           | Name              | Description             |
| ------------------- | ----------------- | ----------------------- |
| `claude`            | Claude            | Standard Claude CLI     |
| `claude-sonnet-4-6` | Claude Sonnet 4.6 | Claude Sonnet 4.6 model |
| `claude-opus-4-6`   | Claude Opus 4.6   | Claude Opus 4.6 model   |
| `codex`             | Codex             | Codex CLI               |
| `glm-47`            | GLM-4.7           | GLM-4.7 via proxy       |
| `glm-5`             | GLM-5             | GLM-5 via proxy         |

**Custom presets:**

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

**Related:** [Per-Job Providers](../technical/per-job-providers.md)

### Schedule Overrides

Temporarily switch providers based on time windows:

```json
{
  "providerScheduleOverrides": [
    {
      "label": "Night Surge - Claude",
      "presetId": "claude-opus-4-6",
      "days": [0, 1, 2, 3, 4, 5, 6],
      "startTime": "23:00",
      "endTime": "04:00",
      "enabled": true
    }
  ]
}
```

**Resolution precedence:** CLI override > schedule override > per-job provider > global provider

### Rate-Limit Fallback

When using a third-party proxy (e.g., GLM-5):

- Automatically detects HTTP 429 responses
- Falls back to native Claude (OAuth / direct Anthropic API)
- Sends immediate Telegram warning when fallback is triggered
- Continues execution with fallback model

```json
{
  "fallbackOnRateLimit": true,
  "primaryFallbackPreset": "claude-sonnet-4-6",
  "secondaryFallbackPreset": "claude-opus-4-6"
}
```

## Notifications

### Webhook Integrations

Send notifications to Slack, Discord, or Telegram:

**Slack:**

```json
{
  "type": "slack",
  "url": "https://hooks.slack.com/services/...",
  "events": ["run_succeeded", "run_failed", "review_completed"]
}
```

**Discord:**

```json
{
  "type": "discord",
  "url": "https://discord.com/api/webhooks/...",
  "events": ["run_succeeded", "run_failed"]
}
```

**Telegram:**

```json
{
  "type": "telegram",
  "botToken": "YOUR_BOT_TOKEN",
  "chatId": "YOUR_CHAT_ID",
  "events": ["run_succeeded", "run_failed", "qa_completed"]
}
```

**Events:**

- `run_started` — PRD executor started
- `run_succeeded` — PRD execution completed successfully
- `run_failed` — PRD execution failed
- `run_timeout` — PRD execution exceeded max runtime
- `run_no_work` — No eligible PRDs to execute
- `review_completed` — PR review cycle completed
- `review_ready_for_human` — PR ready for human review
- `rate_limit_fallback` — Rate limit fallback triggered
- `pr_auto_merged` — PR was automatically merged
- `qa_completed` — QA process completed

**Structured Telegram Notifications:**

On successful runs, Telegram notifications include:

- PR title and link
- Summary extracted from PR body
- File change stats (files changed, additions, deletions)
- Review retry info and final score
- QA screenshot URLs

**Related:** [Configuration: Notifications](configuration.md#notifications), [Integrations](../integrations/integrations.md)

## Developer Experience

### Web UI

Browser-based interface for project management:

- View all registered projects
- Configure settings without editing JSON
- View logs and status
- Manage schedule bundles
- Configure integrations

```bash
night-watch serve              # Local mode (current project)
night-watch serve --global     # Global mode (all projects)
```

**Default port:** 7575

**Related:** [WEB-UI](WEB-UI.md), [Server API](server-api.md)

### Dashboard

Terminal-based live dashboard:

```bash
night-watch dashboard               # 10s refresh interval
night-watch dashboard --interval 5  # 5s refresh
```

**Tabs:**

1. Status — PRD status, process status, PR status
2. Config — View and edit configuration
3. Schedules — View crontab schedules
4. Actions — Quick actions (run, review, cancel)
5. Logs — View executor and reviewer logs

**Keyboard shortcuts:**

- `1-5` — Switch to tab
- `Shift+Tab` — Previous tab
- `r` — Manual refresh
- `q` or `Escape` — Quit

### CLI Commands

Comprehensive command set for all operations:

| Command             | Purpose                             |
| ------------------- | ----------------------------------- |
| `init`              | Initialize Night Watch in a project |
| `run`               | Execute PRD executor                |
| `review`            | Execute PR reviewer                 |
| `qa`                | Run QA process                      |
| `audit`             | Run code audit                      |
| `analytics`         | Run analytics job                   |
| `slice` / `planner` | Run roadmap slicer                  |
| `install`           | Install crontab entries             |
| `uninstall`         | Remove crontab entries              |
| `status`            | Show current status                 |
| `logs`              | View log output                     |
| `prs`               | List matching PRs with CI status    |
| `prds`              | List PRDs with status               |
| `prd create`        | Generate new PRD with Claude        |
| `prd list`          | List all PRDs                       |
| `board`             | Manage project board                |
| `queue`             | Manage job queue                    |
| `notify`            | Send notification event             |
| `cancel`            | Stop running processes              |
| `retry`             | Move completed PRD back to pending  |
| `history`           | Manage execution history            |
| `prd-state`         | Manage PRD state entries            |
| `state migrate`     | Migrate JSON state to SQLite        |
| `update`            | Update CLI and refresh cron         |
| `doctor`            | Check configuration and health      |
| `serve`             | Start web UI server                 |
| `dashboard`         | Live terminal dashboard             |

**Related:** [Commands Reference](commands.md)

### PRD Format

Structured markdown format for PRDs:

```markdown
---
title: Feature Name
status: ready
priority: P1
category: product
depends: [other-feature]
---

## Overview

Description of the feature.

## Requirements

- Requirement 1
- Requirement 2

## Acceptance Criteria

- [ ] Criterion 1
- [ ] Criterion 2
```

**Status values:** `ready`, `blocked`, `in-progress`, `pending-review`, `done`

**Related:** [PRD Format](prd-format.md)

## Advanced Features

### Session-Based Checkpointing

When `sessionMaxRuntime` is set, executor checkpoints progress at session boundaries and re-queues for continuation:

```json
{
  "maxRuntime": 7200,
  "sessionMaxRuntime": 1800
}
```

This allows:

- Long-running PRDs to be processed in chunks
- Progress preservation across timeouts
- Better queue fairness for other jobs

### PRD Priority Ordering

Control execution order with `prdPriority`:

```json
{
  "prdPriority": ["critical-auth-fix", "user-onboarding"]
}
```

PRDs matching these names execute first, regardless of file order.

### Dependency Management

PRDs can declare dependencies:

```markdown
---
depends: [base-auth-system, user-service-refactor]
---
```

A PRD is only eligible when all its dependencies are `done`.

### Template Customization

Override bundled templates by placing files in `.night-watch/templates/`:

- `executor.md` — Executor instructions
- `prd-executor.md` — PRD execution instructions
- `pr-reviewer.md` — PR review instructions
- `qa.md` — QA instructions
- `audit.md` — Audit instructions
- `prd-creator.md` — PRD planner instructions

### Worktree Support

Night Watch uses git worktrees for isolated execution:

- Each PRD executes in a clean worktree
- No conflicts with other concurrent jobs
- Automatic cleanup on completion

**Related:** [Configuration: Roadmap Scanner](configuration.md#planner-roadmapscanner)
