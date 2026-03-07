# PRD: Fix Executor Streaming Output Not Visible

**Complexity:** 2 → LOW mode

---

## 1. Context

**Problem:** When the executor launches `claude -p`, it logs "output will stream below" but no output actually streams to the terminal — all output is silently redirected to the log file via `>> "${LOG_FILE}" 2>&1`.

**Files Analyzed:**
- `scripts/night-watch-helpers.sh` — `log()` function (writes ONLY to file)
- `scripts/night-watch-cron.sh` — provider dispatch (lines 545-577, 624-637)
- `scripts/night-watch-audit-cron.sh` — provider dispatch (lines 163-189)
- `scripts/night-watch-qa-cron.sh` — provider dispatch (lines 595-635)
- `scripts/night-watch-pr-reviewer-cron.sh` — provider dispatch (lines 1075-1106)
- `packages/core/src/utils/shell.ts` — `executeScriptWithOutput()` (already streams child stdout/stderr to terminal)

**Current Behavior:**
- `log()` writes ONLY to `LOG_FILE` (`echo ... >> "${log_file}"`) — not to stdout or stderr
- Provider commands redirect ALL output to file: `claude -p ... >> "${LOG_FILE}" 2>&1`
- Node's `executeScriptWithOutput()` listens on the bash child's stdout/stderr pipes but receives nothing because the bash script sends everything to the file
- The terminal shows git worktree output (from git stderr before redirection), then goes silent

## 2. Solution

**Approach:**
- Replace `>> "${LOG_FILE}" 2>&1` with `2>&1 | tee -a "${LOG_FILE}"` for provider dispatch — output goes to both the log file AND stdout (which propagates through Node's pipe to the terminal)
- Modify `log()` to also write to stderr so diagnostic messages are visible in the terminal during interactive `night-watch run`
- All scripts already use `set -euo pipefail`, so pipe exit codes propagate correctly (if `claude` fails with code 1 and `tee` succeeds with 0, pipefail returns 1)

**Key Decisions:**
- `tee -a` (append mode) preserves the existing log file behavior
- Provider output goes to stdout via tee; diagnostic messages go to stderr via log — keeps them on separate channels
- No changes to `executeScriptWithOutput()` needed — it already streams both pipes to the terminal

---

## 3. Execution Phases

### Phase 1: Fix `log()` to also write to stderr + use `tee` for provider output

**Files (5):**
- `scripts/night-watch-helpers.sh` — make `log()` also write to stderr
- `scripts/night-watch-cron.sh` — replace `>> "${LOG_FILE}" 2>&1` with `2>&1 | tee -a "${LOG_FILE}"` (3 occurrences: main dispatch, codex dispatch, fallback)
- `scripts/night-watch-audit-cron.sh` — same replacement (2 occurrences)
- `scripts/night-watch-qa-cron.sh` — same replacement (2 occurrences: claude + codex)
- `scripts/night-watch-pr-reviewer-cron.sh` — same replacement (2 occurrences)

**Implementation:**

- [ ] In `night-watch-helpers.sh`, modify `log()` to also echo to stderr:
  ```bash
  log() {
    local log_file="${LOG_FILE:?LOG_FILE not set}"
    local elapsed_str=""
    if [ -n "${SCRIPT_START_TIME:-}" ]; then
      local _now _elapsed _emin _esec
      _now=$(date +%s)
      _elapsed=$(( _now - SCRIPT_START_TIME ))
      _emin=$(( _elapsed / 60 ))
      _esec=$(( _elapsed % 60 ))
      elapsed_str=" [+${_emin}m${_esec}s]"
    fi
    local msg="[$(date '+%Y-%m-%d %H:%M:%S')] [PID:$$]${elapsed_str} $*"
    echo "${msg}" >> "${log_file}"
    echo "${msg}" >&2
  }
  ```

- [ ] In `night-watch-cron.sh`, replace all 3 provider `>> "${LOG_FILE}" 2>&1` with `2>&1 | tee -a "${LOG_FILE}"`:
  - Line 551 (claude main dispatch)
  - Line 565 (codex main dispatch)
  - Line 632 (claude fallback dispatch)

- [ ] In `night-watch-audit-cron.sh`, replace 2 occurrences (lines 169, 183)

- [ ] In `night-watch-qa-cron.sh`, replace 2 occurrences (lines 601, 628)

- [ ] In `night-watch-pr-reviewer-cron.sh`, replace 2 occurrences (lines 1081, 1095)

**Pattern for each replacement:**

Before:
```bash
if (
  cd "${WORKTREE_DIR}" && timeout "${SESSION_MAX_RUNTIME}" \
    claude -p "${PROMPT}" \
      --dangerously-skip-permissions \
      >> "${LOG_FILE}" 2>&1
); then
```

After:
```bash
if (
  cd "${WORKTREE_DIR}" && timeout "${SESSION_MAX_RUNTIME}" \
    claude -p "${PROMPT}" \
      --dangerously-skip-permissions \
      2>&1 | tee -a "${LOG_FILE}"
); then
```

**Exit code behavior with `pipefail`:**
- All scripts use `set -euo pipefail` (line 2)
- If `timeout ... claude` exits 124 (timeout) and `tee` exits 0 → pipe returns 124 ✓
- If `timeout ... claude` exits 1 (failure) and `tee` exits 0 → pipe returns 1 ✓
- If `timeout ... claude` exits 0 (success) and `tee` exits 0 → pipe returns 0 ✓
- The `if (...); then` construct disables `set -e` for the condition, so non-zero exits are captured correctly

**Rate-limit detection still works:**
- `check_rate_limited` greps the LOG_FILE — `tee -a` still writes everything to the file, so this is unchanged

**Tests Required:**
| Test File | Test Name | Assertion |
|-----------|-----------|-----------|
| Manual | Smoke test: `bash -n scripts/night-watch-cron.sh` | No syntax errors |
| Manual | Smoke test: `bash -n scripts/night-watch-audit-cron.sh` | No syntax errors |
| Manual | Smoke test: `bash -n scripts/night-watch-qa-cron.sh` | No syntax errors |
| Manual | Smoke test: `bash -n scripts/night-watch-pr-reviewer-cron.sh` | No syntax errors |

**User Verification:**
- Action: Run `night-watch run` (or trigger executor)
- Expected: Diagnostic log messages AND claude's streaming output visible in the terminal in real time

---

## 4. Acceptance Criteria

- [ ] When `night-watch run` triggers the executor, claude's output streams to the terminal in real time
- [ ] Diagnostic `log()` messages are visible in the terminal (via stderr)
- [ ] Log file still captures all output (both diagnostic and provider)
- [ ] Exit codes propagate correctly (0, 1, 124 all handled)
- [ ] Rate-limit detection still works (log file content unchanged)
- [ ] All 4 scripts pass `bash -n` syntax check
- [ ] `yarn verify` passes

---

## Files to Modify

| File | Change |
|------|--------|
| `scripts/night-watch-helpers.sh` | `log()` also writes to stderr |
| `scripts/night-watch-cron.sh` | 3× replace `>> LOG 2>&1` with `2>&1 \| tee -a LOG` |
| `scripts/night-watch-audit-cron.sh` | 2× same replacement |
| `scripts/night-watch-qa-cron.sh` | 2× same replacement |
| `scripts/night-watch-pr-reviewer-cron.sh` | 2× same replacement |
