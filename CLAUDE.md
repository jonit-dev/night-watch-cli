# Critical

- Don't trust, verify. Always write tests for new features and bug fixes. Changed some code? Try to validate it somehow.
- Favor composition over inheritance, use tsyringe
- Favor SRP, DRY, KISS, YAGNI, SOLID principles

# General Instructions

- Use yarn as package manager
- Always `yarn verify` and run related tests after code changes
- Favor `@/*` path aliases over relative imports; single-level `./` is fine
- Always use `.js` extensions in imports (compiled output), never `.ts`

# Monorepo Structure

- Yarn workspaces + Turbo: `packages/{core, cli, server, slack, web}`
- Only `@jonit-dev/night-watch-cli` (cli) is published; others are private
- Cross-package imports: `import { X } from '@night-watch/core/module.js'`

# TypeScript

- Strict mode enabled, decorators enabled
- Use `interface` (not `type`) for object shapes — enforced by eslint
- Prefix interfaces with `I`: `IAgentPersona`, `INightWatchConfig`
- Unused vars: prefix with `_` to suppress warnings
- Prefer const arrays over enums: `['claude', 'codex'] as const`

# DI (tsyringe)

- Token-based registration in `packages/core/src/di/container.ts`
- `@injectable()` on classes, `@inject('Token')` for non-class deps
- Repositories registered as singletons
- Import `reflect-metadata` only at entrypoints (cli.ts, test setup), not in every file
- `getRepositories()` factory for backward compat

# File & Code Conventions

- File names: kebab-case (`agent-persona.repository.ts`, `soul-compiler.ts`)
- Tests: vitest, in `src/__tests__/`, files named `*.test.ts`
- Barrel exports: selective re-exports in `index.ts`, avoid `export *` from subdirs
- Separate `export type { }` from value exports
- Constants centralized in `constants.ts` with `DEFAULT_*` / `VALID_*` prefixes
- `sort-imports` enforced (sort specifiers, not declarations)

# Repository Pattern

- Define interface in `storage/repositories/interfaces.ts`
- Implement in `storage/repositories/sqlite/`
- Wire via DI container or `getRepositories()` factory

# Testing

- Framework: vitest with `forks` pool
- Import `reflect-metadata` first in tests using DI
- Reset container between tests: `container.reset()`
- Use temp dirs for DB isolation, clean up in `afterEach`
