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
LOG_FILE="${LOG_DIR}/reviewer.log"
MAX_RUNTIME="${NW_REVIEWER_MAX_RUNTIME:-3600}"  # 1 hour
MAX_LOG_SIZE="524288"  # 512 KB
PROVIDER_CMD="${NW_PROVIDER_CMD:-claude}"
PROVIDER_LABEL="${NW_PROVIDER_LABEL:-}"
MIN_REVIEW_SCORE="${NW_MIN_REVIEW_SCORE:-80}"
BRANCH_PATTERNS_RAW="${NW_BRANCH_PATTERNS:-feat/,night-watch/}"
AUTO_MERGE="${NW_AUTO_MERGE:-0}"
AUTO_MERGE_METHOD="${NW_AUTO_MERGE_METHOD:-squash}"
TARGET_PR="${NW_TARGET_PR:-}"
PARALLEL_ENABLED="${NW_REVIEWER_PARALLEL:-1}"
WORKER_MODE="${NW_REVIEWER_WORKER_MODE:-0}"
PRD_DIR_REL="${NW_PRD_DIR:-docs/PRDs/night-watch}"
if [[ "${PRD_DIR_REL}" = /* ]]; then
  PRD_DIR="${PRD_DIR_REL}"
else
  PRD_DIR="${PROJECT_DIR}/${PRD_DIR_REL}"
fi

# Retry configuration
REVIEWER_MAX_RETRIES="${NW_REVIEWER_MAX_RETRIES:-2}"
REVIEWER_RETRY_DELAY="${NW_REVIEWER_RETRY_DELAY:-30}"
SCRIPT_START_TIME=$(date +%s)

# Normalize retry settings to safe numeric ranges
if ! [[ "${REVIEWER_MAX_RETRIES}" =~ ^[0-9]+$ ]]; then
  REVIEWER_MAX_RETRIES="2"
fi
if ! [[ "${REVIEWER_RETRY_DELAY}" =~ ^[0-9]+$ ]]; then
  REVIEWER_RETRY_DELAY="30"
fi
if [ "${REVIEWER_MAX_RETRIES}" -gt 10 ]; then
  REVIEWER_MAX_RETRIES="10"
fi
if [ "${REVIEWER_RETRY_DELAY}" -gt 300 ]; then
  REVIEWER_RETRY_DELAY="300"
fi

mkdir -p "${LOG_DIR}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=night-watch-helpers.sh
source "${SCRIPT_DIR}/night-watch-helpers.sh"

# Ensure provider CLI is on PATH (nvm, fnm, volta, common bin dirs)
if ! ensure_provider_on_path "${PROVIDER_CMD}"; then
  echo "ERROR: Provider '${PROVIDER_CMD}' not found in PATH or common installation locations" >&2
  exit 127
fi
PROJECT_RUNTIME_KEY=$(project_runtime_key "${PROJECT_DIR}")
PROVIDER_MODEL_DISPLAY=$(resolve_provider_model_display "${PROVIDER_CMD}" "${PROVIDER_LABEL}")
GLOBAL_LOCK_FILE="/tmp/night-watch-pr-reviewer-${PROJECT_RUNTIME_KEY}.lock"
if [ "${WORKER_MODE}" = "1" ] && [ -n "${TARGET_PR}" ]; then
  LOCK_FILE="/tmp/night-watch-pr-reviewer-${PROJECT_RUNTIME_KEY}-pr-${TARGET_PR}.lock"
else
  # NOTE: Lock file path must match reviewerLockPath() in src/utils/status-data.ts
  LOCK_FILE="${GLOBAL_LOCK_FILE}"
fi

# ── Global Job Queue Gate ────────────────────────────────────────────────────
# Acquire global gate before per-project lock to serialize jobs across projects.
# When gate is busy, enqueue the job and exit cleanly.
SCRIPT_TYPE="reviewer"

emit_result() {
  local status="${1:?status required}"
  local details="${2:-}"
  if [ -n "${details}" ]; then
    echo "NIGHT_WATCH_RESULT:${status}|${details}"
  else
    echo "NIGHT_WATCH_RESULT:${status}"
  fi
}

# ── Global Job Queue Gate ────────────────────────────────────────────────────
# Acquire global gate before per-project lock to serialize jobs across projects.
# When gate is busy, enqueue the job and exit cleanly.
if [ "${NW_QUEUE_ENABLED:-0}" = "1" ]; then
  if [ "${NW_QUEUE_DISPATCHED:-0}" = "1" ]; then
    arm_global_queue_cleanup
  elif acquire_global_gate; then
    if queue_can_start_now; then
      arm_global_queue_cleanup
    else
      release_global_gate
      enqueue_job "${SCRIPT_TYPE}" "${PROJECT_DIR}"
      emit_result "queued"
      exit 0
    fi
  else
    enqueue_job "${SCRIPT_TYPE}" "${PROJECT_DIR}"
    emit_result "queued"
    exit 0
  fi
fi
# ──────────────────────────────────────────────────────────────────────────────

emit_final_status() {
  local exit_code="${1:?exit code required}"
  local prs_csv="${2:-}"
  local auto_merged="${3:-}"
  local auto_merge_failed="${4:-}"
  local attempts="${5:-1}"
  local final_score="${6:-}"
  local details=""
  local prs_summary=""
  local auto_merged_summary=""
  local auto_merge_failed_summary=""
  local final_score_summary=""
  local final_score_line=""

  prs_summary="${prs_csv:-none}"
  auto_merged_summary="${auto_merged:-none}"
  auto_merge_failed_summary="${auto_merge_failed:-none}"
  final_score_summary="${final_score:-n/a}"
  if [ -n "${final_score}" ]; then
    final_score_line="Final score: ${final_score_summary}/100"
  else
    final_score_line="Final score: n/a"
  fi

  if [ "${exit_code}" -eq 0 ]; then
    details="prs=${prs_csv}|auto_merged=${auto_merged}|auto_merge_failed=${auto_merge_failed}|attempts=${attempts}"
    if [ -n "${final_score}" ]; then
      details="${details}|final_score=${final_score}"
    fi
    log "DONE: PR reviewer completed successfully"
    if [ "${WORKER_MODE}" != "1" ]; then
      send_telegram_status_message "🔍 Night Watch Reviewer: completed" "Project: ${PROJECT_NAME}
Provider (model): ${PROVIDER_MODEL_DISPLAY}
Processed PRs: ${prs_summary}
Attempts: ${attempts}
${final_score_line}
Auto-merged PRs: ${auto_merged_summary}
Auto-merge failed: ${auto_merge_failed_summary}"
    fi
    emit_result "success_reviewed" "${details}"
  elif [ "${exit_code}" -eq 124 ]; then
    details="prs=${prs_csv}|attempts=${attempts}"
    if [ -n "${final_score}" ]; then
      details="${details}|final_score=${final_score}"
    fi
    log "TIMEOUT: PR reviewer killed after ${MAX_RUNTIME}s"
    if [ "${WORKER_MODE}" != "1" ]; then
      send_telegram_status_message "🔍 Night Watch Reviewer: timeout" "Project: ${PROJECT_NAME}
Provider (model): ${PROVIDER_MODEL_DISPLAY}
Timeout: ${MAX_RUNTIME}s
Processed PRs: ${prs_summary}
Attempts: ${attempts}
${final_score_line}"
    fi
    emit_result "timeout" "${details}"
  else
    details="prs=${prs_csv}|attempts=${attempts}"
    if [ -n "${final_score}" ]; then
      details="${details}|final_score=${final_score}"
    fi
    log "FAIL: PR reviewer exited with code ${exit_code}"
    if [ "${WORKER_MODE}" != "1" ]; then
      send_telegram_status_message "🔍 Night Watch Reviewer: failed" "Project: ${PROJECT_NAME}
Provider (model): ${PROVIDER_MODEL_DISPLAY}
Exit code: ${exit_code}
Processed PRs: ${prs_summary}
Attempts: ${attempts}
${final_score_line}"
    fi
    emit_result "failure" "${details}"
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

provider_output_looks_invalid() {
  local from_line="${1:-0}"
  if [ ! -f "${LOG_FILE}" ]; then
    return 1
  fi

  tail -n "+$((from_line + 1))" "${LOG_FILE}" 2>/dev/null \
    | grep -Eqi \
      'Unknown skill:|session is in a broken state|working directory .* no longer exists|Path ".*" does not exist|Please restart this session|failed to start LSP server plugin|spawn .* ENOENT'
}

truncate_for_prompt() {
  local text="${1:-}"
  local limit="${2:-7000}"
  if [ "${#text}" -le "${limit}" ]; then
    printf "%s" "${text}"
  else
    printf '%s\n\n[truncated to %s chars]' "${text:0:${limit}}" "${limit}"
  fi
}

extract_linked_issue_numbers() {
  local body="${1:-}"
  printf '%s\n' "${body}" \
    | grep -Eoi '(close[sd]?|fix(e[sd])?|resolve[sd]?)[[:space:]]*:?[[:space:]]*#[0-9]+' \
    | grep -Eo '[0-9]+' \
    | awk '!seen[$0]++' || true
}

find_prd_file_by_branch() {
  local branch_name="${1:-}"
  local branch_slug="${branch_name#*/}"
  local branch_number=""
  local candidate_dirs=()
  local candidate=""
  local base_name=""
  local dir=""

  if [ -z "${branch_slug}" ]; then
    branch_slug="${branch_name}"
  fi
  [ -z "${branch_slug}" ] && return 1

  if [ -d "${PRD_DIR}" ]; then
    candidate_dirs+=("${PRD_DIR}")
  fi
  if [ -d "${PRD_DIR}/done" ]; then
    candidate_dirs+=("${PRD_DIR}/done")
  fi
  [ "${#candidate_dirs[@]}" -eq 0 ] && return 1

  for dir in "${candidate_dirs[@]}"; do
    if [ -f "${dir}/${branch_slug}.md" ]; then
      printf "%s" "${dir}/${branch_slug}.md"
      return 0
    fi
  done

  branch_number=$(printf '%s' "${branch_slug}" | grep -oE '^[0-9]+' || true)
  for dir in "${candidate_dirs[@]}"; do
    while IFS= read -r candidate; do
      [ -z "${candidate}" ] && continue
      base_name=$(basename "${candidate}" .md)
      if [[ "${base_name}" == "${branch_slug}"* ]] || [[ "${branch_slug}" == "${base_name}"* ]]; then
        printf "%s" "${candidate}"
        return 0
      fi
      if [ -n "${branch_number}" ] && [[ "${base_name}" == "${branch_number}-"* ]]; then
        printf "%s" "${candidate}"
        return 0
      fi
    done < <(find "${dir}" -maxdepth 1 -type f -name '*.md' 2>/dev/null | sort)
  done

  return 1
}

build_prd_context_for_pr() {
  local pr_number="${1:?PR number required}"
  local pr_payload=""
  local pr_title=""
  local pr_branch=""
  local pr_body=""
  local pr_url=""
  local issue_context=""
  local issue_count=0
  local issue_number=""
  local issue_payload=""
  local issue_title=""
  local issue_body=""
  local issue_excerpt=""
  local prd_file=""
  local prd_payload=""
  local prd_excerpt=""
  local prd_rel_path=""
  local section=""

  pr_payload=$(gh pr view "${pr_number}" --json title,headRefName,body,url 2>/dev/null || true)
  pr_title=$(printf '%s' "${pr_payload}" | jq -r '.title // ""' 2>/dev/null || echo "")
  pr_branch=$(printf '%s' "${pr_payload}" | jq -r '.headRefName // ""' 2>/dev/null || echo "")
  pr_body=$(printf '%s' "${pr_payload}" | jq -r '.body // ""' 2>/dev/null || echo "")
  pr_url=$(printf '%s' "${pr_payload}" | jq -r '.url // ""' 2>/dev/null || echo "")

  if [ -n "${pr_body}" ]; then
    while IFS= read -r issue_number; do
      [ -z "${issue_number}" ] && continue
      issue_count=$((issue_count + 1))
      if [ "${issue_count}" -gt 2 ]; then
        break
      fi

      issue_payload=$(gh issue view "${issue_number}" --json title,body,url 2>/dev/null || true)
      issue_title=$(printf '%s' "${issue_payload}" | jq -r '.title // ""' 2>/dev/null || echo "")
      issue_body=$(printf '%s' "${issue_payload}" | jq -r '.body // ""' 2>/dev/null || echo "")
      [ -z "${issue_body}" ] && continue

      issue_excerpt=$(truncate_for_prompt "${issue_body}" 4500)
      issue_context="${issue_context}${issue_context:+$'\n\n'}Issue #${issue_number}: ${issue_title}
${issue_excerpt}"
    done < <(extract_linked_issue_numbers "${pr_body}")
  fi

  if [ -z "${issue_context}" ] && [ -n "${pr_branch}" ]; then
    prd_file=$(find_prd_file_by_branch "${pr_branch}" || true)
    if [ -n "${prd_file}" ] && [ -f "${prd_file}" ]; then
      prd_payload=$(cat "${prd_file}" 2>/dev/null || true)
      if [ -n "${prd_payload}" ]; then
        prd_excerpt=$(truncate_for_prompt "${prd_payload}" 4500)
        if [[ "${prd_file}" == "${PROJECT_DIR}/"* ]]; then
          prd_rel_path="${prd_file#${PROJECT_DIR}/}"
        else
          prd_rel_path="${prd_file}"
        fi
      fi
    fi
  fi

  section="### PR #${pr_number}"
  if [ -n "${pr_title}" ]; then
    section="${section} — ${pr_title}"
  fi
  section="${section}
- branch: ${pr_branch:-unknown}"
  if [ -n "${pr_url}" ]; then
    section="${section}
- url: ${pr_url}"
  fi

  if [ -n "${issue_context}" ]; then
    section="${section}
- context source: linked GitHub issue body
${issue_context}"
  elif [ -n "${prd_excerpt}" ]; then
    section="${section}
- context source: ${prd_rel_path}
${prd_excerpt}"
  else
    section="${section}
- context source: not found"
  fi

  printf "%s" "${section}"
}

build_prd_context_prompt() {
  local pr_number=""
  local entry=""
  local combined=""

  for pr_number in "$@"; do
    [ -z "${pr_number}" ] && continue
    entry=$(build_prd_context_for_pr "${pr_number}")
    [ -z "${entry}" ] && continue
    combined="${combined}${combined:+$'\n\n'}${entry}"
  done

  [ -z "${combined}" ] && return 0
  printf '\n\n## PRD Context\nUse this product context while reviewing and fixing PRs.\n%s\n' "${combined}"
}

# Extract the latest review score from PR comments
# Returns empty string if no score found
get_pr_score() {
  local pr_number="${1:?PR number required}"
  local all_comments
  all_comments=$(
    {
      gh pr view "${pr_number}" --json comments --jq '.comments[].body' 2>/dev/null || true
      if [ -n "${REPO:-}" ]; then
        gh api "repos/${REPO}/issues/${pr_number}/comments" --jq '.[].body' 2>/dev/null || true
      fi
    } | sort -u
  )
  echo "${all_comments}" \
    | grep -oP 'Overall Score:\*?\*?\s*(\d+)/100' \
    | tail -1 \
    | grep -oP '\d+(?=/100)' || echo ""
}

# Count failed CI checks for a PR.
# Uses JSON fields when available (more reliable across check name/status formats),
# then falls back to text parsing for older/mocked gh outputs.
get_pr_failed_ci_checks() {
  local pr_number="${1:?PR number required}"
  local failed_count=""

  failed_count="$(
    gh pr checks "${pr_number}" --json bucket,state,conclusion --jq '
      [ .[]
        | (.bucket // "" | ascii_downcase) as $bucket
        | (.state // "" | ascii_downcase) as $state
        | (.conclusion // "" | ascii_downcase) as $conclusion
        | select(
            $bucket == "fail" or
            $bucket == "cancel" or
            $state == "failure" or
            $state == "error" or
            $state == "cancelled" or
            $conclusion == "failure" or
            $conclusion == "error" or
            $conclusion == "cancelled" or
            $conclusion == "timed_out" or
            $conclusion == "action_required" or
            $conclusion == "startup_failure" or
            $conclusion == "stale"
          )
      ] | length
    ' 2>/dev/null || true
  )"

  if [[ "${failed_count}" =~ ^[0-9]+$ ]]; then
    echo "${failed_count}"
    return 0
  fi

  failed_count=$(
    gh pr checks "${pr_number}" 2>/dev/null \
      | grep -Eci 'fail|error|cancel|timed[_ -]?out|action_required|startup_failure|stale' || true
  )

  if [[ "${failed_count}" =~ ^[0-9]+$ ]]; then
    echo "${failed_count}"
  else
    echo "0"
  fi
}

# Return a semicolon-separated summary of failing CI checks for a PR.
# Format: "<check name> [state=<state>, conclusion=<conclusion>]"
get_pr_failed_ci_summary() {
  local pr_number="${1:?PR number required}"
  local failed_summary=""

  failed_summary="$(
    gh pr checks "${pr_number}" --json name,bucket,state,conclusion --jq '
      [ .[]
        | (.bucket // "" | ascii_downcase) as $bucket
        | (.state // "" | ascii_downcase) as $state
        | (.conclusion // "" | ascii_downcase) as $conclusion
        | select(
            $bucket == "fail" or
            $bucket == "cancel" or
            $state == "failure" or
            $state == "error" or
            $state == "cancelled" or
            $conclusion == "failure" or
            $conclusion == "error" or
            $conclusion == "cancelled" or
            $conclusion == "timed_out" or
            $conclusion == "action_required" or
            $conclusion == "startup_failure" or
            $conclusion == "stale"
          )
        | "\(.name // "unknown") [state=\(.state // "unknown"), conclusion=\(.conclusion // "unknown")]"
      ] | join("; ")
    ' 2>/dev/null || true
  )"

  if [ -n "${failed_summary}" ]; then
    echo "${failed_summary}"
    return 0
  fi

  # Fallback for older/mocked outputs where JSON fields aren't available.
  failed_summary=$(
    gh pr checks "${pr_number}" 2>/dev/null \
      | grep -Ei 'fail|error|cancel|timed[_ -]?out|action_required|startup_failure|stale' \
      | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]][[:space:]]*/ /g' \
      | paste -sd '; ' - || true
  )

  echo "${failed_summary}"
}

# Clean up reviewer-managed worktrees.
# - Always removes the caller's runner worktree when runner_scope is provided.
# - Only non-worker/controller processes perform broad cleanup to avoid
#   parallel workers deleting each other's active worktrees.
cleanup_reviewer_worktrees() {
  local runner_scope="${1:-}"

  if [ -n "${runner_scope}" ]; then
    cleanup_worktrees "${PROJECT_DIR}" "${runner_scope}"
  fi

  if [ "${WORKER_MODE}" = "1" ]; then
    return 0
  fi

  # Remove per-PR reviewer worktrees created by prompts from older runs.
  cleanup_worktrees "${PROJECT_DIR}" "${PROJECT_NAME}-nw-review-"

  # Remove legacy reviewer worktree naming used in some older prompt variants.
  local escaped_project_name
  escaped_project_name=$(printf '%s\n' "${PROJECT_NAME}" | sed 's/[][(){}.^$*+?|\\/]/\\&/g')
  git -C "${PROJECT_DIR}" worktree list --porcelain 2>/dev/null \
    | grep '^worktree ' \
    | awk '{print $2}' \
    | while read -r wt; do
        local wt_basename
        wt_basename=$(basename "${wt}")
        if printf '%s\n' "${wt_basename}" | grep -Eq "^${escaped_project_name}-pr-?[0-9]+$"; then
          log "CLEANUP: Removing legacy reviewer worktree ${wt}"
          git -C "${PROJECT_DIR}" worktree remove --force "${wt}" 2>/dev/null || true
        fi
      done || true
}

# Validate provider
if ! validate_provider "${PROVIDER_CMD}"; then
  echo "ERROR: Unknown provider: ${PROVIDER_CMD}" >&2
  exit 1
fi

rotate_log
log_separator
log "RUN-START: reviewer invoked project=${PROJECT_DIR} provider=${PROVIDER_CMD} worker=${WORKER_MODE} target_pr=${TARGET_PR:-all} parallel=${PARALLEL_ENABLED}"
log "CONFIG: max_runtime=${MAX_RUNTIME}s min_review_score=${MIN_REVIEW_SCORE} auto_merge=${AUTO_MERGE} branch_patterns=${BRANCH_PATTERNS_RAW}"

if ! acquire_lock "${LOCK_FILE}"; then
  emit_result "skip_locked"
  exit 0
fi

cd "${PROJECT_DIR}"

if [ "${WORKER_MODE}" != "1" ]; then
  send_telegram_status_message "🔍 Night Watch Reviewer: started" "Project: ${PROJECT_NAME}
Provider (model): ${PROVIDER_MODEL_DISPLAY}
Branch patterns: ${BRANCH_PATTERNS_RAW}
Target PR: ${TARGET_PR:-all matching}
Action: scanning open PRs for failing checks or low review scores."
fi

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
  if [ "${WORKER_MODE}" != "1" ]; then
    send_telegram_status_message "🔍 Night Watch Reviewer: no matching PRs" "Project: ${PROJECT_NAME}
Provider (model): ${PROVIDER_MODEL_DISPLAY}
Branch patterns: ${BRANCH_PATTERNS_RAW}
Target PR: ${TARGET_PR:-all matching}
Result: 0 open PRs matched."
  fi
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

  FAILED_CHECKS=$(get_pr_failed_ci_checks "${pr_number}")
  if [ "${FAILED_CHECKS}" -gt 0 ]; then
    FAILED_SUMMARY=$(get_pr_failed_ci_summary "${pr_number}")
    if [ -n "${FAILED_SUMMARY}" ]; then
      log "INFO: PR #${pr_number} (${pr_branch}) has ${FAILED_CHECKS} failed CI check(s): ${FAILED_SUMMARY}"
    else
      log "INFO: PR #${pr_number} (${pr_branch}) has ${FAILED_CHECKS} failed CI check(s)"
    fi
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

  # ── Auto-merge eligible PRs ───────────────────────────────
  if [ "${NW_AUTO_MERGE:-0}" = "1" ]; then
    AUTO_MERGE_METHOD="${NW_AUTO_MERGE_METHOD:-squash}"
    AUTO_MERGED_COUNT=0

    log "AUTO-MERGE: Checking for merge-ready PRs (method: ${AUTO_MERGE_METHOD})"

    while IFS=$'\t' read -r pr_number pr_branch; do
      [ -z "${pr_number}" ] || [ -z "${pr_branch}" ] && continue
      printf '%s\n' "${pr_branch}" | grep -Eq "${BRANCH_REGEX}" || continue

      # Check CI status - must have ALL checks passing (not just "no failures")
      # gh pr checks exits 0 if all pass, 8 if pending, non-zero otherwise
      if ! gh pr checks "${pr_number}" --required >/dev/null 2>&1; then
        log "AUTO-MERGE: PR #${pr_number} has pending or failed CI checks"
        continue
      fi

      # Check review score
      PR_COMMENTS=$(
        {
          gh pr view "${pr_number}" --json comments --jq '.comments[].body' 2>/dev/null || true
          if [ -n "${REPO}" ]; then
            gh api "repos/${REPO}/issues/${pr_number}/comments" --jq '.[].body' 2>/dev/null || true
          fi
        } | sort -u
      )
      PR_SCORE=$(echo "${PR_COMMENTS}" \
        | grep -oP 'Overall Score:\*?\*?\s*(\d+)/100' \
        | tail -1 \
        | grep -oP '\d+(?=/100)' || echo "")

      # Skip PRs without a score or with score below threshold
      [ -z "${PR_SCORE}" ] && continue
      [ "${PR_SCORE}" -lt "${MIN_REVIEW_SCORE}" ] && continue

      # PR is merge-ready
      log "AUTO-MERGE: PR #${pr_number} (${pr_branch}) — score ${PR_SCORE}/100, CI passing"

      # Dry-run mode: show what would be merged
      if [ "${NW_DRY_RUN:-0}" = "1" ]; then
        log "AUTO-MERGE (dry-run): Would queue merge for PR #${pr_number} using ${AUTO_MERGE_METHOD}"
        continue
      fi

      if gh pr merge "${pr_number}" --"${AUTO_MERGE_METHOD}" --auto --delete-branch 2>>"${LOG_FILE}"; then
        log "AUTO-MERGE: Successfully queued merge for PR #${pr_number}"
        AUTO_MERGED_COUNT=$((AUTO_MERGED_COUNT + 1))
      else
        log "WARN: Auto-merge failed for PR #${pr_number}"
      fi
    done < <(gh pr list --state open --json number,headRefName --jq '.[] | [.number, .headRefName] | @tsv' 2>/dev/null || true)

    if [ "${AUTO_MERGED_COUNT}" -gt 0 ]; then
      log "AUTO-MERGE: Queued ${AUTO_MERGED_COUNT} PR(s) for merge"
    fi
  fi

  if [ "${WORKER_MODE}" != "1" ]; then
    send_telegram_status_message "🔍 Night Watch Reviewer: nothing to do" "Project: ${PROJECT_NAME}
Provider (model): ${PROVIDER_MODEL_DISPLAY}
Result: all ${OPEN_PRS} matching PRs already pass CI and review threshold (${MIN_REVIEW_SCORE})."
  fi
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

# Remove stale reviewer worktrees from previous interrupted runs.
# Worker processes skip broad cleanup to avoid parallel interference.
cleanup_reviewer_worktrees

# Convert "#12 #34" into ["12", "34"] for worker fan-out.
PR_NUMBER_ARRAY=()
for pr_token in ${PRS_NEEDING_WORK}; do
  PR_NUMBER_ARRAY+=("${pr_token#\#}")
done

if [ -z "${TARGET_PR}" ] && [ "${WORKER_MODE}" != "1" ] && [ "${PARALLEL_ENABLED}" = "1" ] && [ "${#PR_NUMBER_ARRAY[@]}" -gt 1 ]; then
  # Dry-run mode: print diagnostics and exit
  if [ "${NW_DRY_RUN:-0}" = "1" ]; then
    echo "=== Dry Run: PR Reviewer ==="
    echo "Provider (model): ${PROVIDER_MODEL_DISPLAY}"
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

  WORKER_IDX=0
  WORKER_STAGGER_DELAY="${NW_REVIEWER_WORKER_STAGGER:-60}"
  for pr_number in "${PR_NUMBER_ARRAY[@]}"; do
    if [ "${WORKER_IDX}" -gt 0 ]; then
      log "PARALLEL: Staggering worker launch by ${WORKER_STAGGER_DELAY}s (worker $((WORKER_IDX + 1))/${#PR_NUMBER_ARRAY[@]})"
      sleep "${WORKER_STAGGER_DELAY}"
    fi

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
    WORKER_IDX=$((WORKER_IDX + 1))
  done

  EXIT_CODE=0
  AUTO_MERGED_PRS=""
  AUTO_MERGE_FAILED_PRS=""
  MAX_WORKER_ATTEMPTS=1
  MAX_WORKER_FINAL_SCORE=""

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
    worker_attempts=$(printf '%s' "${worker_result}" | grep -oP '(?<=attempts=)[^|]+' || true)
    worker_final_score=$(printf '%s' "${worker_result}" | grep -oP '(?<=final_score=)[^|]+' || true)

    AUTO_MERGED_PRS=$(append_csv "${AUTO_MERGED_PRS}" "${worker_auto_merged}")
    AUTO_MERGE_FAILED_PRS=$(append_csv "${AUTO_MERGE_FAILED_PRS}" "${worker_auto_merge_failed}")

    if [[ "${worker_attempts}" =~ ^[0-9]+$ ]] && [ "${worker_attempts}" -gt "${MAX_WORKER_ATTEMPTS}" ]; then
      MAX_WORKER_ATTEMPTS="${worker_attempts}"
    fi
    if [[ "${worker_final_score}" =~ ^[0-9]+$ ]]; then
      if [ -z "${MAX_WORKER_FINAL_SCORE}" ] || [ "${worker_final_score}" -gt "${MAX_WORKER_FINAL_SCORE}" ]; then
        MAX_WORKER_FINAL_SCORE="${worker_final_score}"
      fi
    fi

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

  # Parent/controller process cleans up any per-PR reviewer worktrees that
  # worker runs may have left behind.
  cleanup_reviewer_worktrees

  emit_final_status "${EXIT_CODE}" "${PRS_NEEDING_WORK_CSV}" "${AUTO_MERGED_PRS}" "${AUTO_MERGE_FAILED_PRS}" "${MAX_WORKER_ATTEMPTS}" "${MAX_WORKER_FINAL_SCORE}"
  exit 0
fi

REVIEW_RUN_TOKEN="${PROJECT_RUNTIME_KEY}-$$"
REVIEW_WORKTREE_BASENAME="${PROJECT_NAME}-nw-review-runner-${REVIEW_RUN_TOKEN}"
if [ -n "${TARGET_PR}" ]; then
  REVIEW_WORKTREE_BASENAME="${PROJECT_NAME}-nw-review-runner-pr-${TARGET_PR}-${REVIEW_RUN_TOKEN}"
fi
REVIEW_WORKTREE_DIR="$(dirname "${PROJECT_DIR}")/${REVIEW_WORKTREE_BASENAME}"

cleanup_reviewer_worktrees "${REVIEW_WORKTREE_BASENAME}"

# Dry-run mode: print diagnostics and exit
if [ "${NW_DRY_RUN:-0}" = "1" ]; then
  echo "=== Dry Run: PR Reviewer ==="
  echo "Provider (model): ${PROVIDER_MODEL_DISPLAY}"
  echo "Branch Patterns: ${BRANCH_PATTERNS_RAW}"
  echo "Min Review Score: ${MIN_REVIEW_SCORE}"
  echo "Auto-merge: ${AUTO_MERGE}"
  if [ "${AUTO_MERGE}" = "1" ]; then
    echo "Auto-merge Method: ${AUTO_MERGE_METHOD}"
  fi
  echo "Max Retries: ${REVIEWER_MAX_RETRIES}"
  echo "Retry Delay: ${REVIEWER_RETRY_DELAY}s"
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

if ! assert_isolated_worktree "${PROJECT_DIR}" "${REVIEW_WORKTREE_DIR}" "reviewer"; then
  log "FAIL: Reviewer worktree guard rejected ${REVIEW_WORKTREE_DIR}"
  emit_result "failure" "reason=worktree_guard_failed"
  exit 1
fi

REVIEWER_PROMPT_PATH=$(resolve_instruction_path_with_fallback "${REVIEW_WORKTREE_DIR}" "pr-reviewer.md" "night-watch-pr-reviewer.md" || true)
if [ -z "${REVIEWER_PROMPT_PATH}" ]; then
  log "FAIL: Missing reviewer prompt file. Checked pr-reviewer.md/night-watch-pr-reviewer.md in instructions/, .claude/commands/, and bundled templates/"
  emit_result "failure" "reason=missing_reviewer_prompt"
  exit 1
fi
REVIEWER_PROMPT_BUNDLED_NAME="pr-reviewer.md"
if [[ "${REVIEWER_PROMPT_PATH}" == */night-watch-pr-reviewer.md ]]; then
  REVIEWER_PROMPT_BUNDLED_NAME="night-watch-pr-reviewer.md"
fi
REVIEWER_PROMPT_PATH=$(prefer_bundled_prompt_if_legacy_command "${REVIEW_WORKTREE_DIR}" "${REVIEWER_PROMPT_PATH}" "${REVIEWER_PROMPT_BUNDLED_NAME}")
REVIEWER_PROMPT_BASE=$(cat "${REVIEWER_PROMPT_PATH}")
REVIEWER_PROMPT_REF=$(instruction_ref_for_prompt "${REVIEW_WORKTREE_DIR}" "${REVIEWER_PROMPT_PATH}")
log "INFO: Using reviewer prompt from ${REVIEWER_PROMPT_REF}"

# Inject provider attribution requirement into the reviewer prompt.
# The AI must add a footer to every review comment it posts.
REVIEWER_PROVIDER_LABEL="${NW_PROVIDER_LABEL:-${PROVIDER_CMD}}"
REVIEWER_PROMPT_BASE="${REVIEWER_PROMPT_BASE}"$'\n\n'"## Reviewer Attribution (Required)"$'\n'"At the very end of each review comment you post, add this footer on its own line:"$'\n'"> 🔍 Reviewed by ${REVIEWER_PROVIDER_LABEL}"

EXIT_CODE=0
ATTEMPTS_MADE=1
FINAL_SCORE=""
TARGET_SCOPE_PROMPT=""
if [ -n "${TARGET_PR}" ]; then
  TARGET_SCOPE_PROMPT=$'\n\n## Target Scope\n- Only process PR #'"${TARGET_PR}"$'.\n- Ignore all other PRs.\n- If this PR no longer needs work, stop immediately.\n'

  TARGET_MERGE_STATE=$(gh pr view "${TARGET_PR}" --json mergeStateStatus --jq '.mergeStateStatus' 2>/dev/null || echo "UNKNOWN")
  TARGET_FAILED_CHECKS=$(get_pr_failed_ci_summary "${TARGET_PR}")
  TARGET_SCORE=$(get_pr_score "${TARGET_PR}")

  TARGET_SCOPE_PROMPT+=$'\n## Preflight Data (from CLI)\n- mergeStateStatus: '"${TARGET_MERGE_STATE}"$'\n'
  if [ -n "${TARGET_FAILED_CHECKS}" ]; then
    TARGET_SCOPE_PROMPT+=$'- failing checks: '"${TARGET_FAILED_CHECKS}"$'\n'
  else
    TARGET_SCOPE_PROMPT+=$'- failing checks: none detected\n'
  fi
  if [ -n "${TARGET_SCORE}" ]; then
    TARGET_SCOPE_PROMPT+=$'- latest review score: '"${TARGET_SCORE}"$'/100\n'
  else
    TARGET_SCOPE_PROMPT+=$'- latest review score: not found\n'
  fi
fi

PRD_CONTEXT_PROMPT=""
if [ -n "${TARGET_PR}" ]; then
  PRD_CONTEXT_PROMPT=$(build_prd_context_prompt "${TARGET_PR}")
elif [ "${#PR_NUMBER_ARRAY[@]}" -gt 0 ]; then
  PRD_CONTEXT_PROMPT=$(build_prd_context_prompt "${PR_NUMBER_ARRAY[@]}")
fi
if [ -n "${PRD_CONTEXT_PROMPT}" ]; then
  if [ -n "${TARGET_PR}" ]; then
    log "INFO: Added PRD context for PR #${TARGET_PR}"
  else
    log "INFO: Added PRD context for ${#PR_NUMBER_ARRAY[@]} PR(s)"
  fi
else
  log "WARN: No PRD context found for current reviewer scope"
fi

# ── Retry Loop for Targeted PR Review ──────────────────────────────────────────
# Only retry when targeting a specific PR. Non-targeted mode handles all PRs in one shot.
TOTAL_ATTEMPTS=1
if [ -n "${TARGET_PR}" ]; then
  TOTAL_ATTEMPTS=$((REVIEWER_MAX_RETRIES + 1))
fi
RUN_STARTED_AT=$(date +%s)

remaining_runtime_budget() {
  local now_ts
  local elapsed
  local remaining

  now_ts=$(date +%s)
  elapsed=$((now_ts - RUN_STARTED_AT))
  remaining=$((MAX_RUNTIME - elapsed))
  printf "%s" "${remaining}"
}

sleep_with_runtime_budget() {
  local requested_sleep="${1:-0}"
  local remaining
  local sleep_for

  if ! [[ "${requested_sleep}" =~ ^[0-9]+$ ]]; then
    requested_sleep=0
  fi
  if [ "${requested_sleep}" -le 0 ]; then
    return 0
  fi

  if [ -z "${TARGET_PR}" ]; then
    sleep "${requested_sleep}"
    return 0
  fi

  remaining=$(remaining_runtime_budget)
  if [ "${remaining}" -le 0 ]; then
    return 124
  fi

  sleep_for="${requested_sleep}"
  if [ "${sleep_for}" -gt "${remaining}" ]; then
    sleep_for="${remaining}"
  fi
  if [ "${sleep_for}" -le 0 ]; then
    return 124
  fi

  sleep "${sleep_for}"
  return 0
}

for ATTEMPT in $(seq 1 "${TOTAL_ATTEMPTS}"); do
  ATTEMPTS_MADE="${ATTEMPT}"

  ATTEMPT_TIMEOUT="${MAX_RUNTIME}"
  if [ -n "${TARGET_PR}" ]; then
    # Calculate timeout from remaining runtime budget.
    NOW_TS=$(date +%s)
    ELAPSED=$((NOW_TS - RUN_STARTED_AT))
    REMAINING_BUDGET=$((MAX_RUNTIME - ELAPSED))
    if [ "${REMAINING_BUDGET}" -le 0 ]; then
      EXIT_CODE=124
      log "RETRY: Runtime budget exhausted before attempt ${ATTEMPT}"
      break
    fi

    REMAINING_ATTEMPTS=$((TOTAL_ATTEMPTS - ATTEMPT + 1))
    ATTEMPT_TIMEOUT=$((REMAINING_BUDGET / REMAINING_ATTEMPTS))
    if [ "${ATTEMPT_TIMEOUT}" -lt 1 ]; then
      ATTEMPT_TIMEOUT=1
    fi
  fi

  # Recreate worktree if it was removed unexpectedly between attempts.
  if [ ! -d "${REVIEW_WORKTREE_DIR}" ] || ! git -C "${REVIEW_WORKTREE_DIR}" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    log "RETRY: Reviewer worktree missing for attempt ${ATTEMPT}; recreating ${REVIEW_WORKTREE_DIR}"
    cleanup_reviewer_worktrees "${REVIEW_WORKTREE_BASENAME}"
    if ! prepare_detached_worktree "${PROJECT_DIR}" "${REVIEW_WORKTREE_DIR}" "${DEFAULT_BRANCH}" "${LOG_FILE}"; then
      EXIT_CODE=1
      log "RETRY: Unable to recreate reviewer worktree; aborting"
      break
    fi
    if ! assert_isolated_worktree "${PROJECT_DIR}" "${REVIEW_WORKTREE_DIR}" "reviewer"; then
      EXIT_CODE=1
      log "RETRY: Reviewer worktree guard rejected recreated directory; aborting"
      break
    fi
  fi

  log "RETRY: Starting attempt ${ATTEMPT}/${TOTAL_ATTEMPTS} (timeout: ${ATTEMPT_TIMEOUT}s) pr=${TARGET_PR:-all}"
  LOG_LINE_BEFORE=$(wc -l < "${LOG_FILE}" 2>/dev/null || echo 0)
  REVIEWER_ATTEMPT_START=$(date +%s)
  REVIEWER_PROMPT="${REVIEWER_PROMPT_BASE}${TARGET_SCOPE_PROMPT}${PRD_CONTEXT_PROMPT}"

  case "${PROVIDER_CMD}" in
    claude)
      if (
        cd "${REVIEW_WORKTREE_DIR}" && timeout "${ATTEMPT_TIMEOUT}" \
          claude -p "${REVIEWER_PROMPT}" \
            --dangerously-skip-permissions \
            2>&1 | tee -a "${LOG_FILE}"
      ); then
        EXIT_CODE=0
      else
        EXIT_CODE=$?
      fi
      ;;
    codex)
      if (
        cd "${REVIEW_WORKTREE_DIR}" && timeout "${ATTEMPT_TIMEOUT}" \
          codex exec \
            -C "${REVIEW_WORKTREE_DIR}" \
            --yolo \
            "${REVIEWER_PROMPT}" \
            2>&1 | tee -a "${LOG_FILE}"
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

  REVIEWER_ATTEMPT_ELAPSED=$(( $(date +%s) - REVIEWER_ATTEMPT_START ))
  log "RETRY: Attempt ${ATTEMPT}/${TOTAL_ATTEMPTS} finished exit_code=${EXIT_CODE} elapsed=${REVIEWER_ATTEMPT_ELAPSED}s pr=${TARGET_PR:-all}"

  # If provider failed (non-zero exit), check for rate limit before giving up
  if [ "${EXIT_CODE}" -ne 0 ]; then
	    if [ "${EXIT_CODE}" -ne 124 ] && \
	       check_rate_limited "${LOG_FILE}" "${LOG_LINE_BEFORE}" && \
	       [ -n "${TARGET_PR}" ] && \
	       [ "${ATTEMPT}" -lt "${TOTAL_ATTEMPTS}" ]; then
	      log "RATE-LIMITED: 429 detected for PR #${TARGET_PR} (attempt ${ATTEMPT}/${TOTAL_ATTEMPTS}), retrying in 120s..."
	      if ! sleep_with_runtime_budget 120; then
	        EXIT_CODE=124
	        log "RETRY: Runtime budget exhausted while waiting to retry PR #${TARGET_PR}"
	        break
	      fi
	      continue
	    fi
    log "RETRY: Provider exited with code ${EXIT_CODE}, not retrying"
    break
  fi

	  if provider_output_looks_invalid "${LOG_LINE_BEFORE}"; then
	    log "RETRY: Invalid provider output detected for attempt ${ATTEMPT} (broken session/wrapper output)"
	    if [ "${ATTEMPT}" -lt "${TOTAL_ATTEMPTS}" ]; then
	      if ! sleep_with_runtime_budget "${REVIEWER_RETRY_DELAY}"; then
	        EXIT_CODE=124
	        log "RETRY: Runtime budget exhausted before retrying invalid provider output"
	        break
	      fi
	      continue
	    fi
	    EXIT_CODE=1
    break
  fi

  # Re-check score for the target PR (only in targeted mode)
  if [ -n "${TARGET_PR}" ]; then
    CURRENT_SCORE=$(get_pr_score "${TARGET_PR}")
    if [ -z "${CURRENT_SCORE}" ]; then
      CURRENT_FAILED_CHECKS=$(get_pr_failed_ci_summary "${TARGET_PR}")
      if [ -z "${CURRENT_FAILED_CHECKS}" ]; then
        log "RETRY: No review score for PR #${TARGET_PR}, but CI shows no failing checks; treating as successful."
        break
	      fi
	      if [ "${ATTEMPT}" -lt "${TOTAL_ATTEMPTS}" ]; then
	        log "RETRY: No review score found for PR #${TARGET_PR} after attempt ${ATTEMPT}; retrying in ${REVIEWER_RETRY_DELAY}s..."
	        if ! sleep_with_runtime_budget "${REVIEWER_RETRY_DELAY}"; then
	          EXIT_CODE=124
	          log "RETRY: Runtime budget exhausted before retrying missing score for PR #${TARGET_PR}"
	          break
	        fi
	        continue
	      fi
	      log "RETRY: No review score found for PR #${TARGET_PR} after ${TOTAL_ATTEMPTS} attempts; failing run."
      EXIT_CODE=1
      break
    fi

    FINAL_SCORE="${CURRENT_SCORE}"
    if [ "${CURRENT_SCORE}" -ge "${MIN_REVIEW_SCORE}" ]; then
      log "RETRY: PR #${TARGET_PR} now scores ${CURRENT_SCORE}/100 (>= ${MIN_REVIEW_SCORE}) after attempt ${ATTEMPT}"
      break
	    fi
	    if [ "${ATTEMPT}" -lt "${TOTAL_ATTEMPTS}" ]; then
	      log "RETRY: PR #${TARGET_PR} scores ${CURRENT_SCORE:-unknown}/100 after attempt ${ATTEMPT}/${TOTAL_ATTEMPTS}, retrying in ${REVIEWER_RETRY_DELAY}s..."
	      if ! sleep_with_runtime_budget "${REVIEWER_RETRY_DELAY}"; then
	        EXIT_CODE=124
	        log "RETRY: Runtime budget exhausted before retrying low score for PR #${TARGET_PR}"
	        break
	      fi
	    else
	      log "RETRY: PR #${TARGET_PR} still at ${CURRENT_SCORE:-unknown}/100 after ${TOTAL_ATTEMPTS} attempts - giving up"
	      gh pr edit "${TARGET_PR}" --add-label "needs-human-review" 2>/dev/null || true
    fi
  else
    # Non-targeted mode: no retry (reviewer handles all PRs in one shot)
    break
  fi
done

cleanup_reviewer_worktrees "${REVIEW_WORKTREE_BASENAME}"

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

    # Check CI status - must have ALL checks passing (not just "no failures")
    # gh pr checks exits 0 if all pass, 8 if pending, non-zero otherwise
    if ! gh pr checks "${pr_number}" --required >/dev/null 2>&1; then
      log "AUTO-MERGE: PR #${pr_number} has pending or failed CI checks"
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

REVIEWER_TOTAL_ELAPSED=$(( $(date +%s) - SCRIPT_START_TIME ))
log "OUTCOME: exit_code=${EXIT_CODE} total_elapsed=${REVIEWER_TOTAL_ELAPSED}s prs=${PRS_NEEDING_WORK_CSV:-none} attempts=${ATTEMPTS_MADE}"
emit_final_status "${EXIT_CODE}" "${PRS_NEEDING_WORK_CSV}" "${AUTO_MERGED_PRS}" "${AUTO_MERGE_FAILED_PRS}" "${ATTEMPTS_MADE}" "${FINAL_SCORE}"
