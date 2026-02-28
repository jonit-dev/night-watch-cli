# Commands Reference

> Related: [CLI Package](cli-package.md) | [Configuration](configuration.md) | [DEV-ONBOARDING](DEV-ONBOARDING.md) | [Local Testing](local-testing.md)

## `night-watch init`

Initialize Night Watch in your project. Creates all necessary directories, configuration files, and provider slash commands.

```bash
night-watch init            # Initialize with defaults
night-watch init --force    # Overwrite existing configuration
night-watch init --prd-dir docs/prds  # Custom PRD directory
night-watch init --provider codex     # Use codex provider
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
- Provider CLI installed (Claude CLI or Codex)

---

## `night-watch run`

Execute the PRD executor. Scans for eligible PRDs and implements them using the configured provider CLI.

```bash
night-watch run                    # Execute PRD executor
night-watch run --dry-run          # Show what would be executed (with diagnostics)
night-watch run --provider codex   # Override provider
night-watch run --timeout 3600     # Override max runtime (1 hour)
```

---

## `night-watch review`

Execute the PR reviewer. Finds open PRs on night-watch/ or feat/ branches, checks CI status and review scores, and fixes issues.

```bash
night-watch review                 # Execute PR reviewer
night-watch review --dry-run       # Show PRs needing work (with diagnostics)
night-watch review --provider codex # Override provider
night-watch review --timeout 1800  # Override max runtime (30 min)
```

---

## `night-watch install`

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

## `night-watch uninstall`

Remove crontab entries for the current project.

```bash
night-watch uninstall
```

---

## `night-watch status`

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

## `night-watch logs`

View log output from executor and reviewer.

```bash
night-watch logs                  # View last 50 lines of all logs
night-watch logs -n 100           # View last 100 lines
night-watch logs --follow         # Follow logs in real-time
night-watch logs --type run       # View executor logs only
night-watch logs --type review    # View reviewer logs only
```

---

## `night-watch state migrate`

Migrate legacy JSON state files to the SQLite backend. Run this once after upgrading to a Night Watch version that uses SQLite for state persistence.

```bash
night-watch state migrate           # Migrate JSON state to SQLite
night-watch state migrate --dry-run # Preview what would be migrated
```

**What it migrates:**

- `~/.night-watch/projects.json` — project registry
- `~/.night-watch/history.json` — PRD execution history
- `~/.night-watch/prd-states.json` — PRD pending-review states
- `.roadmap-state.json` files found in each registered project's PRD directory

**Behavior:**

- Safe to run multiple times — migration is idempotent. If already migrated, exits immediately with a notice.
- Creates a timestamped backup of all legacy JSON files in `~/.night-watch/backups/json-migration-<timestamp>/` before making any changes.
- The legacy JSON files are not deleted; they remain as-is alongside the backup.
