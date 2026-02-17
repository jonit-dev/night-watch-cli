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
LOG_DIR="${PROJECT_DIR}/logs"
LOG_FILE="${LOG_DIR}/night-watch.log"
LOCK_FILE=""
MAX_RUNTIME="${NW_MAX_RUNTIME:-7200}"  # 2 hours
MAX_LOG_SIZE="524288"  # 512 KB
PROVIDER_CMD="${NW_PROVIDER_CMD:-claude}"
RUNTIME_MIRROR_DIR=""
RUNTIME_PROJECT_DIR=""
PRD_DIR=""
ELIGIBLE_PRD=""
CLAIMED=0

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
LOCK_FILE="/tmp/night-watch-${PROJECT_RUNTIME_KEY}.lock"

# Validate provider
if ! validate_provider "${PROVIDER_CMD}"; then
  echo "ERROR: Unknown provider: ${PROVIDER_CMD}" >&2
  exit 1
fi

rotate_log

if ! acquire_lock "${LOCK_FILE}"; then
  exit 0
fi

cleanup_on_exit() {
  rm -f "${LOCK_FILE}"

  if [ "${CLAIMED}" = "1" ] && [ -n "${ELIGIBLE_PRD}" ] && [ -n "${PRD_DIR}" ]; then
    release_claim "${PRD_DIR}" "${ELIGIBLE_PRD}" || true
  fi

  if [ -n "${RUNTIME_MIRROR_DIR}" ] && [ -n "${RUNTIME_PROJECT_DIR}" ]; then
    cleanup_runtime_workspace "${RUNTIME_MIRROR_DIR}" "${RUNTIME_PROJECT_DIR}" || true
  fi
}

trap cleanup_on_exit EXIT

if [ -n "${NW_DEFAULT_BRANCH:-}" ]; then
  DEFAULT_BRANCH="${NW_DEFAULT_BRANCH}"
else
  DEFAULT_BRANCH=$(detect_default_branch "${PROJECT_DIR}")
fi

runtime_info=()
if mapfile -t runtime_info < <(prepare_runtime_workspace "${PROJECT_DIR}" "${DEFAULT_BRANCH}" "${LOG_FILE}"); then
  RUNTIME_MIRROR_DIR="${runtime_info[0]:-}"
  RUNTIME_PROJECT_DIR="${runtime_info[1]:-}"
else
  log "FAIL: Could not prepare runtime workspace for ${PROJECT_DIR}"
  exit 1
fi

if [ -z "${RUNTIME_MIRROR_DIR}" ] || [ -z "${RUNTIME_PROJECT_DIR}" ]; then
  log "FAIL: Runtime workspace paths are missing"
  exit 1
fi

if [[ "${PRD_DIR_REL}" = /* ]]; then
  PRD_DIR="${PRD_DIR_REL}"
else
  PRD_DIR="${RUNTIME_PROJECT_DIR}/${PRD_DIR_REL}"
fi

ELIGIBLE_PRD=$(find_eligible_prd "${PRD_DIR}" "${MAX_RUNTIME}" "${PROJECT_DIR}")

if [ -z "${ELIGIBLE_PRD}" ]; then
  log "SKIP: No eligible PRDs (all done, in-progress, or blocked)"
  exit 0
fi

# Claim the PRD to prevent other runs from selecting it
claim_prd "${PRD_DIR}" "${ELIGIBLE_PRD}"
CLAIMED=1

PRD_NAME="${ELIGIBLE_PRD%.md}"
BRANCH_NAME="night-watch/${PRD_NAME}"

log "START: Processing ${ELIGIBLE_PRD} on branch ${BRANCH_NAME} in runtime workspace ${RUNTIME_PROJECT_DIR}"

if ! prepare_branch_checkout "${RUNTIME_PROJECT_DIR}" "${BRANCH_NAME}" "${DEFAULT_BRANCH}" "${LOG_FILE}"; then
  log "FAIL: Could not prepare branch ${BRANCH_NAME} in runtime workspace"
  night_watch_history record "${PROJECT_DIR}" "${ELIGIBLE_PRD}" failure --exit-code 1 2>/dev/null || true
  exit 1
fi

PROMPT="Implement the PRD at docs/PRDs/night-watch/${ELIGIBLE_PRD}

## Setup
- You are already inside an isolated runtime workspace: ${RUNTIME_PROJECT_DIR}
- Current branch is already prepared: ${BRANCH_NAME}
- Do not run git checkout/switch in ${PROJECT_DIR}
- Do not create or remove worktrees; the runtime controller handles isolation and cleanup

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

# Dry-run mode: print diagnostics and exit
if [ "${NW_DRY_RUN:-0}" = "1" ]; then
  log "DRY-RUN: Would process ${ELIGIBLE_PRD}"
  log "DRY-RUN: Provider: ${PROVIDER_CMD}"
  log "DRY-RUN: Runtime: ${MAX_RUNTIME}s"
  echo "=== Dry Run: PRD Executor ==="
  echo "Provider:    ${PROVIDER_CMD}"
  echo "Eligible PRD: ${ELIGIBLE_PRD}"
  echo "Branch:      ${BRANCH_NAME}"
  echo "Runtime Dir: ${RUNTIME_PROJECT_DIR}"
  echo "Timeout:     ${MAX_RUNTIME}s"
  exit 0
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

while [ "${ATTEMPT}" -lt "${MAX_RETRIES}" ]; do
  EXIT_CODE=0

  case "${PROVIDER_CMD}" in
    claude)
      if (
        cd "${RUNTIME_PROJECT_DIR}" && timeout "${MAX_RUNTIME}" \
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
        cd "${RUNTIME_PROJECT_DIR}" && timeout "${MAX_RUNTIME}" \
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

  # Check if this was a rate limit (429) error
  if check_rate_limited "${LOG_FILE}"; then
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

if [ ${EXIT_CODE} -eq 0 ]; then
  PR_EXISTS=$(cd "${RUNTIME_PROJECT_DIR}" && gh pr list --state open --json headRefName --jq '.[].headRefName' 2>/dev/null | grep -cF "${BRANCH_NAME}" || echo "0")
  if [ "${PR_EXISTS}" -gt 0 ]; then
    release_claim "${PRD_DIR}" "${ELIGIBLE_PRD}"
    CLAIMED=0
    if ! checkout_default_branch "${RUNTIME_PROJECT_DIR}" "${DEFAULT_BRANCH}" "${LOG_FILE}"; then
      log "WARN: Could not switch runtime workspace to ${DEFAULT_BRANCH}; PRD not moved to done/"
      exit 0
    fi

    mark_prd_done "${PRD_DIR}" "${ELIGIBLE_PRD}"
    night_watch_history record "${PROJECT_DIR}" "${ELIGIBLE_PRD}" success --exit-code 0 2>/dev/null || true
    if [[ "${PRD_DIR_REL}" = /* ]]; then
      log "WARN: PRD directory is absolute; skipping auto-commit of done/ move"
    else
      git -C "${RUNTIME_PROJECT_DIR}" add -A "${PRD_DIR_REL}/" || true
      git -C "${RUNTIME_PROJECT_DIR}" commit -m "chore: mark ${ELIGIBLE_PRD} as done (PR opened on ${BRANCH_NAME})

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>" || true
      git -C "${RUNTIME_PROJECT_DIR}" push origin "${DEFAULT_BRANCH}" || true
    fi
    log "DONE: ${ELIGIBLE_PRD} implemented, PR opened, PRD moved to done/"
  else
    log "WARN: ${PROVIDER_CMD} exited 0 but no PR found on ${BRANCH_NAME} — PRD NOT moved to done"
  fi
elif [ ${EXIT_CODE} -eq 124 ]; then
  log "TIMEOUT: Night watch killed after ${MAX_RUNTIME}s while processing ${ELIGIBLE_PRD}"
  night_watch_history record "${PROJECT_DIR}" "${ELIGIBLE_PRD}" timeout --exit-code 124 2>/dev/null || true
else
  log "FAIL: Night watch exited with code ${EXIT_CODE} while processing ${ELIGIBLE_PRD}"
  night_watch_history record "${PROJECT_DIR}" "${ELIGIBLE_PRD}" failure --exit-code "${EXIT_CODE}" 2>/dev/null || true
fi
