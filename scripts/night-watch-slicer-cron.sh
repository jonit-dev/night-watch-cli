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
LOG_FILE="${LOG_DIR}/night-watch-slicer.log"
LOCK_FILE=""
MAX_RUNTIME="${NW_SLICER_MAX_RUNTIME:-600}"  # 10 minutes
MAX_LOG_SIZE="524288"  # 512 KB
PROVIDER_CMD="${NW_PROVIDER_CMD:-claude}"

# Ensure NVM / Node / Night Watch CLI are on PATH
export NVM_DIR="${HOME}/.nvm"
[ -s "${NVM_DIR}/nvm.sh" ] && . "${NVM_DIR}/nvm.sh"

mkdir -p "${LOG_DIR}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=night-watch-helpers.sh
source "${SCRIPT_DIR}/night-watch-helpers.sh"
PROJECT_RUNTIME_KEY=$(project_runtime_key "${PROJECT_DIR}")
LOCK_FILE="/tmp/night-watch-slicer-${PROJECT_RUNTIME_KEY}.lock"

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
}

trap cleanup_on_exit EXIT

log "START: Running roadmap slicer for ${PROJECT_DIR}"

# Dry-run mode: print diagnostics and exit
if [ "${NW_DRY_RUN:-0}" = "1" ]; then
  echo "=== Dry Run: Roadmap Slicer ==="
  echo "Provider: ${PROVIDER_CMD}"
  echo "Project Dir: ${PROJECT_DIR}"
  echo "Timeout: ${MAX_RUNTIME}s"
  exit 0
fi

# Resolve night-watch CLI
CLI_BIN=""
if ! CLI_BIN=$(resolve_night_watch_cli); then
  log "ERROR: Could not resolve night-watch CLI"
  exit 1
fi

# Run the slice command with timeout
EXIT_CODE=0
if timeout "${MAX_RUNTIME}" "${CLI_BIN}" slice >> "${LOG_FILE}" 2>&1; then
  EXIT_CODE=0
else
  EXIT_CODE=$?
fi

if [ ${EXIT_CODE} -eq 0 ]; then
  log "DONE: Slicer completed successfully"
elif [ ${EXIT_CODE} -eq 124 ]; then
  log "TIMEOUT: Slicer killed after ${MAX_RUNTIME}s"
else
  log "FAIL: Slicer exited with code ${EXIT_CODE}"
fi

exit ${EXIT_CODE}
