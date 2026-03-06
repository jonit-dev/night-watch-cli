# Remove Legacy Agent Personas & Filesystem PRD Mode

**Complexity:** 5 → MEDIUM mode

**Depends on:** None

## 1. Context

**Problem:** Two major subsystems are dead code:

1. **Agent Personas** (Maya, Carlos, Priya, Dev) with soul/style/skill compilation — originally built for multi-agent Slack deliberation, which was removed in commit 46637a0. The personas, soul compiler, and related UI/routes are unused overhead.

2. **Filesystem PRD mode** — superseded by GitHub Projects board mode. The filesystem scanning, claim files, dependency graph resolution, and `prdDir`-based workflows are no longer the primary path. Board mode is the canonical way to feed work into Night Watch.

**Goal:** Remove both subsystems cleanly, reducing maintenance burden and simplifying the codebase.

## 2. Scope — Agent Personas & Soul Compiler

### Files to delete

- `packages/core/src/storage/repositories/sqlite/agent-persona.repository.ts`
- `packages/core/src/storage/repositories/sqlite/agent-persona.defaults.ts`
- `packages/core/src/agents/soul-compiler.ts`
- `packages/core/src/__tests__/agents/soul-compiler.test.ts`
- `packages/core/src/__tests__/soul-compiler.test.ts`

### Files to modify

- `packages/core/src/di/container.ts` — remove `SqliteAgentPersonaRepository` registration
- `packages/core/src/storage/repositories/interfaces.ts` — remove `IAgentPersonaRepository` interface
- `packages/core/src/storage/repositories/index.ts` — remove persona re-exports
- `packages/core/src/index.ts` — remove persona/soul-compiler exports
- `packages/server/src/routes/agent.routes.ts` — remove persona API routes (or delete file if only personas)
- `web/src/pages/Agents.tsx` — delete page, remove from router/nav

### Acceptance Criteria

- No references to `agent-persona`, `soul-compiler`, `compileSoul`, `AgentPersona`, `IAgentPersona` remain in the codebase
- `yarn verify` passes
- All existing tests pass

## 3. Scope — Filesystem PRD Mode

### What to remove

- Filesystem scanning logic in `packages/cli/src/commands/run.ts` (the non-board-mode branch)
- `night-watch prd list` filesystem scanning in `packages/cli/src/commands/prd.ts`
- Claim file (`.claim`) logic wherever it exists
- `prdDir` config field and its defaults
- `prdPriority` config field
- PRD dependency graph resolution (the `dependencies:` frontmatter system)
- `SqlitePrdStateRepository` if only used for filesystem mode tracking
- `Filesystem Mode` section from `instructions/night-watch.md` and `templates/night-watch.md`
- Related tests

### What to keep

- `night-watch prd create` (if it creates board issues)
- `night-watch prds` (if it reads from board)
- Board mode in `run.ts` — this becomes the only mode
- The `docs/PRDs/` directory itself (for reference/done archive)

### Files to modify (partial list — agent should grep for all references)

- `packages/cli/src/commands/run.ts`
- `packages/cli/src/commands/prd.ts`
- `packages/cli/src/commands/prds.ts`
- `packages/cli/src/commands/init.ts`
- `packages/cli/src/commands/slice.ts`
- `packages/cli/src/commands/state.ts`
- `packages/cli/src/commands/retry.ts`
- `packages/cli/src/commands/doctor.ts`
- `packages/cli/src/commands/cron.ts`
- `packages/cli/src/commands/review.ts`
- `packages/cli/src/commands/dashboard/tab-config.ts`
- `packages/core/src/types.ts` — remove `prdDir`, `prdPriority` fields
- `packages/core/src/constants.ts` — remove related defaults
- `instructions/night-watch.md` — remove Filesystem Mode section
- `templates/night-watch.md` — remove Filesystem Mode section

### Acceptance Criteria

- Board mode is the only execution mode — no filesystem PRD scanning remains
- `prdDir` and `prdPriority` removed from `INightWatchConfig`
- No `.claim` file logic remains
- `yarn verify` passes
- All existing tests pass (update/remove filesystem-mode-specific tests)

## 4. Implementation Notes

- This is a large removal — work methodically file by file
- Grep for all references before deleting to avoid dangling imports
- The `night-watch init` wizard may need updating if it asks about PRD directory setup
- Check that `night-watch status` and `night-watch dashboard` still render correctly without filesystem PRD stats
