#!/usr/bin/env bash
set -euo pipefail

# Night Watch Audit Cron Runner (project-agnostic)
# Usage: night-watch-audit-cron.sh /path/to/project
#
# NOTE: This script expects environment variables to be set by the caller.
# The Node.js CLI will inject config values via environment variables.
# Required env vars (with defaults shown):
#   NW_AUDIT_MAX_RUNTIME=1800    - Maximum runtime in seconds (30 minutes)
#   NW_PROVIDER_CMD=claude       - AI provider CLI to use (claude, codex, etc.)
#   NW_DRY_RUN=0                 - Set to 1 for dry-run mode (prints diagnostics only)

PROJECT_DIR="${1:?Usage: $0 /path/to/project}"
PROJECT_NAME=$(basename "${PROJECT_DIR}")
LOG_DIR="${PROJECT_DIR}/logs"
LOG_FILE="${LOG_DIR}/audit.log"
REPORT_FILE="${PROJECT_DIR}/logs/audit-report.md"
MAX_RUNTIME="${NW_AUDIT_MAX_RUNTIME:-1800}"  # 30 minutes
MAX_LOG_SIZE="524288"  # 512 KB
PROVIDER_CMD="${NW_PROVIDER_CMD:-claude}"

# Ensure NVM / Node / Claude are on PATH
export NVM_DIR="${HOME}/.nvm"
[ -s "${NVM_DIR}/nvm.sh" ] && . "${NVM_DIR}/nvm.sh"

mkdir -p "${LOG_DIR}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=night-watch-helpers.sh
source "${SCRIPT_DIR}/night-watch-helpers.sh"
PROJECT_RUNTIME_KEY=$(project_runtime_key "${PROJECT_DIR}")
# NOTE: Lock file path must match auditLockPath() in src/utils/status-data.ts
LOCK_FILE="/tmp/night-watch-audit-${PROJECT_RUNTIME_KEY}.lock"
AUDIT_PROMPT_TEMPLATE="${SCRIPT_DIR}/../templates/night-watch-audit.md"

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
  emit_result "failure" "reason=unknown_provider"
  exit 1
fi

rotate_log

if ! acquire_lock "${LOCK_FILE}"; then
  emit_result "skip_locked"
  exit 0
fi

# Dry-run mode: print diagnostics and exit
if [ "${NW_DRY_RUN:-0}" = "1" ]; then
  echo "=== Dry Run: Code Auditor ==="
  echo "Provider: ${PROVIDER_CMD}"
  echo "Max Runtime: ${MAX_RUNTIME}s"
  echo "Report File: ${REPORT_FILE}"
  echo "Prompt Template: ${AUDIT_PROMPT_TEMPLATE}"
  emit_result "skip_dry_run"
  exit 0
fi

if [ ! -f "${AUDIT_PROMPT_TEMPLATE}" ]; then
  log "FAIL: Missing bundled audit prompt template at ${AUDIT_PROMPT_TEMPLATE}"
  emit_result "failure_missing_prompt"
  exit 1
fi

AUDIT_PROMPT="$(cat "${AUDIT_PROMPT_TEMPLATE}")"

if [ -n "${NW_DEFAULT_BRANCH:-}" ]; then
  DEFAULT_BRANCH="${NW_DEFAULT_BRANCH}"
else
  DEFAULT_BRANCH=$(detect_default_branch "${PROJECT_DIR}")
fi

AUDIT_WORKTREE_BASENAME="${PROJECT_NAME}-nw-audit-runner"
AUDIT_WORKTREE_DIR="$(dirname "${PROJECT_DIR}")/${AUDIT_WORKTREE_BASENAME}"

cleanup_worktrees "${PROJECT_DIR}" "${AUDIT_WORKTREE_BASENAME}"

if ! prepare_detached_worktree "${PROJECT_DIR}" "${AUDIT_WORKTREE_DIR}" "${DEFAULT_BRANCH}" "${LOG_FILE}"; then
  log "FAIL: Unable to create isolated audit worktree ${AUDIT_WORKTREE_DIR}"
  emit_result "failure" "reason=worktree_setup_failed"
  exit 1
fi

# Ensure the logs dir exists inside the worktree so the provider can write the report
mkdir -p "${AUDIT_WORKTREE_DIR}/logs"

log "START: Running code audit for ${PROJECT_NAME} (provider: ${PROVIDER_CMD})"

EXIT_CODE=0

case "${PROVIDER_CMD}" in
  claude)
    if (
      cd "${AUDIT_WORKTREE_DIR}" && timeout "${MAX_RUNTIME}" \
        claude -p "${AUDIT_PROMPT}" \
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
      cd "${AUDIT_WORKTREE_DIR}" && timeout "${MAX_RUNTIME}" \
        codex --quiet \
          --yolo \
          --prompt "${AUDIT_PROMPT}" \
          >> "${LOG_FILE}" 2>&1
    ); then
      EXIT_CODE=0
    else
      EXIT_CODE=$?
    fi
    ;;
  *)
    log "ERROR: Unknown provider: ${PROVIDER_CMD}"
    emit_result "failure" "reason=unknown_provider"
    exit 1
    ;;
esac

# Copy report back to project dir (if it was written in the worktree)
WORKTREE_REPORT="${AUDIT_WORKTREE_DIR}/logs/audit-report.md"
if [ -f "${WORKTREE_REPORT}" ]; then
  cp "${WORKTREE_REPORT}" "${REPORT_FILE}"
  log "INFO: Audit report copied to ${REPORT_FILE}"
fi

cleanup_worktrees "${PROJECT_DIR}" "${AUDIT_WORKTREE_BASENAME}"

if [ "${EXIT_CODE}" -eq 0 ]; then
  if [ ! -f "${REPORT_FILE}" ]; then
    log "FAIL: Audit provider exited 0 but no report was generated at ${REPORT_FILE}"
    emit_result "failure_no_report"
    exit 1
  fi

  if grep -q "NO_ISSUES_FOUND" "${REPORT_FILE}" 2>/dev/null; then
    log "DONE: Audit complete — no actionable issues found"
    emit_result "skip_clean"
  else
    log "DONE: Audit complete — report written to ${REPORT_FILE}"
    emit_result "success_audit"
  fi
elif [ "${EXIT_CODE}" -eq 124 ]; then
  log "TIMEOUT: Audit killed after ${MAX_RUNTIME}s"
  emit_result "timeout"
else
  log "FAIL: Audit exited with code ${EXIT_CODE}"
  emit_result "failure" "provider_exit=${EXIT_CODE}"
fi

exit "${EXIT_CODE}"
