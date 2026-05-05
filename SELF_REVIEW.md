# Self Review: Agent Manageability CLI

## Implementation

- Added `night-watch agent status --json` with `schemaVersion`, legacy status data, pause state, queue state, board summary, health checks, and recent run timestamps.
- Added `night-watch config list/get/set --json` with dot-path access, simple value parsing, config reload validation, and rollback on invalid persisted values.
- Added `night-watch health --json` with lightweight automation readiness checks and JSON-only stdout.
- Added `night-watch job pause/resume <job> --json`, persisted pause state under `pausedJobs`, and wired cron/queue entry points to skip paused jobs before starting new work.
- Documented the machine-readable CLI contract in `README.md` and `docs/reference/commands.md`; committed the PRD at `docs/prds/agent-manageability-cli.md`.

## Tests Run

- `yarn workspace @jonit-dev/night-watch-cli test src/__tests__/commands/agent.test.ts`
- `yarn workspace @jonit-dev/night-watch-cli test src/__tests__/commands/agent.test.ts src/__tests__/commands/status.test.ts src/__tests__/commands/queue.test.ts`
- `bash -n scripts/night-watch-cron.sh scripts/night-watch-pr-reviewer-cron.sh scripts/night-watch-qa-cron.sh scripts/night-watch-audit-cron.sh scripts/night-watch-slicer-cron.sh scripts/night-watch-plan-cron.sh scripts/night-watch-merger-cron.sh scripts/night-watch-pr-resolver-cron.sh scripts/night-watch-helpers.sh`
- `yarn lint` (passes with existing warnings)
- `yarn verify`
- `yarn workspace @jonit-dev/night-watch-cli build`

## Known Limitations

- `job pause` prevents new cron/queue-dispatched starts; it does not terminate a job that is already running.
- `agent status` includes board details only when a board is already configured. Provider/API errors are captured in `board.error` instead of failing the whole status snapshot.
- `lastRuns` is based on available job-run telemetry from the last 30 days; projects without telemetry return null timestamps.
