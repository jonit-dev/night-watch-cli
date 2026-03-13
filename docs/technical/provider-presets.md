# Provider Presets

> Related: [Configuration](../configuration.md) | [Per-Job Providers](per-job-providers.md)

Provider presets define how Night Watch invokes AI provider CLIs. Each preset specifies the command, flags, model, and environment variables for a provider.

---

## Built-in Presets

Night Watch includes 6 built-in provider presets:

| Preset ID | Name | Model | Description |
|-----------|------|-------|-------------|
| `claude` | Claude | (default) | Standard Claude CLI |
| `claude-sonnet-4-6` | Claude Sonnet 4.6 | claude-sonnet-4-6 | Claude Sonnet 4.6 model |
| `claude-opus-4-6` | Claude Opus 4.6 | claude-opus-4-6 | Claude Opus 4.6 model |
| `codex` | Codex | (default) | Codex CLI |
| `glm-47` | GLM-4.7 | glm-4.7 | GLM-4.7 via Claude CLI proxy |
| `glm-5` | GLM-5 | glm-5 | GLM-5 via Claude CLI proxy |

---

## Preset Configuration

Each preset defines:

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Human-readable name |
| `command` | string | CLI executable |
| `subcommand` | string | Optional subcommand (e.g., `exec` for Codex) |
| `promptFlag` | string | Flag for prompt input (e.g., `-p`) |
| `autoApproveFlag` | string | Flag to skip confirmations |
| `workdirFlag` | string | Flag for working directory |
| `modelFlag` | string | Flag for model selection |
| `model` | string | Model ID |
| `envVars` | object | Environment variables to set |

---

## Built-in Preset Details

### `claude`

```json
{
  "name": "Claude",
  "command": "claude",
  "promptFlag": "-p",
  "autoApproveFlag": "--dangerously-skip-permissions"
}
```

### `claude-sonnet-4-6`

```json
{
  "name": "Claude Sonnet 4.6",
  "command": "claude",
  "promptFlag": "-p",
  "autoApproveFlag": "--dangerously-skip-permissions",
  "modelFlag": "--model",
  "model": "claude-sonnet-4-6"
}
```

### `claude-opus-4-6`

```json
{
  "name": "Claude Opus 4.6",
  "command": "claude",
  "promptFlag": "-p",
  "autoApproveFlag": "--dangerously-skip-permissions",
  "modelFlag": "--model",
  "model": "claude-opus-4-6"
}
```

### `codex`

```json
{
  "name": "Codex",
  "command": "codex",
  "subcommand": "exec",
  "autoApproveFlag": "--yolo",
  "workdirFlag": "-C"
}
```

### `glm-47`

```json
{
  "name": "GLM-4.7",
  "command": "claude",
  "promptFlag": "-p",
  "autoApproveFlag": "--dangerously-skip-permissions",
  "modelFlag": "--model",
  "model": "glm-4.7",
  "envVars": {
    "ANTHROPIC_BASE_URL": "https://api.z.ai/api/anthropic",
    "API_TIMEOUT_MS": "3000000",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "glm-4.7",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "glm-4.7"
  }
}
```

### `glm-5`

```json
{
  "name": "GLM-5",
  "command": "claude",
  "promptFlag": "-p",
  "autoApproveFlag": "--dangerously-skip-permissions",
  "modelFlag": "--model",
  "model": "glm-5",
  "envVars": {
    "ANTHROPIC_BASE_URL": "https://api.z.ai/api/anthropic",
    "API_TIMEOUT_MS": "3000000",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "glm-5",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "glm-5"
  }
}
```

---

## Using Built-in Presets

Set your default provider:

```json
{
  "provider": "claude"
}
```

Or specify a model-specific preset:

```json
{
  "provider": "claude-opus-4-6"
}
```

---

## Custom Presets

Override a built-in preset or add your own in `night-watch.config.json`:

```json
{
  "providerPresets": {
    "my-custom-provider": {
      "name": "My Custom Provider",
      "command": "my-cli",
      "promptFlag": "--prompt",
      "autoApproveFlag": "--yes",
      "modelFlag": "--model",
      "model": "my-model-v1",
      "envVars": {
        "API_KEY": "your-key",
        "API_BASE": "https://api.example.com"
      }
    },
    "claude": {
      "name": "Claude (Custom)",
      "command": "claude",
      "promptFlag": "-p",
      "autoApproveFlag": "--dangerously-skip-permissions",
      "modelFlag": "--model",
      "model": "claude-sonnet-4-6",
      "envVars": {
        "ANTHROPIC_BASE_URL": "https://my-proxy.example.com"
      }
    }
  },
  "provider": "my-custom-provider"
}
```

---

## Preset Resolution

When you specify a provider, Night Watch:

1. Checks `providerPresets` for a matching ID
2. Falls back to built-in presets
3. Uses the preset to construct the CLI command

**Example resolution:**
- `provider: "claude-opus-4-6"` → uses built-in preset
- `provider: "my-custom-provider"` → uses custom preset from config
- `provider: "unknown"` → error (preset not found)

---

## Fallback Presets

Configure fallback providers for rate limit scenarios:

```json
{
  "provider": "claude-opus-4-6",
  "fallbackOnRateLimit": true,
  "primaryFallbackPreset": "claude-sonnet-4-6",
  "secondaryFallbackPreset": "glm-47"
}
```

**Fallback behavior:**
1. Primary provider hits rate limit
2. Switch to `primaryFallbackPreset`
3. If also rate-limited, switch to `secondaryFallbackPreset`
4. Continue with fallback until job completes

---

## Proxy Configuration

Many presets use `ANTHROPIC_BASE_URL` for proxy support:

```json
{
  "providerPresets": {
    "claude-via-proxy": {
      "name": "Claude via Proxy",
      "command": "claude",
      "promptFlag": "-p",
      "autoApproveFlag": "--dangerously-skip-permissions",
      "envVars": {
        "ANTHROPIC_BASE_URL": "https://my-proxy.example.com",
        "API_TIMEOUT_MS": "600000"
      }
    }
  }
}
```

---

## See Also

- [Per-Job Providers](per-job-providers.md) - Assign presets to specific jobs
- [Queue Modes](queue-modes.md) - Configure provider-aware concurrency
- [Configuration](../configuration.md) - Complete configuration reference
