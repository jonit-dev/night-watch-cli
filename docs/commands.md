# Commands Reference

> Related: [CLI Package](cli-package.md) | [Configuration](configuration.md) | [DEV-ONBOARDING](DEV-ONBOARDING.md) | [Local Testing](local-testing.md)

## `night-watch init`

Initialize Night Watch in your project. Creates the working directories, instruction files, and config needed for first run.

```bash
night-watch init            # Initialize with defaults
night-watch init --force    # Overwrite existing configuration
night-watch init --prd-dir docs/prds  # Custom PRD directory
night-watch init --provider codex     # Use codex provider
```

**What it creates:**

- PRD directory (configurable via `--prd-dir`) — Directory for PRD files
- `logs/` — Log files directory (added to .gitignore)
- `instructions/executor.md` — Executor instructions
- `instructions/prd-executor.md` — PRD execution instructions
- `instructions/pr-reviewer.md` — PR review instructions
- `instructions/qa.md` — QA instructions
- `instructions/audit.md` — Audit instructions
- `instructions/prd-creator.md` — PRD planner instructions
- `night-watch.config.json` — Configuration file

**Prerequisites:**

- Node.js 22+
- Git repository
- At least one provider CLI installed (`claude` or `codex`)
- GitHub CLI (`gh`) authenticated only if you want `init` to auto-create the GitHub Project board

**Onboarding behavior:**

- Auto-detects installed provider CLIs
- Uses the single detected provider automatically
- Prompts when multiple providers are detected in an interactive shell
- Defaults to `claude` in non-interactive shells when both `claude` and `codex` are installed
- Detects Playwright and offers to install it for QA when running interactively

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

## `night-watch qa`

Execute the QA process for generating PR tests. Scans for open PRs matching configured branch patterns and generates tests using the configured AI provider.

```bash
night-watch qa                    # Run QA process
night-watch qa --dry-run          # Show what would be executed (with diagnostics)
night-watch qa --provider codex   # Override provider
night-watch qa --timeout 3600     # Override max runtime (1 hour)
```

**What it does:**

- Finds open PRs matching configured branch patterns (e.g., `night-watch/*`, `feat/*`)
- Generates tests for PRs that don't have the configured skip label
- Runs tests using Playwright (auto-installs if configured)
- Posts test results as PR comments
- Sends notifications to configured channels

**Behavior:**

- Queues if another job is currently running
- Skips if QA is disabled in config or no PRs need QA
- Sends notifications for actionable QA results only (not skip/no-op outcomes)

---

## `night-watch audit`

Run AI provider code audit. Scans the codebase for code quality issues and generates a report.

```bash
night-watch audit                 # Run code audit
night-watch audit --dry-run       # Show what would be executed (with diagnostics)
night-watch audit --provider codex # Override provider
night-watch audit --timeout 3600  # Override max runtime (1 hour)
```

**What it does:**

- Runs the configured AI provider to scan codebase for quality issues
- Generates a report at `logs/audit-report.md`
- Logs output to `logs/audit.log`

**Behavior:**

- Queues if another job is currently running
- Skips if audit is disabled in config
- Exits successfully with "no actionable issues found" message if code is clean
- On failure, prints last 8 lines of audit log for debugging

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

## `night-watch state`

Manage Night Watch persistent state. Currently supports migration from legacy JSON files to SQLite backend.

```bash
night-watch state migrate           # Migrate JSON state to SQLite
night-watch state migrate --dry-run # Preview what would be migrated
```

### `state migrate`

Migrate legacy JSON state files to the SQLite backend. Run this once after upgrading to a Night Watch version that uses SQLite for state persistence.

**What it migrates:**

- `~/.night-watch/projects.json` — project registry
- `~/.night-watch/history.json` — PRD execution history
- `~/.night-watch/prd-states.json` — PRD pending-review states
- `.roadmap-state.json` files found in each registered project's PRD directory

**Options:**

- `--dry-run` — Show what would be migrated without making changes

**Behavior:**

- Safe to run multiple times — migration is idempotent. If already migrated, exits immediately with a notice.
- Creates a timestamped backup of all legacy JSON files in `~/.night-watch/backups/json-migration-<timestamp>/` before making any changes.
- The legacy JSON files are not deleted; they remain as-is alongside the backup.
- On success, displays summary with counts of migrated records and backup directory location.

---

## `night-watch prd-state`

Manage PRD state entries in `~/.night-watch/prd-states.json`. Used by bash scripts to track pending-review state without moving files.

```bash
night-watch prd-state set <projectDir> <prdName>           # Mark PRD as pending-review
night-watch prd-state set <projectDir> <prdName> --branch feat/my-feature
night-watch prd-state clear <projectDir> <prdName>          # Remove PRD state entry
night-watch prd-state list <projectDir>                     # List pending-review PRDs
night-watch prd-state list <projectDir> --status pending-review
```

**Subcommands:**

- `set` — Set a PRD state to `pending-review` with optional branch name and timestamp
- `clear` — Remove a PRD state entry entirely
- `list` — List PRD names with a given state (default: `pending-review`)

---

## `night-watch retry`

Move a completed PRD from `done/` back to pending for re-execution.

```bash
night-watch retry <prdName>          # Move PRD back to pending
night-watch retry feature-auth.md    # With .md extension (optional)
```

**Behavior:**

- Automatically adds `.md` extension if not provided
- If PRD is already pending, exits with a message (no-op)
- If PRD is in `done/`, moves it back to the PRD directory root
- If PRD is not found, lists available PRDs in `done/` and exits with error
- Uses current working directory as project root

---

## `night-watch cancel`

Gracefully stop running executor or reviewer processes.

```bash
night-watch cancel              # Cancel all processes
night-watch cancel -t run       # Cancel executor only
night-watch cancel -t review    # Cancel reviewer only
night-watch cancel --force      # Skip confirmation prompts
```

**Options:**

- `-t, --type <type>` — Process type to cancel: `run`, `review`, or `all` (default: `all`)
- `-f, --force` — Skip confirmation prompts and auto-confirm termination

**Behavior:**

- Uses lock files to detect running processes
- Stale lock files are automatically cleaned up
- First attempts graceful termination via `SIGTERM` (waits 3 seconds)
- If process still running, prompts for `SIGKILL` (unless `--force`)
- Returns exit code 1 if any cancellation fails
- Uses current working directory as project root

---

## `night-watch history`

Manage PRD execution history ledger. Designed for bash script integration with silent stdout and exit-code signaling.

```bash
night-watch history record <projectDir> <prdFile> <outcome>     # Record execution result
night-watch history record /path/to/project prd.md success       # Example: record success
night-watch history record . prd.md failure --exit-code 1        # Example: record failure
night-watch history record . prd.md success --attempt 2          # Example: record retry attempt

night-watch history check <projectDir> <prdFile>                 # Check if PRD is in cooldown
night-watch history check . prd.md                               # Example: check default cooldown
night-watch history check . prd.md --cooldown 3600               # Example: custom 1-hour cooldown
```

**Subcommands:**

### `history record`

Record a PRD execution result to the history ledger.

**Arguments:**

- `<projectDir>` — Project directory path
- `<prdFile>` — PRD filename
- `<outcome>` — Execution outcome: `success`, `failure`, `timeout`, or `rate_limited`

**Options:**

- `--exit-code <n>` — Process exit code (default: `0`)
- `--attempt <n>` — Attempt number (default: `1`, must be >= 1)

**Exit codes:**

- `0` — Success
- `2` — Invalid outcome, exit code, or attempt value

### `history check`

Check if a PRD is in cooldown period (designed for bash scripting).

**Arguments:**

- `<projectDir>` — Project directory path
- `<prdFile>` — PRD filename

**Options:**

- `--cooldown <seconds>` — Cooldown period in seconds (default: `7200` = 2 hours)

**Exit codes:**

- `0` — PRD is in cooldown (skip execution)
- `1` — PRD is eligible for execution
- `2` — Invalid cooldown period

---

## `night-watch update`

Update global CLI and refresh cron entries for one or more projects.

```bash
night-watch update                                    # Update global CLI and refresh current project
night-watch update --projects /proj1,/proj2          # Update and refresh multiple projects
night-watch update --no-global                        # Skip CLI update, only refresh cron
night-watch update --global-spec @jonit-dev/night-watch-cli@1.2.3  # Install specific version
```

**What it does:**

1. Updates the global CLI via `npm install -g <spec>`
2. For each project directory: runs `uninstall` then `install` to refresh cron entries

**Options:**

- `--projects <dirs>` — Comma-separated project directories (default: current directory)
- `--global-spec <spec>` — npm package spec for global install (default: `@jonit-dev/night-watch-cli@latest`)
- `--no-global` — Skip global npm install, only refresh project cron entries

**Behavior:**

- Invalid project directories are skipped with a warning
- Each project cron is refreshed by uninstalling and reinstalling
- The global CLI binary location is resolved via `which night-watch`

---

## `night-watch prs`

List matching PRs with CI status and review scores. Shows open PRs on branches matching the configured patterns (e.g., `night-watch/`, `feat/`).

```bash
night-watch prs            # List PRs in table format
night-watch prs --json     # Output as JSON
night-watch prs --debug    # Enable debug logging for CI status and review score derivation
```

**What it shows:**

- PR number, title, and branch name
- CI status (pass/fail/pending/unknown) with color coding
- Review score with color coding (green ≥80, yellow ≥60, red <60)
- PR URL

**Behavior:**

- Filters PRs by branch patterns from `night-watch.config.json` (default: `night-watch/*`, `feat/*`)
- If no matching PRs found, displays configured branch patterns
- Requires GitHub CLI (`gh`) to be authenticated

---

## `night-watch prds`

List all PRDs with their status and dependencies. Shows PRD readiness, blocking dependencies, and associated PR branches.

```bash
night-watch prds            # List PRDs in table format
night-watch prds --json     # Output as JSON
```

**What it shows:**

- PRD name and status (ready/blocked/in-progress/pending-review/done)
- Dependencies with color coding (green = met, red = unmet)
- Associated PR branch if a matching open PR exists

**Status determination:**

- `ready` — All dependencies met, ready to execute
- `blocked` — Has unmet dependencies
- `in-progress` — Open PR exists matching the PRD name/pattern
- `pending-review` — PRD executed but awaiting review
- `done` — PRD completed

**Summary counts:**

Displays totals for each status at the bottom of the output.

**Branch matching:**

Finds matching PRs by checking for branches matching:
- `{branchPrefix}{prdName}` (default: `night-watch/01-feature-name`)
- `feat/{prdName}`
- `feature/{prdName}`

---

## `night-watch plan`

Plan a feature by running the prd-creator skill against your codebase. The configured AI provider explores the project, asks clarifying questions if needed, and writes a complete PRD file.

```bash
night-watch plan "Add user authentication with JWT"   # Plan a specific feature
night-watch plan                                      # Launch provider interactively
night-watch plan "Dark mode" --provider claude        # Override provider
night-watch plan "Search" --timeout 3600              # Override max runtime (1 hour)
night-watch plan "Feature" --dry-run                  # Show what would run
```

**What it does:**

- Runs the configured AI provider with the `prd-creator` skill as instructions
- The provider explores the codebase to understand patterns and architecture
- Creates a structured PRD with phases, tests, and acceptance criteria
- Writes the PRD to your configured PRD directory (e.g., `docs/PRDs/`)

**Options:**

- `[task]` — Feature/task description to plan (optional — provider runs interactively if omitted)
- `--dry-run` — Show what would be executed without running
- `--timeout <seconds>` — Override max runtime (default: 1800s / 30 min)
- `--provider <string>` — AI provider to use (claude or codex)

**Logs:**

- Output logged to `logs/plan.log`

---

## `night-watch slice`

Run the Planner (roadmap slicer) to create a PRD from the next pending roadmap item.

```bash
night-watch slice                  # Run planner to create one PRD
night-watch planner                # Alias for slice
night-watch slice --dry-run        # Preview what would be processed
night-watch slice --timeout 3600   # Override max runtime (1 hour)
night-watch slice --provider claude # Override AI provider
```

**What it does:**

- Reads `ROADMAP.md` and finds the next unprocessed item
- Generates a PRD file from that item using the configured AI provider
- Optionally creates a GitHub Project issue (if board provider is enabled)
- Marks the roadmap item as processed

**Prerequisites:**

- `ROADMAP.md` must exist (configured via `roadmapScanner.roadmapPath`)
- Roadmap scanner must be enabled in config
- AI provider CLI (Claude or Codex) must be installed

**Options:**

- `--dry-run` — Show what would be executed without running (shows roadmap status, pending items, and configuration)
- `--timeout <seconds>` — Override max runtime in seconds for slicer
- `--provider <string>` — AI provider to use (claude or codex)

**Behavior:**

- Uses a lock file to prevent concurrent planner runs
- Skips if roadmap scanner is disabled
- If no pending items, exits successfully with "No pending items to process"
- Created issues go to the column specified by `roadmapScanner.issueColumn` (`Ready` or `Draft`)
- Uses current working directory as project root

---

## `night-watch doctor`

Check Night Watch configuration and system health. Validates your environment setup and reports any issues.

```bash
night-watch doctor            # Run health checks
night-watch doctor --fix      # Auto-fix fixable issues
```

**What it checks:**

1. Node.js version (requires 18+)
2. Git repository
3. GitHub CLI (installed and authenticated)
4. Provider CLI (Claude or Codex)
5. Config file (`night-watch.config.json`)
6. PRD directory
7. Logs directory
8. Webhook configuration (optional, validates URLs and events)
9. Crontab access (informational, non-blocking)

**Exit codes:**

- `0` — All checks passed
- `1` — Issues found that must be fixed before running Night Watch

---

## `night-watch serve`

Start the Night Watch web UI server for managing projects via a browser interface.

```bash
night-watch serve              # Start server for current project (port 7575)
night-watch serve -p 3000      # Use custom port
night-watch serve --global     # Start in global mode (manage all registered projects)
```

**Modes:**

- **Local mode** (default): Serves only the current project. Requires running from an initialized project directory.
- **Global mode** (`--global`): Manages all registered Night Watch projects from a single interface.

**Default port:** `7575`

**Behavior:**

- Creates a lock file to prevent multiple servers from running on the same port/mode
- Automatically cleans up stale locks from terminated processes
- Shows server PID and startup information in global mode
- Lock files are stored at `/tmp/night-watch-serve-{mode}-{port}.lock`

---

## `night-watch prd`

Manage PRD files in your project.

```bash
night-watch prd create "Add user authentication"          # Generate PRD with Claude Opus (default)
night-watch prd create "Add user authentication" --number # Add auto-numbering prefix (01-...)
night-watch prd create "Add user authentication" --model sonnet  # Use a faster/cheaper model
night-watch prd create "Add user authentication" --model claude-sonnet-4-6  # Full model ID
night-watch prd list                                       # List all PRDs with status
night-watch prd list --json                                # Output as JSON
```

**Subcommands:**

- `create` — Generate a new PRD markdown file using Claude
- `list` — List all PRDs with their status (pending, claimed, done) and dependencies

**`create` options:**

| Flag | Description |
| --- | --- |
| `--number` | Add an auto-incrementing numeric prefix to the filename (e.g. `01-feature.md`) |
| `--model <model>` | Claude model to use. Accepts a short alias (`sonnet`, `opus`) or a full model ID. Defaults to `claude-opus-4-6`. |

**What `create` does:**

- Calls Claude (Opus by default) with the bundled `prd-creator.md` planning guide as context
- Streams the PRD to the terminal as it is generated
- Writes the finished PRD to `docs/PRDs/<slug>.md` (relative to `process.cwd()`)
- Slugifies the title extracted from the generated markdown for the filename
- Refuses to overwrite an existing file
- Opens a GitHub issue with the PRD content if `gh` is authenticated and a remote is configured

**Model selection:**

| Value | Model used |
| --- | --- |
| _(default)_ | `claude-opus-4-6` |
| `sonnet` | `claude-sonnet-4-6` |
| `opus` | `claude-opus-4-6` |
| any full ID | used verbatim (e.g. `claude-sonnet-4-6`) |

**Custom planning guide:**

If `instructions/prd-creator.md` exists in the project root, it is used instead of the bundled guide. Run `night-watch init` to scaffold a customizable copy.

**What `list` shows:**

- Pending PRDs (not yet executed)
- Claimed PRDs (currently being executed, with hostname and PID)
- Completed PRDs (moved to `done/` subdirectory)
- Dependencies for each PRD

---

## `night-watch dashboard`

Live terminal dashboard with tabs for Status, Config, Schedules, Actions, and Logs [experimental].

```bash
night-watch dashboard               # Launch dashboard with 10s refresh interval
night-watch dashboard --interval 5  # Set refresh interval to 5 seconds
```

**Options:**

- `--interval <seconds>` — Refresh interval in seconds (default: 10)

**Tabs:**

1. **Status** — PRD status, process status, PR status
2. **Config** — View and edit configuration
3. **Schedules** — View crontab schedules
4. **Actions** — Quick actions (run, review, cancel, etc.)
5. **Logs** — View executor and reviewer logs

**Keyboard shortcuts:**

- `1-5` — Switch to specific tab
- `Shift+Tab` — Cycle to previous tab
- `r` — Manual refresh
- `q` or `Escape` — Quit dashboard

**Behavior:**

- Auto-refreshes at the configured interval (countdown shown in header)
- Displays project name, provider, and last refresh time in header
- Tab content is preserved when switching
- Editing mode prevents tab switching (exit edit mode first)

---

## `night-watch queue`

Manage the global job queue. Provides subcommands for viewing, dispatching, and managing queued jobs.

```bash
night-watch queue status                   # Show current queue status
night-watch queue status --json            # Output as JSON
night-watch queue list                     # List all queue entries
night-watch queue list --status pending    # Filter by status
night-watch queue clear                    # Clear all pending jobs
night-watch queue clear --type qa          # Clear only QA jobs
night-watch queue enqueue executor /path/to/project  # Manually enqueue a job
night-watch queue dispatch                 # Dispatch next pending job (used by cron)
night-watch queue complete <id>            # Remove completed queue entry
night-watch queue can-start                # Check if queue has available slot
night-watch queue expire                   # Expire stale jobs
```

**Subcommands:**

### `queue status`

Show current queue status including running job and pending jobs.

**Options:**

- `--json` — Output as JSON

**Shows:**

- Currently running job (if any)
- Pending job count by type (executor, reviewer, qa, audit, slicer)
- Next job to be dispatched

### `queue list`

List all queue entries with optional filtering.

**Options:**

- `--status <status>` — Filter by status: `pending`, `running`, `dispatched`, or `expired`
- `--json` — Output as JSON

### `queue clear`

Clear pending jobs from the queue.

**Options:**

- `--type <type>` — Only clear jobs of this type (`executor`, `reviewer`, `qa`, `audit`, `slicer`)
- `--all` — Clear all entries including running (dangerous)

### `queue enqueue`

Manually enqueue a job for execution.

**Arguments:**

- `<job-type>` — Job type: `executor`, `reviewer`, `qa`, `audit`, or `slicer`
- `<project-dir>` — Path to the project directory

**Options:**

- `--env <json>` — JSON object of environment variables to store (default: `{}`)

### `queue dispatch`

Dispatch the next pending job and spawn its execution process. Used by cron scripts.

**Options:**

- `--log <file>` — Log file to write dispatch output

**Behavior:**

- Spawns the job script as a detached process
- Marks the job as running in the queue
- Uses the queued project's config for environment variables

### `queue complete`

Remove a completed queue entry. Used by cron scripts after job completion.

**Arguments:**

- `<id>` — Queue entry ID (positive integer)

### `queue can-start`

Check if the global queue has an available slot for a new job.

**Exit codes:**

- `0` — Queue has available slot
- `1` — Queue is full

### `queue expire`

Expire stale jobs that have been waiting too long.

**Options:**

- `--max-wait <seconds>` — Maximum wait time before expiration (minimum: 60, default: varies by config)

---

## `night-watch notify`

Send a notification event via configured webhooks. Designed for bash script integration.

```bash
night-watch notify run_succeeded /path/to/project           # Basic notification
night-watch notify run_failed . --prd feature-auth          # With PRD context
night-watch notify pr_auto_merged . --pr-number 123         # With PR number
night-watch notify run_timeout . --provider codex --exit-code 124  # Full context
```

**Arguments:**

- `<event>` — Notification event type (required)
- `<projectDir>` — Project directory path (required)

**Valid events:**

- `run_started` — PRD executor started
- `run_succeeded` — PRD executor completed successfully
- `run_failed` — PRD executor failed
- `run_timeout` — PRD executor timed out
- `review_completed` — PR reviewer completed
- `rate_limit_fallback` — Rate limit fallback triggered
- `pr_auto_merged` — PR was auto-merged
- `qa_completed` — QA process completed

**Options:**

- `--prd <name>` — PRD name
- `--branch <name>` — Branch name
- `--provider <name>` — Provider name (default: from config)
- `--exit-code <n>` — Exit code (default: `0`)
- `--pr-number <n>` — PR number

**Exit codes:**

- `0` — Notification sent successfully
- `2` — Invalid event type

**Behavior:**

- Sends notifications to all configured webhooks (Slack, Discord, Telegram)
- Project name is derived from the project directory basename
- Designed for integration with bash scripts and CI/CD workflows

---

## `night-watch board`

Manage the PRD tracking board (GitHub Projects). Provides subcommands for creating board issues, viewing status, and syncing with ROADMAP.md.

```bash
night-watch board setup                         # Create the project board
night-watch board setup --title "My Board"      # Custom board title
night-watch board setup-labels                  # Create Night Watch labels in repo
night-watch board setup-labels --dry-run        # Preview labels to create
night-watch board status                        # Show board status grouped by column
night-watch board status --group-by priority     # Group by priority instead
night-watch board status --json                 # Output raw JSON
night-watch board next-issue                    # Get next issue from Ready column
night-watch board next-issue --column Draft     # Fetch from different column
night-watch board next-issue --json             # Output full issue JSON
night-watch board next-issue --all              # Return all issues
night-watch board create-prd "Fix auth bug"      # Create new issue in Draft
night-watch board create-prd "Feature" --body-file prd.md --priority P1 --category product
night-watch board move-issue 123 --column Done   # Move issue to different column
night-watch board comment 123 --body "Updated"   # Add comment to issue
night-watch board close-issue 123                # Close issue and move to Done
night-watch board sync-roadmap                   # Sync ROADMAP.md items to board
night-watch board sync-roadmap --dry-run         # Preview what would be created
night-watch board sync-roadmap --update-labels   # Update labels on existing issues
```

**Subcommands:**

### `board setup`

Create the Night Watch project board and persist its number to config.

**Options:**

- `--title <title>` — Board title (default: `<repo-folder> Night Watch`)

**Behavior:**

- Warns and prompts for confirmation if board already configured
- Auto-creates board if not configured
- Persists project number to `night-watch.config.json`

### `board setup-labels`

Create Night Watch priority, category, and horizon labels in the GitHub repo.

**Options:**

- `--dry-run` — Show what labels would be created without creating them

**Labels created:**

- Priority: `P0`, `P1`, `P2`
- Category: `product`, `quality`, `reliability`, `tech-debt`, `documentation`
- Horizon: `short-term`, `medium-term`, `long-term`

### `board status`

Show the current state of all issues grouped by column (or priority/category).

**Options:**

- `--json` — Output raw JSON
- `--group-by <field>` — Group by: `priority`, `category`, or `column` (default)

**Displays:**

- Issue number, title, priority, category, and column
- Summary counts per grouping
- Total issue count

### `board next-issue`

Return the next issue from a column, sorted by priority (default: Ready column).

**Options:**

- `--column <name>` — Column to fetch from (default: `Ready`)
- `--json` — Output full issue JSON (for agent consumption)
- `--all` — Return all issues (as JSON array when combined with `--json`)

**Sorting:**

- P0 > P1 > P2 > unlabeled
- Tie-breaker: issue number ascending

### `board create-prd`

Create a new issue on the board and add it to a column.

**Arguments:**

- `<title>` — Issue title

**Options:**

- `--body <text>` — Issue body text
- `--body-file <path>` — Read issue body from a file
- `--column <name>` — Target column (default: `Draft`)
- `--label <name>` — Label to apply to the issue
- `--priority <value>` — Priority label (`P0`, `P1`, `P2`)
- `--category <value>` — Category label (`product`, `quality`, `reliability`, etc.)
- `--horizon <value>` — Horizon label (`short-term`, `medium-term`, `long-term`)

### `board move-issue`

Move an issue to a different column.

**Arguments:**

- `<number>` — Issue number

**Options:**

- `--column <name>` — Target column name (required)

### `board comment`

Add a comment to an issue.

**Arguments:**

- `<number>` — Issue number

**Options:**

- `--body <text>` — Comment body text (required)

### `board close-issue`

Close an issue and move it to Done.

**Arguments:**

- `<number>` — Issue number

### `board sync-roadmap`

Sync unchecked items from ROADMAP.md to the board as Draft issues.

**Options:**

- `--dry-run` — Show what would be created without making API calls
- `--update-labels` — Update labels on existing matching issues
- `--roadmap <path>` — Path to ROADMAP.md file (default: `ROADMAP.md`)

**Behavior:**

- Creates issues for unchecked roadmap items
- Auto-assigns category and horizon labels based on section
- Skips items that already have matching issues (unless `--update-labels`)
- Section-to-label mapping is automatic based on roadmap structure
