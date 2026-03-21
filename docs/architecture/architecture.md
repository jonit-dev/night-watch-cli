---
title: Architecture
description: System architecture and design overview
---

# Architecture

Night Watch CLI is built as a monorepo using Yarn workspaces and Turbo.

## Monorepo Structure

```
night-watch-cli/
├── packages/
│   ├── core/      # Core functionality (private)
│   ├── cli/       # Published CLI package
│   ├── server/    # Server components (private)
│   └── slack/     # (Removed - webhook-only now)
└── web/           # Web UI at root
```

## Key Components

### Core Package

The `@night-watch/core` package contains:

- Storage layer with SQLite repositories
- Agent persona definitions
- Soul/Style/Skill compiler
- Utility functions (logger, notifications, avatar generation)

### CLI Package

The `@jonit-dev/night-watch-cli` package is the published entry point.

### DI Container

Uses `tsyringe` for dependency injection with token-based registration.

## Design Principles

- Composition over inheritance
- SRP, DRY, KISS, YAGNI, SOLID
- Repository pattern for data access
