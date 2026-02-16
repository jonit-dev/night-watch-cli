# Architecture

## Overview

```
+-------------------------------------------------------------+
|                     Night Watch CLI                          |
|  (Node.js wrapper for discoverability, config, distribution) |
+-------------------------------------------------------------+
                              |
                              v
+-------------------------------------------------------------+
|                     Bash Scripts                             |
|  (Battle-tested core logic for PRD execution and review)     |
|                                                              |
|  +---------------------+  +--------------------------------+ |
|  | night-watch-cron.sh |  | night-watch-pr-reviewer-cron.sh | |
|  |   (PRD Executor)    |  |        (PR Reviewer)            | |
|  +---------------------+  +--------------------------------+ |
|              |                          |                     |
|              +-----------+--------------+                     |
|                          v                                    |
|            +-----------------------------+                    |
|            | night-watch-helpers.sh      |                    |
|            |   (Shared utilities)        |                    |
|            +-----------------------------+                    |
+-------------------------------------------------------------+
                              |
                              v
+-------------------------------------------------------------+
|                    External Tools                            |
|                                                              |
|  +----------------+  +------------+  +------------------+    |
|  |  Provider CLI  |  | GitHub CLI |  |  Git Worktrees   |    |
|  | (Claude/Codex) |  |  (PR mgmt) |  |  (Isolation)     |    |
|  +----------------+  +------------+  +------------------+    |
+-------------------------------------------------------------+
```

---

## PRD Execution Flow

1. **Scan for PRDs** — Find markdown files in `docs/PRDs/night-watch/`
2. **Check dependencies** — Skip PRDs with unmet dependencies
3. **Check for open PRs** — Skip PRDs that already have an open PR
4. **Acquire lock** — Prevent concurrent executions
5. **Create worktree** — Isolate changes in a git worktree
6. **Launch Provider CLI** — Execute PRD using provider CLI with slash command
7. **Verify PR created** — Check that a PR was opened
8. **Mark done** — Move PRD to `done/` directory
9. **Cleanup** — Remove lock files and worktrees

---

## PR Review Flow

1. **Find open PRs** — Search for PRs on `night-watch/` or `feat/` branches
2. **Check CI status** — Identify failed checks
3. **Check review scores** — Find PRs with score < 80/100
4. **Acquire lock** — Prevent concurrent executions
5. **Launch Provider CLI** — Execute PR fix using provider CLI with slash command
6. **Cleanup** — Remove lock files

---

## Project Structure

```
night-watch-cli/
+-- bin/
|   +-- night-watch.mjs      # ESM entry point
+-- src/
|   +-- cli.ts               # CLI entry
|   +-- config.ts            # Config loader
|   +-- types.ts             # TypeScript types
|   +-- constants.ts         # Default values
|   +-- commands/            # Command implementations
|   |   +-- init.ts
|   |   +-- run.ts
|   |   +-- review.ts
|   |   +-- install.ts
|   |   +-- uninstall.ts
|   |   +-- status.ts
|   |   +-- logs.ts
|   +-- utils/
|       +-- shell.ts         # Shell execution
|       +-- crontab.ts       # Crontab management
+-- scripts/                 # Bundled bash scripts
|   +-- night-watch-cron.sh
|   +-- night-watch-pr-reviewer-cron.sh
|   +-- night-watch-helpers.sh
+-- templates/               # Template files
|   +-- night-watch.md
|   +-- night-watch-pr-reviewer.md
|   +-- night-watch.config.json
+-- docs/                    # Documentation
+-- dist/                    # Compiled output
```
