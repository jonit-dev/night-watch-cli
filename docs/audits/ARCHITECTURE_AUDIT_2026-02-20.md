# Night Watch CLI - Architecture Audit

Date: 2026-02-20  
Scope: Architectural review only (high-impact findings, not style-level nits)

## Rating

**★★★☆☆ (3/5)**

Reason: The repository has a solid package split and meaningful test coverage, but core architectural boundaries are still violated in ways that increase long-term maintenance and change risk.

## Findings (Ordered by Severity)

### 1. Critical - Hidden `core -> slack` dependency cycle

- `packages/slack/package.json` depends on `@night-watch/core`.
- `packages/core/src/utils/notify.ts` dynamically imports `@night-watch/slack/client.js` and `@night-watch/slack/deliberation.js`.
- `packages/core/package.json` does not declare `@night-watch/slack`.

Why this matters: the foundational package is reaching upward into an integration package, creating a cycle and eroding layer independence.

### 2. High - DI/composition-root architecture is not active in runtime paths

- `packages/core/src/di/container.ts` defines `initContainer`, but runtime code paths do not call it.
- `packages/core/src/storage/repositories/index.ts` still falls back to global singleton/service-locator behavior (`getDb()`/`getRepositories()` path).
- Server routes continue importing and calling core utility modules directly.

Why this matters: intended dependency inversion is not actually enforced at runtime, so implicit global state remains the dominant pattern.

### 3. High - Package boundaries are porous (deep internal imports)

- `packages/core/package.json` exports `"./*"` (full deep export surface).
- `packages/server/tsconfig.json` and `packages/cli/tsconfig.json` path-map directly to `../core/src/*`.
- Consumers import internal modules like `@night-watch/core/utils/*`, `@night-watch/core/storage/*`, etc.

Why this matters: consumers are tightly coupled to internals, making refactors brittle and effectively bypassing package encapsulation.

### 4. Medium - Large multi-responsibility modules remain in production paths

Examples:

- `packages/slack/src/deliberation.ts` (~1270 LOC)
- `packages/slack/src/interaction-listener.ts` (~1213 LOC)
- `packages/core/src/storage/repositories/sqlite/agent-persona.repository.ts` (~1047 LOC)
- `packages/core/src/utils/notify.ts` (~542 LOC)

Why this matters: these modules combine orchestration, IO, policy, and domain logic, increasing blast radius for changes and test complexity.

### 5. Medium - Web/server packaging boundary is path-coupled and inconsistent

- Server static file logic expects `packages/server/web/dist`.
- Build scripts produce frontend output in root `web/dist`.

Why this matters: runtime behavior depends on repository layout assumptions instead of an explicit artifact contract.

### 6. Medium - Architecture documentation drift

- `docs/architecture.md` and sections of `docs/architecture-overview.md` still describe legacy single-package `src/` layout and outdated boundaries.

Why this matters: docs no longer represent the operational architecture, reducing onboarding quality and decision clarity.

## Bottom Line

The codebase is in a **transitional architecture state**: good intent and structure at the package level, but boundary enforcement is incomplete. The biggest risks are dependency direction violations and inactive DI strategy, not code style or local implementation details.
