# Architecture

## Overview

Night Watch CLI is a monorepo-based autonomous PRD executor with a Slack integration layer. It uses AI provider CLIs (Claude/Codex) to implement PRD tickets, open pull requests, and fix CI failures. A web UI and REST API provide visibility and control.

```
packages/
├── core/     — Domain logic, storage, config, DI container
├── cli/      — Commander.js entry point; published to npm
├── server/   — Express REST API + SSE; serves the web UI
├── slack/    — Slack bot (Socket Mode), deliberation engine
└── web/      — React + Vite dashboard (built to web/dist/)
```

---

## Package Dependency Graph

```
cli ──────────────┐
                  ▼
server ───────► core ◄─── slack
                            ▲
                            │
              (slack depends on core; core has no dependency on slack)
```

---

## PRD Execution Flow

1. **Scan for PRDs** — Find markdown files in `docs/PRDs/night-watch/`
2. **Check dependencies** — Skip PRDs with unmet dependencies
3. **Check for open PRs** — Skip PRDs that already have an open PR
4. **Acquire lock** — Prevent concurrent executions
5. **Create worktree** — Isolate changes in a git worktree
6. **Launch AI Provider CLI** — Execute PRD using provider CLI with slash command
7. **Verify PR created** — Check that a PR was opened
8. **Mark done** — Move PRD to `done/` directory
9. **Send notifications** — Post to webhooks and/or Slack Bot API
10. **Cleanup** — Remove lock files and worktrees

---

## PR Review Flow

1. **Find open PRs** — Search for PRs on `night-watch/` or `feat/` branches
2. **Check CI status** — Identify failed checks
3. **Check review scores** — Find PRs with score < 80/100
4. **Acquire lock** — Prevent concurrent executions
5. **Launch AI Provider CLI** — Execute PR fix
6. **Cleanup** — Remove lock files

---

## Monorepo Structure

```
night-watch-cli/
├── packages/
│   ├── core/
│   │   └── src/
│   │       ├── agents/           # Soul compiler (persona → system prompt)
│   │       ├── board/            # Roadmap/ticket management
│   │       ├── config.ts         # Hierarchical config loader
│   │       ├── constants.ts      # DEFAULT_*, VALID_* constants
│   │       ├── di/
│   │       │   └── container.ts  # tsyringe composition root
│   │       ├── storage/
│   │       │   ├── repositories/ # Repository interfaces + SQLite implementations
│   │       │   └── sqlite/       # DB client + migrations
│   │       ├── templates/        # PRD/slicer prompt templates
│   │       ├── types.ts          # Shared TypeScript types
│   │       └── utils/            # notify, shell, registry, roadmap, etc.
│   ├── cli/
│   │   └── src/
│   │       ├── cli.ts            # Commander.js program setup
│   │       └── commands/         # init, run, review, qa, serve, board, state…
│   ├── server/
│   │   └── src/
│   │       ├── index.ts          # startServer / startGlobalServer / createApp
│   │       ├── middleware/       # error-handler, graceful-shutdown, SSE, resolver
│   │       ├── routes/           # REST API routes (agents, prds, board, slack…)
│   │       └── services/         # notification.service, etc.
│   ├── slack/
│   │   └── src/
│   │       ├── client.ts         # SlackClient (WebClient wrapper)
│   │       ├── deliberation.ts   # DeliberationEngine (multi-agent discussions)
│   │       ├── factory.ts        # createSlackStack()
│   │       ├── interaction-listener/ # Socket Mode event routing (modular)
│   │       ├── notify.ts         # sendSlackBotNotification()
│   │       └── proactive-loop.ts # Proactive message scheduler
│   └── web/                      # React + Vite SPA (output → web/dist/)
├── web/                           # Vite build root (dist/ used by server)
├── docs/                          # Documentation + PRDs
├── package.json                   # Workspace root (Yarn workspaces)
└── turbo.json                     # Turbo build pipeline
```

---

## Key Design Decisions

| Decision            | Choice                        | Rationale                                         |
| ------------------- | ----------------------------- | ------------------------------------------------- |
| CLI framework       | Commander.js                  | Lightweight, well-established                     |
| Monorepo tooling    | Yarn workspaces + Turbo       | Incremental builds, workspace protocol            |
| DI container        | tsyringe                      | Decorator-based, TypeScript-native                |
| Persistence         | SQLite via repository pattern | Structured state, enforced architectural boundary |
| Scheduling          | System crontab                | No daemon, works on any Unix                      |
| Isolation           | Git worktrees                 | Parallel execution without polluting main tree    |
| Concurrency control | PID lock files                | Simple, reliable, auto-cleanup                    |
| Slack integration   | Socket Mode (WebSocket)       | No inbound HTTP required, works behind NAT        |
| AI personas         | Soul/Style/Skill compiler     | Composable prompt layers per agent                |
