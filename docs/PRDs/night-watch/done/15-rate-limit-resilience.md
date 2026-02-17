# PRD: Rate Limit Resilience

**Depends on:** None (standalone reliability fix)

**Complexity: 4 → MEDIUM mode**

---

## Problem

When the API provider returns a 429 rate limit, the night-watch agent crashes immediately with exit code 1 and waits up to an hour for the next cron tick to retry. Multiple projects sharing the same API account also fire at the same minute, competing for the same rate limit window.

## Solution

### Phase 1: Retry with backoff
- Wrap provider invocation in a retry loop (max `NW_MAX_RETRIES`, default 3)
- Detect 429 by checking log for the pattern after failure
- Exponential backoff: 5min → 10min → 20min
- Timeouts and non-429 failures do NOT retry

### Phase 2: Schedule offset
- New `cronScheduleOffset` config field (0-59 minutes)
- Applied during `night-watch install` — replaces minute field in cron expressions
- e.g. `"cronScheduleOffset": 15` → cron entries fire at :15 instead of :00

## Files Changed

- `scripts/night-watch-cron.sh` — retry loop
- `scripts/night-watch-helpers.sh` — `check_rate_limited()` helper
- `src/commands/run.ts` — pass `NW_MAX_RETRIES`
- `src/types.ts` — `cronScheduleOffset`, `maxRetries` fields
- `src/constants.ts` — defaults
- `src/config.ts` — config loading + env var support
- `src/commands/install.ts` — `applyScheduleOffset()` + wiring
- `src/__tests__/commands/run.test.ts` — tests for offset + env vars
