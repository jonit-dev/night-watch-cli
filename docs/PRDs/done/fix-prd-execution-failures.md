# PRD: Fix PRD Execution Failures

**Complexity:** 5 (MEDIUM mode)
**Priority:** Critical — blocks all automated PRD execution

---

## Problem Statement

PRD execution is failing consistently across projects (night-watch-cli, autopilotrank.com) with three distinct root causes identified from log analysis:

### Root Cause 1: Rate-limit fallback double-failure (Critical)

When the proxy returns 429, the system correctly triggers a native Claude fallback. **However, if native Claude is also rate-limited**, the fallback exits with code 1 and the system records `provider_exit` instead of `rate_limited`.

**Evidence from `logs/executor.log`:**

```
API Error: 429 {"error":{"code":"1308","message":"Usage limit reached for 5 hour..."}}
RATE-LIMITED: Proxy quota exhausted — triggering native Claude fallback
RATE-LIMIT-FALLBACK: Running native Claude (claude-sonnet-4-6)
You've hit your limit · resets Mar 8, 3pm (America/Los_Angeles)
RATE-LIMIT-FALLBACK: Native Claude exited with code 1 elapsed=4s
FAIL: Night watch exited with code 1 while processing 69-ux-revamp...
```

**Impact:** The system records a `failure` with `reason=provider_exit` instead of `rate_limited`, which:

- Triggers a long cooldown (max_runtime-based) instead of a rate-limit-appropriate retry
- Sends misleading failure notifications
- Prevents the PRD from being retried once the rate limit resets

### Root Cause 2: `latest_failure_detail()` reads stale log lines (Medium)

The function scans `tail -50` of the shared `executor.log` file, but log entries from **previous runs** can bleed into the current run's error detail.

**Evidence:** Issue #70's failure detail contains issue #69's error message:

```
detail=[2026-03-07 00:40:59] [PID:75449] FAIL: Night watch exited with code 1 while processing 69-ux-revamp...
```

This happens because the log is append-only and `latest_failure_detail()` doesn't scope to the current PID or run.

### Root Cause 3: `failure_no_pr_after_success` on already-merged work (Low)

In filesystem mode, `code-cleanup-q1-2026.md` was selected and executed despite the work already being merged to master. Claude correctly identified the work was done but didn't create a PR. The cron script then recorded `failure_no_pr_after_success`.

**Evidence:**

```
OUTCOME: exit_code=0 total_elapsed=363s prd=code-cleanup-q1-2026.md
WARN: claude exited 0 but no open/merged PR found on night-watch/code-cleanup-q1-2026
```

This is a pre-existing filesystem mode issue (stale PRDs not moved to `done/`).

---

## Proposed Fixes

### Phase 1: Detect rate-limit in fallback path (Critical fix)

**Files:** `scripts/night-watch-cron.sh`

After the native Claude fallback runs (line ~626), check if the fallback also hit a rate limit before falling through to the generic failure handler.

**Implementation:**

1. After `RATE_LIMIT_FALLBACK_TRIGGERED` block (lines 603-632), if `EXIT_CODE != 0`, scan fallback output for rate-limit indicators (`"hit your limit"`, `429`, `"Usage limit"`)
2. If detected, set a new flag `DOUBLE_RATE_LIMITED=1`
3. In the outcome handler (lines 711-726), when `DOUBLE_RATE_LIMITED=1`:
   - Record outcome as `rate_limited` (not `failure`)
   - Log `RATE-LIMITED: Both proxy and native Claude are rate-limited`
   - Use the rate-limit cooldown (shorter) instead of failure cooldown

**Specific changes in `night-watch-cron.sh`:**

After line 632 (`fi` closing the fallback block), add:

```bash
# Detect double rate-limit: both proxy AND native Claude exhausted
DOUBLE_RATE_LIMITED=0
if [ "${RATE_LIMIT_FALLBACK_TRIGGERED}" = "1" ] && [ ${EXIT_CODE} -ne 0 ]; then
  if check_rate_limited "${LOG_FILE}" "${LOG_LINE_BEFORE}"; then
    DOUBLE_RATE_LIMITED=1
    log "RATE-LIMITED: Both proxy and native Claude are rate-limited for ${ELIGIBLE_PRD}"
  fi
fi
```

In the outcome handler, add a new branch before the generic `else` on line 711:

```bash
elif [ "${DOUBLE_RATE_LIMITED}" = "1" ]; then
  if [ -n "${ISSUE_NUMBER}" ]; then
    "${NW_CLI}" board move-issue "${ISSUE_NUMBER}" --column "Ready" 2>>"${LOG_FILE}" || true
    "${NW_CLI}" board comment "${ISSUE_NUMBER}" \
      --body "Both proxy and native Claude are rate-limited. Will retry after reset (via ${EFFECTIVE_PROVIDER_LABEL})." 2>>"${LOG_FILE}" || true
  fi
  night_watch_history record "${PROJECT_DIR}" "${ELIGIBLE_PRD}" rate_limited --exit-code "${EXIT_CODE}" 2>/dev/null || true
  emit_result "rate_limited" "prd=${ELIGIBLE_PRD}|branch=${BRANCH_NAME}|reason=double_rate_limit"
```

### Phase 2: Scope `latest_failure_detail()` to current run (Medium fix)

**Files:** `scripts/night-watch-cron.sh`

Modify `latest_failure_detail()` to accept an optional `since_line` parameter that filters to only lines written during the current run.

**Implementation:**

1. Change `latest_failure_detail()` (lines 79-92) to accept a second parameter `since_line`
2. Use `tail -n +${since_line}` instead of `tail -50` when `since_line` is provided
3. At the call site (line 712), pass the `LOG_LINE_BEFORE` captured at the start of the current attempt

**Specific changes:**

Replace `latest_failure_detail()`:

```bash
latest_failure_detail() {
  local log_file="${1:?log_file required}"
  local since_line="${2:-0}"
  local summary=""

  if [ "${since_line}" -gt 0 ]; then
    summary=$(tail -n +"${since_line}" "${log_file}" 2>/dev/null \
      | grep -E 'fatal:|error:|ERROR:|FAIL:|WARN:' \
      | tail -1 || true)
  else
    summary=$(tail -50 "${log_file}" 2>/dev/null \
      | grep -E 'fatal:|error:|ERROR:|FAIL:|WARN:' \
      | tail -1 || true)
  fi

  if [ -z "${summary}" ]; then
    if [ "${since_line}" -gt 0 ]; then
      summary=$(tail -n +"${since_line}" "${log_file}" 2>/dev/null | tail -1 || true)
    else
      summary=$(tail -20 "${log_file}" 2>/dev/null | tail -1 || true)
    fi
  fi

  sanitize_result_value "${summary}"
}
```

Update call site at line 712:

```bash
PROVIDER_ERROR_DETAIL=$(latest_failure_detail "${LOG_FILE}" "${LOG_LINE_BEFORE}")
```

### Phase 3: Skip PRDs with existing merged branches (Low fix)

**Files:** `scripts/night-watch-cron.sh`

The pre-execution merged PR check at line 476 already handles board mode correctly. The filesystem mode issue is that stale PRDs in `docs/PRDs/night-watch/` aren't cleaned up.

**Implementation:**
This is already handled — the `code-cleanup-q1-2026.md` issue was a one-time stale file. No code change needed; the existing board mode adoption makes this obsolete. If filesystem mode persists, the merged-PR early exit at line 476 already catches it.

**No code change needed for this phase.**

---

## Acceptance Criteria

1. When both proxy and native Claude are rate-limited, the execution records `rate_limited` (not `failure/provider_exit`)
2. Failure detail strings only contain errors from the current execution run, not previous runs
3. All existing tests pass (`yarn verify` + smoke tests)
4. Rate-limited runs use shorter cooldown windows appropriate for rate limits

---

## Test Plan

1. **Unit test for double rate-limit detection:**
   - Mock `check_rate_limited` returning true after fallback
   - Verify `rate_limited` is emitted (not `failure`)
   - Verify `night_watch_history record ... rate_limited` is called

2. **Unit test for scoped `latest_failure_detail()`:**
   - Create a log file with entries from two different PIDs
   - Call `latest_failure_detail` with `since_line` pointing to the second run
   - Verify only the second run's error is returned

3. **Smoke test:** Run `night-watch-cron.sh` in dry-run mode and verify the new code paths parse correctly (no syntax errors)

---

## Files to Modify

| File                          | Change                                                               |
| ----------------------------- | -------------------------------------------------------------------- |
| `scripts/night-watch-cron.sh` | Add double-rate-limit detection, scope failure detail to current run |
