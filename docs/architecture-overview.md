# Night Watch CLI - Architecture Overview

Night Watch CLI is an autonomous PRD executor that uses AI provider CLIs (Claude, Codex) combined with cron scheduling to automatically implement PRD tickets, open pull requests, and fix CI failures.

---

## High-Level Architecture

```mermaid
graph TB
    subgraph User["User Interface"]
        CLI["night-watch CLI<br/>(Commander.js)"]
    end

    subgraph Core["Node.js Core"]
        Config["Config Loader<br/>(defaults + file + env)"]
        Shell["Shell Executor<br/>(child_process.spawn)"]
        Crontab["Crontab Manager<br/>(read/write/marker)"]
    end

    subgraph Scripts["Bash Scripts"]
        Executor["night-watch-cron.sh<br/>(PRD Executor)"]
        Reviewer["night-watch-pr-reviewer-cron.sh<br/>(PR Reviewer)"]
        Helpers["night-watch-helpers.sh<br/>(Shared Utilities)"]
    end

    subgraph External["External Tools"]
        Provider["AI Provider CLI<br/>(claude / codex)"]
        GH["GitHub CLI (gh)"]
        Git["Git"]
        CronDaemon["Cron Daemon"]
    end

    subgraph Storage["File System"]
        PRDs["docs/PRDs/night-watch/<br/>(pending PRDs)"]
        Done["docs/PRDs/night-watch/done/<br/>(completed PRDs)"]
        Logs["logs/<br/>(executor.log, reviewer.log)"]
        Lock["/tmp/night-watch-*.lock"]
        ConfigFile["night-watch.config.json"]
    end

    CLI --> Config
    CLI --> Shell
    CLI --> Crontab
    Config --> ConfigFile
    Shell --> Executor
    Shell --> Reviewer
    Executor --> Helpers
    Reviewer --> Helpers
    Executor --> Provider
    Reviewer --> Provider
    Executor --> GH
    Reviewer --> GH
    Executor --> Git
    Helpers --> Lock
    Helpers --> Logs
    Helpers --> PRDs
    Helpers --> Done
    Crontab --> CronDaemon
    CronDaemon -.->|scheduled| CLI
```

---

## CLI Command Structure

```mermaid
graph LR
    NW["night-watch"]
    NW --> Init["init<br/>Setup project"]
    NW --> Run["run<br/>Execute PRD now"]
    NW --> Review["review<br/>Review PRs now"]
    NW --> Install["install<br/>Add crontab entries"]
    NW --> Uninstall["uninstall<br/>Remove crontab entries"]
    NW --> Status["status<br/>Show dashboard"]
    NW --> LogsCmd["logs<br/>View log files"]

    Init --> |creates| Dirs["directories + config<br/>+ slash commands"]
    Run --> |spawns| ExecScript["night-watch-cron.sh"]
    Review --> |spawns| RevScript["night-watch-pr-reviewer-cron.sh"]
    Install --> |writes| CronTab["user crontab"]
    Uninstall --> |removes from| CronTab
    Status --> |reads| LockFiles["lock files + PRDs<br/>+ PRs + logs"]
    LogsCmd --> |tails| LogFiles["logs/"]
```

---

## PRD Execution Flow

```mermaid
sequenceDiagram
    participant Cron as Cron Daemon
    participant CLI as night-watch CLI
    participant Config as Config Loader
    participant Shell as Shell Executor
    participant Script as night-watch-cron.sh
    participant Helpers as helpers.sh
    participant AI as AI Provider (claude/codex)
    participant GH as GitHub CLI
    participant Git as Git
    participant FS as File System

    Cron->>CLI: night-watch run
    CLI->>Config: loadConfig(projectDir)
    Config-->>CLI: INightWatchConfig
    CLI->>Shell: executeScript(cron.sh, env)
    Shell->>Script: bash night-watch-cron.sh

    Script->>Helpers: validate_provider()
    Script->>Helpers: rotate_log()
    Script->>Helpers: acquire_lock()

    alt Lock acquired
        Script->>Helpers: cleanup_worktrees()
        Script->>Helpers: find_eligible_prd()
        Helpers->>FS: Scan PRD dir
        Helpers->>GH: Check open PRs
        Helpers->>FS: Check dependencies in done/
        Helpers-->>Script: eligible_prd.md

        alt PRD found
            Script->>Git: Create branch + worktree
            Script->>AI: Execute with PRD prompt
            AI->>Git: Implement, commit, push
            AI->>GH: gh pr create
            AI-->>Script: exit 0

            Script->>GH: Verify PR exists
            Script->>Helpers: mark_prd_done()
            Helpers->>FS: Move PRD to done/
            Script->>Git: Commit + push PRD move
        else No eligible PRD
            Script->>Helpers: log("SKIP")
        end
    else Lock held
        Script->>Helpers: log("SKIP: still active")
    end

    Script->>FS: Release lock (trap EXIT)
```

---

## PR Review Flow

```mermaid
sequenceDiagram
    participant Cron as Cron Daemon
    participant CLI as night-watch CLI
    participant Script as pr-reviewer-cron.sh
    participant GH as GitHub CLI
    participant AI as AI Provider (claude/codex)
    participant Git as Git

    Cron->>CLI: night-watch review
    CLI->>Script: spawn with env vars

    Script->>Script: acquire_lock()
    Script->>GH: gh pr list (feat/, night-watch/)

    loop Each open PR
        Script->>GH: gh pr checks (CI status)
        Script->>GH: gh api (review comments)
        Script->>Script: Extract score from comments

        alt Failed CI or score < 80
            Script->>Script: Mark PR as needing work
        end
    end

    alt PRs need work
        Script->>Script: cleanup_worktrees()
        Script->>AI: Execute /night-watch-pr-reviewer
        AI->>GH: Review code, fix issues
        AI->>Git: Commit + push fixes
        AI-->>Script: exit code
    else All PRs passing
        Script->>Script: log("SKIP: all passing")
    end

    Script->>Script: cleanup_worktrees()
    Script->>Script: Release lock
```

---

## Configuration Cascade

```mermaid
graph TD
    D["Hardcoded Defaults<br/>(src/constants.ts)"] -->|lowest priority| M["Merged Config"]
    F["Config File<br/>(night-watch.config.json)"] -->|overrides defaults| M
    E["Environment Variables<br/>(NW_* prefix)"] -->|overrides file| M
    C["CLI Flags<br/>(--timeout, --provider)"] -->|highest priority| M

    M --> Final["INightWatchConfig"]

    subgraph "Config Properties"
        Final --> P1["provider: claude | codex"]
        Final --> P2["prdDir: docs/PRDs/night-watch"]
        Final --> P3["maxRuntime: 7200s"]
        Final --> P4["cronSchedule: 0 0-15 * * *"]
        Final --> P5["branchPatterns: feat/, night-watch/"]
        Final --> P6["minReviewScore: 80"]
        Final --> P7["reviewerEnabled: true"]
    end
```

---

## Provider Abstraction

```mermaid
graph LR
    subgraph Strategy["Provider Strategy"]
        PC["PROVIDER_COMMANDS map"]
    end

    PC --> Claude["claude<br/>--dangerously-skip-permissions<br/>-p '/night-watch'"]
    PC --> Codex["codex<br/>--quiet --yolo<br/>--prompt '...'"]

    subgraph Config
        CF["night-watch.config.json<br/>provider: 'claude' | 'codex'"]
        ENV["NW_PROVIDER env var"]
        FLAG["--provider CLI flag"]
    end

    CF --> PC
    ENV --> PC
    FLAG --> PC
```

---

## Lock & Process Management

```mermaid
stateDiagram-v2
    [*] --> CheckLock: Script starts

    CheckLock --> ReadPID: Lock file exists
    CheckLock --> AcquireLock: No lock file

    ReadPID --> SkipRun: PID alive (kill -0)
    ReadPID --> RemoveStale: PID dead

    RemoveStale --> AcquireLock: Stale lock removed

    AcquireLock --> Running: Write PID + set trap
    Running --> Cleanup: Script exits (EXIT trap)
    Cleanup --> [*]: Lock file removed

    SkipRun --> [*]: Log "still active"
```

---

## Directory Structure

```
night-watch-cli/
├── bin/
│   └── night-watch.mjs            # ESM entry point (shebang)
├── src/
│   ├── cli.ts                     # Commander.js program setup
│   ├── types.ts                   # INightWatchConfig, Provider type
│   ├── constants.ts               # Defaults, PROVIDER_COMMANDS map
│   ├── config.ts                  # Hierarchical config loader
│   ├── commands/
│   │   ├── init.ts                # Project scaffolding
│   │   ├── run.ts                 # PRD executor dispatch
│   │   ├── review.ts              # PR reviewer dispatch
│   │   ├── install.ts             # Crontab entry creation
│   │   ├── uninstall.ts           # Crontab entry removal
│   │   ├── status.ts              # Health dashboard
│   │   └── logs.ts                # Log viewer (tail -f)
│   └── utils/
│       ├── shell.ts               # Bash subprocess wrapper
│       └── crontab.ts             # Crontab CRUD operations
├── scripts/
│   ├── night-watch-cron.sh        # PRD executor logic
│   ├── night-watch-pr-reviewer-cron.sh  # PR reviewer logic
│   └── night-watch-helpers.sh     # Shared bash functions
├── templates/
│   ├── night-watch.md             # Slash command for executor
│   ├── night-watch-pr-reviewer.md # Slash command for reviewer
│   └── night-watch.config.json    # Config template
├── docs/PRDs/                     # PRD storage
├── logs/                          # Runtime logs
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

---

## Data Flow Summary

```mermaid
flowchart LR
    subgraph Input
        PRD["PRD Files<br/>(Markdown)"]
        CFG["Config<br/>(JSON + ENV)"]
        SCHED["Cron Schedule"]
    end

    subgraph Processing
        NW["Night Watch CLI"]
        BASH["Bash Scripts"]
        AI["AI Provider"]
    end

    subgraph Output
        BR["Git Branch +<br/>Worktree"]
        PR["GitHub PR"]
        DONE["PRD moved<br/>to done/"]
        LOG["Log Files"]
    end

    PRD --> NW
    CFG --> NW
    SCHED -->|triggers| NW
    NW -->|spawns| BASH
    BASH -->|invokes| AI
    AI --> BR
    BR --> PR
    PR --> DONE
    BASH --> LOG
```

---

## Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| CLI framework | Commander.js | Lightweight, well-established, single dependency |
| Core logic | Bash scripts | Battle-tested for process management, git ops, lock files |
| Node.js wrapper | TypeScript | Distribution via npm, config management, type safety |
| Scheduling | System crontab | No daemon to manage, works on any Unix system |
| Isolation | Git worktrees | Parallel execution without polluting the main tree |
| Concurrency control | PID lock files | Simple, reliable, auto-cleanup via bash trap |
| Provider abstraction | Strategy pattern | Easy to add new AI provider CLIs |
| Config hierarchy | Defaults < File < Env < Flags | Standard precedence, 12-factor friendly |
