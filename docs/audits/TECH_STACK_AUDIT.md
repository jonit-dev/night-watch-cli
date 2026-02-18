# Night Watch CLI: Tech Stack Audit

Date: 2026-02-18

## Scope and Method

This audit reviewed the current CLI + Web UI stack for production readiness, maintainability, and modernization opportunities.

Evidence sources:

- Repository configuration (`package.json`, `web/package.json`, `tsconfig.json`, `vitest.config.ts`, `eslint.config.js`)
- CI workflows (`.github/workflows/tests.yml`, `.github/workflows/code-quality.yml`)
- Runtime architecture/docs (`README.md`, `docs/architecture*.md`)
- Command validation run in this repo:
  - `yarn verify` (passes with 4 warnings)
  - `yarn test` (37 files, 609 tests, all passing)
  - `yarn --cwd web build` (passes)
  - Dependency/security checks (`npm outdated`, `yarn audit`, `npm audit --omit=dev`)

## Executive Summary

The project is on a solid base: strict TypeScript, broad automated CLI test coverage, and a working web UI shipped with modern React/Vite.

The biggest issues are not core framework choice. They are stack hygiene and scaling ergonomics:

1. Secret exposure risk in repo config.
2. Package manager + lockfile inconsistency.
3. Missing quality gates for the web app.
4. Shared contracts/types are not centralized across CLI server and web client.

## Current Stack Snapshot

- CLI runtime: Node.js + TypeScript + Commander + Express + better-sqlite3
- Web UI: React 19 + React Router 7 + Vite 6 + Zustand
- Testing: Vitest (CLI tests only)
- Linting: ESLint + typescript-eslint (CLI only)
- CI: two PR workflows for CLI tests/lint/typecheck
- Storage: SQLite (WAL mode) + filesystem logs/config

## Findings (Prioritized)

### 1) Critical: Repository contains an npm auth token

- Evidence: `.npmrc` includes a registry auth token and the file is present in the working tree.
- Impact: Token leakage and package publish/account compromise risk.
- Recommendation:
  - Revoke/rotate the token immediately.
  - Remove tokenized `.npmrc` from repository history and enforce local/user-level auth only.
  - Keep `.npmrc` ignored and use CI secrets for publish workflows.

### 2) High: Package manager and lockfile strategy is inconsistent

- Evidence:
  - Root has both `package-lock.json` and `yarn.lock`.
  - Build/docs/scripts mix npm and yarn commands.
  - Web package has `yarn.lock` but no npm lockfile.
- Impact: Non-reproducible installs, drift between environments, inconsistent audit output.
- Recommendation:
  - Standardize on one toolchain (`pnpm` preferred for future workspace scaling, or npm if simplicity is priority).
  - Keep exactly one lockfile strategy at root/workspaces.

### 3) High: Web app has no lint/test/CI quality gate

- Evidence:
  - CI runs only CLI lint/typecheck/tests.
  - No web lint/test scripts in `web/package.json`.
- Impact: UI regressions can merge without automated checks.
- Recommendation:
  - Add web scripts: `lint`, `typecheck`, `test`.
  - Extend CI to run web build + lint + typecheck (and tests when added).

### 4) High: Tooling is behind latest secure/stable lines (especially Vitest/Vite chain)

- Evidence:
  - `vitest` is `1.x` while latest is `4.x`.
  - Audit flags moderate advisories through Vite/esbuild toolchain path.
- Impact: avoidable security/maintenance risk in dev tooling and slower access to fixes.
- Recommendation:
  - Plan a controlled upgrade: `vitest@4`, Vite-compatible versions, then rebaseline tests.
  - Keep runtime dependency audit separate from dev-tool audit (runtime currently clean via `npm audit --omit=dev`).

### 5) Medium: Tailwind is loaded from CDN in `web/index.html`

- Evidence: `<script src="https://cdn.tailwindcss.com"></script>` in production UI entry.
- Impact: runtime external dependency, less deterministic builds, weaker CSP posture.
- Recommendation:
  - Move to local Tailwind/PostCSS pipeline with pinned versions.

### 6) Medium: Shared API contracts/types are not centralized

- Evidence:
  - Backend types in `src/types.ts`.
  - Web response/config types duplicated in `web/api.ts`.
- Impact: silent contract drift risk between server and client.
- Recommendation:
  - Create shared package (e.g. `packages/contracts` or `packages/types`) consumed by both CLI API server and web app.

### 7) Medium: Node/runtime policy is not unified

- Evidence:
  - Engine is `>=18`, CI runs Node 22, type defs differ root vs web (`@types/node` 20 and 22 lines).
- Impact: compatibility ambiguity and subtle local-vs-CI behavior differences.
- Recommendation:
  - Pick and enforce one active LTS target (Node 22 recommended now), document it, and align engines/CI/dev types.

## Direct Answer: Turbopack for Monorepo + Shared Types?

- `Turbopack`: No, not for this project right now.
  - It is primarily a Next.js bundler path and does not solve your immediate repo management pain here.
- `Shared types folder/package`: Yes, this is the right next move.
  - Add a shared contracts/types package first.
- `Turborepo`: Maybe later, after workspace split.
  - Adopt when you have multiple packages with meaningful build/test graph and CI time worth optimizing.

## Recommended Target Stack (Pragmatic)

For the next stage, the best practical stack is:

1. Node 22 LTS baseline.
2. One package manager + workspaces (prefer `pnpm` + `pnpm-workspace.yaml`).
3. Keep Vite for web; do not switch to Turbopack.
4. Add `packages/types` (or `packages/contracts`) for shared API types.
5. Add Turborepo only after workspace split and measurable CI/build bottlenecks.
6. Add web lint/typecheck/test + CI gates.

## 30-Day Implementation Plan

### Week 1 (Security + Determinism)

1. Rotate/revoke npm token and clean repo secret exposure.
2. Standardize package manager and lockfiles.
3. Align Node version policy across engines/CI/local docs.

### Week 2 (Quality Gates)

1. Add web lint/typecheck scripts.
2. Add web checks to CI.
3. Keep existing CLI checks as mandatory.

### Week 3 (Contracts + Monorepo Readiness)

1. Introduce shared `packages/types` (or `packages/contracts`).
2. Migrate `web/api.ts` and server endpoint types to shared imports.

### Week 4 (Modernization)

1. Upgrade Vitest/Vite chain with test rebaseline.
2. Replace Tailwind CDN with local build pipeline.
3. Re-run audit and lock a quarterly dependency refresh cadence.

## Final Assessment

You are already using solid core technologies. The highest-value improvements are operational and architectural hygiene, not a wholesale framework switch. Prioritize shared contracts + workspace consistency first; evaluate Turborepo only after that. Turbopack is not the right lever for this codebase today.
