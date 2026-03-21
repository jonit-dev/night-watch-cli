# Integrations

> Related: [Features](../reference/features.md) | [Configuration](../reference/configuration.md) | [Agent Personas](../agents/agent-personas.md)

Night Watch CLI integrates with several third-party services to enable notifications, avatar generation, analytics, and project management.

## Notification Integrations

### Slack

Send notifications to Slack channels via incoming webhooks.

**Setup:**

1. Create an Incoming Webhook in your Slack workspace:
   - Go to https://api.slack.com/apps
   - Create a new app or use existing
   - Enable "Incoming Webhooks"
   - Click "Add New Webhook to Workspace"
   - Select a channel and copy the webhook URL

2. Add to `night-watch.config.json`:

```json
{
  "notifications": {
    "webhooks": [
      {
        "type": "slack",
        "url": "https://hooks.slack.com/services/YOUR/WEBHOOK/URL",
        "events": ["run_succeeded", "run_failed", "review_completed", "qa_completed"]
      }
    ]
  }
}
```

**Notification Format:**

Slack notifications include:

- Event title and emoji
- Project name and provider
- PRD name, branch name, PR number
- Exit code and duration
- PR details (title, URL, summary, file stats) when available
- QA screenshot URLs

**Events:**
| Event | Description |
|-------|-------------|
| `run_started` | PRD executor started |
| `run_succeeded` | PRD execution completed successfully |
| `run_failed` | PRD execution failed |
| `run_timeout` | PRD execution exceeded max runtime |
| `run_no_work` | No eligible PRDs to execute |
| `review_completed` | PR review cycle completed |
| `review_ready_for_human` | PR ready for human review |
| `rate_limit_fallback` | Rate limit fallback triggered |
| `pr_auto_merged` | PR was automatically merged |
| `qa_completed` | QA process completed |

### Discord

Send notifications to Discord channels via webhooks.

**Setup:**

1. Create a webhook in your Discord server:
   - Server Settings → Integrations → Webhooks
   - Click "New Webhook"
   - Copy the webhook URL

2. Add to `night-watch.config.json`:

```json
{
  "notifications": {
    "webhooks": [
      {
        "type": "discord",
        "url": "https://discord.com/api/webhooks/YOUR/WEBHOOK/URL",
        "events": ["run_succeeded", "run_failed", "qa_completed"]
      }
    ]
  }
}
```

**Notification Format:**

Discord notifications use embeds with:

- Color-coded by event type
- Event title and emoji
- Description with all context
- Timestamp

### Telegram

Send notifications via Telegram Bot API with rich structured formatting.

**Setup:**

1. Create a bot via [@BotFather](https://t.me/BotFather):
   - Send `/newbot`
   - Follow prompts to name your bot
   - Copy the bot token (e.g., `123456:ABC-DEF1234...`)

2. Get your chat ID:
   - Message your bot
   - Visit `https://api.telegram.org/bot<TOKEN>/getUpdates`
   - Find your `chat_id` in the response

3. Add to `night-watch.config.json`:

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

**Structured Telegram Notifications:**

On successful runs, Telegram notifications include enhanced formatting:

```
🔁 PR Opened

📋 PR #123: Add user authentication
🔗 https://github.com/owner/repo/pull/123

📝 Summary
Implemented JWT-based authentication with refresh tokens. Added login/logout
endpoints, password hashing with bcrypt, and session management.

📊 Stats
Files changed: 12 | +245 / -38

⚙️ Project: my-project | Provider: claude
```

**Review notifications show:**

- Attempt count for retry scenarios
- Final review score
- Whether human review is needed

**QA notifications show:**

- Up to 3 screenshot URLs
- Count of additional screenshots

**Global Notifications:**

Configure a global webhook that applies to all projects:

```bash
# Create global notifications config
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

Global and project-specific webhooks are merged (duplicates removed).

### Environment Override

Configure notifications via environment variable:

```bash
export NW_NOTIFICATIONS='{"webhooks":[{"type":"telegram","botToken":"...","chatId":"...","events":["run_failed"]}]}'
```

## Avatar Generation

### Replicate Integration

Generate custom persona avatars using Replicate's Flux 1.1 Pro model.

**API Token Location:**

The Replicate API token is read from:

```
../myimageupscaler.com/.env.api
```

File should contain:

```
REPLICATE_API_TOKEN=your_replicate_api_token_here
```

**Avatar Generation Process:**

1. Night Watch calls `generatePersonaAvatar(personaName, personaRole, apiToken)`
2. Builds a persona-specific prompt with detailed appearance description
3. Submits to Replicate API (`black-forest-labs/flux-1.1-pro`)
4. Polls for completion (3s intervals, max 3 minutes)
5. Returns image URL (valid for ~1 hour)
6. Slack caches avatar on first display

**Built-in Persona Portraits:**

Each persona has a unique, memorable appearance:

| Persona    | Portrait Description                                                                                           |
| ---------- | -------------------------------------------------------------------------------------------------------------- |
| **Maya**   | South Asian woman, late 20s, sharp dark eyes, charcoal blazer, black turtleneck, focused expression            |
| **Carlos** | Hispanic man, mid-30s, short dark wavy hair, navy henley, calm confident expression                            |
| **Priya**  | Indian woman, early 30s, shoulder-length brown hair, olive cardigan, tortoiseshell glasses, curious expression |
| **Dev**    | East Asian man, late 20s, short textured black hair, gray crewneck, friendly approachable expression           |

**Hosting:**

Generated avatars are hosted on GitHub's CDN:

```
https://raw.githubusercontent.com/jonit-dev/night-watch-cli/main/web/public/avatars/{name}.webp
```

**Custom Persona Avatars:**

For custom personas, avatar generation uses role-based heuristics:

| Role Pattern              | Avatar Descriptor                                    |
| ------------------------- | ---------------------------------------------------- |
| `security`                | Sharp-eyed cybersecurity professional, dark blazer   |
| `architect` / `tech lead` | Confident senior software architect, business casual |
| `qa` / `quality`          | Meticulous quality engineer, smart casual            |
| `implement` / `developer` | Software developer, casual tech attire               |
| `product` / `manager`     | Product manager, business professional               |
| `design`                  | UX/UI designer, creative, modern stylish             |
| (default)                 | Professional software team member, smart casual      |

All avatars use consistent prompt format:

- Professional headshot portrait photo
- Photorealistic, clean soft neutral background
- Natural diffused window lighting
- Shot at f/2.8, shallow depth of field
- Looking directly at camera
- Candid professional headshot style
- No retouching artifacts, natural skin texture

## Analytics Integration

### Amplitude

Process product analytics data to identify actionable insights.

**Configuration:**

```json
{
  "analytics": {
    "enabled": true,
    "schedule": "0 6 * * 1",
    "maxRuntime": 900,
    "lookbackDays": 7,
    "targetColumn": "Draft",
    "analysisPrompt": "Analyze Amplitude data for actionable findings..."
  }
}
```

**Environment Variables Required:**

```bash
export AMPLITUDE_API_KEY=your_amplitude_api_key
export AMPLITUDE_SECRET_KEY=your_amplitude_secret_key
```

**What It Does:**

1. Fetches analytics data for configured `lookbackDays`
2. Applies AI analysis via `analysisPrompt`
3. Identifies trends, anomalies, or drops
4. Creates board issues in `targetColumn` for findings
5. Runs on schedule (default: weekly Monday 06:00)

**Custom Analysis Prompt:**

```json
{
  "analytics": {
    "analysisPrompt": "You are an analytics reviewer. Analyze the following Amplitude product analytics data. Identify significant trends, anomalies, or drops that warrant engineering attention. For each actionable finding, output a JSON array of issues: [{ \"title\": \"...\", \"body\": \"...\", \"labels\": [\"analytics\"] }]. If no issues are warranted, output an empty array: []"
  }
}
```

## Project Management Integrations

### GitHub Projects

Track PRDs and implementation status via GitHub Projects V2.

**Setup:**

1. Auto-create board during `night-watch init` (if `gh` is authenticated)
2. Or manually create board:

```bash
night-watch board setup --title "My Project Board"
```

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

**Features:**

- **Issue Creation:** Auto-create issues from PRDs
- **Status Tracking:** Track PRD status across columns
- **Labels:** Support for priority (P0, P1, P2) and category labels
- **Roadmap Sync:** Sync ROADMAP.md items to board issues

**Board Commands:**

| Command              | Purpose                             |
| -------------------- | ----------------------------------- |
| `board setup`        | Create the project board            |
| `board setup-labels` | Create Night Watch labels in repo   |
| `board status`       | Show board status grouped by column |
| `board next-issue`   | Get next issue from Ready column    |
| `board create-prd`   | Create new issue                    |
| `board move-issue`   | Move issue to different column      |
| `board comment`      | Add comment to issue                |
| `board close-issue`  | Close issue and move to Done        |
| `board sync-roadmap` | Sync ROADMAP.md items to board      |

**Related:** [Commands Reference: Board Commands](../reference/commands.md#night-watch-board)

### GitHub CLI

Night Watch uses GitHub CLI (`gh`) for:

- Creating and managing pull requests
- Checking CI status
- Fetching PR details for notifications
- Creating and managing project issues
- Authentication detection

**Setup:**

```bash
# Install gh
brew install gh  # macOS
# or visit https://github.com/cli/cli

# Authenticate
gh auth login
```

**Features Enabled by `gh`:**

- PR creation with detailed descriptions
- CI status checks in reviewer
- PR details in notifications (title, body, file stats)
- Automatic repo detection for board provider

## Local Storage (SQLite)

Night Watch uses SQLite for persistent state when GitHub integration is not configured or for local-only workflows.

**Database Location:**

```
.night-watch/state.db
```

**Tables:**

| Table               | Purpose                   |
| ------------------- | ------------------------- |
| `projects`          | Registered projects       |
| `execution_history` | PRD execution history     |
| `prd_states`        | PRD pending-review states |
| `roadmap_states`    | Roadmap scan state        |
| `kanban_issues`     | Local board issues        |
| `kanban_comments`   | Issue comments            |
| `job_queue`         | Global job queue          |
| `job_runs`          | Job execution records     |
| `agent_personas`    | Persona definitions       |

**Migration:**

Migrate from legacy JSON state to SQLite:

```bash
night-watch state migrate           # Migrate
night-watch state migrate --dry-run # Preview
```

**Related:** [Commands Reference: State Management](../reference/commands.md#night-watch-state)

## Future Integrations

Potential integrations being considered:

### Jira

Track PRDs and implementation status in Jira projects.

### Linear

Issue tracking integration for Linear users.

### GitHub Actions

Trigger Night Watch jobs from GitHub Actions workflows.

### Custom Webhooks

Generic webhook support for custom integrations.

---

**Related Documentation:**

- [Features](../reference/features.md) — Feature overview
- [Configuration](../reference/configuration.md) — Configuration options
- [Agent Personas](../agents/agent-personas.md) — Avatar generation details
