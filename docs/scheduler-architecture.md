# Scheduler Architecture

The global job queue prevents API rate-limiting and coordinates concurrent execution across multiple Night Watch projects. It supports two dispatch modes: **conservative** (serial, default) and **provider-aware** (parallel with capacity budgets).

---

## Component Overview

```mermaid
graph TD
    subgraph CLI["packages/cli"]
        QC["queue command\nqueue.ts"]
        EB["env-builder.ts\nbuildQueuedJobEnv()"]
    end

    subgraph Core["packages/core"]
        JQ["job-queue.ts\nenqueueJob / dispatchNextJob\ngetQueueStatus / getJobRunsAnalytics"]
        CFG["config.ts\nloadConfig()"]
        CONSTS["constants.ts\nDEFAULT_QUEUE_*\nresolveProviderBucketKey()"]
        SCHED["scheduling.ts\ngetSchedulingPlan()\nnormalizeSchedulingPriority()"]
    end

    subgraph Server["packages/server"]
        QR["queue.routes.ts\nGET /api/queue/status\nGET /api/queue/analytics"]
    end

    subgraph Web["web/"]
        SP["Scheduling.tsx\nQueue Overview\nProvider Lanes\nRecent Runs"]
        API["api.ts\nfetchQueueStatus()\nfetchQueueAnalytics()"]
    end

    subgraph DB["SQLite (~/.night-watch/state.db)"]
        JQT["job_queue table"]
        JRT["job_runs table"]
    end

    subgraph Cron["Cron Scripts (bash)"]
        CS["night-watch-*-cron.sh"]
    end

    CS -->|"queue can-start?"| QC
    CS -->|"queue enqueue"| QC
    CS -->|"queue dispatch"| QC
    QC --> JQ
    QC --> EB
    EB --> CFG
    JQ --> DB
    JQ --> CONSTS
    JQ --> SCHED
    QR --> JQ
    API --> QR
    SP --> API
```

---

## Job Lifecycle

```mermaid
stateDiagram-v2
    [*] --> pending: enqueueJob()

    pending --> dispatched: dispatchNextJob()\n[capacity OK]
    pending --> expired: expireStaleJobs()\n[waited > maxWaitTime]

    dispatched --> running: markJobRunning()\n[process spawned]
    dispatched --> expired: expireStaleJobs()\n[never picked up]

    running --> [*]: removeJob()\n[job completed]
    running --> expired: expireStaleJobs()\n[timed out]

    expired --> [*]: cleanupExpiredJobs()
```

---

## Dispatch Flow

```mermaid
flowchart TD
    Start([dispatchNextJob called]) --> Expire[expireStaleJobs]
    Expire --> CountInFlight[Count in-flight jobs\nstatus = running OR dispatched]
    CountInFlight --> GlobalLimit{inFlightCount >= maxConcurrency?}

    GlobalLimit -->|Yes| ReturnNull1([return null\nlogged: concurrency limit])
    GlobalLimit -->|No| CheckMode{mode?}

    CheckMode -->|conservative| SelectTop[selectNextPendingEntry\none head per project\nsorted by priority + scheduling priority]
    SelectTop --> HasEntry1{entry found?}
    HasEntry1 -->|No| ReturnNull2([return null\nlogged: no pending jobs])
    HasEntry1 -->|Yes| MarkDispatch1[UPDATE status = dispatched\nlogged: dispatched conservative]
    MarkDispatch1 --> ReturnEntry1([return entry])

    CheckMode -->|provider-aware| GetCandidates[getAllPendingCandidates\none head per project\nsorted by priority + scheduling priority]
    GetCandidates --> HasCandidates{any candidates?}
    HasCandidates -->|No| ReturnNull3([return null\nlogged: no pending jobs])
    HasCandidates -->|Yes| IterateCandidates[For each candidate...]

    IterateCandidates --> FitsCapacity{bucket configured?}
    FitsCapacity -->|No bucket assigned| PassThrough([return true\nno per-bucket check])
    FitsCapacity -->|Bucket not configured| PassThrough
    FitsCapacity -->|Check bucket| BC1{inFlightCount >= maxConcurrency?}
    BC1 -->|Yes| Reject1([return false\nlogged: concurrency limit])
    BC1 -->|No| PassBucket([return true\nlogged: capacity check passed])

    PassThrough --> Fits
    PassBucket --> Fits
    Fits{fits?} -->|Yes| MarkDispatch2[UPDATE status = dispatched\nlogged: dispatched provider-aware]
    MarkDispatch2 --> ReturnEntry2([return entry])
    Fits -->|No| NextCandidate[next candidate]
    NextCandidate --> IterateCandidates
    Fits -->|all exhausted| ReturnNull4([return null\nlogged: all candidates blocked])
```

---

## Cross-Project Cron Balancing

When multiple projects share the same job type and cron schedule, `getSchedulingPlan()` staggers their start times to avoid simultaneous execution.

```mermaid
flowchart LR
    subgraph Inputs
        A["Current project config\n(schedulingPriority 1–5)"]
        B["Registry: all projects\nwith same jobType enabled"]
    end

    subgraph Calculation
        C["Sort projects by\npriority DESC, name ASC"]
        D["slotIndex = position in sorted list"]
        E["balancedDelay = slotIndex * 60min / totalPeers"]
        F["totalDelay = manualOffset + balancedDelay"]
    end

    subgraph Output
        G["ISchedulingPlan\n{ manualDelayMinutes\n  balancedDelayMinutes\n  totalDelayMinutes\n  peerCount\n  slotIndex }"]
    end

    A --> C
    B --> C
    C --> D
    D --> E
    E --> F
    F --> G
```

**Example** — 3 projects, executor at same cron:

| Project | Priority | slotIndex | balancedDelay |
|---------|----------|-----------|---------------|
| alpha   | 5        | 0         | 0 min         |
| beta    | 3        | 1         | 20 min        |
| gamma   | 1        | 2         | 40 min        |

---

## Database Schema

### `job_queue`

| Column            | Type    | Description                                          |
|-------------------|---------|------------------------------------------------------|
| `id`              | INTEGER | Auto-increment primary key                           |
| `project_path`    | TEXT    | Absolute path to project directory                   |
| `project_name`    | TEXT    | Human-readable project name                          |
| `job_type`        | TEXT    | `executor` \| `reviewer` \| `qa` \| `audit` \| `slicer` |
| `priority`        | INTEGER | Higher = dispatched first (default: executor=50)     |
| `status`          | TEXT    | `pending` → `dispatched` → `running` → (deleted) or `expired` |
| `env_json`        | TEXT    | Persisted NW_* runtime markers (NOT provider keys)   |
| `enqueued_at`     | INTEGER | Unix timestamp of enqueue                            |
| `dispatched_at`   | INTEGER | Unix timestamp of dispatch (nullable)                |
| `expired_at`      | INTEGER | Unix timestamp of expiry (nullable)                  |
| `provider_key`    | TEXT    | Provider bucket key e.g. `claude-native`, `codex`    |

Index: `(status, priority DESC, enqueued_at ASC)` — optimises dispatch query.

### `job_runs`

Telemetry table for analytics and UI charts. Written at job completion.

| Column           | Type    | Description                                           |
|------------------|---------|-------------------------------------------------------|
| `id`             | INTEGER | Auto-increment primary key                            |
| `project_path`   | TEXT    | Project directory                                     |
| `job_type`       | TEXT    | Job type                                              |
| `provider_key`   | TEXT    | Provider bucket key                                   |
| `queue_entry_id` | INTEGER | FK to `job_queue.id` (nullable if not queued)         |
| `status`         | TEXT    | `queued` \| `running` \| `success` \| `failure` \| `timeout` \| `rate_limited` \| `skipped` |
| `queued_at`      | INTEGER | When enqueued (nullable)                              |
| `started_at`     | INTEGER | When execution started                                |
| `finished_at`    | INTEGER | When execution finished (nullable)                    |
| `wait_seconds`   | INTEGER | Seconds from enqueue to start (nullable)              |
| `duration_seconds`| INTEGER | Execution duration in seconds (nullable)              |
| `throttled_count`| INTEGER | How many times this run was throttled                 |
| `metadata_json`  | TEXT    | Arbitrary JSON metadata                               |

Index: `(project_path, started_at DESC, job_type, provider_key)` — optimises analytics queries.

---

## Provider Bucket Resolution

Provider buckets isolate throttle domains so different API backends don't compete:

```mermaid
flowchart TD
    P{provider?} -->|codex| B1["bucket: 'codex'"]
    P -->|claude| C{ANTHROPIC_BASE_URL set?}
    C -->|No| B2["bucket: 'claude-native'"]
    C -->|Yes| B3["bucket: 'claude-proxy:<hostname>'"]
```

---

## Default Job Priorities

| Job Type  | Priority |
|-----------|----------|
| executor  | 50       |
| reviewer  | 40       |
| slicer    | 30       |
| qa        | 20       |
| audit     | 10       |

---

## Environment Variable Handling at Dispatch

A critical security/correctness invariant: provider identity is **never** stored in the queue.

```mermaid
flowchart LR
    subgraph Persisted["Stored in env_json"]
        E1["NW_DRY_RUN"]
        E2["NW_CRON_TRIGGER"]
        E3["NW_DEFAULT_BRANCH"]
    end

    subgraph NotPersisted["NOT stored — rebuilt at dispatch"]
        E4["ANTHROPIC_API_KEY"]
        E5["ANTHROPIC_BASE_URL"]
        E6["OPENAI_API_KEY"]
        E7["Model IDs"]
    end

    subgraph AtDispatch["Dispatch env assembly"]
        D1["process.env (dispatcher)"]
        D2["buildQueuedJobEnv(entry)\n→ loadConfig(entry.projectPath)\n→ buildBaseEnvVars(config)"]
        D3["filterQueueMarkers(entry.envJson)\nonly NW_* keys"]
        D4["NW_QUEUE_DISPATCHED=1\nNW_QUEUE_ENTRY_ID=<id>"]
    end

    D1 --> Merge[Merged env for spawned process]
    D2 --> Merge
    D3 --> Merge
    D4 --> Merge
```

This ensures multi-provider setups always run each job with its own project's provider config, regardless of which project triggered the dispatch.

---

## Key File Locations

| File | Purpose |
|------|---------|
| `packages/core/src/utils/job-queue.ts` | Core queue operations (enqueue, dispatch, expire, analytics) |
| `packages/core/src/utils/scheduling.ts` | Cross-project cron balancing (`getSchedulingPlan`) |
| `packages/core/src/types.ts` | `IQueueConfig`, `IQueueEntry`, `IQueueStatus`, `IJobRunAnalytics` |
| `packages/core/src/constants.ts` | Defaults, weights, `resolveProviderBucketKey` |
| `packages/core/src/config.ts` | `loadConfig`, `mergeConfigLayer` (deep-merges queue config) |
| `packages/core/src/storage/sqlite/migrations.ts` | `job_queue` and `job_runs` table DDL |
| `packages/cli/src/commands/queue.ts` | CLI subcommands (status, dispatch, enqueue, clear, expire) |
| `packages/cli/src/commands/shared/env-builder.ts` | `buildQueuedJobEnv` — env reconstruction at dispatch |
| `packages/server/src/routes/queue.routes.ts` | `GET /api/queue/status`, `GET /api/queue/analytics` |
| `web/pages/Scheduling.tsx` | Scheduling UI (overview cards, provider lanes, recent runs) |
| `docs/prds/provider-aware-weighted-scheduling.md` | Original design PRD |
