#!/usr/bin/env bash
set -euo pipefail

# Night Watch QA Cron Runner (project-agnostic)
# Usage: night-watch-qa-cron.sh /path/to/project
#
# NOTE: This script expects environment variables to be set by the caller.
# The Node.js CLI will inject config values via environment variables.
# Required env vars (with defaults shown):
#   NW_QA_MAX_RUNTIME=3600            - Maximum runtime in seconds (1 hour)
#   NW_PROVIDER_CMD=claude            - AI provider CLI to use (claude, codex, etc.)
#   NW_BRANCH_PATTERNS=feat/,night-watch/ - Comma-separated branch prefixes to match
#   NW_QA_SKIP_LABEL=skip-qa          - Label to skip QA on a PR
#   NW_QA_ARTIFACTS=both              - Artifact mode (both, tests, report)
#   NW_QA_AUTO_INSTALL_PLAYWRIGHT=1   - Auto-install Playwright browsers
#   NW_DRY_RUN=0                      - Set to 1 for dry-run mode (prints diagnostics only)

PROJECT_DIR="${1:?Usage: $0 /path/to/project}"
PROJECT_NAME=$(basename "${PROJECT_DIR}")
LOG_DIR="${PROJECT_DIR}/logs"
LOG_FILE="${LOG_DIR}/night-watch-qa.log"
MAX_RUNTIME="${NW_QA_MAX_RUNTIME:-3600}"  # 1 hour
MAX_LOG_SIZE="524288"  # 512 KB
PROVIDER_CMD="${NW_PROVIDER_CMD:-claude}"
BRANCH_PATTERNS_RAW="${NW_BRANCH_PATTERNS:-feat/,night-watch/}"
SKIP_LABEL="${NW_QA_SKIP_LABEL:-skip-qa}"
QA_ARTIFACTS="${NW_QA_ARTIFACTS:-both}"
QA_AUTO_INSTALL_PLAYWRIGHT="${NW_QA_AUTO_INSTALL_PLAYWRIGHT:-1}"

# Ensure NVM / Node / Claude are on PATH
export NVM_DIR="${HOME}/.nvm"
[ -s "${NVM_DIR}/nvm.sh" ] && . "${NVM_DIR}/nvm.sh"

# NOTE: Environment variables should be set by the caller (Node.js CLI).
# The .env.night-watch sourcing has been removed - config is now injected via env vars.

mkdir -p "${LOG_DIR}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=night-watch-helpers.sh
source "${SCRIPT_DIR}/night-watch-helpers.sh"
PROJECT_RUNTIME_KEY=$(project_runtime_key "${PROJECT_DIR}")
# NOTE: Lock file path must match qaLockPath() in src/utils/status-data.ts
LOCK_FILE="/tmp/night-watch-qa-${PROJECT_RUNTIME_KEY}.lock"

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

cd "${PROJECT_DIR}"

# Convert comma-separated branch prefixes into a regex that matches branch starts.
BRANCH_REGEX=""
IFS=',' read -r -a BRANCH_PATTERNS <<< "${BRANCH_PATTERNS_RAW}"
for pattern in "${BRANCH_PATTERNS[@]}"; do
  trimmed_pattern=$(printf '%s' "${pattern}" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')
  if [ -n "${trimmed_pattern}" ]; then
    BRANCH_REGEX="${BRANCH_REGEX}${BRANCH_REGEX:+|}^${trimmed_pattern}"
  fi
done

if [ -z "${BRANCH_REGEX}" ]; then
  BRANCH_REGEX='^(feat/|night-watch/)'
fi

# List open PRs with their details for filtering
PR_JSON=$(gh pr list --state open --json number,headRefName,title,labels 2>/dev/null || echo "[]")

# Count PRs matching branch patterns
OPEN_PRS=$(
  echo "${PR_JSON}" \
    | jq -r '.[].headRefName' 2>/dev/null \
    | { grep -E "${BRANCH_REGEX}" || true; } \
    | wc -l \
    | tr -d '[:space:]'
)

if [ "${OPEN_PRS}" -eq 0 ]; then
  log "SKIP: No open PRs matching branch patterns (${BRANCH_PATTERNS_RAW})"
  emit_result "skip_no_open_prs"
  exit 0
fi

REPO=$(gh repo view --json nameWithOwner --jq '.nameWithOwner' 2>/dev/null || echo "")

# Collect PRs that need QA
PRS_NEEDING_QA=""
QA_NEEDED=0

while IFS=$'\t' read -r pr_number pr_branch pr_title pr_labels; do
  if [ -z "${pr_number}" ] || [ -z "${pr_branch}" ]; then
    continue
  fi

  # Filter by branch pattern
  if ! printf '%s\n' "${pr_branch}" | grep -Eq "${BRANCH_REGEX}"; then
    continue
  fi

  # Skip PRs with the skip label
  if echo "${pr_labels}" | grep -q "${SKIP_LABEL}"; then
    log "SKIP-QA: PR #${pr_number} (${pr_branch}) has '${SKIP_LABEL}' label"
    continue
  fi

  # Skip PRs with [skip-qa] in their title
  if echo "${pr_title}" | grep -qi '\[skip-qa\]'; then
    log "SKIP-QA: PR #${pr_number} (${pr_branch}) has [skip-qa] in title"
    continue
  fi

  # Skip PRs that already have a QA comment (idempotency)
  ALL_COMMENTS=$(
    {
      gh pr view "${pr_number}" --json comments --jq '.comments[].body' 2>/dev/null || true
      if [ -n "${REPO}" ]; then
        gh api "repos/${REPO}/issues/${pr_number}/comments" --jq '.[].body' 2>/dev/null || true
      fi
    } | sort -u
  )
  if echo "${ALL_COMMENTS}" | grep -q '<!-- night-watch-qa-marker -->'; then
    log "SKIP-QA: PR #${pr_number} (${pr_branch}) already has QA comment"
    continue
  fi

  QA_NEEDED=1
  PRS_NEEDING_QA="${PRS_NEEDING_QA} #${pr_number}"
done < <(
  echo "${PR_JSON}" \
    | jq -r '.[] | [.number, .headRefName, .title, ([.labels[].name] | join(","))] | @tsv' 2>/dev/null || true
)

if [ "${QA_NEEDED}" -eq 0 ]; then
  log "SKIP: All ${OPEN_PRS} open PR(s) matching patterns already have QA comments"
  emit_result "skip_all_qa_done"
  exit 0
fi

PRS_NEEDING_QA=$(echo "${PRS_NEEDING_QA}" \
  | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]][[:space:]]*/ /g' -e 's/[[:space:]]*$//')
PRS_NEEDING_QA_CSV="${PRS_NEEDING_QA// /,}"

if [ -n "${NW_DEFAULT_BRANCH:-}" ]; then
  DEFAULT_BRANCH="${NW_DEFAULT_BRANCH}"
else
  DEFAULT_BRANCH=$(detect_default_branch "${PROJECT_DIR}")
fi
QA_WORKTREE_DIR="$(dirname "${PROJECT_DIR}")/${PROJECT_NAME}-nw-qa-runner"

log "START: Found PR(s) needing QA:${PRS_NEEDING_QA}"

cleanup_worktrees "${PROJECT_DIR}"

# Dry-run mode: print diagnostics and exit
if [ "${NW_DRY_RUN:-0}" = "1" ]; then
  echo "=== Dry Run: QA Runner ==="
  echo "Provider: ${PROVIDER_CMD}"
  echo "Branch Patterns: ${BRANCH_PATTERNS_RAW}"
  echo "Skip Label: ${SKIP_LABEL}"
  echo "QA Artifacts: ${QA_ARTIFACTS}"
  echo "Auto-install Playwright: ${QA_AUTO_INSTALL_PLAYWRIGHT}"
  echo "Open PRs needing QA:${PRS_NEEDING_QA}"
  echo "Default Branch: ${DEFAULT_BRANCH}"
  echo "QA Worktree: ${QA_WORKTREE_DIR}"
  echo "Timeout: ${MAX_RUNTIME}s"
  exit 0
fi

EXIT_CODE=0

# Process each PR that needs QA
for pr_ref in ${PRS_NEEDING_QA}; do
  pr_num="${pr_ref#\#}"

  cleanup_worktrees "${PROJECT_DIR}"
  if ! prepare_detached_worktree "${PROJECT_DIR}" "${QA_WORKTREE_DIR}" "${DEFAULT_BRANCH}" "${LOG_FILE}"; then
    log "FAIL: Unable to create isolated QA worktree ${QA_WORKTREE_DIR} for PR #${pr_num}"
    EXIT_CODE=1
    break
  fi

  log "QA: Checking out PR #${pr_num} in worktree"
  if ! (cd "${QA_WORKTREE_DIR}" && gh pr checkout "${pr_num}" >> "${LOG_FILE}" 2>&1); then
    log "WARN: Failed to checkout PR #${pr_num}, skipping"
    EXIT_CODE=1
    cleanup_worktrees "${PROJECT_DIR}"
    continue
  fi

  case "${PROVIDER_CMD}" in
    claude)
      if (
        cd "${QA_WORKTREE_DIR}" && timeout "${MAX_RUNTIME}" \
          claude -p "/night-watch-qa" \
            --dangerously-skip-permissions \
            >> "${LOG_FILE}" 2>&1
      ); then
        log "QA: PR #${pr_num} — provider completed successfully"
      else
        local_exit=$?
        log "QA: PR #${pr_num} — provider exited with code ${local_exit}"
        if [ ${local_exit} -eq 124 ]; then
          EXIT_CODE=124
          break
        fi
        EXIT_CODE=${local_exit}
      fi
      ;;
    codex)
      if (
        cd "${QA_WORKTREE_DIR}" && timeout "${MAX_RUNTIME}" \
          codex --quiet \
            --yolo \
            --prompt "$(cat "${QA_WORKTREE_DIR}/.claude/commands/night-watch-qa.md")" \
            >> "${LOG_FILE}" 2>&1
      ); then
        log "QA: PR #${pr_num} — provider completed successfully"
      else
        local_exit=$?
        log "QA: PR #${pr_num} — provider exited with code ${local_exit}"
        if [ ${local_exit} -eq 124 ]; then
          EXIT_CODE=124
          break
        fi
        EXIT_CODE=${local_exit}
      fi
      ;;
    *)
      log "ERROR: Unknown provider: ${PROVIDER_CMD}"
      exit 1
      ;;
  esac

  cleanup_worktrees "${PROJECT_DIR}"
done

cleanup_worktrees "${PROJECT_DIR}"

if [ ${EXIT_CODE} -eq 0 ]; then
  log "DONE: QA runner completed successfully"
  if [ -n "${REPO}" ]; then
    emit_result "success_qa" "prs=${PRS_NEEDING_QA_CSV}|repo=${REPO}"
  else
    emit_result "success_qa" "prs=${PRS_NEEDING_QA_CSV}"
  fi
elif [ ${EXIT_CODE} -eq 124 ]; then
  log "TIMEOUT: QA runner killed after ${MAX_RUNTIME}s"
  if [ -n "${REPO}" ]; then
    emit_result "timeout" "prs=${PRS_NEEDING_QA_CSV}|repo=${REPO}"
  else
    emit_result "timeout" "prs=${PRS_NEEDING_QA_CSV}"
  fi
else
  log "FAIL: QA runner exited with code ${EXIT_CODE}"
  if [ -n "${REPO}" ]; then
    emit_result "failure" "prs=${PRS_NEEDING_QA_CSV}|repo=${REPO}"
  else
    emit_result "failure" "prs=${PRS_NEEDING_QA_CSV}"
  fi
fi

exit "${EXIT_CODE}"
