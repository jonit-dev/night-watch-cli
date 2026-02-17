# PRD: Crontab Sandbox Guard

**Depends on:** None (standalone safety fix)

**Complexity: 3 → LOW mode**

---

## Problem

The Night Watch agent (running with `--dangerously-skip-permissions`) can modify the host system's real crontab during PRD execution. When processing `03-day-to-day-operations.md`, the agent ran `night-watch install/uninstall` against the live crontab, and when it crashed due to a 429 rate limit, it left the crontab in an "uninstalled" state — permanently removing its own cron entries.

## Solution

- Add `NW_EXECUTION_CONTEXT=agent` env var set by both `buildEnvVars()` and `night-watch-cron.sh`
- Guard `writeCrontab()` to throw when this env var is set
- Single chokepoint — all crontab mutations flow through `writeCrontab()`

## Files Changed

- `src/utils/crontab.ts` — guard in `writeCrontab()`
- `src/commands/run.ts` — set `NW_EXECUTION_CONTEXT=agent` in env
- `scripts/night-watch-cron.sh` — `export NW_EXECUTION_CONTEXT=agent`
- `src/__tests__/utils/crontab.test.ts` — test for guard behavior
