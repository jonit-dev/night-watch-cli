# Night Watch CLI

[![npm version](https://img.shields.io/npm/v/night-watch-cli.svg)](https://www.npmjs.com/package/night-watch-cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)

**Autonomous PRD execution using AI Provider CLIs + cron**

Night Watch is a battle-tested autonomous PRD executor that uses AI provider CLIs (Claude CLI or Codex) + cron to implement PRD tickets, open PRs, and fix CI failures — all while you sleep.

---

## Table of Contents

- [Quick Start](#quick-start)
- [Supported Providers](#supported-providers)
- [Using GLM-5 or Custom Endpoints](#using-glm-5-or-custom-endpoints)
- [Installation](#installation)
- [Documentation](#documentation)
- [License](#license)

---

## Quick Start

```bash
# 1. Install globally
npm install -g night-watch-cli

# 2. Initialize in your project
cd your-project
night-watch init

# 3. Check provider detection
night-watch run --dry-run

# 4. Add your PRD files
echo "# My First PRD\n\nImplement feature X..." > docs/PRDs/night-watch/my-feature.md

# 5. Run or install cron
night-watch run           # Run once
night-watch install       # Setup automated cron
```

---

## Supported Providers

| Provider | CLI Command | Auto-Mode Flag | Slash Commands |
|----------|-------------|----------------|----------------|
| `claude` | `claude` | `--dangerously-skip-permissions` | `-p "/command-name"` |
| `codex` | `codex` | `--yolo` | `--prompt "text"` |

- Default provider is `claude`
- Change with `--provider codex` flag or `"provider": "codex"` in config

---

## Using GLM-5 or Custom Endpoints

Night Watch supports passing custom environment variables to the provider CLI via the `providerEnv` config field. This lets you point the Claude CLI at any Anthropic-compatible endpoint — including **GLM-5**.

Add `providerEnv` to your `night-watch.config.json`:

```json
{
  "provider": "claude",
  "providerEnv": {
    "ANTHROPIC_API_KEY": "your-glm5-api-key",
    "ANTHROPIC_BASE_URL": "https://your-glm5-endpoint.example.com"
  }
}
```

These variables are:
- **Injected into the provider CLI process** at runtime (`night-watch run`, `night-watch review`)
- **Exported in cron entries** when you run `night-watch install`, so automated runs also pick them up
- **Visible in `--dry-run` output** for easy debugging

### Common Use Cases

| Use Case | Environment Variables |
|----------|----------------------|
| GLM-5 via custom endpoint | `ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL` |
| Proxy / VPN routing | `HTTPS_PROXY`, `HTTP_PROXY` |
| Custom model selection | Any provider-specific env var |

See [Configuration > Provider Environment](docs/configuration.md#provider-environment-providerenv) for full details.

---

## Installation

### npm (Recommended)

```bash
npm install -g night-watch-cli
```

### npx (No install)

```bash
npx night-watch-cli init
```

### From Source

```bash
git clone https://github.com/jonit-dev/night-watch-cli.git
cd night-watch-cli
npm install && npm run build && npm link
```

---

## Documentation

| Document | Description |
|----------|-------------|
| [Commands Reference](docs/commands.md) | All CLI commands and their options |
| [Configuration](docs/configuration.md) | Config file, environment variables, CLI flags, `providerEnv` |
| [PRD Format](docs/prd-format.md) | How to write PRDs, dependencies, lifecycle |
| [Architecture](docs/architecture.md) | System design, execution flows, project structure |
| [Troubleshooting](docs/troubleshooting.md) | Common errors and how to fix them |
| [Contributing](docs/contributing.md) | Development setup, building, testing, publishing |

---

## License

MIT License - see [LICENSE](LICENSE) for details.
