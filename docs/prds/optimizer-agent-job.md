# PRD: Optimizer Agent Job

**Complexity: 8 -> HIGH mode**

## Problem

Night Watch can execute PRDs, review PRs, run QA, audit code quality, and manage roadmap health, but it does not have a dedicated job that continuously finds major performance or algorithmic complexity bottlenecks and improves one proven opportunity at a time.

## Solution

- Add `optimizer` as a first-class Night Watch job with its own config, CLI command, schedule, logs, queue/status integration, web controls, and provider assignment.
- The Optimizer first performs a broad scan for major project bottlenecks, ranks the most promising leads, and selects one high-confidence target for the run.
- It only performs a surgical code change after it has established a baseline and can prove the change produces a better result through tests, benchmarks, profiling output, or a clearly comparable verification signal.
- It opens a dedicated draft PR only when verification passes; otherwise it writes a report and opens no PR.
- The v1 scope is performance and algorithmic complexity only, using a bundled template based on the Codex `complexity-optimizer` workflow.

## Integration Points

- Entry point: `night-watch optimize`
- Scheduled entry point: installed cron entry when `optimizer.enabled` is true
- API trigger: `/api/actions/optimize`
- Config key: `optimizer`
- Env prefix: `NW_OPTIMIZER`
- Log files: `logs/optimizer.log` and `logs/optimizer-report.md`
- Branch prefix: `night-watch/optimizer`
- Default PR label: `optimization`

## Public Interfaces

Add `IOptimizerConfig`:

```typescript
export interface IOptimizerConfig {
  enabled: boolean;
  schedule: string;
  maxRuntime: number;
  branchPrefix: string;
  prLabel: string;
  targetScope: string;
  maxFindingsToInspect: number;
  verificationCommand: string;
}
```

Defaults:

- `enabled: false`
- `schedule: '20 4 * * 2'`
- `maxRuntime: 0`
- `branchPrefix: 'night-watch/optimizer'`
- `prLabel: 'optimization'`
- `targetScope: ''`
- `maxFindingsToInspect: 5`
- `verificationCommand: ''`

An empty `targetScope` means scan the repo. An empty `verificationCommand` means use project test/build detection and existing verification conventions.

## Phases

### Phase 1: Registry, Types, and Config

- [ ] Add `optimizer` to core and shared `JobType` unions.
- [ ] Add `optimizer?: Provider` to `IJobProviders`.
- [ ] Add `IOptimizerConfig` and `optimizer` on `INightWatchConfig`.
- [ ] Register optimizer in `JOB_REGISTRY` with `cliCommand: 'optimize'`, `logName: 'optimizer'`, `lockSuffix: '-optimizer.lock'`, `queuePriority: 15`, and `envPrefix: 'NW_OPTIMIZER'`.
- [ ] Include optimizer in config normalization and env override paths.
- [ ] Add web-side default config helpers.
- [ ] Test registry inclusion, config defaults, and env overrides.

### Phase 2: CLI and Script Runner

- [ ] Implement `packages/cli/src/commands/optimize.ts`.
- [ ] Register `optimize` in `packages/cli/src/cli.ts`.
- [ ] Add `scripts/night-watch-optimizer-cron.sh`.
- [ ] Reuse existing helpers for provider command building, log rotation, queue handling, job pause checks, locking, worktree isolation, git pushing, and PR creation.
- [ ] Support `--dry-run`, `--json`, `--timeout`, `--provider`, and optional `--target-scope`.
- [ ] In dry-run mode, print provider, target scope, branch prefix, label, scanner command, verification command, and report path without mutating the repo.
- [ ] Test CLI help, dry-run, timeout override, provider override, disabled-job behavior, and result parsing.

### Phase 3: Bottleneck Scan and Proof Workflow

- [ ] Add a Night Watch-owned first-pass complexity scanner or package a scanner script so the job does not depend on a user-local Codex skill path.
- [ ] Add `templates/optimizer.md` and `templates/night-watch-optimizer.md`.
- [ ] The optimizer prompt must require this sequence:
  1. Detect stack, test commands, build commands, and performance-sensitive paths.
  2. Run the broad bottleneck scan across the target scope.
  3. Inspect up to `maxFindingsToInspect` top leads manually.
  4. Select exactly one target area with evidence that it matters.
  5. Establish a baseline using an existing benchmark, focused test timing, profiling signal, or a small reproducible measurement.
  6. Make a surgical optimization that preserves behavior and public APIs.
  7. Re-run the same measurement and verification.
  8. Commit and push only if the result is better and verification passes.
  9. Write `logs/optimizer-report.md` and stop if no safe proven improvement exists.
- [ ] The prompt must explicitly forbid broad rewrites, unrelated cleanup, speculative abstractions, and PRs without a passing proof signal.
- [ ] Test scanner invocation and no-safe-target report behavior.

### Phase 4: PR Creation and Abort Semantics

- [ ] Create optimizer branches as `night-watch/optimizer/<slug>`.
- [ ] Open a draft PR only when the worktree has commits, verification passed, and the before/after signal shows improvement.
- [ ] Apply the configured `prLabel`.
- [ ] Include in the PR body:
  - bottleneck summary
  - baseline evidence
  - change summary
  - after evidence
  - tests and verification run
  - residual risk
- [ ] On timeout, unsafe target, failed verification, or no measurable improvement, write `logs/optimizer-report.md`, emit a structured result, and open no PR.
- [ ] Test successful PR metadata parsing and abort/no-PR outcomes.

### Phase 5: Web, Scheduling, Status, and Logs

- [ ] Add optimizer to `web/utils/jobs.ts`.
- [ ] Add optimizer to schedule templates and advanced-job settings surfaces.
- [ ] Ensure dashboard status, scheduling timeline, log views, queue views, pause/resume, and manual trigger controls include optimizer.
- [ ] Add or verify `/api/actions/optimize` through registry-derived routing.
- [ ] Test Settings/Scheduling visibility and trigger endpoint mapping.

## Acceptance Criteria

- [ ] `night-watch optimize --dry-run` exits zero and performs no repo mutations.
- [ ] `optimizer.enabled` controls cron/schedule visibility like other advanced jobs.
- [ ] Each run starts with a broad scan for major bottlenecks before selecting a target.
- [ ] Each implementation run addresses exactly one target area.
- [ ] The job opens a PR only when it can show before/after improvement and all verification passes.
- [ ] Failed, unsafe, no-op, or unproven runs produce `logs/optimizer-report.md` and no PR.
- [ ] The Optimizer never edits the primary checkout directly.
- [ ] All added tests pass under `yarn verify`.

## Assumptions

- User-facing name is `Optimizer`.
- v1 scope is performance and algorithmic complexity only.
- The job is allowed to implement and open PRs, but only after proving a better result.
- Target selection is automatic by default, with optional configured target scope.
- The bundled scanner output is treated as leads, not proof; the agent must inspect and verify before editing.
