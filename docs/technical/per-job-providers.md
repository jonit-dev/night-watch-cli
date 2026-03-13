# Per-Job Provider Configuration

> Related: [Configuration](../configuration.md) | [Provider Presets](provider-presets.md) | [Queue Modes](queue-modes.md)

Assign different AI providers to different job types for optimized cost, performance, or specialization.

---

## Overview

By default, all jobs use the global `provider` setting. With `jobProviders`, you can assign specific providers to individual job types.

```json
{
  "provider": "claude",
  "jobProviders": {
    "analytics": "claude-opus-4-6",
    "planner": "claude-sonnet-4-6",
    "qa": "codex"
  }
}
```

In this example:
- Executor uses `claude` (default)
- Reviewer uses `claude` (default)
- Analytics uses `claude-opus-4-6`
- Planner uses `claude-sonnet-4-6`
- QA uses `codex`

---

## Available Job Types

| Job Type | Description | Default Provider |
|----------|-------------|------------------|
| `executor` | PRD execution | global `provider` |
| `reviewer` | PR review | global `provider` |
| `qa` | Playwright testing | global `provider` |
| `audit` | Code quality audit | global `provider` |
| `analytics` | Amplitude analysis | global `provider` |
| `planner` | Roadmap slicing | global `provider` |

---

## Configuration

### Full Example

```json
{
  "provider": "claude",
  "jobProviders": {
    "executor": "claude-sonnet-4-6",
    "reviewer": "claude",
    "qa": "codex",
    "audit": "claude-sonnet-4-6",
    "analytics": "claude-opus-4-6",
    "planner": "claude-sonnet-4-6"
  }
}
```

### Cost Optimization

Use cheaper models for non-critical jobs:

```json
{
  "provider": "claude-opus-4-6",
  "jobProviders": {
    "qa": "claude-sonnet-4-6",
    "audit": "claude-sonnet-4-6",
    "analytics": "claude-sonnet-4-6"
  }
}
```

### Specialization

Use specialized providers for specific tasks:

```json
{
  "provider": "claude",
  "jobProviders": {
    "analytics": "claude-opus-4-6",
    "qa": "codex",
    "planner": "claude-sonnet-4-6"
  }
}
```

---

## Provider Resolution

When a job runs, Night Watch resolves the provider:

1. Check `jobProviders[jobType]` if set
2. Fall back to global `provider`
3. Look up preset by resolved ID
4. Execute with resolved preset

**Flowchart:**
```
job runs → jobProviders[jobType]? → yes → use preset
            ↓ no
         global provider → use preset
```

---

## Queue Integration

Per-job providers work seamlessly with [provider-aware queue mode](queue-modes.md):

```json
{
  "provider": "claude",
  "jobProviders": {
    "analytics": "claude-opus-4-6",
    "qa": "codex"
  },
  "queue": {
    "mode": "provider-aware",
    "providerBuckets": {
      "claude": { "maxConcurrency": 2 },
      "claude-opus-4-6": { "maxConcurrency": 1 },
      "codex": { "maxConcurrency": 1 }
    }
  }
}
```

**Execution behavior:**
- Executor, reviewer, planner → `claude` bucket (max 2 concurrent)
- Analytics → `claude-opus-4-6` bucket (max 1 concurrent)
- QA → `codex` bucket (max 1 concurrent)

---

## Common Patterns

### High-Quality Execution, Fast Review

```json
{
  "provider": "claude-opus-4-6",
  "jobProviders": {
    "reviewer": "claude-sonnet-4-6"
  }
}
```

### Specialized Analytics

```json
{
  "provider": "claude",
  "jobProviders": {
    "analytics": "claude-opus-4-6"
  }
}
```

### Fast QA, Careful Audit

```json
{
  "provider": "claude-sonnet-4-6",
  "jobProviders": {
    "qa": "claude",
    "audit": "claude-opus-4-6"
  }
}
```

### Multi-Provider Setup

```json
{
  "provider": "claude",
  "jobProviders": {
    "qa": "codex",
    "analytics": "glm-5"
  }
}
```

---

## Environment Variables

| Variable | Config Key |
|----------|------------|
| `NW_JOB_PROVIDER_EXECUTOR` | `jobProviders.executor` |
| `NW_JOB_PROVIDER_REVIEWER` | `jobProviders.reviewer` |
| `NW_JOB_PROVIDER_QA` | `jobProviders.qa` |
| `NW_JOB_PROVIDER_AUDIT` | `jobProviders.audit` |
| `NW_JOB_PROVIDER_ANALYTICS` | `jobProviders.analytics` |
| `NW_JOB_PROVIDER_PLANNER` | `jobProviders.planner` |

---

## Validation

Night Watch validates `jobProviders` on startup:

- Invalid job type → warning, ignored
- Invalid preset ID → error, must fix
- Valid configuration → jobs use assigned providers

---

## See Also

- [Provider Presets](provider-presets.md) - Available built-in and custom presets
- [Queue Modes](queue-modes.md) - Provider-aware concurrency control
- [Configuration](../configuration.md) - Complete configuration reference
