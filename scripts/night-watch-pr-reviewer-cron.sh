#!/usr/bin/env bash
set -euo pipefail

# Night Watch PR Reviewer Cron Runner (project-agnostic)
# Usage: night-watch-pr-reviewer-cron.sh /path/to/project
#
# NOTE: This script expects environment variables to be set by the caller.
# The Node.js CLI will inject config values via environment variables.
# Required env vars (with defaults shown):
#   NW_REVIEWER_MAX_RUNTIME=3600 - Maximum runtime in seconds (1 hour)
#   NW_PROVIDER_CMD=claude       - AI provider CLI to use (claude, codex, etc.)
#   NW_DRY_RUN=0                 - Set to 1 for dry-run mode (prints diagnostics only)

PROJECT_DIR="${1:?Usage: $0 /path/to/project}"
PROJECT_NAME=$(basename "${PROJECT_DIR}")
LOG_DIR="${PROJECT_DIR}/logs"
LOG_FILE="${LOG_DIR}/night-watch-pr-reviewer.log"
LOCK_FILE="/tmp/night-watch-pr-reviewer-${PROJECT_NAME}.lock"
MAX_RUNTIME="${NW_REVIEWER_MAX_RUNTIME:-3600}"  # 1 hour
MAX_LOG_SIZE="524288"  # 512 KB
PROVIDER_CMD="${NW_PROVIDER_CMD:-claude}"

# Ensure NVM / Node / Claude are on PATH
export NVM_DIR="${HOME}/.nvm"
[ -s "${NVM_DIR}/nvm.sh" ] && . "${NVM_DIR}/nvm.sh"

# NOTE: Environment variables should be set by the caller (Node.js CLI).
# The .env.night-watch sourcing has been removed - config is now injected via env vars.

mkdir -p "${LOG_DIR}"

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

cd "${PROJECT_DIR}"

OPEN_PRS=$(gh pr list --state open --json headRefName --jq '.[].headRefName' 2>/dev/null | grep -E '^(feat/|night-watch/)' | wc -l)

if [ "${OPEN_PRS}" -eq 0 ]; then
  log "SKIP: No open night-watch/ or feat/ PRs to review"
  exit 0
fi

NEEDS_WORK=0
REPO=$(gh repo view --json nameWithOwner --jq '.nameWithOwner' 2>/dev/null)
PRS_NEEDING_WORK=""

while IFS=$'\t' read -r pr_number pr_branch; do
  FAILED_CHECKS=$(gh pr checks "${pr_number}" 2>/dev/null | grep -ci 'fail' || true)
  if [ "${FAILED_CHECKS}" -gt 0 ]; then
    log "INFO: PR #${pr_number} (${pr_branch}) has ${FAILED_CHECKS} failed CI check(s)"
    NEEDS_WORK=1
    PRS_NEEDING_WORK="${PRS_NEEDING_WORK} #${pr_number}"
    continue
  fi

  ALL_COMMENTS=$(
    {
      gh pr view "${pr_number}" --json comments --jq '.comments[].body' 2>/dev/null
      gh api "repos/${REPO}/issues/${pr_number}/comments" --jq '.[].body' 2>/dev/null
    } | sort -u
  )
  LATEST_SCORE=$(echo "${ALL_COMMENTS}" \
    | grep -oP 'Overall Score:\*?\*?\s*(\d+)/100' \
    | tail -1 \
    | grep -oP '\d+(?=/100)' || echo "")
  if [ -n "${LATEST_SCORE}" ] && [ "${LATEST_SCORE}" -lt 80 ]; then
    log "INFO: PR #${pr_number} (${pr_branch}) has review score ${LATEST_SCORE}/100"
    NEEDS_WORK=1
    PRS_NEEDING_WORK="${PRS_NEEDING_WORK} #${pr_number}"
  fi
done < <(gh pr list --state open --json number,headRefName --jq '.[] | select(.headRefName | test("^(feat/|night-watch/)")) | [.number, .headRefName] | @tsv' 2>/dev/null)

if [ "${NEEDS_WORK}" -eq 0 ]; then
  log "SKIP: All ${OPEN_PRS} open PR(s) have passing CI and review score >= 80 (or no score yet)"
  exit 0
fi

log "START: Found PR(s) needing work:${PRS_NEEDING_WORK}"

cleanup_worktrees "${PROJECT_DIR}"

# Dry-run mode: print diagnostics and exit
if [ "${NW_DRY_RUN:-0}" = "1" ]; then
  echo "=== Dry Run: PR Reviewer ==="
  echo "Provider: ${PROVIDER_CMD}"
  echo "Open PRs needing work:${PRS_NEEDING_WORK}"
  echo "Timeout: ${MAX_RUNTIME}s"
  exit 0
fi

case "${PROVIDER_CMD}" in
  claude)
    timeout "${MAX_RUNTIME}" \
      claude -p "/night-watch-pr-reviewer" \
        --dangerously-skip-permissions \
        >> "${LOG_FILE}" 2>&1
    ;;
  codex)
    timeout "${MAX_RUNTIME}" \
      codex --quiet \
        --yolo \
        --prompt "$(cat "${PROJECT_DIR}/.claude/commands/night-watch-pr-reviewer.md")" \
        >> "${LOG_FILE}" 2>&1
    ;;
  *)
    log "ERROR: Unknown provider: ${PROVIDER_CMD}"
    exit 1
    ;;
esac

EXIT_CODE=$?

cleanup_worktrees "${PROJECT_DIR}"

if [ ${EXIT_CODE} -eq 0 ]; then
  log "DONE: PR reviewer completed successfully"
elif [ ${EXIT_CODE} -eq 124 ]; then
  log "TIMEOUT: PR reviewer killed after ${MAX_RUNTIME}s"
else
  log "FAIL: PR reviewer exited with code ${EXIT_CODE}"
fi
