# Configuration

> Related: [Core Package](core-package.md) | [Commands Reference](commands.md) | [CLI Package](cli-package.md) | [Architecture Overview](architecture-overview.md)

Configuration is loaded in this order (later overrides earlier):

1. Default values
2. Config file (`night-watch.config.json`)
3. Environment variables (`NW_*`)
4. CLI flags

---

## Config File

Create `night-watch.config.json` in your project root:

```json
{
  "projectName": "my-project",
  "defaultBranch": "main",
  "provider": "claude",
  "reviewerEnabled": true,
  "prdDir": "docs/PRDs/night-watch",
  "maxRuntime": 7200,
  "reviewerMaxRuntime": 3600,
  "branchPrefix": "night-watch",
  "branchPatterns": ["feat/", "night-watch/"],
  "minReviewScore": 80,
  "maxLogSize": 524288,
  "cronSchedule": "0 0-15 * * *",
  "reviewerSchedule": "0 0,3,6,9,12,15 * * *",
  "providerEnv": {},
  "fallbackOnRateLimit": false,
  "claudeModel": "sonnet"
}
```

### Config Fields

> **Note:** All configuration fields can be customized from the Settings page in the Web UI. You no longer need to edit `night-watch.config.json` directly.

| Field                 | Type     | Default                         | Description                                                |
| --------------------- | -------- | ------------------------------- | ---------------------------------------------------------- |
| `defaultBranch`       | string   | `""` (auto-detect)              | Default branch name (e.g. `main`)                          |
| `provider`            | string   | `"claude"`                      | AI provider (`claude` or `codex`)                          |
| `reviewerEnabled`     | boolean  | `true`                          | Enable the PR reviewer                                     |
| `prdDir`              | string   | `"docs/PRDs/night-watch"`       | Directory containing PRD files                             |
| `maxRuntime`          | number   | `7200`                          | Max runtime in seconds for PRD execution                   |
| `reviewerMaxRuntime`  | number   | `3600`                          | Max runtime in seconds for PR reviewer                     |
| `branchPrefix`        | string   | `"night-watch"`                 | Prefix for created branches                                |
| `branchPatterns`      | string[] | `["feat/", "night-watch/"]`     | Branch patterns for PR reviewer                            |
| `minReviewScore`      | number   | `80`                            | Min review score (out of 100)                              |
| `maxLogSize`          | number   | `524288`                        | Max log file size in bytes (512 KB)                        |
| `cronSchedule`        | string   | `"0 0-21 * * *"`                | Cron schedule for executor                                 |
| `reviewerSchedule`    | string   | `"0 0,3,6,9,12,15,18,21 * * *"` | Cron schedule for reviewer                                 |
| `cronScheduleOffset`  | number   | `0`                             | Minute offset (0-59) applied to cron schedules during install |
| `maxRetries`          | number   | `3`                             | Retry attempts for rate-limited API calls                  |
| `providerEnv`         | object   | `{}`                            | Custom env vars passed to the provider CLI                 |
| `fallbackOnRateLimit` | boolean  | `false`                         | Fall back to native Claude when proxy returns 429          |
| `claudeModel`         | string   | `"sonnet"`                      | Claude model for native execution (`"sonnet"` or `"opus"`) |
| `notifications`       | object   | `{ webhooks: [] }`              | Notification webhook configuration (see below)             |
| `prdPriority`         | string[] | `[]`                            | PRDs matching these names are executed first               |
| `roadmapScanner`      | object   | (see below)                     | Roadmap scanner configuration                              |
| `templatesDir`        | string   | `".night-watch/templates"`      | Directory for custom template overrides                     |
| `boardProvider`       | object   | (see below)                     | Board provider configuration for PRD tracking              |
| `jobProviders`        | object   | `{}`                            | Per-job provider configuration                             |
| `autoMerge`           | boolean  | `false`                         | Enable automatic merging of PRs that pass CI and review    |
| `autoMergeMethod`     | string   | `"squash"`                      | Git merge method for auto-merge (`squash`, `merge`, `rebase`) |
| `qa`                  | object   | (see below)                     | QA process configuration                                   |
| `audit`               | object   | (see below)                     | Code audit configuration                                   |

---

## Environment Variables

All Night Watch env vars are prefixed with `NW_`:

| Variable                    | Config Key                                            |
| --------------------------- | ----------------------------------------------------- |
| `NW_DEFAULT_BRANCH`         | `defaultBranch`                                       |
| `NW_PRD_DIR`                | `prdDir`                                              |
| `NW_MAX_RUNTIME`            | `maxRuntime`                                          |
| `NW_REVIEWER_MAX_RUNTIME`   | `reviewerMaxRuntime`                                  |
| `NW_BRANCH_PREFIX`          | `branchPrefix`                                        |
| `NW_BRANCH_PATTERNS`        | `branchPatterns` (JSON array or comma-separated)      |
| `NW_MIN_REVIEW_SCORE`       | `minReviewScore`                                      |
| `NW_MAX_LOG_SIZE`           | `maxLogSize`                                          |
| `NW_CRON_SCHEDULE`          | `cronSchedule`                                        |
| `NW_REVIEWER_SCHEDULE`      | `reviewerSchedule`                                    |
| `NW_PROVIDER`               | `provider`                                            |
| `NW_REVIEWER_ENABLED`       | `reviewerEnabled`                                     |
| `NW_REVIEWER_PARALLEL`      | reviewer parallel fan-out (`1` enabled, `0` disabled) |
| `NW_FALLBACK_ON_RATE_LIMIT` | `fallbackOnRateLimit`                                 |
| `NW_CLAUDE_MODEL`           | `claudeModel`                                         |

---

## CLI Flags

Flags override all other configuration:

```bash
night-watch run --provider codex --timeout 3600
night-watch review --provider claude --timeout 1800
```

---

## Provider Environment (`providerEnv`)

The `providerEnv` field lets you pass arbitrary environment variables to the provider CLI process. This is how you configure custom API endpoints, keys, or proxies.

```json
{
  "provider": "claude",
  "providerEnv": {
    "ANTHROPIC_API_KEY": "your-api-key",
    "ANTHROPIC_BASE_URL": "https://your-endpoint.example.com"
  }
}
```

How it works:

- **Runtime** — Variables are injected into the spawned provider CLI process when running `night-watch run` or `night-watch review`
- **Cron** — Variables are exported in each cron entry when running `night-watch install`, so automated runs inherit them
- **Dry run** — Variables are displayed under "Environment Variables" when using `--dry-run`

See the [GLM-5 setup guide](../README.md#using-glm-5-or-custom-endpoints) in the README for a concrete example.

---

## Rate-Limit Fallback

When using a third-party proxy (e.g. GLM-5 via a custom `ANTHROPIC_BASE_URL`), the proxy may exhaust its quota and start returning HTTP 429 errors. The rate-limit fallback feature detects this and automatically re-runs the same task with native Claude (Anthropic API, OAuth), bypassing the proxy entirely.

### Enabling fallback

```json
{
  "fallbackOnRateLimit": true,
  "claudeModel": "sonnet"
}
```

### How it works

1. Night Watch detects a 429 response during a proxy execution.
2. Instead of retrying (which would also fail), it immediately switches to native Claude.
3. A Telegram warning is sent right away — before the fallback execution starts — so you know the proxy quota is exhausted. This uses your configured Telegram webhook credentials.
4. The task runs to completion with native Claude using `--model <claudeModel>`.
5. The final `run_succeeded` / `run_failed` notification reflects the actual outcome.

### Claude model selection

`claudeModel` controls which model is used for native (non-proxy) execution:

| Value                | Model ID            |
| -------------------- | ------------------- |
| `"sonnet"` (default) | `claude-sonnet-4-6` |
| `"opus"`             | `claude-opus-4-6`   |

This applies both when `provider` is `"claude"` with no proxy configured, and when the fallback is triggered.

### Requirements

- `fallbackOnRateLimit` only applies to the `claude` provider.
- A Telegram webhook must be configured to receive the instant warning. The warning is sent via direct `curl` from the bash script — it does not go through the Node.js notification pipeline, so it fires even if the Node.js runner is not available.
- Native Claude must be authenticated (e.g. via `claude auth login`) on the machine running the cron job.

---

## Notifications

Night Watch can send notifications to Slack, Discord, or Telegram when runs complete. Configure webhooks in the `notifications` field:

```json
{
  "notifications": {
    "webhooks": [
      {
        "type": "telegram",
        "botToken": "YOUR_BOT_TOKEN",
        "chatId": "YOUR_CHAT_ID",
        "events": ["run_succeeded", "run_failed", "run_timeout", "review_completed"]
      }
    ]
  }
}
```

### Webhook Types

| Type       | Required Fields                | Description                |
| ---------- | ------------------------------ | -------------------------- |
| `slack`    | `url`, `events`                | Slack incoming webhook URL |
| `discord`  | `url`, `events`                | Discord webhook URL        |
| `telegram` | `botToken`, `chatId`, `events` | Telegram Bot API           |

### Events

| Event                 | Fires When                                                  |
| --------------------- | ----------------------------------------------------------- |
| `run_succeeded`       | PRD execution completed successfully and PR was opened      |
| `run_failed`          | PRD execution failed                                        |
| `run_timeout`         | PRD execution exceeded `maxRuntime`                         |
| `review_completed`    | PR review cycle completed                                   |
| `rate_limit_fallback` | Proxy returned 429 and execution fell back to native Claude |
| `pr_auto_merged`      | PR was automatically merged after passing CI and review     |
| `qa_completed`        | QA process completed (passed or failed)                     |

### Telegram Setup

1. Create a bot via [@BotFather](https://t.me/BotFather) on Telegram
2. Copy the bot token (e.g. `123456:ABC-DEF...`)
3. Get your chat ID by messaging the bot and checking `https://api.telegram.org/bot<TOKEN>/getUpdates`
4. Add the webhook config to `night-watch.config.json`

### Structured Notifications

On successful runs, Telegram notifications include a structured summary with:

- PR title and link
- Summary extracted from the PR body (what was implemented, approach taken)
- File change stats (files changed, additions, deletions)
- Project and provider info

If `gh` CLI is not available or the PR can't be found, notifications gracefully fall back to a basic format.

### Environment Override

Notifications can also be configured via the `NW_NOTIFICATIONS` environment variable (JSON string):

```bash
export NW_NOTIFICATIONS='{"webhooks":[{"type":"telegram","botToken":"...","chatId":"...","events":["run_failed"]}]}'
```

### Validation

Run `night-watch doctor` to validate your webhook configuration. It checks:

- Slack URLs start with `https://hooks.slack.com/`
- Discord URLs start with `https://discord.com/api/webhooks/`
- Telegram webhooks have both `botToken` and `chatId`
- All events are valid event names

---

## QA Process (`qa`)

The QA process runs automated UI tests using Playwright on PRs that match configured branch patterns.

```json
{
  "qa": {
    "enabled": true,
    "schedule": "30 1,7,13,19 * * *",
    "maxRuntime": 3600,
    "branchPatterns": [],
    "artifacts": "both",
    "skipLabel": "skip-qa",
    "autoInstallPlaywright": true
  }
}
```

### QA Fields

| Field                | Type    | Default                   | Description                                               |
| -------------------- | ------- | ------------------------- | --------------------------------------------------------- |
| `enabled`            | boolean | `true`                    | Enable the QA process                                      |
| `schedule`           | string  | `"30 1,7,13,19 * * *"`    | Cron expression for QA execution                           |
| `maxRuntime`         | number  | `3600`                    | Maximum runtime in seconds for QA tasks                    |
| `branchPatterns`     | string[]| `[]`                      | Branch patterns to match (uses top-level `branchPatterns` if empty) |
| `artifacts`          | string  | `"both"`                   | Artifacts to capture: `screenshot`, `video`, or `both`    |
| `skipLabel`          | string  | `"skip-qa"`               | GitHub label to skip QA for specific PRs                   |
| `autoInstallPlaywright` | boolean | `true`                | Auto-install Playwright browsers if missing                |

---

## Code Audit (`audit`)

The audit process runs automated code quality and security audits.

```json
{
  "audit": {
    "enabled": true,
    "schedule": "0 2,8,14,20 * * *",
    "maxRuntime": 1800
  }
}
```

### Audit Fields

| Field       | Type    | Default                | Description                           |
| ----------- | ------- | ---------------------- | ------------------------------------- |
| `enabled`   | boolean | `true`                 | Enable the audit process              |
| `schedule`  | string  | `"0 2,8,14,20 * * *"`  | Cron expression for audit execution   |
| `maxRuntime`| number  | `1800`                 | Maximum runtime in seconds for audit  |

---

## Roadmap Scanner (`roadmapScanner`)

The roadmap scanner automatically scans `ROADMAP.md` and generates PRDs for unchecked items. The Slicer uses AI to generate detailed PRDs from roadmap items.

```json
{
  "roadmapScanner": {
    "enabled": false,
    "roadmapPath": "ROADMAP.md",
    "autoScanInterval": 300,
    "slicerSchedule": "0 2,8,14,20 * * *",
    "slicerMaxRuntime": 600
  }
}
```

### Roadmap Scanner Fields

| Field              | Type    | Default                | Description                                          |
| ------------------ | ------- | ---------------------- | ---------------------------------------------------- |
| `enabled`          | boolean | `false`                | Enable the roadmap scanner                           |
| `roadmapPath`      | string  | `"ROADMAP.md"`         | Path to ROADMAP.md file (relative to project root)   |
| `autoScanInterval` | number  | `300`                  | Interval in seconds between automatic scans (min 30)  |
| `slicerSchedule`   | string  | `"0 2,8,14,20 * * *"`  | Cron schedule for the slicer                         |
| `slicerMaxRuntime` | number  | `600`                  | Maximum runtime in seconds for the slicer            |

---

## Board Provider (`boardProvider`)

Track PRDs and their status using GitHub Projects or local SQLite.

```json
{
  "boardProvider": {
    "enabled": true,
    "provider": "github",
    "projectNumber": 123,
    "repo": "owner/repo"
  }
}
```

### Board Provider Fields

| Field           | Type    | Default      | Description                                      |
| --------------- | ------- | ------------ | ------------------------------------------------ |
| `enabled`       | boolean | `true`       | Enable the board provider                        |
| `provider`      | string  | `"github"`   | Board provider: `github` or `local`              |
| `projectNumber` | number  | (required for GitHub) | GitHub Projects V2 project number           |
| `repo`          | string  | (auto-detected) | `owner/repo` format (auto-detected if empty)  |

---

## Job Providers (`jobProviders`)

Override the AI provider for specific job types.

```json
{
  "jobProviders": {
    "executor": "claude",
    "reviewer": "codex",
    "qa": "claude",
    "audit": "claude",
    "slicer": "claude"
  }
}
```

### Job Provider Fields

| Field     | Type   | Default | Description                                    |
| --------- | ------ | ------- | ---------------------------------------------- |
| `executor`| string | (uses global) | Provider for PRD execution           |
| `reviewer`| string | (uses global) | Provider for PR reviews            |
| `qa`      | string | (uses global) | Provider for QA tasks                 |
| `audit`   | string | (uses global) | Provider for audit tasks              |
| `slicer`  | string | (uses global) | Provider for slicer tasks             |

Set to empty string or omit to use the global `provider` setting.

---

## Auto-Merge

Automatically merge PRs that pass CI and meet the review score threshold.

```json
{
  "autoMerge": true,
  "autoMergeMethod": "squash"
}
```

### Auto-Merge Fields

| Field            | Type    | Default    | Description                                            |
| ---------------- | ------- | ---------- | ------------------------------------------------------ |
| `autoMerge`      | boolean | `false`    | Enable automatic merging of passing PRs                |
| `autoMergeMethod`| string  | `"squash"`  | Git merge method: `squash`, `merge`, or `rebase`        |

---

## PRD Priority (`prdPriority`)

Control which PRDs are executed first when multiple are pending.

```json
{
  "prdPriority": ["feature-x", "bugfix-y"]
}
```

PRDs whose filename (without `.md` extension) matches an entry in the `prdPriority` array are executed before others. This is useful for prioritizing critical features or urgent fixes.
