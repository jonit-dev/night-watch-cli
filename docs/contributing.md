# Contributing

## Development Setup

```bash
git clone https://github.com/jonit-dev/night-watch-cli.git
cd night-watch-cli
yarn install
```

## Build

```bash
yarn build          # Build all packages (via Turbo)
yarn verify         # Type-check + lint (no emit)
```

## Test

```bash
yarn test           # Run all tests
yarn vitest run packages/core/src/__tests__/  # Run specific package tests
```

## Run in Development

```bash
yarn dev -- init              # Run CLI from source (no build needed)
yarn dev -- run --dry-run     # Preview execution
yarn dev:web                  # Start web UI dev server
```

## Local CLI Testing

```bash
yarn local          # Build + link globally
night-watch status  # Test from any directory
yarn unlink         # Remove global symlink
```

See [Local Testing](local-testing.md) for details.

---

## Code Conventions

- **Package manager**: yarn (not npm)
- **File names**: kebab-case (`agent-persona.repository.ts`)
- **Interfaces**: Prefix with `I` (`IAgentPersona`)
- **Imports**: Use `.js` extensions, `@night-watch/*` for cross-package
- **Tests**: Vitest, in `src/__tests__/`, files named `*.test.ts`
- Always run `yarn verify` before committing

See [DEV-ONBOARDING](DEV-ONBOARDING.md) for the full conventions guide.

---

## Pre-Commit Hooks

Husky + lint-staged runs automatically:

- TypeScript/JavaScript: ESLint --fix + Prettier --write
- JSON/Markdown/YAML: Prettier --write

---

## Publishing (For Maintainers)

```bash
# 1. Bump version in packages/cli/package.json
# 2. Build and test
yarn build
yarn test

# 3. Publish to npm
cd packages/cli
npm publish --access public
```

The `prepublishOnly` script ensures build + test pass before publishing.

---

## Architecture Docs

- [DEV-ONBOARDING](DEV-ONBOARDING.md) — Getting started guide
- [Architecture Overview](architecture-overview.md) — System diagrams
- [Build Pipeline](build-pipeline.md) — Build, bundle, CI/CD
- [Core Package](core-package.md) — Domain logic deep-dive
- [CLI Package](cli-package.md) — Commands and integration
- [Server API](server-api.md) — REST endpoint reference
