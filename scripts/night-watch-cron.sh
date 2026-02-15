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
PRD_DIR="${PROJECT_DIR}/docs/PRDs/night-watch"
LOG_DIR="${PROJECT_DIR}/logs"
LOG_FILE="${LOG_DIR}/night-watch.log"
LOCK_FILE="/tmp/night-watch-${PROJECT_NAME}.lock"
MAX_RUNTIME="${NW_MAX_RUNTIME:-7200}"  # 2 hours
MAX_LOG_SIZE="524288"  # 512 KB
PROVIDER_CMD="${NW_PROVIDER_CMD:-claude}"

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

# Validate provider
if ! validate_provider "${PROVIDER_CMD}"; then
  echo "ERROR: Unknown provider: ${PROVIDER_CMD}" >&2
  exit 1
fi

rotate_log

if ! acquire_lock "${LOCK_FILE}"; then
  exit 0
fi

cleanup_worktrees "${PROJECT_DIR}"

ELIGIBLE_PRD=$(find_eligible_prd "${PRD_DIR}")

if [ -z "${ELIGIBLE_PRD}" ]; then
  log "SKIP: No eligible PRDs (all done, in-progress, or blocked)"
  exit 0
fi

PRD_NAME="${ELIGIBLE_PRD%.md}"
BRANCH_NAME="night-watch/${PRD_NAME}"
DEFAULT_BRANCH=$(detect_default_branch "${PROJECT_DIR}")

log "START: Processing ${ELIGIBLE_PRD} on branch ${BRANCH_NAME}"

cd "${PROJECT_DIR}"

PROMPT="Implement the PRD at docs/PRDs/night-watch/${ELIGIBLE_PRD}

## Rules
- Branch name MUST be exactly: ${BRANCH_NAME}
- Create the branch from ${DEFAULT_BRANCH}: git checkout ${DEFAULT_BRANCH} && git pull origin ${DEFAULT_BRANCH} && git checkout -b ${BRANCH_NAME}
- Use a git worktree: git worktree add ../${PROJECT_NAME}-nw-${PRD_NAME} ${BRANCH_NAME}
- cd into the worktree, install dependencies, then implement
- Follow all CLAUDE.md conventions (if present)
- Write tests as specified in the PRD
- Run the project's verify/test command — fix until it passes
- Commit, push, and open a PR:
  git push -u origin ${BRANCH_NAME}
  gh pr create --title \"feat: <short title>\" --body \"<summary referencing PRD>\"
- After PR is created, clean up: git worktree remove ../${PROJECT_NAME}-nw-${PRD_NAME}
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
  echo "Timeout:     ${MAX_RUNTIME}s"
  exit 0
fi

case "${PROVIDER_CMD}" in
  claude)
    timeout "${MAX_RUNTIME}" \
      claude -p "${PROMPT}" \
        --dangerously-skip-permissions \
        >> "${LOG_FILE}" 2>&1
    ;;
  codex)
    timeout "${MAX_RUNTIME}" \
      codex --quiet \
        --yolo \
        --prompt "${PROMPT}" \
        >> "${LOG_FILE}" 2>&1
    ;;
  *)
    log "ERROR: Unknown provider: ${PROVIDER_CMD}"
    exit 1
    ;;
esac

EXIT_CODE=$?

if [ ${EXIT_CODE} -eq 0 ]; then
  PR_EXISTS=$(gh pr list --state open --json headRefName --jq '.[].headRefName' 2>/dev/null | grep -cF "${BRANCH_NAME}" || echo "0")
  if [ "${PR_EXISTS}" -gt 0 ]; then
    mark_prd_done "${PRD_DIR}" "${ELIGIBLE_PRD}"
    git -C "${PROJECT_DIR}" add -A docs/PRDs/night-watch/
    git -C "${PROJECT_DIR}" commit -m "chore: mark ${ELIGIBLE_PRD} as done (PR opened on ${BRANCH_NAME})

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>" || true
    git -C "${PROJECT_DIR}" push origin "${DEFAULT_BRANCH}" || true
    log "DONE: ${ELIGIBLE_PRD} implemented, PR opened, PRD moved to done/"
  else
    log "WARN: ${PROVIDER_CMD} exited 0 but no PR found on ${BRANCH_NAME} — PRD NOT moved to done"
  fi
elif [ ${EXIT_CODE} -eq 124 ]; then
  log "TIMEOUT: Night watch killed after ${MAX_RUNTIME}s while processing ${ELIGIBLE_PRD}"
  cleanup_worktrees "${PROJECT_DIR}"
else
  log "FAIL: Night watch exited with code ${EXIT_CODE} while processing ${ELIGIBLE_PRD}"
  cleanup_worktrees "${PROJECT_DIR}"
fi
