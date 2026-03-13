# Queue Modes

> Related: [Configuration](../configuration.md) | [Scheduling Architecture](../scheduler-architecture.md)

Night Watch supports multiple queue execution strategies for managing concurrent job execution across providers.

---

## Overview

The queue system controls how jobs are dispatched and executed. You can configure the queue behavior through the `queue` section in your `night-watch.config.json`.

```json
{
  "queue": {
    "enabled": true,
    "mode": "provider-aware",
    "maxConcurrency": 1,
    "maxWaitTime": 7200,
    "priority": {
      "executor": 50,
      "reviewer": 40,
      "qa": 30,
      "audit": 20,
      "analytics": 10,
      "planner": 5
    },
    "providerBuckets": {
      "claude": { "maxConcurrency": 2 },
      "codex": { "maxConcurrency": 1 }
    }
  }
}
```

---

## Queue Modes

### `conservative` (Serial Execution)

Jobs execute one at a time, in order. This is the safest mode and ensures no concurrent API calls.

**When to use:**
- Rate-limited APIs
- Debugging job failures
- Single-provider setups
- Testing and development

**Behavior:**
- Jobs queue up and execute sequentially
- No parallel execution even with multiple providers
- Predictable execution order

### `provider-aware` (Parallel by Provider)

Jobs execute in parallel across different providers, with per-provider concurrency limits.

**When to use:**
- Multiple provider configurations
- Provider-specific rate limits
- Optimizing throughput across APIs

**Behavior:**
- Each provider has its own concurrency bucket
- Jobs for `claude` execute independently from `codex`
- Configure `providerBuckets` to control per-provider limits

**Example:**
```json
{
  "queue": {
    "mode": "provider-aware",
    "providerBuckets": {
      "claude": { "maxConcurrency": 3 },
      "codex": { "maxConcurrency": 2 }
    }
  }
}
```

### `auto` (Automatic)

Night Watch automatically selects the best mode based on your configuration.

**Behavior:**
- Uses `provider-aware` when multiple providers are configured with `providerBuckets`
- Falls back to `conservative` for single-provider setups

**When to use:**
- Most users
- Dynamic provider configurations
- "Set it and forget it"

---

## Configuration Options

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable/disable the queue system |
| `mode` | string | `"auto"` | Queue mode: `conservative`, `provider-aware`, or `auto` |
| `maxConcurrency` | number | `1` | Global max concurrent jobs (conservative mode) |
| `maxWaitTime` | number | `7200` | Max wait time in seconds before job expires |
| `priority` | object | (see defaults) | Job type priority for queue ordering |
| `providerBuckets` | object | `{}` | Per-provider concurrency limits |

---

## Job Priority

Jobs with higher priority values execute first. Default priorities:

| Job Type | Default Priority |
|----------|-----------------|
| `executor` | 50 |
| `reviewer` | 40 |
| `qa` | 30 |
| `audit` | 20 |
| `analytics` | 10 |
| `planner` | 5 |

Customize priorities in your config:

```json
{
  "queue": {
    "priority": {
      "executor": 100,
      "reviewer": 90,
      "analytics": 10
    }
  }
}
```

---

## Provider Buckets

Configure per-provider concurrency limits for `provider-aware` mode:

```json
{
  "queue": {
    "mode": "provider-aware",
    "providerBuckets": {
      "claude": { "maxConcurrency": 3 },
      "claude-opus-4-6": { "maxConcurrency": 1 },
      "codex": { "maxConcurrency": 2 }
    }
  }
}
```

**Bucket Resolution:**
- Jobs specify their provider (via `jobProviders` or default)
- Queue looks up matching bucket by preset ID
- Falls back to provider base name (`claude-opus-4-6` → `claude`)

**Example:**
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

In this configuration:
- Executor jobs use `claude` bucket (max 2 concurrent)
- Analytics jobs use `claude-opus-4-6` bucket (max 1 concurrent)
- QA jobs use `codex` bucket (max 1 concurrent)

---

## Environment Variables

| Variable | Config Key |
|----------|------------|
| `NW_QUEUE_ENABLED` | `queue.enabled` |
| `NW_QUEUE_MODE` | `queue.mode` |
| `NW_QUEUE_MAX_CONCURRENCY` | `queue.maxConcurrency` |
| `NW_QUEUE_MAX_WAIT_TIME` | `queue.maxWaitTime` |

---

## Queue Status CLI

Check queue status:

```bash
night-watch queue status
```

View analytics:

```bash
night-watch queue analytics
```

---

## See Also

- [Per-Job Providers](per-job-providers.md) - Assign providers to specific jobs
- [Provider Presets](provider-presets.md) - Built-in and custom provider configurations
- [Scheduler Architecture](../scheduler-architecture.md) - How scheduling works under the hood
