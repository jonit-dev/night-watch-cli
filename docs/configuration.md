# Configuration

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
  "providerEnv": {}
}
```

### Config Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `defaultBranch` | string | `""` (auto-detect) | Default branch name (e.g. `main`) |
| `provider` | string | `"claude"` | AI provider (`claude` or `codex`) |
| `reviewerEnabled` | boolean | `true` | Enable the PR reviewer |
| `prdDir` | string | `"docs/PRDs/night-watch"` | Directory containing PRD files |
| `maxRuntime` | number | `7200` | Max runtime in seconds for PRD execution |
| `reviewerMaxRuntime` | number | `3600` | Max runtime in seconds for PR reviewer |
| `branchPrefix` | string | `"night-watch"` | Prefix for created branches |
| `branchPatterns` | string[] | `["feat/", "night-watch/"]` | Branch patterns for PR reviewer |
| `minReviewScore` | number | `80` | Min review score (out of 100) |
| `maxLogSize` | number | `524288` | Max log file size in bytes (512 KB) |
| `cronSchedule` | string | `"0 0-21 * * *"` | Cron schedule for executor |
| `reviewerSchedule` | string | `"0 0,3,6,9,12,15,18,21 * * *"` | Cron schedule for reviewer |
| `providerEnv` | object | `{}` | Custom env vars passed to the provider CLI |

---

## Environment Variables

All Night Watch env vars are prefixed with `NW_`:

| Variable | Config Key |
|----------|------------|
| `NW_DEFAULT_BRANCH` | `defaultBranch` |
| `NW_PRD_DIR` | `prdDir` |
| `NW_MAX_RUNTIME` | `maxRuntime` |
| `NW_REVIEWER_MAX_RUNTIME` | `reviewerMaxRuntime` |
| `NW_BRANCH_PREFIX` | `branchPrefix` |
| `NW_BRANCH_PATTERNS` | `branchPatterns` (JSON array or comma-separated) |
| `NW_MIN_REVIEW_SCORE` | `minReviewScore` |
| `NW_MAX_LOG_SIZE` | `maxLogSize` |
| `NW_CRON_SCHEDULE` | `cronSchedule` |
| `NW_REVIEWER_SCHEDULE` | `reviewerSchedule` |
| `NW_PROVIDER` | `provider` |
| `NW_REVIEWER_ENABLED` | `reviewerEnabled` |

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

| Type | Required Fields | Description |
|------|----------------|-------------|
| `slack` | `url`, `events` | Slack incoming webhook URL |
| `discord` | `url`, `events` | Discord webhook URL |
| `telegram` | `botToken`, `chatId`, `events` | Telegram Bot API |

### Events

| Event | Fires When |
|-------|-----------|
| `run_succeeded` | PRD execution completed successfully and PR was opened |
| `run_failed` | PRD execution failed |
| `run_timeout` | PRD execution exceeded `maxRuntime` |
| `review_completed` | PR review cycle completed |

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
