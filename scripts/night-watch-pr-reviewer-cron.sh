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
MIN_REVIEW_SCORE="${NW_MIN_REVIEW_SCORE:-80}"
BRANCH_PATTERNS_RAW="${NW_BRANCH_PATTERNS:-feat/,night-watch/}"

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

OPEN_PRS=$(
  { gh pr list --state open --json headRefName --jq '.[].headRefName' 2>/dev/null || true; } \
    | { grep -E "${BRANCH_REGEX}" || true; } \
    | wc -l \
    | tr -d '[:space:]'
)

if [ "${OPEN_PRS}" -eq 0 ]; then
  log "SKIP: No open PRs matching branch patterns (${BRANCH_PATTERNS_RAW})"
  exit 0
fi

NEEDS_WORK=0
REPO=$(gh repo view --json nameWithOwner --jq '.nameWithOwner' 2>/dev/null || echo "")
PRS_NEEDING_WORK=""

while IFS=$'\t' read -r pr_number pr_branch; do
  if [ -z "${pr_number}" ] || [ -z "${pr_branch}" ]; then
    continue
  fi

  if ! printf '%s\n' "${pr_branch}" | grep -Eq "${BRANCH_REGEX}"; then
    continue
  fi

  FAILED_CHECKS=$(gh pr checks "${pr_number}" 2>/dev/null | grep -ci 'fail' || true)
  if [ "${FAILED_CHECKS}" -gt 0 ]; then
    log "INFO: PR #${pr_number} (${pr_branch}) has ${FAILED_CHECKS} failed CI check(s)"
    NEEDS_WORK=1
    PRS_NEEDING_WORK="${PRS_NEEDING_WORK} #${pr_number}"
    continue
  fi

  ALL_COMMENTS=$(
    {
      gh pr view "${pr_number}" --json comments --jq '.comments[].body' 2>/dev/null || true
      if [ -n "${REPO}" ]; then
        gh api "repos/${REPO}/issues/${pr_number}/comments" --jq '.[].body' 2>/dev/null || true
      fi
    } | sort -u
  )
  LATEST_SCORE=$(echo "${ALL_COMMENTS}" \
    | grep -oP 'Overall Score:\*?\*?\s*(\d+)/100' \
    | tail -1 \
    | grep -oP '\d+(?=/100)' || echo "")
  if [ -n "${LATEST_SCORE}" ] && [ "${LATEST_SCORE}" -lt "${MIN_REVIEW_SCORE}" ]; then
    log "INFO: PR #${pr_number} (${pr_branch}) has review score ${LATEST_SCORE}/100 (threshold: ${MIN_REVIEW_SCORE})"
    NEEDS_WORK=1
    PRS_NEEDING_WORK="${PRS_NEEDING_WORK} #${pr_number}"
  fi
done < <(gh pr list --state open --json number,headRefName --jq '.[] | [.number, .headRefName] | @tsv' 2>/dev/null || true)

if [ "${NEEDS_WORK}" -eq 0 ]; then
  log "SKIP: All ${OPEN_PRS} open PR(s) have passing CI and review score >= ${MIN_REVIEW_SCORE} (or no score yet)"
  exit 0
fi

if [ -n "${NW_DEFAULT_BRANCH:-}" ]; then
  DEFAULT_BRANCH="${NW_DEFAULT_BRANCH}"
else
  DEFAULT_BRANCH=$(detect_default_branch "${PROJECT_DIR}")
fi
REVIEW_WORKTREE_DIR="$(dirname "${PROJECT_DIR}")/${PROJECT_NAME}-nw-review-runner"

log "START: Found PR(s) needing work:${PRS_NEEDING_WORK}"

cleanup_worktrees "${PROJECT_DIR}"

# Dry-run mode: print diagnostics and exit
if [ "${NW_DRY_RUN:-0}" = "1" ]; then
  echo "=== Dry Run: PR Reviewer ==="
  echo "Provider: ${PROVIDER_CMD}"
  echo "Branch Patterns: ${BRANCH_PATTERNS_RAW}"
  echo "Min Review Score: ${MIN_REVIEW_SCORE}"
  echo "Open PRs needing work:${PRS_NEEDING_WORK}"
  echo "Default Branch: ${DEFAULT_BRANCH}"
  echo "Review Worktree: ${REVIEW_WORKTREE_DIR}"
  echo "Timeout: ${MAX_RUNTIME}s"
  exit 0
fi

if ! prepare_detached_worktree "${PROJECT_DIR}" "${REVIEW_WORKTREE_DIR}" "${DEFAULT_BRANCH}" "${LOG_FILE}"; then
  log "FAIL: Unable to create isolated reviewer worktree ${REVIEW_WORKTREE_DIR}"
  exit 1
fi

EXIT_CODE=0

case "${PROVIDER_CMD}" in
  claude)
    if (
      cd "${REVIEW_WORKTREE_DIR}" && timeout "${MAX_RUNTIME}" \
        claude -p "/night-watch-pr-reviewer" \
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
      cd "${REVIEW_WORKTREE_DIR}" && timeout "${MAX_RUNTIME}" \
        codex --quiet \
          --yolo \
          --prompt "$(cat "${REVIEW_WORKTREE_DIR}/.claude/commands/night-watch-pr-reviewer.md")" \
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

cleanup_worktrees "${PROJECT_DIR}"

if [ ${EXIT_CODE} -eq 0 ]; then
  log "DONE: PR reviewer completed successfully"
elif [ ${EXIT_CODE} -eq 124 ]; then
  log "TIMEOUT: PR reviewer killed after ${MAX_RUNTIME}s"
else
  log "FAIL: PR reviewer exited with code ${EXIT_CODE}"
fi
