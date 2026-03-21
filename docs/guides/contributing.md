---
title: Contributing
description: How to contribute to Night Watch CLI
---

# Contributing

Thank you for your interest in contributing to Night Watch CLI!

## Development Setup

```bash
# Clone the repository
git clone <repo-url>
cd night-watch-cli

# Install dependencies
yarn install

# Run verification (type-check + lint)
yarn verify
```

## Running Tests

```bash
# Run all tests
yarn test

# Run tests in watch mode
yarn test:watch
```

## Code Style

- Use `yarn` as package manager
- Always run `yarn verify` after code changes
- Use `@/*` path aliases over relative imports
- Single-level `./` imports are fine
- Always use `.js` extensions in imports

## TypeScript Conventions

- Strict mode enabled
- Use `interface` (not `type`) for object shapes
- Prefix interfaces with `I`: `IAgentPersona`, `INightWatchConfig`
- Prefix unused vars with `_`
- Prefer const arrays over enums

## File Conventions

- File names: kebab-case (`agent-persona.repository.ts`)
- Tests: in `src/__tests__/`, named `*.test.ts`
- Barrel exports: selective re-exports in `index.ts`
- Constants in `constants.ts` with `DEFAULT_*` / `VALID_*` prefixes

## DI (tsyringe)

- Token-based registration in `packages/core/src/di/container.ts`
- `@injectable()` on classes
- `@inject('Token')` for non-class deps
- Import `reflect-metadata` only at entrypoints

## Submitting Changes

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run `yarn verify` and tests
5. Submit a pull request

## Branch Structure

- Only branch: `master` (local and remote)
- Feature branches off `master`
- PRs target `master`
