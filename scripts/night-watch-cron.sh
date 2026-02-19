#!/usr/bin/env bash
set -euo pipefail

# Night Watch Cron Runner (project-agnostic)
# Usage: night-watch-cron.sh /path/to/project
# Finds the next eligible PRD and passes it to the configured AI provider for implementation.
#
# NOTE: This script expects environment variables to be set by the caller.
# The Node.js CLI will inject config values via environment variables.
# Required env vars (with defaults shown):
#   NW_MAX_RUNTIME=7200          - Maximum runtime in seconds (2 hours)
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
LOG_FILE="${LOG_DIR}/night-watch.log"
MAX_RUNTIME="${NW_MAX_RUNTIME:-7200}"  # 2 hours
MAX_LOG_SIZE="524288"  # 512 KB
PROVIDER_CMD="${NW_PROVIDER_CMD:-claude}"
BRANCH_PREFIX="${NW_BRANCH_PREFIX:-night-watch}"

# Ensure NVM / Node / Claude are on PATH
export NVM_DIR="${HOME}/.nvm"
[ -s "${NVM_DIR}/nvm.sh" ] && . "${NVM_DIR}/nvm.sh"

# NOTE: Environment variables should be set by the caller (Node.js CLI).
# The .env.night-watch sourcing has been removed - config is now injected via env vars.

mkdir -p "${LOG_DIR}"

# Load shared helpers
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=night-watch-helpers.sh
source "${SCRIPT_DIR}/night-watch-helpers.sh"
PROJECT_RUNTIME_KEY=$(project_runtime_key "${PROJECT_DIR}")
# NOTE: Lock file path must match executorLockPath() in src/utils/status-data.ts
LOCK_FILE="/tmp/night-watch-${PROJECT_RUNTIME_KEY}.lock"

emit_result() {
  local status="${1:?status required}"
  local details="${2:-}"
  if [ -n "${details}" ]; then
    echo "NIGHT_WATCH_RESULT:${status}|${details}"
  else
    echo "NIGHT_WATCH_RESULT:${status}"
  fi
}

# Validate provider
if ! validate_provider "${PROVIDER_CMD}"; then
  echo "ERROR: Unknown provider: ${PROVIDER_CMD}" >&2
  exit 1
fi

rotate_log

if ! acquire_lock "${LOCK_FILE}"; then
  emit_result "skip_locked"
  exit 0
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
  ISSUE_JSON=$(find_eligible_board_issue)
  if [ -z "${ISSUE_JSON}" ]; then
    log "SKIP: No eligible issues in Ready column (board mode)"
    emit_result "skip_no_eligible_prd"
    exit 0
  fi
  ISSUE_NUMBER=$(printf '%s' "${ISSUE_JSON}" | jq -r '.number // empty' 2>/dev/null || true)
  ISSUE_TITLE_RAW=$(printf '%s' "${ISSUE_JSON}" | jq -r '.title // empty' 2>/dev/null || true)
  ISSUE_BODY=$(printf '%s' "${ISSUE_JSON}" | jq -r '.body // empty' 2>/dev/null || true)
  if [ -z "${ISSUE_NUMBER}" ]; then
    log "ERROR: Board mode: failed to parse issue number from JSON"
    exit 1
  fi
  # Slugify title for branch naming
  ELIGIBLE_PRD="${ISSUE_NUMBER}-$(printf '%s' "${ISSUE_TITLE_RAW}" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '-' | sed 's/^-\|-$//g')"
  log "BOARD: Found ready issue #${ISSUE_NUMBER}: ${ISSUE_TITLE_RAW}"
  # Move issue to In Progress (claim it on the board)
  "${NW_CLI}" board move-issue "${ISSUE_NUMBER}" --column "In Progress" 2>>"${LOG_FILE}" || \
    log "WARN: Failed to move issue #${ISSUE_NUMBER} to In Progress"
  trap "rm -f '${LOCK_FILE}'" EXIT
else
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

finalize_prd_done() {
  local reason="${1:?reason required}"

  release_claim "${PRD_DIR}" "${ELIGIBLE_PRD}"
  # NOTE: PRDs are moved to done/ immediately when a PR is opened (or already merged)
  # rather than waiting for reviewer/merge loops.
  if prepare_detached_worktree "${PROJECT_DIR}" "${BOOKKEEP_WORKTREE_DIR}" "${DEFAULT_BRANCH}" "${LOG_FILE}"; then
    if mark_prd_done "${BOOKKEEP_PRD_DIR}" "${ELIGIBLE_PRD}"; then
      night_watch_history record "${PROJECT_DIR}" "${ELIGIBLE_PRD}" success --exit-code 0 2>/dev/null || true
      if [[ "${PRD_DIR_REL}" = /* ]]; then
        git -C "${BOOKKEEP_WORKTREE_DIR}" add -A "${PRD_DIR_REL}" || true
      else
        git -C "${BOOKKEEP_WORKTREE_DIR}" add -A "${PRD_DIR_REL}/" || true
      fi
      git -C "${BOOKKEEP_WORKTREE_DIR}" commit -m "chore: mark ${ELIGIBLE_PRD} as done (${reason})

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>" || true
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

log "START: Processing ${ELIGIBLE_PRD} on branch ${BRANCH_NAME} (worktree: ${WORKTREE_DIR})"

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
Read .claude/commands/prd-executor.md and follow its FULL execution pipeline:
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
Read .claude/commands/prd-executor.md and follow its FULL execution pipeline:
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
    # Board mode: move issue to Done
    "${NW_CLI}" board move-issue "${ISSUE_NUMBER}" --column "Done" 2>>"${LOG_FILE}" || true
    emit_result "success_already_merged" "prd=${ELIGIBLE_PRD}|branch=${BRANCH_NAME}"
    exit 0
  elif finalize_prd_done "already merged on ${BRANCH_NAME}"; then
    emit_result "success_already_merged" "prd=${ELIGIBLE_PRD}|branch=${BRANCH_NAME}"
    exit 0
  fi
  night_watch_history record "${PROJECT_DIR}" "${ELIGIBLE_PRD}" failure --exit-code 1 2>/dev/null || true
  emit_result "failure_finalize" "prd=${ELIGIBLE_PRD}|branch=${BRANCH_NAME}"
  exit 1
fi

if ! prepare_branch_worktree "${PROJECT_DIR}" "${WORKTREE_DIR}" "${BRANCH_NAME}" "${DEFAULT_BRANCH}" "${LOG_FILE}"; then
  log "FAIL: Unable to create isolated worktree ${WORKTREE_DIR} for ${BRANCH_NAME}"
  restore_issue_to_ready "Failed to prepare worktree for branch ${BRANCH_NAME}. Moved back to Ready for retry."
  night_watch_history record "${PROJECT_DIR}" "${ELIGIBLE_PRD}" failure --exit-code 1 2>/dev/null || true
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

while [ "${ATTEMPT}" -lt "${MAX_RETRIES}" ]; do
  EXIT_CODE=0
  # Capture log position before this attempt so check_rate_limited only
  # scans lines written by the current invocation (not leftover 429s from
  # previous runs that would cause false-positive rate-limit retries).
  LOG_LINE_BEFORE=$(wc -l < "${LOG_FILE}" 2>/dev/null || echo 0)

  case "${PROVIDER_CMD}" in
    claude)
      if (
        cd "${WORKTREE_DIR}" && timeout "${MAX_RUNTIME}" \
          claude -p "${PROMPT}" \
            --dangerously-skip-permissions \
            >> "${LOG_FILE}" 2>&1
      ); then
        EXIT_CODE=0
      else
        EXIT_CODE=$?
      fi
      ;;
    codex)
      if (
        cd "${WORKTREE_DIR}" && timeout "${MAX_RUNTIME}" \
          codex --quiet \
            --yolo \
            --prompt "${PROMPT}" \
            >> "${LOG_FILE}" 2>&1
      ); then
        EXIT_CODE=0
      else
        EXIT_CODE=$?
      fi
      ;;
    *)
      log "ERROR: Unknown provider: ${PROVIDER_CMD}"
      exit 1
      ;;
  esac

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
  log "RATE-LIMIT-FALLBACK: Running native Claude (${FALLBACK_MODEL})"

  # Send immediate Telegram warning (fire-and-forget)
  send_rate_limit_fallback_warning "${FALLBACK_MODEL}" "$(basename "${PROJECT_DIR}")"

  LOG_LINE_BEFORE=$(wc -l < "${LOG_FILE}" 2>/dev/null || echo 0)

  if (
    cd "${WORKTREE_DIR}" && \
      unset ANTHROPIC_BASE_URL ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN \
            ANTHROPIC_DEFAULT_SONNET_MODEL ANTHROPIC_DEFAULT_OPUS_MODEL && \
      timeout "${MAX_RUNTIME}" \
        claude -p "${PROMPT}" \
          --dangerously-skip-permissions \
          --model "${FALLBACK_MODEL}" \
          >> "${LOG_FILE}" 2>&1
  ); then
    EXIT_CODE=0
  else
    EXIT_CODE=$?
  fi

  log "RATE-LIMIT-FALLBACK: Native Claude exited with code ${EXIT_CODE}"
fi

if [ ${EXIT_CODE} -eq 0 ]; then
  OPEN_PR_COUNT=$(count_prs_for_branch open "${BRANCH_NAME}")
  if [ "${OPEN_PR_COUNT}" -gt 0 ]; then
    if [ -n "${ISSUE_NUMBER}" ]; then
      # Board mode: move to Review and comment with PR URL
      PR_URL=$(gh pr list --state open --json headRefName,url \
        --jq ".[] | select(.headRefName == \"${BRANCH_NAME}\") | .url" 2>/dev/null || true)
      "${NW_CLI}" board move-issue "${ISSUE_NUMBER}" --column "Review" 2>>"${LOG_FILE}" || true
      if [ -n "${PR_URL}" ]; then
        "${NW_CLI}" board comment "${ISSUE_NUMBER}" --body "PR opened: ${PR_URL}" 2>>"${LOG_FILE}" || true
      fi
      emit_result "success_open_pr" "prd=${ELIGIBLE_PRD}|branch=${BRANCH_NAME}"
    elif finalize_prd_done "implemented, PR opened on ${BRANCH_NAME}"; then
      emit_result "success_open_pr" "prd=${ELIGIBLE_PRD}|branch=${BRANCH_NAME}"
    else
      night_watch_history record "${PROJECT_DIR}" "${ELIGIBLE_PRD}" failure --exit-code 1 2>/dev/null || true
      emit_result "failure_finalize" "prd=${ELIGIBLE_PRD}|branch=${BRANCH_NAME}"
      EXIT_CODE=1
    fi
  else
    MERGED_PR_COUNT=$(count_prs_for_branch merged "${BRANCH_NAME}")
    if [ "${MERGED_PR_COUNT}" -gt 0 ]; then
      if [ -n "${ISSUE_NUMBER}" ]; then
        "${NW_CLI}" board move-issue "${ISSUE_NUMBER}" --column "Done" 2>>"${LOG_FILE}" || true
        emit_result "success_already_merged" "prd=${ELIGIBLE_PRD}|branch=${BRANCH_NAME}"
      elif finalize_prd_done "already merged on ${BRANCH_NAME}"; then
        emit_result "success_already_merged" "prd=${ELIGIBLE_PRD}|branch=${BRANCH_NAME}"
      else
        night_watch_history record "${PROJECT_DIR}" "${ELIGIBLE_PRD}" failure --exit-code 1 2>/dev/null || true
        emit_result "failure_finalize" "prd=${ELIGIBLE_PRD}|branch=${BRANCH_NAME}"
        EXIT_CODE=1
      fi
    else
      log "WARN: ${PROVIDER_CMD} exited 0 but no open/merged PR found on ${BRANCH_NAME} — recording cooldown to avoid repeated stuck runs"
      if [ -n "${ISSUE_NUMBER}" ]; then
        "${NW_CLI}" board move-issue "${ISSUE_NUMBER}" --column "Ready" 2>>"${LOG_FILE}" || true
        "${NW_CLI}" board comment "${ISSUE_NUMBER}" \
          --body "Execution completed but no PR was found. Moved back to Ready for retry." 2>>"${LOG_FILE}" || true
      fi
      night_watch_history record "${PROJECT_DIR}" "${ELIGIBLE_PRD}" failure --exit-code 1 2>/dev/null || true
      emit_result "failure_no_pr_after_success" "prd=${ELIGIBLE_PRD}|branch=${BRANCH_NAME}"
      EXIT_CODE=1
    fi
  fi
elif [ ${EXIT_CODE} -eq 124 ]; then
  log "TIMEOUT: Night watch killed after ${MAX_RUNTIME}s while processing ${ELIGIBLE_PRD}"
  if [ -n "${ISSUE_NUMBER}" ]; then
    "${NW_CLI}" board move-issue "${ISSUE_NUMBER}" --column "Ready" 2>>"${LOG_FILE}" || true
    "${NW_CLI}" board comment "${ISSUE_NUMBER}" \
      --body "Execution timed out after ${MAX_RUNTIME}s. Moved back to Ready for retry." 2>>"${LOG_FILE}" || true
  fi
  night_watch_history record "${PROJECT_DIR}" "${ELIGIBLE_PRD}" timeout --exit-code 124 2>/dev/null || true
  emit_result "timeout" "prd=${ELIGIBLE_PRD}|branch=${BRANCH_NAME}"
else
  log "FAIL: Night watch exited with code ${EXIT_CODE} while processing ${ELIGIBLE_PRD}"
  if [ -n "${ISSUE_NUMBER}" ]; then
    "${NW_CLI}" board move-issue "${ISSUE_NUMBER}" --column "Ready" 2>>"${LOG_FILE}" || true
    "${NW_CLI}" board comment "${ISSUE_NUMBER}" \
      --body "Execution failed with exit code ${EXIT_CODE}. Moved back to Ready for retry." 2>>"${LOG_FILE}" || true
  fi
  night_watch_history record "${PROJECT_DIR}" "${ELIGIBLE_PRD}" failure --exit-code "${EXIT_CODE}" 2>/dev/null || true
  emit_result "failure" "prd=${ELIGIBLE_PRD}|branch=${BRANCH_NAME}"
fi

cleanup_worktrees "${PROJECT_DIR}"
exit "${EXIT_CODE}"
