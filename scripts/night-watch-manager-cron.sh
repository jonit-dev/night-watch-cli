#!/usr/bin/env bash
set -euo pipefail

# Night Watch Manager Cron Runner
# Usage: night-watch-manager-cron.sh /path/to/project

PROJECT_DIR="${1:?Usage: $0 /path/to/project}"
PROJECT_NAME=$(basename "${PROJECT_DIR}")
LOG_DIR="${PROJECT_DIR}/logs"
LOG_FILE="${LOG_DIR}/manager.log"
MAX_LOG_SIZE="524288"
SCRIPT_TYPE="manager"

mkdir -p "${LOG_DIR}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=night-watch-helpers.sh
source "${SCRIPT_DIR}/night-watch-helpers.sh"
skip_if_job_paused "${SCRIPT_TYPE}" "${PROJECT_DIR}"

emit_result() {
  local status="${1:?status required}"
  local details="${2:-}"
  if [ -n "${details}" ]; then
    echo "NIGHT_WATCH_RESULT:${status}|${details}"
  else
    echo "NIGHT_WATCH_RESULT:${status}"
  fi
}

PROJECT_RUNTIME_KEY=$(project_runtime_key "${PROJECT_DIR}")
# NOTE: Lock file path must match managerLockPath() in src/utils/status-data.ts
LOCK_FILE="/tmp/night-watch-manager-${PROJECT_RUNTIME_KEY}.lock"

if [ "${NW_QUEUE_ENABLED:-0}" = "1" ]; then
  if [ "${NW_QUEUE_DISPATCHED:-0}" = "1" ]; then
    arm_global_queue_cleanup
  else
    claim_or_enqueue "${SCRIPT_TYPE}" "${PROJECT_DIR}"
  fi
fi

rotate_log
log_separator
log "RUN-START: manager invoked project=${PROJECT_DIR}"

if ! acquire_lock "${LOCK_FILE}"; then
  emit_result "skip_locked"
  exit 0
fi
trap 'release_lock "${LOCK_FILE}"' EXIT

CLI_BIN=$(resolve_night_watch_cli) || {
  echo "ERROR: Cannot resolve night-watch CLI" >&2
  emit_result "failure" "reason=cli_not_found"
  exit 1
}

cd "${PROJECT_DIR}"
"${CLI_BIN}" manager --json
emit_result "success"
