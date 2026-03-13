#!/usr/bin/env bash
set -euo pipefail

# Night Watch Slicer Cron Runner (project-agnostic)
# Usage: night-watch-slicer-cron.sh /path/to/project
#
# This is a thin wrapper that acquires a lock and calls `night-watch slice`.
# The CLI command handles all the logic directly in TypeScript.
#
# NOTE: This script expects environment variables to be set by the caller.
# The Node.js CLI will inject config values via environment variables.
# Required env vars (with defaults shown):
#   NW_SLICER_MAX_RUNTIME=600  - Maximum runtime in seconds (10 minutes)
#   NW_PROVIDER_CMD=claude     - AI provider CLI to use (claude, codex, etc.)
#   NW_DRY_RUN=0               - Set to 1 for dry-run mode (prints diagnostics only)

PROJECT_DIR="${1:?Usage: $0 /path/to/project}"
PROJECT_NAME=$(basename "${PROJECT_DIR}")
LOG_DIR="${PROJECT_DIR}/logs"
LOG_FILE="${LOG_DIR}/slicer.log"
LOCK_FILE=""
MAX_RUNTIME="${NW_SLICER_MAX_RUNTIME:-600}"  # 10 minutes
MAX_LOG_SIZE="524288"  # 512 KB
PROVIDER_CMD="${NW_PROVIDER_CMD:-claude}"
PROVIDER_LABEL="${NW_PROVIDER_LABEL:-}"
SCRIPT_START_TIME=$(date +%s)

mkdir -p "${LOG_DIR}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=night-watch-helpers.sh
source "${SCRIPT_DIR}/night-watch-helpers.sh"

# Ensure provider CLI is on PATH (nvm, fnm, volta, common bin dirs)
ensure_provider_on_path "${PROVIDER_CMD}" || true
PROJECT_RUNTIME_KEY=$(project_runtime_key "${PROJECT_DIR}")
LOCK_FILE="/tmp/night-watch-slicer-${PROJECT_RUNTIME_KEY}.lock"
PROVIDER_MODEL_DISPLAY=$(resolve_provider_model_display "${PROVIDER_CMD}" "${PROVIDER_LABEL}")

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
log_separator
log "RUN-START: slicer invoked project=${PROJECT_DIR} provider=${PROVIDER_CMD} dry_run=${NW_DRY_RUN:-0}"
log "CONFIG: max_runtime=${MAX_RUNTIME}s roadmap_path=${NW_ROADMAP_PATH:-ROADMAP.md}"

if ! acquire_lock "${LOCK_FILE}"; then
  exit 0
fi
# ── Global Job Queue Gate ────────────────────────────────────────────────────
# Atomically claim a DB slot or enqueue for later dispatch — no flock needed.
if [ "${NW_QUEUE_ENABLED:-0}" = "1" ]; then
  if [ "${NW_QUEUE_DISPATCHED:-0}" = "1" ]; then
    arm_global_queue_cleanup
  else
    claim_or_enqueue "slicer" "${PROJECT_DIR}"
  fi
fi
# ──────────────────────────────────────────────────────────────────────────────
cleanup_on_exit() {
  rm -f "${LOCK_FILE}"
}

trap cleanup_on_exit EXIT

log "START: Running roadmap slicer for ${PROJECT_DIR}"
send_telegram_status_message "📋 Night Watch Planner: started" "Project: ${PROJECT_NAME}
Provider (model): ${PROVIDER_MODEL_DISPLAY}
Roadmap path: ${NW_ROADMAP_PATH:-ROADMAP.md}
Action: planning next roadmap item into a PRD."

# Dry-run mode: print diagnostics and exit
if [ "${NW_DRY_RUN:-0}" = "1" ]; then
  echo "=== Dry Run: Roadmap Slicer ==="
  echo "Provider (model): ${PROVIDER_MODEL_DISPLAY}"
  echo "Project Dir: ${PROJECT_DIR}"
  echo "Roadmap Path: ${NW_ROADMAP_PATH:-ROADMAP.md}"
  echo "Timeout: ${MAX_RUNTIME}s"
  exit 0
fi

# Resolve night-watch CLI
CLI_BIN=""
if ! CLI_BIN=$(resolve_night_watch_cli); then
  log "ERROR: Could not resolve night-watch CLI"
  send_telegram_status_message "📋 Night Watch Planner: failed" "Project: ${PROJECT_NAME}
Provider (model): ${PROVIDER_MODEL_DISPLAY}
Failure reason: cli_not_found"
  exit 1
fi

# Run the slice command with timeout
EXIT_CODE=0
SLICER_RUN_START=$(date +%s)
log "SLICER: Starting night-watch slice timeout=${MAX_RUNTIME}s"
if timeout "${MAX_RUNTIME}" "${CLI_BIN}" slice >> "${LOG_FILE}" 2>&1; then
  EXIT_CODE=0
else
  EXIT_CODE=$?
fi

SLICER_ELAPSED=$(( $(date +%s) - SLICER_RUN_START ))
SLICER_TOTAL_ELAPSED=$(( $(date +%s) - SCRIPT_START_TIME ))
log "OUTCOME: exit_code=${EXIT_CODE} run_elapsed=${SLICER_ELAPSED}s total_elapsed=${SLICER_TOTAL_ELAPSED}s project=${PROJECT_NAME}"

if [ ${EXIT_CODE} -eq 0 ]; then
  log "DONE: Slicer completed successfully"
  send_telegram_status_message "📋 Night Watch Planner: completed" "Project: ${PROJECT_NAME}
Provider (model): ${PROVIDER_MODEL_DISPLAY}
PRD planning run finished successfully."
elif [ ${EXIT_CODE} -eq 124 ]; then
  log "TIMEOUT: Slicer killed after ${MAX_RUNTIME}s"
  send_telegram_status_message "📋 Night Watch Planner: timeout" "Project: ${PROJECT_NAME}
Provider (model): ${PROVIDER_MODEL_DISPLAY}
Timeout: ${MAX_RUNTIME}s"
else
  log "FAIL: Slicer exited with code ${EXIT_CODE}"
  send_telegram_status_message "📋 Night Watch Planner: failed" "Project: ${PROJECT_NAME}
Provider (model): ${PROVIDER_MODEL_DISPLAY}
Failure reason: provider_exit_${EXIT_CODE}
Exit code: ${EXIT_CODE}"
fi
exit ${EXIT_CODE}
