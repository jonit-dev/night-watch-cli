#!/usr/bin/env bash
set -euo pipefail

# Night Watch Cron Runner (project-agnostic)
# Usage: night-watch-cron.sh /path/to/project
# Finds the next eligible PRD and passes it to the configured AI provider for implementation.
#
# NOTE: This script expects environment variables to be set by the caller.
# The Node.js CLI will inject config values via environment variables.
# Required env vars (with defaults shown):
#   NW_MAX_RUNTIME=14400         - Maximum runtime in seconds (4 hours)
#   NW_PROVIDER_CMD=claude       - AI provider CLI to use (claude, codex, etc.)
#   NW_DRY_RUN=0                 - Set to 1 for dry-run mode (prints diagnostics only)

PROJECT_DIR="${1:?Usage: $0 /path/to/project}"
PROJECT_NAME=$(basename "${PROJECT_DIR}")
PRD_DIR_REL="${NW_PRD_DIR:-docs/PRDs/night-watch}"
if [[ "${PRD_DIR_REL}" = /* ]]; then
  PRD_DIR="${PRD_DIR_REL}"
else
  PRD_DIR="${PROJECT_DIR}/${PRD_DIR_REL}"
fi
LOG_DIR="${PROJECT_DIR}/logs"
LOG_FILE="${LOG_DIR}/executor.log"
MAX_RUNTIME="${NW_MAX_RUNTIME:-14400}"  # 4 hours — used for cooldowns and eligibility
SESSION_MAX_RUNTIME="${NW_SESSION_MAX_RUNTIME:-${MAX_RUNTIME}}"  # per-invocation timeout; defaults to MAX_RUNTIME
MAX_LOG_SIZE="524288"  # 512 KB
PROVIDER_CMD="${NW_PROVIDER_CMD:-claude}"
# Human-friendly provider label used in PR comments, board comments, and commit attribution.
# NW_PROVIDER_LABEL is set by the Node CLI (derived from config.providerLabel or auto-detected).
# EFFECTIVE_PROVIDER_LABEL may be updated after execution if rate-limit fallback is triggered.
PROVIDER_LABEL="${NW_PROVIDER_LABEL:-${PROVIDER_CMD}}"
EFFECTIVE_PROVIDER_LABEL="${PROVIDER_LABEL}"
BRANCH_PREFIX="${NW_BRANCH_PREFIX:-night-watch}"
SCRIPT_START_TIME=$(date +%s)

mkdir -p "${LOG_DIR}"

# Load shared helpers
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=night-watch-helpers.sh
source "${SCRIPT_DIR}/night-watch-helpers.sh"

# Ensure provider CLI is on PATH (nvm, fnm, volta, common bin dirs)
if ! ensure_provider_on_path "${PROVIDER_CMD}"; then
  echo "ERROR: Provider '${PROVIDER_CMD}' not found in PATH or common installation locations" >&2
  exit 127
fi
PROJECT_RUNTIME_KEY=$(project_runtime_key "${PROJECT_DIR}")
# NOTE: Lock file path must match executorLockPath() in src/utils/status-data.ts
LOCK_FILE="/tmp/night-watch-${PROJECT_RUNTIME_KEY}.lock"
SCRIPT_TYPE="executor"

emit_result() {
  local status="${1:?status required}"
  local details="${2:-}"
  if [ "${RATE_LIMIT_FALLBACK_TRIGGERED:-0}" = "1" ]; then
    if [ -n "${details}" ]; then
      details="${details}|rate_limit_fallback=1"
    else
      details="rate_limit_fallback=1"
    fi
  fi
  if [ -n "${details}" ]; then
    echo "NIGHT_WATCH_RESULT:${status}|${details}"
  else
    echo "NIGHT_WATCH_RESULT:${status}"
  fi
}

sanitize_result_value() {
  local raw="${1:-}"
  printf '%s' "${raw}" \
    | tr '\r\n' '  ' \
    | sed -E 's/[[:space:]]+/ /g; s/[|]/\//g; s/^[[:space:]]+//; s/[[:space:]]+$//'
}

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

# ── Global Job Queue Gate ────────────────────────────────────────────────────
# Acquire global gate before per-project lock to serialize jobs across projects.
# When gate is busy, enqueue the job and exit cleanly.
if [ "${NW_QUEUE_ENABLED:-0}" = "1" ]; then
  if [ "${NW_QUEUE_DISPATCHED:-0}" = "1" ]; then
    arm_global_queue_cleanup
  elif acquire_global_gate; then
    if queue_can_start_now; then
      arm_global_queue_cleanup
    else
      release_global_gate
      enqueue_job "${SCRIPT_TYPE}" "${PROJECT_DIR}"
      emit_result "queued"
      exit 0
    fi
  else
    enqueue_job "${SCRIPT_TYPE}" "${PROJECT_DIR}"
    emit_result "queued"
    exit 0
  fi
fi
# ──────────────────────────────────────────────────────────────────────────────

# Validate provider
if ! validate_provider "${PROVIDER_CMD}"; then
  echo "ERROR: Unknown provider: ${PROVIDER_CMD}" >&2
  exit 1
fi

rotate_log
log_separator
log "RUN-START: executor invoked project=${PROJECT_DIR} provider=${PROVIDER_CMD} board=${NW_BOARD_ENABLED:-false} dry_run=${NW_DRY_RUN:-0}"

if ! acquire_lock "${LOCK_FILE}"; then
  emit_result "skip_locked"
  exit 0
fi

# Ensure all repo-scoped gh/night-watch commands run against this project.
if ! cd "${PROJECT_DIR}"; then
  log "ERROR: Cannot access project directory ${PROJECT_DIR}"
  emit_result "failure" "reason=invalid_project_dir"
  exit 1
fi

cleanup_worktrees "${PROJECT_DIR}"

ISSUE_NUMBER=""    # board mode: GitHub issue number
ISSUE_BODY=""      # board mode: issue body (PRD content)
ISSUE_TITLE_RAW="" # board mode: issue title
NW_CLI=""          # board mode: resolved night-watch CLI binary

restore_issue_to_ready() {
  local reason="${1:-Execution failed before implementation started.}"
  if [ -n "${ISSUE_NUMBER}" ] && [ -n "${NW_CLI}" ]; then
    "${NW_CLI}" board move-issue "${ISSUE_NUMBER}" --column "Ready" 2>>"${LOG_FILE}" || true
    "${NW_CLI}" board comment "${ISSUE_NUMBER}" --body "${reason}" 2>>"${LOG_FILE}" || true
  fi
}

if [ "${NW_BOARD_ENABLED:-}" = "true" ]; then
  # Board mode: discover next task from GitHub Projects board
  NW_CLI=$(resolve_night_watch_cli 2>/dev/null || true)
  if [ -z "${NW_CLI}" ]; then
    log "ERROR: Cannot resolve night-watch CLI for board mode"
    exit 1
  fi

  if [ -n "${NW_TARGET_ISSUE:-}" ]; then
    # Targeted issue pickup: use specified issue directly (already "In Progress" from Slack trigger)
    ISSUE_NUMBER="${NW_TARGET_ISSUE}"
    log "BOARD: Using targeted issue #${ISSUE_NUMBER} (from NW_TARGET_ISSUE)"
    ISSUE_JSON=$(gh issue view "${ISSUE_NUMBER}" --json number,title,body 2>/dev/null || true)
    if [ -z "${ISSUE_JSON}" ]; then
      log "ERROR: Cannot fetch issue #${ISSUE_NUMBER} via gh"
      exit 1
    fi
    ISSUE_TITLE_RAW=$(printf '%s' "${ISSUE_JSON}" | jq -r '.title // empty' 2>/dev/null || true)
    ISSUE_BODY=$(printf '%s' "${ISSUE_JSON}" | jq -r '.body // empty' 2>/dev/null || true)
  else
    BOARD_DISCOVERY_STATUS=0
    if ISSUE_JSON=$(find_eligible_board_issue "${PROJECT_DIR}" "${MAX_RUNTIME}"); then
      BOARD_DISCOVERY_STATUS=0
    else
      BOARD_DISCOVERY_STATUS=$?
    fi
    if [ -z "${ISSUE_JSON}" ]; then
      if [ "${BOARD_DISCOVERY_STATUS}" -eq 2 ]; then
        log "INFO: Ready board issues were found, but all are in cooldown; skipping this run"
      else
        log "INFO: No Ready board issues found; skipping this run"
      fi
    else
      ISSUE_NUMBER=$(printf '%s' "${ISSUE_JSON}" | jq -r '.number // empty' 2>/dev/null || true)
      ISSUE_TITLE_RAW=$(printf '%s' "${ISSUE_JSON}" | jq -r '.title // empty' 2>/dev/null || true)
      ISSUE_BODY=$(printf '%s' "${ISSUE_JSON}" | jq -r '.body // empty' 2>/dev/null || true)
      if [ -z "${ISSUE_NUMBER}" ]; then
        log "ERROR: Board mode: failed to parse issue number from JSON"
        exit 1
      fi
      # Move issue to In Progress (claim it on the board)
      "${NW_CLI}" board move-issue "${ISSUE_NUMBER}" --column "In Progress" 2>>"${LOG_FILE}" || \
        log "WARN: Failed to move issue #${ISSUE_NUMBER} to In Progress"
    fi
  fi

  if [ -n "${ISSUE_NUMBER}" ]; then
    # Slugify title for branch naming
    ELIGIBLE_PRD="${ISSUE_NUMBER}-$(printf '%s' "${ISSUE_TITLE_RAW}" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '-' | sed 's/^-\|-$//g')"
    log "BOARD: Processing issue #${ISSUE_NUMBER}: ${ISSUE_TITLE_RAW}"
    trap "rm -f '${LOCK_FILE}'" EXIT
  fi
fi

if [ -z "${ISSUE_NUMBER}" ]; then
  if [ "${NW_BOARD_ENABLED:-}" = "true" ]; then
    log "SKIP: Board mode active but no eligible Ready issues found"
    emit_result "skip_no_eligible_prd"
    exit 0
  fi
  # Filesystem mode: scan PRD directory
  ELIGIBLE_PRD=$(find_eligible_prd "${PRD_DIR}" "${MAX_RUNTIME}" "${PROJECT_DIR}")
  if [ -z "${ELIGIBLE_PRD}" ]; then
    log "SKIP: No eligible PRDs (all done, in-progress, or blocked)"
    emit_result "skip_no_eligible_prd"
    exit 0
  fi
  # Claim the PRD to prevent other runs from selecting it
  claim_prd "${PRD_DIR}" "${ELIGIBLE_PRD}"
  # Update EXIT trap to also release claim
  trap "rm -f '${LOCK_FILE}'; release_claim '${PRD_DIR}' '${ELIGIBLE_PRD}'" EXIT
fi

PRD_NAME="${ELIGIBLE_PRD%.md}"
BRANCH_NAME="${BRANCH_PREFIX}/${PRD_NAME}"
WORKTREE_DIR="$(dirname "${PROJECT_DIR}")/${PROJECT_NAME}-nw-${PRD_NAME}"
BOOKKEEP_WORKTREE_DIR="$(dirname "${PROJECT_DIR}")/${PROJECT_NAME}-nw-bookkeeping"
if [ -n "${NW_DEFAULT_BRANCH:-}" ]; then
  DEFAULT_BRANCH="${NW_DEFAULT_BRANCH}"
else
  DEFAULT_BRANCH=$(detect_default_branch "${PROJECT_DIR}")
fi
if [[ "${PRD_DIR_REL}" = /* ]]; then
  BOOKKEEP_PRD_DIR="${PRD_DIR_REL}"
else
  BOOKKEEP_PRD_DIR="${BOOKKEEP_WORKTREE_DIR}/${PRD_DIR_REL}"
fi

count_prs_for_branch() {
  local pr_state="${1:?pr_state required}"
  local branch_name="${2:?branch_name required}"
  local count
  count=$(
    { gh pr list --state "${pr_state}" --json headRefName --jq '.[].headRefName' 2>/dev/null || true; } \
      | { grep -xF "${branch_name}" || true; } \
      | wc -l \
      | tr -d '[:space:]'
  )
  echo "${count:-0}"
}

checkpoint_timeout_progress() {
  local worktree_dir="${1:?worktree_dir required}"
  local branch_name="${2:?branch_name required}"
  local prd_file="${3:?prd_file required}"

  if [ ! -d "${worktree_dir}" ]; then
    return 0
  fi

  if ! git -C "${worktree_dir}" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    return 0
  fi

  if [ -z "$(git -C "${worktree_dir}" status --porcelain 2>/dev/null)" ]; then
    log "TIMEOUT: No local changes to checkpoint for ${prd_file}"
    return 0
  fi

  log "TIMEOUT: Checkpointing local progress for ${prd_file} on ${branch_name}"
  if git -C "${worktree_dir}" add -A >/dev/null 2>&1; then
    if ! git -C "${worktree_dir}" diff --cached --quiet >/dev/null 2>&1; then
      git -C "${worktree_dir}" commit --no-verify \
        -m "chore: checkpoint timed-out progress for ${prd_file}" \
        >> "${LOG_FILE}" 2>&1 || true
    fi
  fi
}

extract_timeout_phase_titles() {
  local issue_body="${1:-}"
  if [ -z "${issue_body}" ]; then
    return 0
  fi

  printf '%s\n' "${issue_body}" \
    | tr -d '\r' \
    | awk '
        BEGIN { count = 0 }
        /^[[:space:]]*#{2,4}[[:space:]]*Phase[[:space:]]+[0-9]+[[:space:]]*:/ {
          line = $0
          sub(/^[[:space:]]*#{2,4}[[:space:]]*/, "", line)
          gsub(/[[:space:]]+$/, "", line)
          if (count < 3) {
            count++
            print line
          }
        }
      '
}

build_timeout_followup_comment() {
  local max_runtime="${1:?max_runtime required}"
  local prd_label="${2:?prd_label required}"
  local branch_name="${3:?branch_name required}"
  local issue_body="${4:-}"
  local phase_titles=""
  local comment=""

  phase_titles=$(extract_timeout_phase_titles "${issue_body}" || true)

  comment="Timeout follow-up:

Execution hit the ${max_runtime}s runtime limit while processing ${prd_label}.
Progress was checkpointed on branch ${branch_name}, so the next run will resume from the latest checkpoint.

Suggested slices for the next runs:"

  if [ -n "${phase_titles}" ]; then
    local idx=1
    while IFS= read -r phase_title; do
      [ -z "${phase_title}" ] && continue
      comment="${comment}
${idx}. ${phase_title}"
      idx=$((idx + 1))
    done <<< "${phase_titles}"
  else
    comment="${comment}
1. Phase 1: Setup and interfaces
2. Phase 2: Core implementation and tests
3. Phase 3: Integration and verification"
  fi

  comment="${comment}

Recommendation: avoid huge PRDs. Slice large work into smaller PRDs/phases so each run can finish within the runtime window."

  printf '%s' "${comment}"
}

finalize_prd_done() {
  local reason="${1:?reason required}"

  release_claim "${PRD_DIR}" "${ELIGIBLE_PRD}"
  # NOTE: PRDs are moved to done/ immediately when a PR is opened (or already merged)
  # rather than waiting for reviewer/merge loops.
  if prepare_detached_worktree "${PROJECT_DIR}" "${BOOKKEEP_WORKTREE_DIR}" "${DEFAULT_BRANCH}" "${LOG_FILE}"; then
    if ! assert_isolated_worktree "${PROJECT_DIR}" "${BOOKKEEP_WORKTREE_DIR}" "executor-bookkeeping"; then
      log "WARN: Bookkeeping worktree guard rejected ${BOOKKEEP_WORKTREE_DIR}"
      return 1
    fi
    if mark_prd_done "${BOOKKEEP_PRD_DIR}" "${ELIGIBLE_PRD}"; then
      night_watch_history record "${PROJECT_DIR}" "${ELIGIBLE_PRD}" success --exit-code 0 2>/dev/null || true
      if [[ "${PRD_DIR_REL}" = /* ]]; then
        git -C "${BOOKKEEP_WORKTREE_DIR}" add -A "${PRD_DIR_REL}" || true
      else
        git -C "${BOOKKEEP_WORKTREE_DIR}" add -A "${PRD_DIR_REL}/" || true
      fi
      git -C "${BOOKKEEP_WORKTREE_DIR}" commit -m "chore: mark ${ELIGIBLE_PRD} as done (${reason})

Co-Authored-By: Night Watch [${EFFECTIVE_PROVIDER_LABEL}] <noreply@anthropic.com>" || true
      git -C "${BOOKKEEP_WORKTREE_DIR}" push origin "HEAD:${DEFAULT_BRANCH}" || true
      log "DONE: ${ELIGIBLE_PRD} ${reason}, PRD moved to done/"
      return 0
    fi
    log "WARN: Failed to move ${ELIGIBLE_PRD} to done/ in bookkeeping worktree"
    return 1
  fi

  log "WARN: Unable to prepare bookkeeping worktree for ${ELIGIBLE_PRD}"
  return 1
}

log "CONFIG: prd=${ELIGIBLE_PRD} branch=${BRANCH_NAME}"
log "CONFIG: worktree=${WORKTREE_DIR}"
log "CONFIG: default_branch=${DEFAULT_BRANCH} provider=${PROVIDER_CMD} label=${PROVIDER_LABEL:-none}"
log "CONFIG: max_runtime=${MAX_RUNTIME}s max_retries=${NW_MAX_RETRIES:-3} board=${NW_BOARD_ENABLED:-false}"
log "START: Processing ${ELIGIBLE_PRD} on branch ${BRANCH_NAME} (worktree: ${WORKTREE_DIR})"

# Send run_started notification via all configured webhooks (Telegram, Slack, Discord)
if NW_NOTIFY_CLI=$(resolve_night_watch_cli 2>/dev/null); then
  "${NW_NOTIFY_CLI}" notify run_started "${PROJECT_DIR}" \
    --prd "${ELIGIBLE_PRD}" \
    --branch "${BRANCH_NAME}" \
    --provider "${PROVIDER_LABEL:-${PROVIDER_CMD}}" \
    >> "${LOG_FILE}" 2>&1 || true
fi

EXECUTOR_PROMPT_PATH=$(resolve_instruction_path "${PROJECT_DIR}" "prd-executor.md" || true)
if [ -z "${EXECUTOR_PROMPT_PATH}" ]; then
  log "FAIL: Missing PRD executor instructions. Checked instructions/, .claude/commands/, and bundled templates/"
  restore_issue_to_ready "Failed to locate PRD executor instructions. Checked instructions/, .claude/commands/, and bundled templates/."
  night_watch_history record "${PROJECT_DIR}" "${ELIGIBLE_PRD}" failure --exit-code 1 2>/dev/null || true
  emit_result "failure" "reason=missing_executor_prompt"
  exit 1
fi
EXECUTOR_PROMPT_REF=$(instruction_ref_for_prompt "${PROJECT_DIR}" "${EXECUTOR_PROMPT_PATH}")

if [ -n "${ISSUE_NUMBER}" ]; then
  PROMPT="Implement the following PRD (GitHub issue #${ISSUE_NUMBER}: ${ISSUE_TITLE_RAW}):

${ISSUE_BODY}

## Setup
- You are already inside an isolated worktree at: ${WORKTREE_DIR}
- Current branch is already checked out: ${BRANCH_NAME}
- Do NOT run git checkout/switch in ${PROJECT_DIR}
- Do NOT create or remove worktrees; the cron script manages that
- Install dependencies if needed and implement in the current worktree only

## Implementation — PRD Executor Workflow
Read ${EXECUTOR_PROMPT_REF} and follow the FULL execution pipeline:
1. Parse the PRD into phases and extract dependencies
2. Build a dependency graph to identify parallelism
3. Create a task list with one task per phase
4. Execute phases in parallel waves using agent swarms — launch ALL independent phases concurrently
5. Run the project's verify/test command between waves to catch issues early
6. After all phases complete, run final verification and fix any issues
Follow all CLAUDE.md conventions (if present).

## Finalize
- Commit all changes, push, and open a PR:
  git push -u origin ${BRANCH_NAME}
  gh pr create --title \"feat: <short title>\" --body \"Closes #${ISSUE_NUMBER}

<summary>\"
- Do NOT process any other issues — only issue #${ISSUE_NUMBER}"
else
  PROMPT_PRD_PATH="${PRD_DIR_REL}/${ELIGIBLE_PRD}"
  PROMPT="Implement the PRD at ${PROMPT_PRD_PATH}

## Setup
- You are already inside an isolated worktree at: ${WORKTREE_DIR}
- Current branch is already checked out: ${BRANCH_NAME}
- Do NOT run git checkout/switch in ${PROJECT_DIR}
- Do NOT create or remove worktrees; the cron script manages that
- Install dependencies if needed and implement in the current worktree only

## Implementation — PRD Executor Workflow
Read ${EXECUTOR_PROMPT_REF} and follow the FULL execution pipeline:
1. Parse the PRD into phases and extract dependencies
2. Build a dependency graph to identify parallelism
3. Create a task list with one task per phase
4. Execute phases in parallel waves using agent swarms — launch ALL independent phases concurrently
5. Run the project's verify/test command between waves to catch issues early
6. After all phases complete, run final verification and fix any issues
Follow all CLAUDE.md conventions (if present).

## Finalize
- Commit all changes, push, and open a PR:
  git push -u origin ${BRANCH_NAME}
  gh pr create --title \"feat: <short title>\" --body \"<summary referencing PRD>\"
- Do NOT move the PRD to done/ — the cron script handles that
- Do NOT process any other PRDs — only ${ELIGIBLE_PRD}"
fi

# Dry-run mode: print diagnostics and exit
if [ "${NW_DRY_RUN:-0}" = "1" ]; then
  log "DRY-RUN: Would process ${ELIGIBLE_PRD}"
  log "DRY-RUN: Provider: ${PROVIDER_CMD}"
  log "DRY-RUN: Runtime: ${MAX_RUNTIME}s"
  echo "=== Dry Run: PRD Executor ==="
  echo "Provider:    ${PROVIDER_CMD}"
  echo "Eligible PRD: ${ELIGIBLE_PRD}"
  echo "Branch:      ${BRANCH_NAME}"
  echo "Worktree:    ${WORKTREE_DIR}"
  echo "Bookkeeping: ${BOOKKEEP_WORKTREE_DIR}"
  echo "Timeout:     ${MAX_RUNTIME}s"
  exit 0
fi

# If this PRD already has a merged PR for its branch, finalize it immediately.
MERGED_PR_COUNT=$(count_prs_for_branch merged "${BRANCH_NAME}")
if [ "${MERGED_PR_COUNT}" -gt 0 ]; then
  log "INFO: Found merged PR for ${BRANCH_NAME}; skipping provider run"
  if [ -n "${ISSUE_NUMBER}" ]; then
    # Board mode: close issue and move to Done
    "${NW_CLI}" board close-issue "${ISSUE_NUMBER}" 2>>"${LOG_FILE}" || \
      "${NW_CLI}" board move-issue "${ISSUE_NUMBER}" --column "Done" 2>>"${LOG_FILE}" || true
    emit_result "success_already_merged" "prd=${ELIGIBLE_PRD}|branch=${BRANCH_NAME}"
    exit 0
  elif finalize_prd_done "already merged on ${BRANCH_NAME}"; then
    emit_result "success_already_merged" "prd=${ELIGIBLE_PRD}|branch=${BRANCH_NAME}"
    exit 0
  fi
  night_watch_history record "${PROJECT_DIR}" "${ELIGIBLE_PRD}" failure --exit-code 1 2>/dev/null || true
  emit_result "failure_finalize" "prd=${ELIGIBLE_PRD}|branch=${BRANCH_NAME}|reason=finalize_failed|detail=Failed_to_finalize_already_merged_prd"
  exit 1
fi

if ! prepare_branch_worktree "${PROJECT_DIR}" "${WORKTREE_DIR}" "${BRANCH_NAME}" "${DEFAULT_BRANCH}" "${LOG_FILE}"; then
  log "FAIL: Unable to create isolated worktree ${WORKTREE_DIR} for ${BRANCH_NAME}"
  restore_issue_to_ready "Failed to prepare worktree for branch ${BRANCH_NAME}. Moved back to Ready for retry."
  night_watch_history record "${PROJECT_DIR}" "${ELIGIBLE_PRD}" failure --exit-code 1 2>/dev/null || true
  emit_result "failure" "prd=${ELIGIBLE_PRD}|branch=${BRANCH_NAME}|reason=worktree_setup_failed|detail=$(latest_failure_detail "${LOG_FILE}")"
  exit 1
fi

if ! assert_isolated_worktree "${PROJECT_DIR}" "${WORKTREE_DIR}" "executor"; then
  log "FAIL: Executor worktree guard rejected ${WORKTREE_DIR}"
  restore_issue_to_ready "Failed worktree isolation guard for branch ${BRANCH_NAME}. Moved back to Ready for retry."
  night_watch_history record "${PROJECT_DIR}" "${ELIGIBLE_PRD}" failure --exit-code 1 2>/dev/null || true
  emit_result "failure" "prd=${ELIGIBLE_PRD}|branch=${BRANCH_NAME}|reason=worktree_guard_failed|detail=$(latest_failure_detail "${LOG_FILE}")"
  exit 1
fi

# Sandbox: prevent the agent from modifying crontab during execution
export NW_EXECUTION_CONTEXT=agent

MAX_RETRIES="${NW_MAX_RETRIES:-3}"
if ! [[ "${MAX_RETRIES}" =~ ^[0-9]+$ ]] || [ "${MAX_RETRIES}" -lt 1 ]; then
  MAX_RETRIES=1
fi
BACKOFF_BASE=300  # 5 minutes in seconds
EXIT_CODE=0
ATTEMPT=0
RATE_LIMIT_FALLBACK_TRIGGERED=0

ATTEMPT_NUM=0
while [ "${ATTEMPT}" -lt "${MAX_RETRIES}" ]; do
  EXIT_CODE=0
  ATTEMPT_NUM=$((ATTEMPT_NUM + 1))
  ATTEMPT_START_TIME=$(date +%s)
  log "ATTEMPT: ${ATTEMPT_NUM}/${MAX_RETRIES} starting provider=${PROVIDER_CMD} prd=${ELIGIBLE_PRD}"
  log "EXECUTING: Launching ${PROVIDER_CMD} — output will stream below. This may take several minutes."
  # Capture log position before this attempt so check_rate_limited only
  # scans lines written by the current invocation (not leftover 429s from
  # previous runs that would cause false-positive rate-limit retries).
  LOG_LINE_BEFORE=$(wc -l < "${LOG_FILE}" 2>/dev/null || echo 0)

  case "${PROVIDER_CMD}" in
    claude)
      if (
        cd "${WORKTREE_DIR}" && timeout "${SESSION_MAX_RUNTIME}" \
          claude -p "${PROMPT}" \
            --dangerously-skip-permissions \
            2>&1 | tee -a "${LOG_FILE}"
      ); then
        EXIT_CODE=0
      else
        EXIT_CODE=$?
      fi
      ;;
    codex)
      if (
        cd "${WORKTREE_DIR}" && timeout "${SESSION_MAX_RUNTIME}" \
          codex exec \
            -C "${WORKTREE_DIR}" \
            --yolo \
            "${PROMPT}" \
            2>&1 | tee -a "${LOG_FILE}"
      ); then
        EXIT_CODE=0
      else
        EXIT_CODE=$?
      fi
      ;;
    *)
      log "ERROR: Unknown provider: ${PROVIDER_CMD}"
      emit_result "failure" "prd=${ELIGIBLE_PRD}|branch=${BRANCH_NAME}|reason=unknown_provider|detail=$(sanitize_result_value "Unknown provider: ${PROVIDER_CMD}")"
      exit 1
      ;;
  esac

  ATTEMPT_ELAPSED=$(( $(date +%s) - ATTEMPT_START_TIME ))
  log "ATTEMPT: ${ATTEMPT_NUM}/${MAX_RETRIES} finished exit_code=${EXIT_CODE} elapsed=${ATTEMPT_ELAPSED}s prd=${ELIGIBLE_PRD}"

  # Success or timeout — don't retry
  if [ ${EXIT_CODE} -eq 0 ] || [ ${EXIT_CODE} -eq 124 ]; then
    break
  fi

  # Check if this was a rate limit (429) error (only in lines from this attempt)
  if check_rate_limited "${LOG_FILE}" "${LOG_LINE_BEFORE}"; then
    # If fallback is enabled, skip proxy retries and switch to native Claude immediately
    if [ "${NW_FALLBACK_ON_RATE_LIMIT:-}" = "true" ] && [ "${PROVIDER_CMD}" = "claude" ]; then
      log "RATE-LIMITED: Proxy quota exhausted — triggering native Claude fallback"
      RATE_LIMIT_FALLBACK_TRIGGERED=1
      break
    fi
    ATTEMPT=$((ATTEMPT + 1))
    if [ "${ATTEMPT}" -ge "${MAX_RETRIES}" ]; then
      log "RATE-LIMITED: All ${MAX_RETRIES} attempts exhausted for ${ELIGIBLE_PRD}"
      night_watch_history record "${PROJECT_DIR}" "${ELIGIBLE_PRD}" rate_limited --exit-code "${EXIT_CODE}" --attempt "${ATTEMPT}" 2>/dev/null || true
      break
    fi
    BACKOFF=$(( BACKOFF_BASE * (1 << (ATTEMPT - 1)) ))
    BACKOFF_MIN=$(( BACKOFF / 60 ))
    log "RATE-LIMITED: Attempt ${ATTEMPT}/${MAX_RETRIES}, retrying in ${BACKOFF_MIN}m"
    sleep "${BACKOFF}"
  elif check_context_exhausted "${LOG_FILE}" "${LOG_LINE_BEFORE}"; then
    # Context window exhausted — checkpoint progress and resume in a fresh session
    ATTEMPT=$((ATTEMPT + 1))
    if [ "${ATTEMPT}" -ge "${MAX_RETRIES}" ]; then
      log "CONTEXT-EXHAUSTED: All ${MAX_RETRIES} resume attempts exhausted for ${ELIGIBLE_PRD}"
      break
    fi
    log "CONTEXT-EXHAUSTED: Session ${ATTEMPT_NUM} hit context limit — checkpointing and resuming (${ATTEMPT}/${MAX_RETRIES})"
    checkpoint_timeout_progress "${WORKTREE_DIR}" "${BRANCH_NAME}" "${ELIGIBLE_PRD}"
    git -C "${WORKTREE_DIR}" push origin "${BRANCH_NAME}" --force-with-lease >> "${LOG_FILE}" 2>&1 || true
    # Switch prompt to "continue" mode for the next attempt (fresh context)
    if [ -n "${ISSUE_NUMBER}" ]; then
      PROMPT="Continue implementing PRD (GitHub issue #${ISSUE_NUMBER}: ${ISSUE_TITLE_RAW}).

The previous session ran out of context window. Progress has been committed on branch ${BRANCH_NAME}.

## Your task
1. Review the current state: check git log, existing code changes, and any task list
2. Compare against the original PRD requirements (issue #${ISSUE_NUMBER}) to identify what is already done vs remaining
3. Continue implementing the remaining phases/tasks
4. Do NOT redo work that is already completed and committed

## Setup
- You are already inside an isolated worktree at: ${WORKTREE_DIR}
- Current branch is already checked out: ${BRANCH_NAME}
- Do NOT run git checkout/switch in ${PROJECT_DIR}
- Do NOT create or remove worktrees; the cron script manages that

## Implementation — PRD Executor Workflow
Read ${EXECUTOR_PROMPT_REF} and follow the FULL execution pipeline for remaining phases only.
Follow all CLAUDE.md conventions (if present).

## Finalize
- Commit all changes, push, and open a PR:
  git push -u origin ${BRANCH_NAME}
  gh pr create --title \"feat: <short title>\" --body \"Closes #${ISSUE_NUMBER}

<summary>\"
- Do NOT process any other issues — only issue #${ISSUE_NUMBER}"
    else
      PROMPT="Continue implementing the PRD at ${PRD_DIR_REL}/${ELIGIBLE_PRD}

The previous session ran out of context window. Progress has been committed on branch ${BRANCH_NAME}.

## Your task
1. Review the current state: check git log, existing code changes, and any task list
2. Compare against the original PRD to identify what is already done vs remaining
3. Continue implementing the remaining phases/tasks
4. Do NOT redo work that is already completed and committed

## Setup
- You are already inside an isolated worktree at: ${WORKTREE_DIR}
- Current branch is already checked out: ${BRANCH_NAME}
- Do NOT run git checkout/switch in ${PROJECT_DIR}
- Do NOT create or remove worktrees; the cron script manages that

## Implementation — PRD Executor Workflow
Read ${EXECUTOR_PROMPT_REF} and follow the FULL execution pipeline for remaining phases only.
Follow all CLAUDE.md conventions (if present).

## Finalize
- Commit all changes, push, and open a PR:
  git push -u origin ${BRANCH_NAME}
  gh pr create --title \"feat: <short title>\" --body \"<summary referencing PRD>\"
- Do NOT move the PRD to done/ — the cron script handles that
- Do NOT process any other PRDs — only ${ELIGIBLE_PRD}"
    fi
    # No backoff — context exhaustion is not rate-limiting
  else
    # Non-retryable failure
    break
  fi
done

# ── Native Claude fallback ────────────────────────────────────────────────────
# When the proxy returns 429 and fallbackOnRateLimit is enabled, re-run the
# same prompt with native Claude (OAuth), bypassing the proxy entirely.
if [ "${RATE_LIMIT_FALLBACK_TRIGGERED}" = "1" ]; then
  FALLBACK_MODEL="${NW_CLAUDE_MODEL_ID:-claude-sonnet-4-6}"
  log "RATE-LIMIT-FALLBACK: Running native Claude (${FALLBACK_MODEL}) prd=${ELIGIBLE_PRD}"

  # Send immediate Telegram warning (fire-and-forget)
  send_rate_limit_fallback_warning "${FALLBACK_MODEL}" "$(basename "${PROJECT_DIR}")"

  LOG_LINE_BEFORE=$(wc -l < "${LOG_FILE}" 2>/dev/null || echo 0)
  FALLBACK_START_TIME=$(date +%s)

  if (
    cd "${WORKTREE_DIR}" && \
      unset ANTHROPIC_BASE_URL ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN \
            ANTHROPIC_DEFAULT_SONNET_MODEL ANTHROPIC_DEFAULT_OPUS_MODEL && \
      timeout "${SESSION_MAX_RUNTIME}" \
        claude -p "${PROMPT}" \
          --dangerously-skip-permissions \
          --model "${FALLBACK_MODEL}" \
          2>&1 | tee -a "${LOG_FILE}"
  ); then
    EXIT_CODE=0
  else
    EXIT_CODE=$?
  fi

  FALLBACK_ELAPSED=$(( $(date +%s) - FALLBACK_START_TIME ))
  log "RATE-LIMIT-FALLBACK: Native Claude exited with code ${EXIT_CODE} elapsed=${FALLBACK_ELAPSED}s"
  # Update effective provider label to reflect actual executor used
  EFFECTIVE_PROVIDER_LABEL="Claude ${FALLBACK_MODEL} (fallback)"
fi

# Detect double rate-limit: both proxy AND native Claude exhausted
DOUBLE_RATE_LIMITED=0
if [ "${RATE_LIMIT_FALLBACK_TRIGGERED}" = "1" ] && [ ${EXIT_CODE} -ne 0 ]; then
  if check_rate_limited "${LOG_FILE}" "${LOG_LINE_BEFORE}"; then
    DOUBLE_RATE_LIMITED=1
    log "RATE-LIMITED: Both proxy and native Claude are rate-limited for ${ELIGIBLE_PRD}"
  fi
fi

TOTAL_ELAPSED=$(( $(date +%s) - SCRIPT_START_TIME ))
log "OUTCOME: exit_code=${EXIT_CODE} total_elapsed=${TOTAL_ELAPSED}s prd=${ELIGIBLE_PRD} branch=${BRANCH_NAME}"

if [ ${EXIT_CODE} -eq 0 ]; then
  OPEN_PR_COUNT=$(count_prs_for_branch open "${BRANCH_NAME}")
  if [ "${OPEN_PR_COUNT}" -gt 0 ]; then
    if [ -n "${ISSUE_NUMBER}" ]; then
      # Board mode: comment with PR URL, then close issue and move to Done
      PR_URL=$(gh pr list --state open --json headRefName,url \
        --jq ".[] | select(.headRefName == \"${BRANCH_NAME}\") | .url" 2>/dev/null || true)
      if [ -n "${PR_URL}" ]; then
        "${NW_CLI}" board comment "${ISSUE_NUMBER}" --body "PR opened: ${PR_URL} (via ${EFFECTIVE_PROVIDER_LABEL})" 2>>"${LOG_FILE}" || true
        gh pr comment "${PR_URL}" --body "> 🤖 Implemented by ${EFFECTIVE_PROVIDER_LABEL}" 2>>"${LOG_FILE}" || true
      fi
      "${NW_CLI}" board close-issue "${ISSUE_NUMBER}" 2>>"${LOG_FILE}" || \
        "${NW_CLI}" board move-issue "${ISSUE_NUMBER}" --column "Done" 2>>"${LOG_FILE}" || true
      log "SUCCESS: PR opened and ready for review — ${PR_URL}"
      emit_result "success_open_pr" "prd=${ELIGIBLE_PRD}|branch=${BRANCH_NAME}"
    elif finalize_prd_done "implemented, PR opened on ${BRANCH_NAME}"; then
      # Non-board mode: post attribution comment to the PR
      NON_BOARD_PR_URL=$(gh pr list --state open --json headRefName,url \
        --jq ".[] | select(.headRefName == \"${BRANCH_NAME}\") | .url" 2>/dev/null || true)
      if [ -n "${NON_BOARD_PR_URL}" ]; then
        gh pr comment "${NON_BOARD_PR_URL}" --body "> 🤖 Implemented by ${EFFECTIVE_PROVIDER_LABEL}" 2>>"${LOG_FILE}" || true
      fi
      log "SUCCESS: PR opened and ready for review — ${NON_BOARD_PR_URL}"
      emit_result "success_open_pr" "prd=${ELIGIBLE_PRD}|branch=${BRANCH_NAME}"
    else
      night_watch_history record "${PROJECT_DIR}" "${ELIGIBLE_PRD}" failure --exit-code 1 2>/dev/null || true
      emit_result "failure_finalize" "prd=${ELIGIBLE_PRD}|branch=${BRANCH_NAME}|reason=finalize_failed|detail=Failed_to_finalize_open_prd"
      EXIT_CODE=1
    fi
  else
    MERGED_PR_COUNT=$(count_prs_for_branch merged "${BRANCH_NAME}")
    if [ "${MERGED_PR_COUNT}" -gt 0 ]; then
      if [ -n "${ISSUE_NUMBER}" ]; then
        "${NW_CLI}" board close-issue "${ISSUE_NUMBER}" 2>>"${LOG_FILE}" || \
          "${NW_CLI}" board move-issue "${ISSUE_NUMBER}" --column "Done" 2>>"${LOG_FILE}" || true
        emit_result "success_already_merged" "prd=${ELIGIBLE_PRD}|branch=${BRANCH_NAME}"
      elif finalize_prd_done "already merged on ${BRANCH_NAME}"; then
        emit_result "success_already_merged" "prd=${ELIGIBLE_PRD}|branch=${BRANCH_NAME}"
      else
        night_watch_history record "${PROJECT_DIR}" "${ELIGIBLE_PRD}" failure --exit-code 1 2>/dev/null || true
        emit_result "failure_finalize" "prd=${ELIGIBLE_PRD}|branch=${BRANCH_NAME}|reason=finalize_failed|detail=Failed_to_finalize_merged_prd"
        EXIT_CODE=1
      fi
    else
      log "WARN: ${PROVIDER_CMD} exited 0 but no open/merged PR found on ${BRANCH_NAME} — recording cooldown to avoid repeated stuck runs"
      if [ -n "${ISSUE_NUMBER}" ]; then
        "${NW_CLI}" board move-issue "${ISSUE_NUMBER}" --column "Ready" 2>>"${LOG_FILE}" || true
        "${NW_CLI}" board comment "${ISSUE_NUMBER}" \
          --body "Execution completed but no PR was found (via ${EFFECTIVE_PROVIDER_LABEL}). Moved back to Ready for retry." 2>>"${LOG_FILE}" || true
      fi
      night_watch_history record "${PROJECT_DIR}" "${ELIGIBLE_PRD}" failure --exit-code 1 2>/dev/null || true
      emit_result "failure_no_pr_after_success" "prd=${ELIGIBLE_PRD}|branch=${BRANCH_NAME}|reason=no_pr_after_success|detail=$(sanitize_result_value "Provider exited successfully but no open or merged PR was found")"
      EXIT_CODE=1
    fi
  fi
elif [ ${EXIT_CODE} -eq 124 ]; then
  log "TIMEOUT: Session limit hit after ${SESSION_MAX_RUNTIME}s while processing ${ELIGIBLE_PRD}"
  checkpoint_timeout_progress "${WORKTREE_DIR}" "${BRANCH_NAME}" "${ELIGIBLE_PRD}"
  if [ -n "${ISSUE_NUMBER}" ]; then
    "${NW_CLI}" board move-issue "${ISSUE_NUMBER}" --column "Ready" 2>>"${LOG_FILE}" || true
    if [ "${SESSION_MAX_RUNTIME}" != "${MAX_RUNTIME}" ]; then
      "${NW_CLI}" board comment "${ISSUE_NUMBER}" \
        --body "Session paused after ${SESSION_MAX_RUNTIME}s (via ${EFFECTIVE_PROVIDER_LABEL}). Progress checkpointed on branch \`${BRANCH_NAME}\`. Will resume automatically on the next run." 2>>"${LOG_FILE}" || true
    else
      "${NW_CLI}" board comment "${ISSUE_NUMBER}" \
        --body "Execution timed out after ${SESSION_MAX_RUNTIME}s (via ${EFFECTIVE_PROVIDER_LABEL}). Moved back to Ready for retry." 2>>"${LOG_FILE}" || true
      TIMEOUT_FOLLOWUP_COMMENT=$(build_timeout_followup_comment \
        "${SESSION_MAX_RUNTIME}" \
        "${ELIGIBLE_PRD}" \
        "${BRANCH_NAME}" \
        "${ISSUE_BODY}")
      "${NW_CLI}" board comment "${ISSUE_NUMBER}" --body "${TIMEOUT_FOLLOWUP_COMMENT}" 2>>"${LOG_FILE}" || true
    fi
  fi
  night_watch_history record "${PROJECT_DIR}" "${ELIGIBLE_PRD}" timeout --exit-code 124 2>/dev/null || true
  emit_result "timeout" "prd=${ELIGIBLE_PRD}|branch=${BRANCH_NAME}"
elif [ "${DOUBLE_RATE_LIMITED}" = "1" ]; then
  if [ -n "${ISSUE_NUMBER}" ]; then
    "${NW_CLI}" board move-issue "${ISSUE_NUMBER}" --column "Ready" 2>>"${LOG_FILE}" || true
    "${NW_CLI}" board comment "${ISSUE_NUMBER}" \
      --body "Both proxy and native Claude are rate-limited. Will retry after reset (via ${EFFECTIVE_PROVIDER_LABEL})." 2>>"${LOG_FILE}" || true
  fi
  night_watch_history record "${PROJECT_DIR}" "${ELIGIBLE_PRD}" rate_limited --exit-code "${EXIT_CODE}" 2>/dev/null || true
  emit_result "rate_limited" "prd=${ELIGIBLE_PRD}|branch=${BRANCH_NAME}|reason=double_rate_limit"
elif check_context_exhausted "${LOG_FILE}" "${LOG_LINE_BEFORE}"; then
  # All resume attempts for context exhaustion were used up
  log "FAIL: Context window exhausted after ${MAX_RETRIES} resume attempts for ${ELIGIBLE_PRD}"
  checkpoint_timeout_progress "${WORKTREE_DIR}" "${BRANCH_NAME}" "${ELIGIBLE_PRD}"
  git -C "${WORKTREE_DIR}" push origin "${BRANCH_NAME}" --force-with-lease >> "${LOG_FILE}" 2>&1 || true
  if [ -n "${ISSUE_NUMBER}" ]; then
    "${NW_CLI}" board move-issue "${ISSUE_NUMBER}" --column "Ready" 2>>"${LOG_FILE}" || true
    "${NW_CLI}" board comment "${ISSUE_NUMBER}" \
      --body "Context window exhausted after ${MAX_RETRIES} resume attempts (${TOTAL_ELAPSED}s total, via ${EFFECTIVE_PROVIDER_LABEL}). Progress checkpointed on branch \`${BRANCH_NAME}\`. Will resume on next run." 2>>"${LOG_FILE}" || true
  fi
  night_watch_history record "${PROJECT_DIR}" "${ELIGIBLE_PRD}" context_exhausted --exit-code "${EXIT_CODE}" 2>/dev/null || true
  emit_result "failure" "prd=${ELIGIBLE_PRD}|branch=${BRANCH_NAME}|reason=context_exhausted|exit_code=${EXIT_CODE}"
else
  PROVIDER_ERROR_DETAIL=$(latest_failure_detail "${LOG_FILE}" "${LOG_LINE_BEFORE}")
  log "FAIL: Night watch exited with code ${EXIT_CODE} while processing ${ELIGIBLE_PRD}"
  if [ -n "${ISSUE_NUMBER}" ]; then
    "${NW_CLI}" board move-issue "${ISSUE_NUMBER}" --column "Ready" 2>>"${LOG_FILE}" || true
    FAILURE_COMMENT="Execution failed with exit code ${EXIT_CODE} after ${TOTAL_ELAPSED}s (via ${EFFECTIVE_PROVIDER_LABEL}). Moved back to Ready for retry."
    if [ "${TOTAL_ELAPSED}" -gt 1800 ]; then
      FAILURE_COMMENT="${FAILURE_COMMENT}

This run lasted over $((TOTAL_ELAPSED / 60)) minutes before failing — likely a context overflow. Consider slicing this PRD into smaller sub-issues so each run can finish within a single session."
    fi
    "${NW_CLI}" board comment "${ISSUE_NUMBER}" --body "${FAILURE_COMMENT}" 2>>"${LOG_FILE}" || true
  fi
  night_watch_history record "${PROJECT_DIR}" "${ELIGIBLE_PRD}" failure --exit-code "${EXIT_CODE}" 1>/dev/null || true
  emit_result "failure" "prd=${ELIGIBLE_PRD}|branch=${BRANCH_NAME}|reason=provider_exit|exit_code=${EXIT_CODE}|detail=${PROVIDER_ERROR_DETAIL}"
fi

cleanup_worktrees "${PROJECT_DIR}"
exit "${EXIT_CODE}"
