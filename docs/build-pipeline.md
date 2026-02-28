# Build Pipeline

How Night Watch is compiled, bundled, tested, and published.

> Related: [CLI Package](cli-package.md) | [DEV-ONBOARDING](DEV-ONBOARDING.md) | [Local Testing](local-testing.md)

---

## Overview

```mermaid
flowchart LR
    subgraph "Source"
        TS["TypeScript<br/>packages/*/src/"]
    end

    subgraph "Stage 1: Compile"
        TSC["tsc --build"]
        Alias["tsc-alias"]
    end

    subgraph "Stage 2: Bundle"
        ESB["esbuild<br/>(build.mjs)"]
    end

    subgraph "Stage 3: Copy Assets"
        Web["web/dist/ → dist/web/"]
        Scripts["scripts/ → dist/scripts/"]
        Templates["templates/ → dist/templates/"]
    end

    subgraph "Output"
        Bundle["dist/cli.js<br/>(single file)"]
        Assets["dist/web/<br/>dist/scripts/<br/>dist/templates/"]
    end

    TS --> TSC --> Alias --> ESB
    ESB --> Bundle
    ESB --> Web & Scripts & Templates
    Web & Scripts & Templates --> Assets
```

---

## Build Stages

### Stage 1: TypeScript Compilation

```bash
tsc --build          # Compile all packages (incremental)
tsc-alias            # Resolve @night-watch/* path aliases to relative paths
```

TypeScript uses project references (`tsconfig.json` → `references`). Each package has its own `tsconfig.json` extending the shared `tsconfig.base.json`.

**Base config** (`tsconfig.base.json`):

- Target: ES2022
- Module: NodeNext
- Strict mode: true
- Decorators + decorator metadata: enabled (for tsyringe)

### Stage 2: esbuild Bundling

**File:** `packages/cli/build.mjs`

The bundler inlines workspace packages and keeps npm dependencies external:

```mermaid
graph LR
    subgraph "Inlined (workspace)"
        Core["@night-watch/core"]
        Server["@night-watch/server"]
    end

    subgraph "External (npm)"
        SQLite["better-sqlite3"]
        Express["express"]
        Commander["commander"]
        Blessed["blessed"]
        SlackSDK["@slack/*"]
    end

    Entry["dist/cli.js<br/>(tsc output)"] --> ESBuild
    Core --> ESBuild
    Server --> ESBuild
    ESBuild --> Bundle["dist/cli.js<br/>(bundled)"]
```

**Key esbuild options:**

- **Entry:** `dist/cli.js`
- **Platform:** Node.js ESM
- **Packages:** `'external'` — npm dependencies NOT bundled
- **Banner:** `import 'reflect-metadata'` injected first (tsyringe requires it)
- **Minification:** Disabled (debuggability)
- **Source maps:** Disabled

**Custom workspace plugin:** Resolves `@night-watch/*` imports to their pre-compiled `dist/` files. Supports both package-level (`@night-watch/core`) and subpath (`@night-watch/core/notify.js`) imports.

### Stage 3: Asset Copying

After bundling, three asset directories are copied into `dist/`:

| Source       | Destination       | Purpose                    |
| ------------ | ----------------- | -------------------------- |
| `web/dist/`  | `dist/web/`       | Web dashboard static files |
| `scripts/`   | `dist/scripts/`   | Bash cron scripts          |
| `templates/` | `dist/templates/` | PRD templates              |

All copies use `dereference: true` for symlink resolution.

---

## Build Commands

```bash
# Build everything (all packages via Turbo)
yarn build

# Type-check only (no emit)
yarn verify

# Build CLI package specifically
cd packages/cli && yarn build

# Development mode (no build, runs from source via tsx)
yarn dev -- run --dry-run
```

---

## Turbo Task Graph

**File:** `turbo.json`

```mermaid
graph TD
    Build["build"]
    Test["test"]
    Verify["verify"]

    Build -->|"^build (deps first)"| Build
    Test -->|"build + ^build"| Build
    Verify -->|"^build"| Build
```

- `build` depends on `^build` (upstream packages build first)
- `test` depends on local `build` + upstream `^build`
- `verify` depends on upstream `^build` only
- Outputs cached: `dist/**`

---

## CI/CD Pipeline

### GitHub Actions

```mermaid
flowchart TD
    subgraph "ci.yml (Push to main / PRs)"
        Install1["yarn install --frozen-lockfile"]
        Verify["yarn verify"]
        Test1["yarn test"]
        Install1 --> Verify --> Test1
    end

    subgraph "tests.yml"
        Install2["yarn install"]
        Test2["yarn test"]
        Smoke["core-flow-smoke.test.ts"]
        Install2 --> Test2 & Smoke
    end

    subgraph "code-quality.yml"
        Lint["yarn lint"]
        TSC["TypeScript check"]
        WebLint["web: lint + typecheck"]
        Lint & TSC & WebLint
    end

    subgraph "pr-review.yml"
        AIReview["AI Review<br/>(GLM-5 / GPT-5.2)"]
    end
```

**PR Review Bot:** Uses `jonit-dev/openrouter-github-action` with GLM-5 model. Scores PRs on a 0-100 scale. PRs scoring below `minReviewScore` (default 80) are flagged.

### Pre-Commit Hooks

Husky + lint-staged runs on every commit:

- TypeScript/JavaScript: ESLint --fix + Prettier --write
- JSON/Markdown/YAML: Prettier --write

---

## Publishing to npm

```mermaid
sequenceDiagram
    participant Dev as Developer
    participant Pkg as package.json
    participant Build as Build Pipeline
    participant Test as Test Suite
    participant NPM as npm Registry

    Dev->>Pkg: Bump version
    Dev->>Build: yarn build
    Build->>Build: tsc → tsc-alias → esbuild
    Dev->>Test: yarn test
    Test-->>Dev: All pass
    Dev->>NPM: npm publish --access public
    Note over NPM: @jonit-dev/night-watch-cli@x.y.z
```

The `prepublishOnly` script ensures build + test pass before publishing.

**Published files:**

```
dist/            # Bundled CLI + assets
bin/             # night-watch.mjs entry point
scripts/         # Bash cron scripts
templates/       # PRD templates
```

**Not published:** `src/`, tests, tsconfig, dev dependencies.

---

## Known Gotchas

### Stale `.tsbuildinfo`

TypeScript incremental caches can mask stale builds. Delete and rebuild:

```bash
find . -name '*.tsbuildinfo' -delete
yarn build
```

### `import.meta.url` in Bundled Code

After esbuild inlines workspace packages, `import.meta.url` resolves to the bundle file (`dist/cli.js`), not the original source file. Use directory traversal from the known bundle location instead of relative `../..` paths.

### `better-sqlite3` Must Stay External

It ships with a native `.node` binary that cannot be bundled by esbuild. It remains an npm dependency that users install normally.

### `reflect-metadata` Banner

tsyringe requires `reflect-metadata` imported before any decorated class. The esbuild banner ensures this runs first in the bundle:

```javascript
banner: {
  js: "import 'reflect-metadata';";
}
```

---

## Related Docs

- [CLI Package](cli-package.md) — What gets built
- [Local Testing](local-testing.md) — Testing without publishing
- [DEV-ONBOARDING](DEV-ONBOARDING.md) — Getting started
- [Contributing](contributing.md) — Development workflow
