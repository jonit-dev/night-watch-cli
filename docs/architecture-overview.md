# Night Watch CLI - Architecture Overview

Night Watch CLI is an autonomous PRD executor that uses AI provider CLIs (Claude, Codex) combined with cron scheduling to automatically implement PRD tickets, open pull requests, and fix CI failures.

---

## High-Level Architecture

```mermaid
graph TB
    subgraph User["User Interface"]
        CLI["packages/cli<br/>(Commander.js)"]
        WebUI["packages/web<br/>(React + Vite)"]
    end

    subgraph Core["packages/core"]
        Config["Config Loader<br/>(defaults + file + env)"]
        Shell["Shell Executor<br/>(child_process.spawn)"]
        Repos["Repository Layer<br/>(SQLite via tsyringe)"]
        Notify["Notification Utils<br/>(webhooks)"]
    end

    subgraph Server["packages/server"]
        API["Express REST API<br/>(+ SSE)"]
    end

    subgraph SlackPkg["packages/slack"]
        Bot["Slack Bot<br/>(Socket Mode)"]
        DelibEngine["DeliberationEngine<br/>(multi-agent)"]
        SlackNotify["Slack Notifications<br/>(Bot API)"]
    end

    subgraph External["External Tools"]
        Provider["AI Provider CLI<br/>(claude / codex)"]
        GH["GitHub CLI (gh)"]
        Git["Git"]
        CronDaemon["Cron Daemon"]
        SlackAPI["Slack API"]
    end

    subgraph Storage["Persistence"]
        DB[("~/.night-watch/state.db<br/>(SQLite)")]
        PRDs["docs/PRDs/night-watch/<br/>(pending PRDs)"]
        Lock["/tmp/night-watch-*.lock"]
    end

    CLI --> Config
    CLI --> Shell
    CLI --> Repos
    CLI --> Notify
    WebUI -->|HTTP/SSE| API
    API --> Config
    API --> Repos
    API --> SlackNotify
    Shell --> Provider
    Shell --> GH
    Shell --> Git
    Bot --> DelibEngine
    Bot --> SlackAPI
    SlackNotify --> SlackAPI
    Repos --> DB
    CronDaemon -.->|scheduled| CLI
    Shell --> Lock
    Shell --> PRDs
```

---

## CLI Command Structure

```mermaid
graph LR
    NW["night-watch"]
    NW --> Init["init<br/>Setup project"]
    NW --> Run["run<br/>Execute PRD now"]
    NW --> Review["review<br/>Review PRs now"]
    NW --> QA["qa<br/>QA run"]
    NW --> Serve["serve<br/>Start web server"]
    NW --> Board["board<br/>Ticket board"]
    NW --> State["state<br/>State management"]
    NW --> LogsCmd["logs<br/>View log files"]

    Init --> |creates| Dirs["directories + config<br/>+ slash commands"]
    Run --> |spawns| Provider["AI Provider CLI<br/>(claude/codex)"]
    Review --> |spawns| Provider
    QA --> |spawns| Provider
    Serve --> |starts| API["packages/server<br/>(Express + SSE)"]
    Board --> |reads| DB[("state.db")]
    State --> |reads/writes| DB
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
    D["Hardcoded Defaults<br/>(packages/core/src/constants.ts)"] -->|lowest priority| M["Merged Config"]
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
night-watch-cli/                    # Yarn workspaces monorepo
├── packages/
│   ├── core/                       # Domain logic (private)
│   │   └── src/
│   │       ├── agents/             # Soul/Style/Skill compiler → system prompts
│   │       ├── board/              # Roadmap + ticket management
│   │       ├── config.ts           # Hierarchical config loader
│   │       ├── constants.ts        # DEFAULT_*, VALID_* constants
│   │       ├── di/
│   │       │   └── container.ts    # tsyringe composition root
│   │       ├── storage/
│   │       │   ├── repositories/   # Interfaces + SQLite implementations
│   │       │   └── sqlite/         # DB client + migrations
│   │       ├── templates/          # PRD/slicer prompt templates
│   │       ├── types.ts            # Shared TypeScript interfaces
│   │       └── utils/              # notify, shell, registry, roadmap…
│   ├── cli/                        # Published npm package
│   │   └── src/
│   │       ├── cli.ts              # Commander.js program setup
│   │       └── commands/           # init, run, review, qa, serve, board…
│   ├── server/                     # REST API + SSE (private)
│   │   └── src/
│   │       ├── index.ts            # startServer / startGlobalServer
│   │       ├── middleware/         # error-handler, graceful-shutdown, SSE
│   │       ├── routes/             # agents, prds, board, slack…
│   │       └── services/           # notification.service
│   ├── slack/                      # Slack bot (private)
│   │   └── src/
│   │       ├── client.ts           # SlackClient (WebClient wrapper)
│   │       ├── deliberation.ts     # DeliberationEngine
│   │       ├── factory.ts          # createSlackStack()
│   │       ├── interaction-listener/ # Socket Mode event routing
│   │       ├── notify.ts           # sendSlackBotNotification()
│   │       └── proactive-loop.ts   # Proactive message scheduler
│   └── web/                        # React SPA source (private)
├── web/                            # Vite build root → web/dist/ (served by server)
├── docs/PRDs/                      # PRD storage (pending + done/)
├── logs/                           # Runtime logs
├── package.json                    # Workspace root
├── turbo.json                      # Turbo build pipeline
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

| Decision             | Choice                        | Rationale                                                 |
| -------------------- | ----------------------------- | --------------------------------------------------------- |
| CLI framework        | Commander.js                  | Lightweight, well-established, single dependency          |
| Core logic           | Bash scripts                  | Battle-tested for process management, git ops, lock files |
| Node.js wrapper      | TypeScript                    | Distribution via npm, config management, type safety      |
| Scheduling           | System crontab                | No daemon to manage, works on any Unix system             |
| Isolation            | Git worktrees                 | Parallel execution without polluting the main tree        |
| Concurrency control  | PID lock files                | Simple, reliable, auto-cleanup via bash trap              |
| Provider abstraction | Strategy pattern              | Easy to add new AI provider CLIs                          |
| Config hierarchy     | Defaults < File < Env < Flags | Standard precedence, 12-factor friendly                   |
| Persistence layer    | SQLite via repository pattern | Structured state with enforced architectural boundary     |

---

## Persistence Architecture

Night Watch uses a layered persistence architecture backed by SQLite. All SQL operations are confined to `packages/core/src/storage/**` and enforced at lint time.

```mermaid
flowchart LR
    CLI[Commands / Server] --> Utils[Utility Functions]
    Utils --> Repos[Repository Interfaces]
    Repos --> SqliteImpl[SQLite Implementations]
    SqliteImpl --> DB[(~/.night-watch/state.db)]
    Migrate[state migrate command] --> DB
```

### Layers

| Layer                  | Location                                                 | Responsibility                                           |
| ---------------------- | -------------------------------------------------------- | -------------------------------------------------------- |
| Commands / Server      | `packages/cli/src/commands/**`, `packages/server/src/**` | User-facing logic; calls utility functions only          |
| Utility Functions      | `packages/core/src/utils/**`                             | Business logic; accesses state via repository interfaces |
| Repository Interfaces  | `packages/core/src/storage/repositories/interfaces.ts`   | Persistence contracts; no SQL                            |
| SQLite Implementations | `packages/core/src/storage/repositories/sqlite/**`       | Concrete SQL implementations                             |
| SQLite Client          | `packages/core/src/storage/sqlite/client.ts`             | Database connection and setup                            |
| Migrations             | `packages/core/src/storage/sqlite/migrations.ts`         | Schema versioning                                        |

### Repository Interfaces

- `IProjectRegistryRepository` — registered project paths
- `IExecutionHistoryRepository` — PRD execution records and cooldown tracking
- `IPrdStateRepository` — per-PRD workflow state (e.g. `pending-review`)
- `IRoadmapStateRepository` — roadmap scan metadata

### Boundary Enforcement

- All `better-sqlite3` imports are restricted to `packages/core/src/storage/**` by an ESLint `no-restricted-imports` rule in `eslint.config.js`
- Any attempt to import `better-sqlite3` outside the storage layer will produce a lint error:
  `SQL access is restricted to src/storage/**. Use repository interfaces instead.`
- The `state` command (`packages/cli/src/commands/state.ts`) manages SQLite state operations

### Verifying the Boundary

Run the following to confirm no raw SQL or `better-sqlite3` imports exist outside the storage layer:

```bash
rg -n "SELECT|INSERT|UPDATE|DELETE|better-sqlite3" packages/core/src --glob '!packages/core/src/storage/**'
```

This should return zero results.
