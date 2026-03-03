# Night Watch CLI Audit: Architecture, Code Quality, and Dead Code

Date: 2026-03-03

## Scope
- `packages/core`
- `packages/cli`
- `packages/server`
- `web`
- root-level legacy `src/`

## Method
- Static code review focused on SRP, DRY, KISS, YAGNI, overengineering, architecture boundaries, and dead code.
- Evidence references are file+line anchors from the current repository state.

## Executive Summary
The repository is functional but carries significant architectural duplication and migration residue. The biggest risk is synchronous shell/CLI execution inside HTTP request paths and SSE polling loops, which can block the Node event loop under load. The second major issue is broad route duplication between single-project and global modes, already showing drift and maintainability risk. Dead/legacy code from pre-monorepo layout is still present and can mislead contributors.

---

## Findings (Ordered by Severity)

### H1: Event-loop blocking in server hot paths (status + board APIs)
Principles: `KISS`, performance architecture, separation of concerns

Why it matters:
- The server executes blocking shell commands (`gh`, `git`) from request/SSE paths.
- Under concurrent users or slow GitHub CLI/API responses, all requests can stall.

Evidence:
- SSE poller runs every 2s: `packages/server/src/middleware/sse.middleware.ts:31-53`.
- Poller calls snapshot fetch each tick: `packages/server/src/middleware/sse.middleware.ts:40`.
- Snapshot includes PR collection: `packages/core/src/utils/status-data.ts:667-684`.
- PR collection uses blocking `execSync('gh pr list ...')`: `packages/core/src/utils/status-data.ts:536-543`.
- Board HTTP handlers call provider operations directly per request: `packages/server/src/routes/board.routes.ts:24-55`, `:60-107`.
- Board provider GraphQL helper uses `execFileSync`: `packages/core/src/board/providers/github-graphql.ts:1-29`.
- Board provider issue operations also use `execFileSync`: `packages/core/src/board/providers/github-projects.ts:717-734`, `:802-814`, `:979-992`.

Recommended fix:
- Move external CLI calls off request thread (async worker or queued job model).
- Cache expensive status/board reads with bounded TTL and explicit invalidation.
- Keep SSE publisher fed by async background refresh, not synchronous command execution.

---

### H2: Single-project vs global-mode route duplication is extensive and drifting
Principles: `DRY`, `SRP`, maintainability

Why it matters:
- Multiple route files duplicate nearly the same logic for `/api/*` and `/api/projects/:id/*`.
- This doubles patching effort and increases regression risk.
- There is already behavior drift in SSE config handling and lifecycle cleanup.

Evidence (duplicated route stacks):
- Board routes duplicated: `packages/server/src/routes/board.routes.ts:20-192` and `:197-383`.
- Action routes duplicated: `packages/server/src/routes/action.routes.ts:132-248` and `:253-379`.
- Roadmap routes duplicated: `packages/server/src/routes/roadmap.routes.ts:24-91` and `:96-163`.
- Status/schedule routes duplicated: `packages/server/src/routes/status.routes.ts:18-54` and `:113-200`.

Drift indicators:
- Global SSE watcher captures request-scoped config reference: `packages/server/src/routes/status.routes.ts:132` (`() => req.projectConfig!`), which can become stale after config updates.
- Project watcher intervals are created and stored but never cleared: `packages/server/src/index.ts:166-168`, `packages/server/src/routes/status.routes.ts:131-134` (no corresponding `clearInterval`).

Recommended fix:
- Build one route implementation per feature with a small context adapter (`projectDir`, `getConfig`, `sseClients`).
- Centralize watcher lifecycle with connect/disconnect ref counting and cleanup.

---

### M1: CLI command architecture has repeated orchestration logic and SRP violations
Principles: `SRP`, `DRY`, `KISS`

Why it matters:
- Command handlers combine CLI parsing, config mutation, env building, dry-run rendering, execution, notification dispatch, and exit control.
- Same patterns appear across commands, increasing bug surface.

Evidence:
- Repeated env builder / override functions:
  - `packages/cli/src/commands/run.ts:258`, `:338`
  - `packages/cli/src/commands/review.ts:64`, `:115`
  - `packages/cli/src/commands/qa.ts:66`, `:113`
  - `packages/cli/src/commands/slice.ts:37`, `:75`
  - `packages/cli/src/commands/audit.ts:31`
- `run` command is a large multi-responsibility orchestration unit: `packages/cli/src/commands/run.ts:426-600`.
- Concrete DRY regression: duplicated auto-merge env assignment block in review command:
  - first block `packages/cli/src/commands/review.ts:89-94`
  - repeated again `packages/cli/src/commands/review.ts:100-104`

Recommended fix:
- Extract a shared command runner pipeline (`load->override->env->dryRun->execute->notify`).
- Keep command files thin and use reusable env-builder modules by job type.

---

### M2: `config.ts` is a monolith doing too many unrelated jobs
Principles: `SRP`, `DRY`, `KISS`

Why it matters:
- One file handles defaults, legacy normalization, env parsing, merge logic, validation helpers, and script-path resolution.
- Merge logic is manually duplicated for file and env overlays.
- High chance of subtle drift when adding fields.

Evidence:
- Defaults builder: `packages/core/src/config.ts:64-119`.
- Legacy/normalization parser: `packages/core/src/config.ts:149-330`.
- Manual merge blocks duplicated:
  - file merge `packages/core/src/config.ts:389-427`
  - env merge `packages/core/src/config.ts:429-463`
- Env variable parsing section: `packages/core/src/config.ts:487-759`.
- Unrelated script-path resolver in same file: `packages/core/src/config.ts:790-828`.

Recommended fix:
- Split into `config/defaults`, `config/schema+validation`, `config/loaders(file/env)`, and `config/merge`.
- Use declarative schema validation to reduce repeated per-field plumbing.

---

### M3: YAGNI/overengineering in server service layer (runtime-unused wrappers)
Principles: `YAGNI`, `KISS`

Why it matters:
- Service classes are thin pass-through wrappers around core functions but are not used by runtime routes.
- Extra abstraction adds maintenance overhead without runtime benefit.

Evidence:
- Wrapper services:
  - `packages/server/src/services/notification.service.ts:29-104`
  - `packages/server/src/services/status.service.ts:39-168`
  - `packages/server/src/services/roadmap.service.ts:26-67`
- Runtime routes call core functions directly instead of services:
  - `packages/server/src/routes/status.routes.ts:9` (`fetchStatusSnapshot`)
  - `packages/server/src/routes/roadmap.routes.ts:9-16` (`scanRoadmap`, etc.)
- DI container comments refer to a server extension step that does not exist in current runtime flow:
  - `packages/core/src/di/container.ts:9-11` (`extendContainerWithServices()` mention).

Recommended fix:
- Either fully adopt service injection in routes, or remove wrappers and keep direct core calls.
- Align container comments/docs with actual architecture.

---

### M4: Confirmed dead legacy code in root `src/` tree
Principles: `YAGNI`, dead code elimination, maintainability

Why it matters:
- Legacy code still contains old command/config implementations but is outside current build/test graph.
- It creates false affordances for contributors and increases drift risk.

Evidence:
- Root TS project references only monorepo packages (not root `src`): `tsconfig.json:6-10`.
- Legacy files still present and substantial:
  - `src/constants.ts:1-93`
  - `src/commands/run.ts:1-260` (file continues beyond shown excerpt).
- Behavior divergence already exists between legacy and active command paths:
  - legacy board env toggle requires `projectNumber`: `src/commands/run.ts:101-106`
  - active command enables board mode without that requirement: `packages/cli/src/commands/run.ts:310-313`.

Recommended fix:
- Remove or archive `src/` legacy tree behind a dedicated migration/history folder.
- Add CI guard to prevent imports from root `src/`.

---

### M5: Orphan web-package residue and unreachable tests
Principles: `DRY`, `KISS`, architecture consistency

Why it matters:
- Repo contains both root `web/` app and leftover `packages/web/` artifacts.
- Some tests are not part of executed test suites.

Evidence:
- Unreachable test file in orphan path: `packages/web/src/__tests__/api.test.ts:1-77`.
- Root vitest project list excludes `packages/web`: `vitest.config.ts:5-8`.
- Workspace and scripts show mixed topology:
  - workspace targets `packages/*`: `package.json:5-7`
  - active web scripts use root `web/`: `package.json:12-14`
- Architecture docs still state `packages/web`: `docs/architecture-overview.md:15`.

Recommended fix:
- Choose one canonical web location (prefer root `web/` or fully migrate to `packages/web/`).
- Move/enable tests in the canonical location and wire them into CI.
- Update architecture docs to match reality.

---

### M6: Board provider has hard 100-item limit (scalability underload)
Principles: scalability architecture, `YAGNI` (assumption that board remains small)

Why it matters:
- Queries use `items(first: 100)` and do not paginate.
- Boards with >100 issues will return incomplete data and operations may target partial views.

Evidence:
- `getAllIssues` query limit: `packages/core/src/board/providers/github-projects.ts:856`.
- `moveIssue` lookup query limit: `packages/core/src/board/providers/github-projects.ts:912`.

Recommended fix:
- Implement GraphQL pagination (`pageInfo`, cursors).
- Add tests for boards with >100 issues.

---

## Dead Code Inventory

### Confirmed dead or runtime-unused
- Root legacy code not in build graph:
  - `src/constants.ts`
  - `src/commands/run.ts`
- Server service wrappers not used by runtime routes:
  - `packages/server/src/services/notification.service.ts`
  - `packages/server/src/services/status.service.ts`
  - `packages/server/src/services/roadmap.service.ts`
- Orphan/unexecuted web test path:
  - `packages/web/src/__tests__/api.test.ts`

### Likely stale architectural residue
- Container comment references missing extension integration:
  - `packages/core/src/di/container.ts:9-11`
- Documentation references `packages/web` while active app is root `web/`:
  - `docs/architecture-overview.md:15`

---

## Priority Remediation Plan

1. Remove blocking shell execution from HTTP/SSE hot paths.
2. Collapse duplicated route stacks into shared handlers with context adapters.
3. Delete/archive root `src/` legacy tree and orphan `packages/web` residue.
4. Decide whether server services are real runtime abstractions or remove them.
5. Split `config.ts` into focused modules with schema-based validation.
6. Add board pagination and corresponding tests.

---

## Audit Limitations
- This was a static audit; no runtime load test was executed.
- Findings emphasize architecture and maintainability risk, not feature completeness.
