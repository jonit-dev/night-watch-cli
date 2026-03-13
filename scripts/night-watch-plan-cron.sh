#!/usr/bin/env bash
set -euo pipefail

# Night Watch Plan Runner (project-agnostic)
# Usage: night-watch-plan-cron.sh /path/to/project
#
# NOTE: This script expects environment variables to be set by the caller.
# The Node.js CLI will inject config values via environment variables.
# Required env vars (with defaults shown):
#   NW_PLAN_TASK=''          - Task/feature description to plan (required)
#   NW_PRD_DIR=docs/PRDs     - PRD output directory (relative to project)
#   NW_PLAN_MAX_RUNTIME=1800 - Maximum runtime in seconds
#   NW_PROVIDER_CMD=claude   - AI provider CLI to use
#   NW_DRY_RUN=0             - Set to 1 for dry-run mode

PROJECT_DIR="${1:?Usage: $0 /path/to/project}"
PROJECT_NAME=$(basename "${PROJECT_DIR}")
LOG_DIR="${PROJECT_DIR}/logs"
LOG_FILE="${LOG_DIR}/plan.log"
MAX_RUNTIME="${NW_PLAN_MAX_RUNTIME:-1800}"
MAX_LOG_SIZE="524288"  # 512 KB
PROVIDER_CMD="${NW_PROVIDER_CMD:-claude}"
PROVIDER_LABEL="${NW_PROVIDER_LABEL:-}"
SCRIPT_START_TIME=$(date +%s)

mkdir -p "${LOG_DIR}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=night-watch-helpers.sh
source "${SCRIPT_DIR}/night-watch-helpers.sh"

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

# Ensure provider CLI is on PATH
if ! ensure_provider_on_path "${PROVIDER_CMD}"; then
  echo "ERROR: Provider '${PROVIDER_CMD}' not found in PATH or common installation locations" >&2
  emit_result "failure" "reason=provider_not_found"
  exit 1
fi

PROVIDER_MODEL_DISPLAY=$(resolve_provider_model_display "${PROVIDER_CMD}" "${PROVIDER_LABEL}")
PRD_DIR="${NW_PRD_DIR:-docs/PRDs}"
PLAN_TASK="${NW_PLAN_TASK:-}"

rotate_log
log_separator
log "RUN-START: planner invoked project=${PROJECT_DIR} provider=${PROVIDER_CMD} dry_run=${NW_DRY_RUN:-0}"
log "CONFIG: max_runtime=${MAX_RUNTIME}s prd_dir=${PRD_DIR}"

# Dry-run mode
if [ "${NW_DRY_RUN:-0}" = "1" ]; then
  echo "=== Dry Run: PRD Planner ==="
  echo "Provider (model): ${PROVIDER_MODEL_DISPLAY}"
  echo "Task: ${PLAN_TASK:-<none>}"
  echo "PRD Directory: ${PRD_DIR}"
  emit_result "skip_dry_run"
  exit 0
fi

# Resolve prd-creator instructions (project instructions/ > .claude/commands/ > bundled templates/)
CREATOR_PROMPT_PATH=$(resolve_instruction_path "${PROJECT_DIR}" "prd-creator.md" || true)
if [ -z "${CREATOR_PROMPT_PATH}" ]; then
  log "FAIL: Missing prd-creator instructions. Checked instructions/, .claude/commands/, and bundled templates/"
  emit_result "failure_missing_prompt"
  exit 1
fi

CREATOR_PROMPT="$(cat "${CREATOR_PROMPT_PATH}")"

# Append the task description if provided
if [ -n "${PLAN_TASK}" ]; then
  CREATOR_PROMPT="${CREATOR_PROMPT}

---

## Your Task

You are planning the following feature for the project in the current directory:

**Task:** ${PLAN_TASK}

**PRD Directory:** ${PRD_DIR}

Explore the codebase, determine an appropriate output filename based on the task title, and create the PRD following the skill instructions above. Write the PRD file to \`${PRD_DIR}/<slugified-task-name>.md\`."
fi

log "START: Running PRD planner for ${PROJECT_NAME} (provider: ${PROVIDER_CMD})"

EXIT_CODE=0

# Build provider command array using generic helper
mapfile -d '' -t PROVIDER_CMD_PARTS < <(build_provider_cmd "${PROJECT_DIR}" "${CREATOR_PROMPT}")

# Execute in the project directory so the provider can explore the codebase
if (cd "${PROJECT_DIR}" && timeout "${MAX_RUNTIME}" "${PROVIDER_CMD_PARTS[@]}" 2>&1 | tee -a "${LOG_FILE}"); then
  EXIT_CODE=0
else
  EXIT_CODE=$?
fi

ELAPSED=$(( $(date +%s) - SCRIPT_START_TIME ))
log "OUTCOME: exit_code=${EXIT_CODE} elapsed=${ELAPSED}s project=${PROJECT_NAME}"

if [ "${EXIT_CODE}" -eq 0 ]; then
  log "DONE: Planner complete"
  emit_result "success_plan"
elif [ "${EXIT_CODE}" -eq 124 ]; then
  log "TIMEOUT: Planner killed after ${MAX_RUNTIME}s"
  emit_result "timeout"
else
  log "FAIL: Planner exited with code ${EXIT_CODE}"
  emit_result "failure" "provider_exit=${EXIT_CODE}"
fi

exit "${EXIT_CODE}"
