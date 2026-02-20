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
#   NW_AUTO_MERGE=0              - Set to 1 to enable auto-merge
#   NW_AUTO_MERGE_METHOD=squash  - Merge method: squash, merge, or rebase

PROJECT_DIR="${1:?Usage: $0 /path/to/project}"
PROJECT_NAME=$(basename "${PROJECT_DIR}")
LOG_DIR="${PROJECT_DIR}/logs"
LOG_FILE="${LOG_DIR}/night-watch-pr-reviewer.log"
MAX_RUNTIME="${NW_REVIEWER_MAX_RUNTIME:-3600}"  # 1 hour
MAX_LOG_SIZE="524288"  # 512 KB
PROVIDER_CMD="${NW_PROVIDER_CMD:-claude}"
MIN_REVIEW_SCORE="${NW_MIN_REVIEW_SCORE:-80}"
BRANCH_PATTERNS_RAW="${NW_BRANCH_PATTERNS:-feat/,night-watch/}"
AUTO_MERGE="${NW_AUTO_MERGE:-0}"
AUTO_MERGE_METHOD="${NW_AUTO_MERGE_METHOD:-squash}"
TARGET_PR="${NW_TARGET_PR:-}"
PARALLEL_ENABLED="${NW_REVIEWER_PARALLEL:-1}"
WORKER_MODE="${NW_REVIEWER_WORKER_MODE:-0}"

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
GLOBAL_LOCK_FILE="/tmp/night-watch-pr-reviewer-${PROJECT_RUNTIME_KEY}.lock"
if [ "${WORKER_MODE}" = "1" ] && [ -n "${TARGET_PR}" ]; then
  LOCK_FILE="/tmp/night-watch-pr-reviewer-${PROJECT_RUNTIME_KEY}-pr-${TARGET_PR}.lock"
else
  # NOTE: Lock file path must match reviewerLockPath() in src/utils/status-data.ts
  LOCK_FILE="${GLOBAL_LOCK_FILE}"
fi

emit_result() {
  local status="${1:?status required}"
  local details="${2:-}"
  if [ -n "${details}" ]; then
    echo "NIGHT_WATCH_RESULT:${status}|${details}"
  else
    echo "NIGHT_WATCH_RESULT:${status}"
  fi
}

emit_final_status() {
  local exit_code="${1:?exit code required}"
  local prs_csv="${2:-}"
  local auto_merged="${3:-}"
  local auto_merge_failed="${4:-}"

  if [ "${exit_code}" -eq 0 ]; then
    log "DONE: PR reviewer completed successfully"
    emit_result "success_reviewed" "prs=${prs_csv}|auto_merged=${auto_merged}|auto_merge_failed=${auto_merge_failed}"
  elif [ "${exit_code}" -eq 124 ]; then
    log "TIMEOUT: PR reviewer killed after ${MAX_RUNTIME}s"
    emit_result "timeout" "prs=${prs_csv}"
  else
    log "FAIL: PR reviewer exited with code ${exit_code}"
    emit_result "failure" "prs=${prs_csv}"
  fi
}

append_csv() {
  local current="${1:-}"
  local incoming="${2:-}"
  if [ -z "${incoming}" ]; then
    printf "%s" "${current}"
    return 0
  fi
  if [ -z "${current}" ]; then
    printf "%s" "${incoming}"
  else
    printf "%s,%s" "${current}" "${incoming}"
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

if [ -n "${TARGET_PR}" ]; then
  OPEN_PRS=$(
    if gh pr view "${TARGET_PR}" --json number >/dev/null 2>&1; then
      echo "1"
    else
      echo "0"
    fi
  )
else
  OPEN_PRS=$(
    { gh pr list --state open --json headRefName --jq '.[].headRefName' 2>/dev/null || true; } \
      | { grep -E "${BRANCH_REGEX}" || true; } \
      | wc -l \
      | tr -d '[:space:]'
  )
fi

if [ "${OPEN_PRS}" -eq 0 ]; then
  log "SKIP: No open PRs matching branch patterns (${BRANCH_PATTERNS_RAW})"
  emit_result "skip_no_open_prs"
  exit 0
fi

NEEDS_WORK=0
REPO=$(gh repo view --json nameWithOwner --jq '.nameWithOwner' 2>/dev/null || echo "")
PRS_NEEDING_WORK=""

while IFS=$'\t' read -r pr_number pr_branch; do
  if [ -z "${pr_number}" ] || [ -z "${pr_branch}" ]; then
    continue
  fi

  if [ -n "${TARGET_PR}" ] && [ "${pr_number}" != "${TARGET_PR}" ]; then
    continue
  fi

  if [ -z "${TARGET_PR}" ] && ! printf '%s\n' "${pr_branch}" | grep -Eq "${BRANCH_REGEX}"; then
    continue
  fi

  # Merge-conflict signal: this PR needs action even if CI and score look fine.
  MERGE_STATE=$(gh pr view "${pr_number}" --json mergeStateStatus --jq '.mergeStateStatus' 2>/dev/null || echo "")
  if [ "${MERGE_STATE}" = "DIRTY" ] || [ "${MERGE_STATE}" = "CONFLICTING" ]; then
    log "INFO: PR #${pr_number} (${pr_branch}) has merge conflicts (${MERGE_STATE})"
    NEEDS_WORK=1
    PRS_NEEDING_WORK="${PRS_NEEDING_WORK} #${pr_number}"
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
  emit_result "skip_all_passing"
  exit 0
fi

PRS_NEEDING_WORK=$(echo "${PRS_NEEDING_WORK}" \
  | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]][[:space:]]*/ /g' -e 's/[[:space:]]*$//')
PRS_NEEDING_WORK_CSV="${PRS_NEEDING_WORK// /,}"

if [ -n "${NW_DEFAULT_BRANCH:-}" ]; then
  DEFAULT_BRANCH="${NW_DEFAULT_BRANCH}"
else
  DEFAULT_BRANCH=$(detect_default_branch "${PROJECT_DIR}")
fi

log "START: Found PR(s) needing work:${PRS_NEEDING_WORK}"

# Convert "#12 #34" into ["12", "34"] for worker fan-out.
PR_NUMBER_ARRAY=()
for pr_token in ${PRS_NEEDING_WORK}; do
  PR_NUMBER_ARRAY+=("${pr_token#\#}")
done

if [ -z "${TARGET_PR}" ] && [ "${WORKER_MODE}" != "1" ] && [ "${PARALLEL_ENABLED}" = "1" ] && [ "${#PR_NUMBER_ARRAY[@]}" -gt 1 ]; then
  # Dry-run mode: print diagnostics and exit
  if [ "${NW_DRY_RUN:-0}" = "1" ]; then
    echo "=== Dry Run: PR Reviewer ==="
    echo "Provider: ${PROVIDER_CMD}"
    echo "Branch Patterns: ${BRANCH_PATTERNS_RAW}"
    echo "Min Review Score: ${MIN_REVIEW_SCORE}"
    echo "Auto-merge: ${AUTO_MERGE}"
    if [ "${AUTO_MERGE}" = "1" ]; then
      echo "Auto-merge Method: ${AUTO_MERGE_METHOD}"
    fi
    echo "Open PRs needing work:${PRS_NEEDING_WORK}"
    echo "Default Branch: ${DEFAULT_BRANCH}"
    echo "Parallel Workers: ${#PR_NUMBER_ARRAY[@]}"
    echo "Timeout: ${MAX_RUNTIME}s"
    exit 0
  fi

  log "PARALLEL: Launching ${#PR_NUMBER_ARRAY[@]} reviewer worker(s)"

  declare -a WORKER_PIDS=()
  declare -a WORKER_PRS=()
  declare -a WORKER_OUTPUTS=()

  for pr_number in "${PR_NUMBER_ARRAY[@]}"; do
    worker_output=$(mktemp "/tmp/night-watch-pr-reviewer-${PROJECT_RUNTIME_KEY}-pr-${pr_number}.XXXXXX")
    WORKER_OUTPUTS+=("${worker_output}")
    WORKER_PRS+=("${pr_number}")

    (
      NW_TARGET_PR="${pr_number}" \
      NW_REVIEWER_WORKER_MODE="1" \
      NW_REVIEWER_PARALLEL="0" \
      bash "${SCRIPT_DIR}/night-watch-pr-reviewer-cron.sh" "${PROJECT_DIR}" > "${worker_output}" 2>&1
    ) &

    worker_pid=$!
    WORKER_PIDS+=("${worker_pid}")
    log "PARALLEL: Worker PID ${worker_pid} started for PR #${pr_number}"
  done

  EXIT_CODE=0
  AUTO_MERGED_PRS=""
  AUTO_MERGE_FAILED_PRS=""

  for idx in "${!WORKER_PIDS[@]}"; do
    worker_pid="${WORKER_PIDS[$idx]}"
    worker_pr="${WORKER_PRS[$idx]}"
    worker_output="${WORKER_OUTPUTS[$idx]}"

    worker_exit_code=0
    if wait "${worker_pid}"; then
      worker_exit_code=0
    else
      worker_exit_code=$?
    fi

    if [ -f "${worker_output}" ] && [ -s "${worker_output}" ]; then
      cat "${worker_output}" >> "${LOG_FILE}"
    fi

    worker_result=$(grep -o 'NIGHT_WATCH_RESULT:.*' "${worker_output}" 2>/dev/null | tail -1 || true)
    worker_status=$(printf '%s' "${worker_result}" | sed -n 's/^NIGHT_WATCH_RESULT:\([^|]*\).*$/\1/p')
    worker_auto_merged=$(printf '%s' "${worker_result}" | grep -oP '(?<=auto_merged=)[^|]+' || true)
    worker_auto_merge_failed=$(printf '%s' "${worker_result}" | grep -oP '(?<=auto_merge_failed=)[^|]+' || true)

    AUTO_MERGED_PRS=$(append_csv "${AUTO_MERGED_PRS}" "${worker_auto_merged}")
    AUTO_MERGE_FAILED_PRS=$(append_csv "${AUTO_MERGE_FAILED_PRS}" "${worker_auto_merge_failed}")

    rm -f "${worker_output}"

    if [ "${worker_status}" = "failure" ] || { [ -n "${worker_status}" ] && [ "${worker_status}" != "success_reviewed" ] && [ "${worker_status}" != "timeout" ] && [ "${worker_status#skip_}" = "${worker_status}" ]; }; then
      if [ "${EXIT_CODE}" -eq 0 ] || [ "${EXIT_CODE}" -eq 124 ]; then
        EXIT_CODE=1
      fi
      log "PARALLEL: Worker for PR #${worker_pr} reported status '${worker_status:-unknown}'"
    elif [ "${worker_status}" = "timeout" ]; then
      if [ "${EXIT_CODE}" -eq 0 ]; then
        EXIT_CODE=124
      fi
      log "PARALLEL: Worker for PR #${worker_pr} timed out"
    elif [ "${worker_exit_code}" -ne 0 ]; then
      if [ "${worker_exit_code}" -eq 124 ]; then
        if [ "${EXIT_CODE}" -eq 0 ]; then
          EXIT_CODE=124
        fi
      elif [ "${EXIT_CODE}" -eq 0 ] || [ "${EXIT_CODE}" -eq 124 ]; then
        EXIT_CODE="${worker_exit_code}"
      fi
      log "PARALLEL: Worker for PR #${worker_pr} exited with code ${worker_exit_code}"
    else
      log "PARALLEL: Worker for PR #${worker_pr} completed"
    fi
  done

  emit_final_status "${EXIT_CODE}" "${PRS_NEEDING_WORK_CSV}" "${AUTO_MERGED_PRS}" "${AUTO_MERGE_FAILED_PRS}"
  exit 0
fi

REVIEW_WORKTREE_BASENAME="${PROJECT_NAME}-nw-review-runner"
if [ -n "${TARGET_PR}" ]; then
  REVIEW_WORKTREE_BASENAME="${REVIEW_WORKTREE_BASENAME}-pr-${TARGET_PR}"
fi
REVIEW_WORKTREE_DIR="$(dirname "${PROJECT_DIR}")/${REVIEW_WORKTREE_BASENAME}"

cleanup_worktrees "${PROJECT_DIR}" "${REVIEW_WORKTREE_BASENAME}"

# Dry-run mode: print diagnostics and exit
if [ "${NW_DRY_RUN:-0}" = "1" ]; then
  echo "=== Dry Run: PR Reviewer ==="
  echo "Provider: ${PROVIDER_CMD}"
  echo "Branch Patterns: ${BRANCH_PATTERNS_RAW}"
  echo "Min Review Score: ${MIN_REVIEW_SCORE}"
  echo "Auto-merge: ${AUTO_MERGE}"
  if [ "${AUTO_MERGE}" = "1" ]; then
    echo "Auto-merge Method: ${AUTO_MERGE_METHOD}"
  fi
  echo "Open PRs needing work:${PRS_NEEDING_WORK}"
  echo "Default Branch: ${DEFAULT_BRANCH}"
  echo "Review Worktree: ${REVIEW_WORKTREE_DIR}"
  echo "Target PR: ${TARGET_PR:-all}"
  if [ -n "${TARGET_PR}" ]; then
    echo "Worker Mode: ${WORKER_MODE}"
  fi
  echo "Timeout: ${MAX_RUNTIME}s"
  exit 0
fi

if ! prepare_detached_worktree "${PROJECT_DIR}" "${REVIEW_WORKTREE_DIR}" "${DEFAULT_BRANCH}" "${LOG_FILE}"; then
  log "FAIL: Unable to create isolated reviewer worktree ${REVIEW_WORKTREE_DIR}"
  exit 1
fi

EXIT_CODE=0
TARGET_SCOPE_PROMPT=""
if [ -n "${TARGET_PR}" ]; then
  TARGET_SCOPE_PROMPT=$'\n\n## Target Scope\n- Only process PR #'"${TARGET_PR}"$'.\n- Ignore all other PRs.\n- If this PR no longer needs work, stop immediately.\n'
fi

case "${PROVIDER_CMD}" in
  claude)
    CLAUDE_PROMPT="/night-watch-pr-reviewer${TARGET_SCOPE_PROMPT}"
    if (
      cd "${REVIEW_WORKTREE_DIR}" && timeout "${MAX_RUNTIME}" \
        claude -p "${CLAUDE_PROMPT}" \
          --dangerously-skip-permissions \
          >> "${LOG_FILE}" 2>&1
    ); then
      EXIT_CODE=0
    else
      EXIT_CODE=$?
    fi
    ;;
  codex)
    CODEX_PROMPT="$(cat "${REVIEW_WORKTREE_DIR}/.claude/commands/night-watch-pr-reviewer.md")${TARGET_SCOPE_PROMPT}"
    if (
      cd "${REVIEW_WORKTREE_DIR}" && timeout "${MAX_RUNTIME}" \
        codex --quiet \
          --yolo \
          --prompt "${CODEX_PROMPT}" \
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

cleanup_worktrees "${PROJECT_DIR}" "${REVIEW_WORKTREE_BASENAME}"

# ── Auto-merge eligible PRs ─────────────────────────────────────────────────────
# After the reviewer completes, check for PRs that are merge-ready and queue them
# for auto-merge if enabled. Uses gh pr merge --auto to respect GitHub branch protection.
AUTO_MERGED_PRS=""
AUTO_MERGE_FAILED_PRS=""

if [ "${AUTO_MERGE}" = "1" ] && [ ${EXIT_CODE} -eq 0 ]; then
  log "AUTO-MERGE: Checking for merge-ready PRs..."

  while IFS=$'\t' read -r pr_number pr_branch; do
    if [ -z "${pr_number}" ] || [ -z "${pr_branch}" ]; then
      continue
    fi

    if [ -n "${TARGET_PR}" ] && [ "${pr_number}" != "${TARGET_PR}" ]; then
      continue
    fi

    # Only process PRs matching branch patterns
    if [ -z "${TARGET_PR}" ] && ! printf '%s\n' "${pr_branch}" | grep -Eq "${BRANCH_REGEX}"; then
      continue
    fi

    # Check CI status - must have no failures
    FAILED_CHECKS=$(gh pr checks "${pr_number}" 2>/dev/null | grep -ci 'fail' || true)
    if [ "${FAILED_CHECKS}" -gt 0 ]; then
      continue
    fi

    # Check review score - must have score >= threshold
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

    # Skip PRs without a score
    if [ -z "${LATEST_SCORE}" ]; then
      continue
    fi

    # Skip PRs with score below threshold
    if [ "${LATEST_SCORE}" -lt "${MIN_REVIEW_SCORE}" ]; then
      continue
    fi

    # PR is merge-ready - queue for auto-merge
    log "AUTO-MERGE: PR #${pr_number} (${pr_branch}) — score ${LATEST_SCORE}/100, CI passing"

    if gh pr merge "${pr_number}" --"${AUTO_MERGE_METHOD}" --auto --delete-branch 2>>"${LOG_FILE}"; then
      log "AUTO-MERGE: Successfully queued merge for PR #${pr_number}"
      if [ -z "${AUTO_MERGED_PRS}" ]; then
        AUTO_MERGED_PRS="#${pr_number}"
      else
        AUTO_MERGED_PRS="${AUTO_MERGED_PRS},#${pr_number}"
      fi
    else
      log "WARN: Auto-merge failed for PR #${pr_number}"
      if [ -z "${AUTO_MERGE_FAILED_PRS}" ]; then
        AUTO_MERGE_FAILED_PRS="#${pr_number}"
      else
        AUTO_MERGE_FAILED_PRS="${AUTO_MERGE_FAILED_PRS},#${pr_number}"
      fi
    fi
  done < <(gh pr list --state open --json number,headRefName --jq '.[] | [.number, .headRefName] | @tsv' 2>/dev/null || true)
fi

emit_final_status "${EXIT_CODE}" "${PRS_NEEDING_WORK_CSV}" "${AUTO_MERGED_PRS}" "${AUTO_MERGE_FAILED_PRS}"
