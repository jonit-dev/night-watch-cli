# Night Watch CLI

[![npm version](https://img.shields.io/npm/v/night-watch-cli.svg)](https://www.npmjs.com/package/night-watch-cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)

**Autonomous PRD execution using Claude CLI + cron**

Night Watch is a battle-tested autonomous PRD executor that uses Claude CLI + cron to implement PRD tickets, open PRs, and fix CI failures — all while you sleep.

---

## Quick Start

```bash
# 1. Install globally
npm install -g night-watch-cli

# 2. Initialize in your project
cd your-project
night-watch init

# 3. Add your PRD files
echo "# My First PRD\n\nImplement feature X..." > docs/PRDs/night-watch/my-feature.md

# 4. Run or install cron
night-watch run           # Run once
night-watch install       # Setup automated cron
```

---

## Installation

### npm (Recommended)

```bash
npm install -g night-watch-cli
```

### npx (No install)

```bash
npx night-watch-cli init
```

### From Source

```bash
git clone https://github.com/joaopio/night-watch-cli.git
cd night-watch-cli
npm install
npm run build
npm link
```

---

## Commands Reference

### `night-watch init`

Initialize Night Watch in your project. Creates all necessary directories, configuration files, and Claude slash commands.

```bash
night-watch init            # Initialize with defaults
night-watch init --force    # Overwrite existing configuration
night-watch init --prd-dir docs/prds  # Custom PRD directory
```

**What it creates:**
- `docs/PRDs/night-watch/done/` — Directory for completed PRDs
- `docs/PRDs/night-watch/NIGHT-WATCH-SUMMARY.md` — Progress tracking file
- `logs/` — Log files directory (added to .gitignore)
- `.claude/commands/night-watch.md` — Claude slash command for PRD execution
- `.claude/commands/night-watch-pr-reviewer.md` — Claude slash command for PR review
- `night-watch.config.json` — Configuration file

**Prerequisites:**
- Git repository
- GitHub CLI (`gh`) authenticated
- Claude CLI installed

---

### `night-watch run`

Execute the PRD executor. Scans for eligible PRDs and implements them using Claude CLI.

```bash
night-watch run                    # Execute PRD executor
night-watch run --dry-run          # Show what would be executed
night-watch run --budget 3.00      # Override max budget ($3)
night-watch run --timeout 3600     # Override max runtime (1 hour)
```

**Claude Provider Options:**

```bash
night-watch run --api-key "key"           # Custom API key
night-watch run --api-url "https://..."   # Custom API endpoint
night-watch run --model "glm-5"           # Custom model name
```

---

### `night-watch review`

Execute the PR reviewer. Finds open PRs on night-watch/ or feat/ branches, checks CI status and review scores, and fixes issues.

```bash
night-watch review                 # Execute PR reviewer
night-watch review --dry-run       # Show PRs needing work
night-watch review --budget 2.00   # Override max budget ($2)
night-watch review --timeout 1800  # Override max runtime (30 min)
```

Supports the same Claude provider options as `run`.

---

### `night-watch install`

Install crontab entries for automated execution.

```bash
night-watch install                        # Install with default schedules
night-watch install --schedule "0 * * * *" # Custom executor schedule
night-watch install --reviewer-schedule "0 */2 * * *" # Custom reviewer schedule
night-watch install --no-reviewer          # Skip reviewer cron
```

**Default Schedules:**
- Executor: `0 0-15 * * *` (hourly from midnight to 3pm UTC)
- Reviewer: `0 0,3,6,9,12,15 * * *` (every 3 hours)

---

### `night-watch uninstall`

Remove crontab entries for the current project.

```bash
night-watch uninstall
```

---

### `night-watch status`

Show current Night Watch status including lock files, PRD counts, open PRs, and log file info.

```bash
night-watch status          # Basic status
night-watch status --verbose # Detailed status with log snippets
night-watch status --json    # Output as JSON
```

**Status shows:**
- Process status (executor/reviewer running or not)
- PRD status (pending vs completed)
- PR status (open PRs on night-watch/feat branches)
- Crontab status (installed or not)
- Log file status (size, last lines)

---

### `night-watch logs`

View log output from executor and reviewer.

```bash
night-watch logs                  # View last 50 lines of all logs
night-watch logs -n 100           # View last 100 lines
night-watch logs --follow         # Follow logs in real-time
night-watch logs --type run       # View executor logs only
night-watch logs --type review    # View reviewer logs only
```

---

## Configuration

Configuration is loaded in this order (later overrides earlier):
1. Default values
2. Config file (`night-watch.config.json`)
3. Environment variables
4. CLI flags

### Config File

Create `night-watch.config.json` in your project root:

```json
{
  "prdDir": "docs/PRDs/night-watch",
  "maxBudget": 5.00,
  "reviewerMaxBudget": 3.00,
  "maxRuntime": 7200,
  "reviewerMaxRuntime": 3600,
  "branchPrefix": "night-watch",
  "branchPatterns": ["feat/", "night-watch/"],
  "minReviewScore": 80,
  "maxLogSize": 524288,
  "cronSchedule": "0 0-15 * * *",
  "reviewerSchedule": "0 0,3,6,9,12,15 * * *",
  "claude": {
    "apiKey": "your-api-key-here",
    "baseUrl": "https://api.anthropic.com",
    "timeout": 3000000,
    "opusModel": "claude-opus-4-5-20250219",
    "sonnetModel": "claude-sonnet-4-20250514"
  }
}
```

### Environment Variables

**Night Watch Config (prefixed with `NW_`):**

| Variable | Config Key |
|----------|------------|
| `NW_PRD_DIR` | `prdDir` |
| `NW_MAX_BUDGET` | `maxBudget` |
| `NW_REVIEWER_MAX_BUDGET` | `reviewerMaxBudget` |
| `NW_MAX_RUNTIME` | `maxRuntime` |
| `NW_REVIEWER_MAX_RUNTIME` | `reviewerMaxRuntime` |
| `NW_BRANCH_PREFIX` | `branchPrefix` |
| `NW_BRANCH_PATTERNS` | `branchPatterns` (JSON array or comma-separated) |
| `NW_MIN_REVIEW_SCORE` | `minReviewScore` |
| `NW_MAX_LOG_SIZE` | `maxLogSize` |
| `NW_CRON_SCHEDULE` | `cronSchedule` |
| `NW_REVIEWER_SCHEDULE` | `reviewerSchedule` |

**Claude Provider Config (direct env vars):**

| Variable | Config Key |
|----------|------------|
| `ANTHROPIC_AUTH_TOKEN` | `claude.apiKey` |
| `ANTHROPIC_BASE_URL` | `claude.baseUrl` |
| `API_TIMEOUT_MS` | `claude.timeout` |
| `ANTHROPIC_DEFAULT_OPUS_MODEL` | `claude.opusModel` |
| `ANTHROPIC_DEFAULT_SONNET_MODEL` | `claude.sonnetModel` |

### CLI Flags

Flags override all other configuration:

```bash
night-watch run --budget 3.00 --timeout 3600 --api-key "key" --api-url "url" --model "model-name"
```

---

## PRD Format

Night Watch looks for PRD files in `docs/PRDs/night-watch/` (configurable). PRDs are markdown files with optional dependency declarations.

### Basic PRD

```markdown
# Feature: User Authentication

## Overview
Implement user authentication using JWT tokens.

## Requirements
- [ ] Login endpoint
- [ ] Logout endpoint
- [ ] Token refresh
- [ ] Password hashing

## Acceptance Criteria
- Users can log in with email/password
- Tokens expire after 24 hours
- All endpoints have proper error handling
```

### PRD with Dependencies

```markdown
# Feature: User Profile

Depends on: Feature: User Authentication

## Overview
Add user profile management.

## Requirements
- [ ] Profile page
- [ ] Edit profile
- [ ] Avatar upload
```

When a PRD specifies `Depends on:`, Night Wait will only process it after the dependency's PRD file is moved to `done/`.

---

## How It Works

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     Night Watch CLI                          │
│  (Node.js wrapper for discoverability, config, distribution) │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                     Bash Scripts                             │
│  (Battle-tested core logic for PRD execution and review)     │
│                                                              │
│  ┌─────────────────────┐  ┌────────────────────────────────┐ │
│  │ night-watch-cron.sh │  │ night-watch-pr-reviewer-cron.sh │ │
│  │   (PRD Executor)    │  │        (PR Reviewer)            │ │
│  └─────────────────────┘  └────────────────────────────────┘ │
│              │                          │                     │
│              └──────────┬───────────────┘                     │
│                         ▼                                    │
│            ┌────────────────────────┐                        │
│            │ night-watch-helpers.sh │                        │
│            │   (Shared utilities)   │                        │
│            └────────────────────────┘                        │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    External Tools                            │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────┐  │
│  │  Claude CLI  │  │   GitHub CLI │  │  Git Worktrees     │  │
│  │ (AI Agent)   │  │  (PR mgmt)   │  │  (Isolation)       │  │
│  └──────────────┘  └──────────────┘  └────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### PRD Execution Flow

1. **Scan for PRDs** — Find markdown files in `docs/PRDs/night-watch/`
2. **Check dependencies** — Skip PRDs with unmet dependencies
3. **Check for open PRs** — Skip PRDs that already have an open PR
4. **Acquire lock** — Prevent concurrent executions
5. **Create worktree** — Isolate changes in a git worktree
6. **Launch Claude** — Execute PRD using Claude CLI with slash command
7. **Verify PR created** — Check that a PR was opened
8. **Mark done** — Move PRD to `done/` directory
9. **Cleanup** — Remove lock files and worktrees

### PR Review Flow

1. **Find open PRs** — Search for PRs on `night-watch/` or `feat/` branches
2. **Check CI status** — Identify failed checks
3. **Check review scores** — Find PRs with score < 80/100
4. **Acquire lock** — Prevent concurrent executions
5. **Launch Claude** — Execute PR fix using Claude CLI with slash command
6. **Cleanup** — Remove lock files

---

## Troubleshooting

### "Current directory is not a git repository"

Run `night-watch init` from the root of a git repository:

```bash
cd your-project
git init  # if not already a git repo
night-watch init
```

### "GitHub CLI (gh) is not authenticated"

Authenticate with GitHub:

```bash
gh auth login
```

### "Claude CLI is not available"

Install Claude CLI:

```bash
# Follow instructions at https://docs.anthropic.com/en/docs/claude-cli
```

### "Night Watch is already installed"

Uninstall first, then reinstall:

```bash
night-watch uninstall
night-watch install
```

### "Lock file exists but process not running"

Remove stale lock files:

```bash
rm /tmp/night-watch-*.lock
```

Or use `night-watch status --verbose` to check which lock files are stale.

### Logs not being created

Ensure the logs directory exists and is writable:

```bash
mkdir -p logs
chmod 755 logs
```

### PRD not being processed

Check:
1. PRD is in the correct directory (`docs/PRDs/night-watch/`)
2. Dependencies are satisfied (check `done/` directory)
3. No open PR exists for this PRD
4. Run `night-watch run --dry-run` to see what would be processed

---

## Contributing

### Development Setup

```bash
git clone https://github.com/joaopio/night-watch-cli.git
cd night-watch-cli
npm install
```

### Build

```bash
npm run build
```

### Test

```bash
npm test
```

### Run in Development

```bash
npm run dev -- init
```

### Project Structure

```
night-watch-cli/
├── bin/
│   └── night-watch.mjs      # ESM entry point
├── src/
│   ├── cli.ts               # CLI entry
│   ├── config.ts            # Config loader
│   ├── types.ts             # TypeScript types
│   ├── constants.ts         # Default values
│   ├── commands/            # Command implementations
│   │   ├── init.ts
│   │   ├── run.ts
│   │   ├── review.ts
│   │   ├── install.ts
│   │   ├── uninstall.ts
│   │   ├── status.ts
│   │   └── logs.ts
│   └── utils/
│       ├── shell.ts         # Shell execution
│       └── crontab.ts       # Crontab management
├── scripts/                 # Bundled bash scripts
│   ├── night-watch-cron.sh
│   ├── night-watch-pr-reviewer-cron.sh
│   └── night-watch-helpers.sh
├── templates/               # Template files
│   ├── night-watch.md
│   ├── night-watch-pr-reviewer.md
│   └── night-watch.config.json
└── dist/                    # Compiled output
```

---

## License

MIT License - see [LICENSE](LICENSE) for details.
