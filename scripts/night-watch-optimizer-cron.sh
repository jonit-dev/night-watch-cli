#!/usr/bin/env bash
set -euo pipefail

# Night Watch Optimizer Cron Runner
# Usage: night-watch-optimizer-cron.sh /path/to/project

PROJECT_DIR="${1:?Usage: $0 /path/to/project}"
PROJECT_NAME=$(basename "${PROJECT_DIR}")
LOG_DIR="${PROJECT_DIR}/logs"
LOG_FILE="${LOG_DIR}/optimizer.log"
REPORT_FILE="${LOG_DIR}/optimizer-report.md"
RESULT_FILE="${LOG_DIR}/optimizer-result.json"
MAX_RUNTIME="${NW_OPTIMIZER_MAX_RUNTIME:-0}"
BRANCH_PREFIX="${NW_OPTIMIZER_BRANCH_PREFIX:-night-watch/optimizer}"
PR_LABEL="${NW_OPTIMIZER_PR_LABEL:-optimization}"
TARGET_SCOPE="${NW_OPTIMIZER_TARGET_SCOPE:-}"
MAX_FINDINGS_TO_INSPECT="${NW_OPTIMIZER_MAX_FINDINGS_TO_INSPECT:-5}"
VERIFICATION_COMMAND="${NW_OPTIMIZER_VERIFICATION_COMMAND:-}"
PROVIDER_CMD="${NW_PROVIDER_CMD:-claude}"
PROVIDER_LABEL="${NW_PROVIDER_LABEL:-}"
SCRIPT_TYPE="optimizer"
SCRIPT_START_TIME=$(date +%s)
MAX_LOG_SIZE="524288"

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

write_abort_report() {
  local reason="${1:?reason required}"
  mkdir -p "${LOG_DIR}"
  if [ ! -f "${REPORT_FILE}" ]; then
    {
      echo "# Optimizer Report"
      echo
      echo "No optimizer PR was opened."
      echo
      echo "Reason: ${reason}"
    } > "${REPORT_FILE}"
  fi
}

json_string() {
  local file="${1:?file required}"
  local key="${2:?key required}"
  jq -r --arg key "${key}" '.[$key] // ""' "${file}" 2>/dev/null || true
}

json_bool_true() {
  local file="${1:?file required}"
  local key="${2:?key required}"
  [ "$(jq -r --arg key "${key}" '.[$key] == true' "${file}" 2>/dev/null || echo false)" = "true" ]
}

slugify() {
  printf '%s' "${1:-optimizer-target}" \
    | tr '[:upper:]' '[:lower:]' \
    | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//' \
    | cut -c 1-72
}

copy_optimizer_artifacts() {
  if [ -f "${OPTIMIZER_WORKTREE_DIR}/logs/optimizer-report.md" ]; then
    cp "${OPTIMIZER_WORKTREE_DIR}/logs/optimizer-report.md" "${REPORT_FILE}"
  fi
  if [ -f "${OPTIMIZER_WORKTREE_DIR}/logs/optimizer-result.json" ]; then
    cp "${OPTIMIZER_WORKTREE_DIR}/logs/optimizer-result.json" "${RESULT_FILE}"
  fi
}

if ! validate_provider "${PROVIDER_CMD}"; then
  echo "ERROR: Unknown provider: ${PROVIDER_CMD}" >&2
  emit_result "failure" "reason=unknown_provider"
  exit 1
fi

if ! ensure_provider_on_path "${PROVIDER_CMD}"; then
  echo "ERROR: Provider '${PROVIDER_CMD}' not found in PATH or common installation locations" >&2
  emit_result "failure" "reason=provider_not_found"
  exit 1
fi

PROJECT_RUNTIME_KEY=$(project_runtime_key "${PROJECT_DIR}")
LOCK_FILE="/tmp/night-watch-optimizer-${PROJECT_RUNTIME_KEY}.lock"
PROVIDER_MODEL_DISPLAY=$(resolve_provider_model_display "${PROVIDER_CMD}" "${PROVIDER_LABEL}")

if [ "${NW_QUEUE_ENABLED:-0}" = "1" ]; then
  if [ "${NW_QUEUE_DISPATCHED:-0}" = "1" ]; then
    arm_global_queue_cleanup
  else
    claim_or_enqueue "${SCRIPT_TYPE}" "${PROJECT_DIR}"
  fi
fi

rotate_log
log_separator
log "RUN-START: optimizer invoked project=${PROJECT_DIR} provider=${PROVIDER_CMD} dry_run=${NW_DRY_RUN:-0}"
log "CONFIG: max_runtime=${MAX_RUNTIME}s branch_prefix=${BRANCH_PREFIX} target_scope=${TARGET_SCOPE:-repo} max_findings=${MAX_FINDINGS_TO_INSPECT}"

if ! acquire_lock "${LOCK_FILE}"; then
  emit_result "skip_locked"
  exit 0
fi

send_telegram_status_message "⚙️ Night Watch Optimizer: started" "Project: ${PROJECT_NAME}
Provider (model): ${PROVIDER_MODEL_DISPLAY}
Action: scanning for one provable performance improvement."

if [ "${NW_DRY_RUN:-0}" = "1" ]; then
  echo "=== Dry Run: Optimizer ==="
  echo "Provider (model): ${PROVIDER_MODEL_DISPLAY}"
  echo "Target Scope: ${TARGET_SCOPE:-repo}"
  echo "Branch Prefix: ${BRANCH_PREFIX}"
  echo "PR Label: ${PR_LABEL}"
  echo "Scanner Command: bash ${SCRIPT_DIR}/night-watch-optimizer-scan.sh"
  echo "Verification Command: ${VERIFICATION_COMMAND:-auto-detect}"
  echo "Report File: ${REPORT_FILE}"
  emit_result "skip_dry_run"
  exit 0
fi

if [ -n "${NW_DEFAULT_BRANCH:-}" ]; then
  DEFAULT_BRANCH="${NW_DEFAULT_BRANCH}"
else
  DEFAULT_BRANCH=$(detect_default_branch "${PROJECT_DIR}")
fi

OPTIMIZER_WORKTREE_BASENAME="${PROJECT_NAME}-nw-optimizer-runner"
OPTIMIZER_WORKTREE_DIR="$(dirname "${PROJECT_DIR}")/${OPTIMIZER_WORKTREE_BASENAME}"

cleanup_optimizer_worktree_on_exit() {
  cleanup_worktree_path "${PROJECT_DIR}" "${OPTIMIZER_WORKTREE_DIR}"
}

append_exit_trap "cleanup_optimizer_worktree_on_exit"
cleanup_worktrees "${PROJECT_DIR}" "${OPTIMIZER_WORKTREE_BASENAME}"

if ! prepare_detached_worktree "${PROJECT_DIR}" "${OPTIMIZER_WORKTREE_DIR}" "${DEFAULT_BRANCH}" "${LOG_FILE}"; then
  log "FAIL: Unable to create isolated optimizer worktree ${OPTIMIZER_WORKTREE_DIR}"
  write_abort_report "worktree_setup_failed"
  emit_result "failure" "reason=worktree_setup_failed"
  exit 1
fi

if ! assert_isolated_worktree "${PROJECT_DIR}" "${OPTIMIZER_WORKTREE_DIR}" "optimizer"; then
  log "FAIL: Optimizer worktree guard rejected ${OPTIMIZER_WORKTREE_DIR}"
  write_abort_report "worktree_guard_failed"
  emit_result "failure" "reason=worktree_guard_failed"
  exit 1
fi

mkdir -p "${OPTIMIZER_WORKTREE_DIR}/logs"

SCAN_FILE="${OPTIMIZER_WORKTREE_DIR}/logs/optimizer-scan.md"
if ! bash "${SCRIPT_DIR}/night-watch-optimizer-scan.sh" "${OPTIMIZER_WORKTREE_DIR}" "${TARGET_SCOPE}" > "${SCAN_FILE}" 2>> "${LOG_FILE}"; then
  log "FAIL: Optimizer scanner failed"
  write_abort_report "scanner_failed"
  emit_result "failure" "reason=scanner_failed"
  exit 1
fi

OPTIMIZER_CONTRACT="$(cat "${SCRIPT_DIR}/../templates/optimizer.md")"
RUN_TEMPLATE="$(cat "${SCRIPT_DIR}/../templates/night-watch-optimizer.md")"
OPTIMIZER_PROMPT="${RUN_TEMPLATE}"
OPTIMIZER_PROMPT="${OPTIMIZER_PROMPT//\{\{PROJECT_NAME\}\}/${PROJECT_NAME}}"
OPTIMIZER_PROMPT="${OPTIMIZER_PROMPT//\{\{TARGET_SCOPE\}\}/${TARGET_SCOPE:-repo}}"
OPTIMIZER_PROMPT="${OPTIMIZER_PROMPT//\{\{SCANNER_COMMAND\}\}/bash ${SCRIPT_DIR}/night-watch-optimizer-scan.sh}"
OPTIMIZER_PROMPT="${OPTIMIZER_PROMPT//\{\{VERIFICATION_COMMAND\}\}/${VERIFICATION_COMMAND:-auto-detect}}"
OPTIMIZER_PROMPT="${OPTIMIZER_PROMPT//\{\{MAX_FINDINGS_TO_INSPECT\}\}/${MAX_FINDINGS_TO_INSPECT}}"
OPTIMIZER_PROMPT="${OPTIMIZER_PROMPT//\{\{OPTIMIZER_CONTRACT\}\}/${OPTIMIZER_CONTRACT}}"
OPTIMIZER_PROMPT="${OPTIMIZER_PROMPT//\{\{MAX_FINDINGS_TO_INSPECT\}\}/${MAX_FINDINGS_TO_INSPECT}}"

mapfile -d '' -t PROVIDER_CMD_PARTS < <(build_provider_cmd "${OPTIMIZER_WORKTREE_DIR}" "${OPTIMIZER_PROMPT}")

EXIT_CODE=0
if (cd "${OPTIMIZER_WORKTREE_DIR}" && run_with_optional_timeout "${MAX_RUNTIME}" "${PROVIDER_CMD_PARTS[@]}" 2>&1 | tee -a "${LOG_FILE}"); then
  EXIT_CODE=0
else
  EXIT_CODE=$?
fi

copy_optimizer_artifacts

if [ "${EXIT_CODE}" -eq 124 ]; then
  log "TIMEOUT: Optimizer killed after ${MAX_RUNTIME}s"
  write_abort_report "timeout"
  send_telegram_status_message "⚙️ Night Watch Optimizer: timeout" "Project: ${PROJECT_NAME}
Provider (model): ${PROVIDER_MODEL_DISPLAY}
No PR opened."
  emit_result "timeout"
  exit 124
fi

if [ "${EXIT_CODE}" -ne 0 ]; then
  log "FAIL: Optimizer provider exited with code ${EXIT_CODE}"
  write_abort_report "provider_exit_${EXIT_CODE}"
  emit_result "failure" "provider_exit=${EXIT_CODE}"
  exit "${EXIT_CODE}"
fi

if [ ! -f "${RESULT_FILE}" ]; then
  log "ABORT: Missing optimizer-result.json; no PR opened"
  write_abort_report "missing_result_json"
  emit_result "skip_unproven" "reason=missing_result_json"
  exit 0
fi

if ! json_bool_true "${RESULT_FILE}" "improved"; then
  log "ABORT: Optimizer did not prove an improvement; no PR opened"
  write_abort_report "no_measurable_improvement"
  emit_result "skip_unproven" "reason=no_measurable_improvement"
  exit 0
fi

if ! json_bool_true "${RESULT_FILE}" "verificationPassed"; then
  log "ABORT: Optimizer verification did not pass; no PR opened"
  write_abort_report "verification_failed"
  emit_result "skip_unproven" "reason=verification_failed"
  exit 0
fi

if [ -z "$(git -C "${OPTIMIZER_WORKTREE_DIR}" status --porcelain)" ]; then
  log "ABORT: Optimizer reported success but made no changes; no PR opened"
  write_abort_report "no_worktree_changes"
  emit_result "skip_no_changes"
  exit 0
fi

TARGET_SLUG="$(slugify "$(json_string "${RESULT_FILE}" "targetSlug")")"
if [ -z "${TARGET_SLUG}" ]; then
  TARGET_SLUG="proven-improvement"
fi
BRANCH_NAME="${BRANCH_PREFIX%/}/${TARGET_SLUG}"

git -C "${OPTIMIZER_WORKTREE_DIR}" switch -c "${BRANCH_NAME}" >> "${LOG_FILE}" 2>&1
git -C "${OPTIMIZER_WORKTREE_DIR}" add -A
git -C "${OPTIMIZER_WORKTREE_DIR}" commit -m "perf: optimize ${TARGET_SLUG}" >> "${LOG_FILE}" 2>&1

if ! git_push_for_project "${OPTIMIZER_WORKTREE_DIR}" origin "${BRANCH_NAME}" >> "${LOG_FILE}" 2>&1; then
  log "FAIL: Unable to push optimizer branch ${BRANCH_NAME}"
  write_abort_report "push_failed"
  emit_result "failure" "reason=push_failed|branch=${BRANCH_NAME}"
  exit 1
fi

ensure_github_label "${PR_LABEL}" "Night Watch optimizer PR" "1d76db"

PR_BODY_FILE="${OPTIMIZER_WORKTREE_DIR}/logs/optimizer-pr-body.md"
{
  echo "## Bottleneck Summary"
  echo
  json_string "${RESULT_FILE}" "bottleneckSummary"
  echo
  echo "## Baseline Evidence"
  echo
  json_string "${RESULT_FILE}" "baselineEvidence"
  echo
  echo "## Change Summary"
  echo
  json_string "${RESULT_FILE}" "changeSummary"
  echo
  echo "## After Evidence"
  echo
  json_string "${RESULT_FILE}" "afterEvidence"
  echo
  echo "## Tests and Verification"
  echo
  json_string "${RESULT_FILE}" "verification"
  echo
  echo "## Residual Risk"
  echo
  json_string "${RESULT_FILE}" "residualRisk"
} > "${PR_BODY_FILE}"

PR_TITLE="perf: optimize ${TARGET_SLUG}"
CREATE_ARGS=(
  --draft
  --base "${DEFAULT_BRANCH}"
  --head "${BRANCH_NAME}"
  --title "${PR_TITLE}"
  --body-file "${PR_BODY_FILE}"
)
if [ -n "${PR_LABEL}" ]; then
  CREATE_ARGS+=(--label "${PR_LABEL}")
fi

CREATE_OUTPUT=""
if ! CREATE_OUTPUT=$(gh pr create "${CREATE_ARGS[@]}" 2>> "${LOG_FILE}"); then
  log "FAIL: gh pr create failed for optimizer branch ${BRANCH_NAME}"
  write_abort_report "pr_create_failed"
  emit_result "failure" "reason=pr_create_failed|branch=${BRANCH_NAME}"
  exit 1
fi

PR_URL=$(printf '%s' "${CREATE_OUTPUT}" | grep -Eo 'https://[^[:space:]]+/pull/[0-9]+' | tail -n 1 || true)
TOTAL_ELAPSED=$(( $(date +%s) - SCRIPT_START_TIME ))
log "DONE: Optimizer opened draft PR ${PR_URL:-unknown} branch=${BRANCH_NAME} elapsed=${TOTAL_ELAPSED}s"
send_telegram_status_message "⚙️ Night Watch Optimizer: PR opened" "Project: ${PROJECT_NAME}
Provider (model): ${PROVIDER_MODEL_DISPLAY}
Branch: ${BRANCH_NAME}
PR: ${PR_URL:-unknown}"
emit_result "success_pr" "branch=${BRANCH_NAME}|pr=${PR_URL:-unknown}"
