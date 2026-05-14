#!/usr/bin/env bash
set -euo pipefail

# Night Watch Merge Orchestrator Cron Runner
# Usage: night-watch-merger-cron.sh /path/to/project
#
# Scans all open PRs, filters eligible ones, and merges them in FIFO order
# (oldest PR first by creation date). Rebases remaining PRs after each merge.
#
# Required env vars (with defaults shown):
#   NW_MERGER_MAX_RUNTIME=1800               - Maximum runtime in seconds (30 min)
#   NW_MERGER_MERGE_METHOD=squash            - Merge method: squash|merge|rebase
#   NW_MERGER_MIN_REVIEW_SCORE=80            - Minimum review score threshold
#   NW_MERGER_BRANCH_PATTERNS=               - Comma-separated branch prefixes (empty = all)
#   NW_MERGER_REBASE_BEFORE_MERGE=1          - Set to 1 to rebase before merging
#   NW_MERGER_MAX_PRS_PER_RUN=0             - Max PRs to merge per run (0 = unlimited)
#   NW_MERGER_CI_POLICY=fallback-local      - CI gate: ci-only|fallback-local|ignore
#   NW_MERGER_LOCAL_CHECK_COMMAND=...       - Command run in temp PR worktree for local fallback
#   NW_MERGER_CI_MAX_WAIT=300                - Max seconds to wait for checks after rebase
#   NW_MERGER_CI_POLL_INTERVAL=15            - Seconds between check polls after rebase
#   NW_DRY_RUN=0                             - Set to 1 for dry-run mode

PROJECT_DIR="${1:?Usage: $0 /path/to/project}"
PROJECT_NAME=$(basename "${PROJECT_DIR}")
LOG_DIR="${PROJECT_DIR}/logs"
LOG_FILE="${LOG_DIR}/merger.log"
MAX_RUNTIME="${NW_MERGER_MAX_RUNTIME:-1800}"
MAX_LOG_SIZE="524288"  # 512 KB
MERGE_METHOD="${NW_MERGER_MERGE_METHOD:-squash}"
MIN_REVIEW_SCORE="${NW_MERGER_MIN_REVIEW_SCORE:-80}"
REBASE_BEFORE_MERGE="${NW_MERGER_REBASE_BEFORE_MERGE:-1}"
MAX_PRS_PER_RUN="${NW_MERGER_MAX_PRS_PER_RUN:-0}"
CI_MAX_WAIT="${NW_MERGER_CI_MAX_WAIT:-300}"
CI_POLL_INTERVAL="${NW_MERGER_CI_POLL_INTERVAL:-15}"
CI_POLICY="${NW_MERGER_CI_POLICY:-fallback-local}"
LOCAL_CHECK_COMMAND="${NW_MERGER_LOCAL_CHECK_COMMAND:-yarn install --frozen-lockfile && yarn verify && yarn test}"
BRANCH_PATTERNS_RAW="${NW_MERGER_BRANCH_PATTERNS:-}"
READY_TO_MERGE_LABEL="${NW_PR_RESOLVER_READY_LABEL:-ready-to-merge}"
SCRIPT_START_TIME=$(date +%s)
DRY_RUN="${NW_DRY_RUN:-0}"
PROVIDER_CMD="${NW_PROVIDER_CMD:-claude}"
PROVIDER_LABEL="${NW_PROVIDER_LABEL:-}"

# Normalize numeric settings
if ! [[ "${MAX_PRS_PER_RUN}" =~ ^[0-9]+$ ]]; then
  MAX_PRS_PER_RUN="0"
fi
if ! [[ "${MIN_REVIEW_SCORE}" =~ ^[0-9]+$ ]]; then
  MIN_REVIEW_SCORE="80"
fi
if ! [[ "${CI_MAX_WAIT}" =~ ^[0-9]+$ ]]; then
  CI_MAX_WAIT="300"
fi
if ! [[ "${CI_POLL_INTERVAL}" =~ ^[0-9]+$ ]] || [ "${CI_POLL_INTERVAL}" = "0" ]; then
  CI_POLL_INTERVAL="15"
fi
# Clamp merge method to valid values
case "${MERGE_METHOD}" in
  squash|merge|rebase) ;;
  *) MERGE_METHOD="squash" ;;
esac
case "${CI_POLICY}" in
  ci-only|fallback-local|ignore) ;;
  *) CI_POLICY="fallback-local" ;;
esac

mkdir -p "${LOG_DIR}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=night-watch-helpers.sh
source "${SCRIPT_DIR}/night-watch-helpers.sh"

PROJECT_RUNTIME_KEY=$(project_runtime_key "${PROJECT_DIR}")
# NOTE: Lock file path must match mergerLockPath() in src/utils/status-data.ts
LOCK_FILE="/tmp/night-watch-merger-${PROJECT_RUNTIME_KEY}.lock"
SCRIPT_TYPE="merger"
skip_if_job_paused "${SCRIPT_TYPE}" "${PROJECT_DIR}"

MERGED_PRS=0
FAILED_PRS=0
MERGED_PR_LIST=""
LAST_LOCAL_CHECK_OUTPUT=""

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
# Atomically claim a DB slot or enqueue for later dispatch — no flock needed.
if [ "${NW_QUEUE_ENABLED:-0}" = "1" ]; then
  if [ "${NW_QUEUE_DISPATCHED:-0}" = "1" ]; then
    arm_global_queue_cleanup
  else
    claim_or_enqueue "${SCRIPT_TYPE}" "${PROJECT_DIR}"
  fi
fi
# ──────────────────────────────────────────────────────────────────────────────

# Check if branch matches configured patterns
matches_branch_patterns() {
  local branch="${1}"
  if [ -z "${BRANCH_PATTERNS_RAW}" ]; then
    return 0  # No filter = match all
  fi
  IFS=',' read -ra patterns <<< "${BRANCH_PATTERNS_RAW}"
  for pattern in "${patterns[@]}"; do
    pattern="${pattern# }"  # trim leading space
    if [ -n "${pattern}" ] && [[ "${branch}" == "${pattern}"* ]]; then
      return 0
    fi
  done
  return 1
}

# Get review score from PR labels/comments
get_review_score() {
  local pr_number="${1}"
  # Look for review score comment from night-watch
  local score
  score=$(gh pr view "${pr_number}" --json comments \
    --jq '[.comments[].body | select(test("score[^0-9]{0,30}[0-9]+/100"; "i")) | capture("(?i)score[^0-9]{0,30}(?<s>[0-9]+)/100") | .s] | last | tonumber // -1' \
    2>/dev/null || echo "-1")
  echo "${score}"
}

# Count pending review feedback that should send the PR back through reviewer
# instead of allowing the merger to land it. We combine GitHub's review decision
# with unresolved review threads because some providers leave actionable feedback
# as thread comments without lowering the score.
get_pending_review_feedback_count() {
  local pr_number="${1}"
  local review_decision=""
  local change_request_count="0"
  local unresolved_thread_count="0"
  local repo=""
  local owner=""
  local name=""

  review_decision=$(gh pr view "${pr_number}" --json reviewDecision --jq '.reviewDecision // ""' 2>/dev/null || echo "")

  change_request_count=$(gh api "repos/{owner}/{repo}/pulls/${pr_number}/reviews" \
    --jq '[.[] | select(.state == "CHANGES_REQUESTED")] | length' 2>/dev/null || echo "0")
  if ! [[ "${change_request_count}" =~ ^[0-9]+$ ]]; then
    change_request_count="0"
  fi

  repo=$(gh repo view --json nameWithOwner --jq '.nameWithOwner' 2>/dev/null || echo "")
  if [[ "${repo}" == */* ]]; then
    owner="${repo%%/*}"
    name="${repo#*/}"
    unresolved_thread_count=$(gh api graphql \
      -F owner="${owner}" \
      -F name="${name}" \
      -F number="${pr_number}" \
      -f query='
        query($owner: String!, $name: String!, $number: Int!) {
          repository(owner: $owner, name: $name) {
            pullRequest(number: $number) {
              reviewThreads(first: 100) {
                nodes {
                  isResolved
                }
              }
            }
          }
        }
      ' \
      --jq '[.data.repository.pullRequest.reviewThreads.nodes[]? | select(.isResolved == false)] | length' \
      2>/dev/null || echo "0")
    if ! [[ "${unresolved_thread_count}" =~ ^[0-9]+$ ]]; then
      unresolved_thread_count="0"
    fi
  fi

  if [ "${unresolved_thread_count}" -gt 0 ]; then
    echo "${unresolved_thread_count}"
    return 0
  fi

  if [ "${change_request_count}" -gt 0 ]; then
    echo "${change_request_count}"
    return 0
  fi

  if [ "${review_decision}" = "CHANGES_REQUESTED" ]; then
    echo "1"
    return 0
  fi

  echo "0"
}

# Get the current head OID for a PR.
get_pr_head_oid() {
  local pr_number="${1}"
  gh pr view "${pr_number}" --json headRefOid --jq '.headRefOid // ""' 2>/dev/null || echo ""
}

# Return the CI state for the PR's status rollup on the expected head OID.
ci_status_for_head() {
  local pr_number="${1}"
  local expected_head="${2:-}"
  local status_json

  status_json=$(gh pr view "${pr_number}" --json headRefOid,statusCheckRollup 2>/dev/null || echo "")
  if [ -z "${status_json}" ]; then
    echo "unknown"
    return 0
  fi

  echo "${status_json}" | jq -r --arg expected_head "${expected_head}" '
    def in_list($values): . as $value | $values | index($value);
    def check_run_failure:
      .__typename == "CheckRun"
      and ((.conclusion // "") | in_list(["FAILURE", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STALE", "STARTUP_FAILURE"]));
    def status_context_failure:
      .__typename == "StatusContext"
      and ((.state // "") | in_list(["FAILURE", "ERROR"]));
    def check_run_pending:
      .__typename == "CheckRun"
      and ((.status // "") != "COMPLETED" or .conclusion == null);
    def status_context_pending:
      .__typename == "StatusContext"
      and ((.state // "") | in_list(["PENDING", "EXPECTED"]));
    def check_run_nonpassing:
      .__typename == "CheckRun"
      and ((.conclusion // "") | in_list(["SUCCESS", "NEUTRAL", "SKIPPED"]) | not);
    def status_context_nonpassing:
      .__typename == "StatusContext"
      and (.state // "") != "SUCCESS";
    if ($expected_head != "" and (.headRefOid // "") != $expected_head) then
      "head_mismatch"
    elif ((.statusCheckRollup // []) | length) == 0 then
      "absent"
    elif any((.statusCheckRollup // [])[]; check_run_failure or status_context_failure) then
      "failed"
    elif any((.statusCheckRollup // [])[]; check_run_pending or status_context_pending) then
      "pending"
    elif any((.statusCheckRollup // [])[]; check_run_nonpassing or status_context_nonpassing) then
      "failed"
    else
      "passing"
    end
  ' 2>/dev/null || echo "unknown"
}

wait_for_ci_passing_on_head() {
  local pr_number="${1}"
  local expected_head="${2}"
  local ci_waited=0
  LAST_CI_STATUS="unknown"

  while [ "${ci_waited}" -lt "${CI_MAX_WAIT}" ]; do
    LAST_CI_STATUS=$(ci_status_for_head "${pr_number}" "${expected_head}")
    if [ "${LAST_CI_STATUS}" = "passing" ]; then
      return 0
    fi
    log "INFO: PR #${pr_number}: Waiting for fresh CI on head ${expected_head} (${LAST_CI_STATUS}, ${ci_waited}s/${CI_MAX_WAIT}s)..."
    sleep "${CI_POLL_INTERVAL}"
    ci_waited=$((ci_waited + CI_POLL_INTERVAL))
  done

  LAST_CI_STATUS=$(ci_status_for_head "${pr_number}" "${expected_head}")
  [ "${LAST_CI_STATUS}" = "passing" ]
}

find_existing_worktree_for_head() {
  local pr_branch="${1}"
  local expected_head="${2}"
  local project_real=""
  local worktree_path=""
  local branch=""
  local head=""

  project_real=$(cd "${PROJECT_DIR}" && pwd -P 2>/dev/null || echo "${PROJECT_DIR}")

  while IFS= read -r line; do
    if [[ "${line}" == worktree\ * ]]; then
      worktree_path="${line#worktree }"
      branch=""
      head=""
      continue
    fi
    if [[ "${line}" == HEAD\ * ]]; then
      head="${line#HEAD }"
      continue
    fi
    if [[ "${line}" == branch\ * ]]; then
      branch="${line#branch refs/heads/}"
      if [ -n "${worktree_path}" ] \
        && [ "${branch}" = "${pr_branch}" ] \
        && [ "${head}" = "${expected_head}" ] \
        && [ -d "${worktree_path}" ]; then
        local worktree_real=""
        worktree_real=$(cd "${worktree_path}" && pwd -P 2>/dev/null || echo "${worktree_path}")
        if [ "${worktree_real}" = "${project_real}" ]; then
          continue
        fi
        if git -C "${worktree_path}" diff --quiet >/dev/null 2>&1 \
          && git -C "${worktree_path}" diff --cached --quiet >/dev/null 2>&1; then
          printf "%s" "${worktree_path}"
          return 0
        fi
      fi
    fi
  done < <(git worktree list --porcelain 2>/dev/null || true)

  return 1
}

run_local_check_command_in_dir() {
  local pr_number="${1}"
  local expected_head="${2}"
  local check_dir="${3}"
  local check_exit=1
  local output_file=""

  output_file=$(mktemp "${TMPDIR:-/tmp}/night-watch-merger-local-check-${pr_number}.XXXXXX")
  LAST_LOCAL_CHECK_OUTPUT=""

  set +e
  (
    cd "${check_dir}"
    bash -lc "${LOCAL_CHECK_COMMAND}"
  ) 2>&1 | tee "${output_file}" | tee -a "${LOG_FILE}"
  check_exit=${PIPESTATUS[0]}
  set -e

  LAST_LOCAL_CHECK_OUTPUT=$(head -c 10000 "${output_file}" 2>/dev/null || true)
  rm -f "${output_file}" 2>/dev/null || true

  if [ "${check_exit}" -eq 0 ]; then
    log "INFO: PR #${pr_number}: Local checks passed for head ${expected_head}"
    return 0
  fi

  log "INFO: PR #${pr_number}: Local checks failed for head ${expected_head} (exit ${check_exit})"
  return 1
}

run_local_checks_for_head() {
  local pr_number="${1}"
  local pr_branch="${2}"
  local expected_head="${3}"
  local temp_parent=""
  local worktree_dir=""
  local existing_worktree_dir=""
  local temp_ref=""

  if [ -z "${LOCAL_CHECK_COMMAND}" ]; then
    log "INFO: PR #${pr_number}: Local check command is empty, treating fallback as failed"
    return 1
  fi

  if existing_worktree_dir=$(find_existing_worktree_for_head "${pr_branch}" "${expected_head}"); then
    log "INFO: PR #${pr_number}: Reusing existing worktree for local checks: ${existing_worktree_dir}"
    run_local_check_command_in_dir "${pr_number}" "${expected_head}" "${existing_worktree_dir}"
    return $?
  fi

  temp_parent=$(mktemp -d "${TMPDIR:-/tmp}/night-watch-merger-${pr_number}.XXXXXX")
  worktree_dir="${temp_parent}/worktree"
  temp_ref="refs/night-watch/merger/${pr_number}-${expected_head}"

  cleanup_local_check_worktree() {
    git worktree remove --force "${worktree_dir}" >/dev/null 2>&1 || true
    git update-ref -d "${temp_ref}" >/dev/null 2>&1 || true
    rm -rf "${temp_parent}" >/dev/null 2>&1 || true
  }

  log "INFO: PR #${pr_number}: Running local checks for head ${expected_head}: ${LOCAL_CHECK_COMMAND}"

  if ! git cat-file -e "${expected_head}^{commit}" >/dev/null 2>&1; then
    log "INFO: PR #${pr_number}: Fetching PR head ${expected_head} for local checks"
    git fetch --quiet --force origin "pull/${pr_number}/head:${temp_ref}" >/dev/null 2>&1 || {
      log "INFO: PR #${pr_number}: Unable to fetch PR head for local checks"
      cleanup_local_check_worktree
      return 1
    }
  fi

  if ! git worktree add --detach --quiet "${worktree_dir}" "${expected_head}" >/dev/null 2>&1; then
    if ! git worktree add --detach --quiet "${worktree_dir}" "${temp_ref}" >/dev/null 2>&1; then
      log "INFO: PR #${pr_number}: Unable to create local check worktree"
      cleanup_local_check_worktree
      return 1
    fi
  fi

  run_local_check_command_in_dir "${pr_number}" "${expected_head}" "${worktree_dir}"
  local check_result=$?

  cleanup_local_check_worktree

  return "${check_result}"
}

run_reviewer_repair_for_pr() {
  local pr_number="${1}"
  local pr_branch="${2}"
  local expected_head="${3}"
  local elapsed=0
  local remaining=0
  local reviewer_exit=1

  elapsed=$(( $(date +%s) - SCRIPT_START_TIME ))
  remaining=$(( MAX_RUNTIME - elapsed - 30 ))
  if [ "${remaining}" -lt 120 ]; then
    log "INFO: PR #${pr_number} (${pr_branch}): Not enough merger runtime left for targeted reviewer repair (${remaining}s), skipping repair"
    return 1
  fi

  log "INFO: PR #${pr_number} (${pr_branch}): Running targeted reviewer repair after local check failure on head ${expected_head}"

  set +e
  (
    NW_TARGET_PR="${pr_number}" \
    NW_REVIEWER_WORKER_MODE="1" \
    NW_REVIEWER_PARALLEL="0" \
    NW_REVIEWER_MAX_RUNTIME="${remaining}" \
    NW_TARGET_LOCAL_CHECK_COMMAND="${LOCAL_CHECK_COMMAND}" \
    NW_TARGET_LOCAL_CHECK_OUTPUT="${LAST_LOCAL_CHECK_OUTPUT}" \
    bash "${SCRIPT_DIR}/night-watch-pr-reviewer-cron.sh" "${PROJECT_DIR}"
  ) 2>&1 | tee -a "${LOG_FILE}"
  reviewer_exit=${PIPESTATUS[0]}
  set -e

  if [ "${reviewer_exit}" -eq 0 ]; then
    log "INFO: PR #${pr_number} (${pr_branch}): Targeted reviewer repair completed"
    return 0
  fi

  log "INFO: PR #${pr_number} (${pr_branch}): Targeted reviewer repair failed (exit ${reviewer_exit})"
  return 1
}

ci_gate_allows_head() {
  local pr_number="${1}"
  local pr_branch="${2}"
  local expected_head="${3}"
  local context="${4:-CI}"
  local ci_status

  if [ "${CI_POLICY}" = "ignore" ]; then
    log "INFO: PR #${pr_number} (${pr_branch}): CI policy is ignore; skipping ${context} gate for head ${expected_head}"
    return 0
  fi

  ci_status=$(ci_status_for_head "${pr_number}" "${expected_head}")
  if [ "${ci_status}" = "passing" ]; then
    return 0
  fi

  if [ "${CI_POLICY}" = "fallback-local" ]; then
    log "INFO: PR #${pr_number} (${pr_branch}): ${context} not passing on head ${expected_head} (${ci_status}); trying local checks"
    if run_local_checks_for_head "${pr_number}" "${pr_branch}" "${expected_head}"; then
      return 0
    fi
    if run_reviewer_repair_for_pr "${pr_number}" "${pr_branch}" "${expected_head}"; then
      local repaired_head=""
      repaired_head=$(get_pr_head_oid "${pr_number}")
      if [ -n "${repaired_head}" ]; then
        log "INFO: PR #${pr_number} (${pr_branch}): Re-checking local checks after targeted repair on head ${repaired_head}"
        if run_local_checks_for_head "${pr_number}" "${pr_branch}" "${repaired_head}"; then
          return 0
        fi
      fi
    fi
    log "INFO: PR #${pr_number} (${pr_branch}): Local check fallback failed after repair attempt, skipping"
    return 1
  fi

  log "INFO: PR #${pr_number} (${pr_branch}): ${context} not passing on head ${expected_head} (${ci_status}), skipping"
  return 1
}

# Rebase a PR against its base branch
rebase_pr() {
  local pr_number="${1}"
  log "INFO: Rebasing PR #${pr_number} against base branch"
  if [ "${DRY_RUN}" = "1" ]; then
    log "INFO: [DRY RUN] Would rebase PR #${pr_number}"
    return 0
  fi
  gh pr update-branch --rebase "${pr_number}" 2>/dev/null
  return $?
}

cleanup_watchdog() {
  local pid="${1:-}"
  local child_pids=""

  if [ -z "${pid}" ]; then
    return 0
  fi

  child_pids=$(pgrep -P "${pid}" 2>/dev/null || true)
  if [ -n "${child_pids}" ]; then
    kill ${child_pids} 2>/dev/null || true
  fi

  kill "${pid}" 2>/dev/null || true
  wait "${pid}" 2>/dev/null || true
}

log() {
  echo "[$(date '+%Y-%m-%dT%H:%M:%S')] $*" | tee -a "${LOG_FILE}"
}

rotate_log() {
  if [ -f "${LOG_FILE}" ] && [ "$(stat -c%s "${LOG_FILE}" 2>/dev/null || echo 0)" -ge "${MAX_LOG_SIZE}" ]; then
    mv "${LOG_FILE}" "${LOG_FILE}.bak" 2>/dev/null || true
  fi
}

# ── Log rotation ──────────────────────────────────────────────────────────────
rotate_log
# ─────────────────────────────────────────────────────────────────────────────

cd "${PROJECT_DIR}"

log "========================================"
log "RUN-START: merger invoked project=${PROJECT_DIR} dry_run=${DRY_RUN}"
log "CONFIG: merge_method=${MERGE_METHOD} min_review_score=${MIN_REVIEW_SCORE} rebase_before_merge=${REBASE_BEFORE_MERGE} max_prs=${MAX_PRS_PER_RUN} max_runtime=${MAX_RUNTIME}s ci_policy=${CI_POLICY} local_check_command=${LOCAL_CHECK_COMMAND} ready_label=${READY_TO_MERGE_LABEL} branch_patterns=${BRANCH_PATTERNS_RAW:-<all>}"
log "========================================"

if ! acquire_lock "${LOCK_FILE}"; then
  emit_result "skip_locked"
  exit 0
fi

# ── Dry-run mode ────────────────────────────────────────────────────────────
if [ "${DRY_RUN}" = "1" ]; then
  echo "=== Dry Run: Merge Orchestrator ==="
  echo "Merge Method: ${MERGE_METHOD}"
  echo "Min Review Score: ${MIN_REVIEW_SCORE}/100"
  echo "Rebase Before Merge: ${REBASE_BEFORE_MERGE}"
  echo "Max PRs Per Run: ${MAX_PRS_PER_RUN} (0=unlimited)"
  echo "Max Runtime: ${MAX_RUNTIME}s"
  echo "Branch Patterns: ${BRANCH_PATTERNS_RAW:-<all>}"
  log "INFO: Dry run mode — exiting without processing"
  emit_result "skip_dry_run"
  exit 0
fi

# Timeout watchdog
(
  sleep "${MAX_RUNTIME}"
  log "TIMEOUT: Merger exceeded ${MAX_RUNTIME}s, terminating"
  kill -TERM $$ 2>/dev/null || true
) &
WATCHDOG_PID=$!
append_exit_trap "cleanup_watchdog ${WATCHDOG_PID}"

# Discover open PRs sorted by creation date (oldest first = FIFO)
log "INFO: Scanning open PRs..."
PR_LIST_JSON=$(gh pr list --state open \
  --json number,headRefName,createdAt,isDraft,labels \
  --jq 'sort_by(.createdAt)' \
  2>/dev/null || echo "[]")

PR_COUNT=$(echo "${PR_LIST_JSON}" | jq 'length')
log "INFO: Found ${PR_COUNT} open PRs"

if [ "${PR_COUNT}" = "0" ]; then
  log "SKIP: No open PRs found. Exiting."
  emit_result "skip_no_prs"
  exit 0
fi

# Process each PR in FIFO order
PROCESSED=0
while IFS= read -r pr_json; do
  pr_number=$(echo "${pr_json}" | jq -r '.number')
  pr_branch=$(echo "${pr_json}" | jq -r '.headRefName')
  is_draft=$(echo "${pr_json}" | jq -r '.isDraft')
  pr_labels=$(echo "${pr_json}" | jq -r '[.labels[]?.name] | join(",")')

  # Skip drafts
  if [ "${is_draft}" = "true" ]; then
    log "INFO: PR #${pr_number} (${pr_branch}): Skipping draft"
    continue
  fi

  if csv_has_label "${pr_labels:-}" "${NW_EXECUTOR_PARTIAL_LABEL}"; then
    log "INFO: PR #${pr_number} (${pr_branch}): Skipping partial executor PR"
    continue
  fi

  if csv_has_label "${pr_labels:-}" "${READY_TO_MERGE_LABEL}"; then
    log "INFO: PR #${pr_number} (${pr_branch}): Skipping PR labeled ${READY_TO_MERGE_LABEL}"
    continue
  fi

  # Check branch pattern filter
  if ! matches_branch_patterns "${pr_branch}"; then
    log "DEBUG: PR #${pr_number} (${pr_branch}): Branch pattern mismatch, skipping"
    continue
  fi

  pr_head_oid=$(get_pr_head_oid "${pr_number}")
  if [ -z "${pr_head_oid}" ]; then
    log "INFO: PR #${pr_number} (${pr_branch}): Unable to determine PR head, skipping"
    continue
  fi

  # Check CI status, optionally falling back to local checks for provider/billing failures.
  if ! ci_gate_allows_head "${pr_number}" "${pr_branch}" "${pr_head_oid}" "CI"; then
    continue
  fi

  # Check review score
  if [ "${MIN_REVIEW_SCORE}" -gt "0" ]; then
    score=$(get_review_score "${pr_number}")
    if [ "${score}" -lt "0" ] || [ "${score}" -lt "${MIN_REVIEW_SCORE}" ]; then
      log "INFO: PR #${pr_number} (${pr_branch}): Review score ${score} < ${MIN_REVIEW_SCORE} (or no score found), reviewer job required before merge"
      continue
    fi
  fi

  pending_review_feedback_count=$(get_pending_review_feedback_count "${pr_number}")
  if [ "${pending_review_feedback_count}" -gt "0" ]; then
    log "INFO: PR #${pr_number} (${pr_branch}): ${pending_review_feedback_count} pending review feedback item(s), reviewer job required before merge"
    continue
  fi

  log "INFO: PR #${pr_number} (${pr_branch}): Eligible for merge"

  # Rebase before merge if configured
  if [ "${REBASE_BEFORE_MERGE}" = "1" ]; then
    pr_head_before_rebase="${pr_head_oid}"
    if ! rebase_pr "${pr_number}"; then
      log "WARN: PR #${pr_number}: Rebase failed, skipping"
      FAILED_PRS=$((FAILED_PRS + 1))
      continue
    fi
    log "INFO: PR #${pr_number}: Rebase successful"

    pr_head_after_rebase=$(get_pr_head_oid "${pr_number}")
    if [ -z "${pr_head_after_rebase}" ]; then
      log "INFO: PR #${pr_number}: Unable to determine PR head after rebase, skipping"
      continue
    fi
    if [ "${pr_head_after_rebase}" != "${pr_head_before_rebase}" ]; then
      log "INFO: PR #${pr_number}: Head changed after rebase ${pr_head_before_rebase} -> ${pr_head_after_rebase}; waiting for fresh CI"
    else
      log "INFO: PR #${pr_number}: Head unchanged after rebase (${pr_head_after_rebase}); confirming CI"
    fi

    if [ "${CI_POLICY}" = "ignore" ]; then
      log "INFO: PR #${pr_number}: CI policy is ignore; skipping fresh CI gate after rebase"
    else
      # Poll CI until all checks attached to the post-rebase head are complete and passing.
      if ! wait_for_ci_passing_on_head "${pr_number}" "${pr_head_after_rebase}"; then
        log "INFO: PR #${pr_number}: Fresh CI not passing on head ${pr_head_after_rebase} after rebase (${LAST_CI_STATUS}, waited ${CI_MAX_WAIT}s)"
        if [ "${CI_POLICY}" = "fallback-local" ]; then
          if ! run_local_checks_for_head "${pr_number}" "${pr_branch}" "${pr_head_after_rebase}"; then
            log "INFO: PR #${pr_number}: Fresh local check fallback failed after rebase, skipping"
            continue
          fi
        else
          log "INFO: PR #${pr_number}: Skipping because CI policy requires GitHub CI"
          continue
        fi
      fi
    fi
  fi

  # Merge the PR
  log "INFO: Merging PR #${pr_number} with method: ${MERGE_METHOD}..."
  if gh pr merge "${pr_number}" "--${MERGE_METHOD}" --delete-branch 2>&1 | tee -a "${LOG_FILE}"; then
    log "INFO: PR #${pr_number}: Merged successfully"
    MERGED_PRS=$((MERGED_PRS + 1))
    MERGED_PR_LIST="${MERGED_PR_LIST}${pr_number},"

    # Rebase remaining PRs after each successful merge
    log "INFO: Rebasing remaining open PRs after merging #${pr_number}..."
    REMAINING_JSON=$(gh pr list --state open \
      --json number,headRefName,labels \
      2>/dev/null || echo "[]")
    while IFS= read -r remaining_pr; do
      remaining_number=$(echo "${remaining_pr}" | jq -r '.number')
      remaining_branch=$(echo "${remaining_pr}" | jq -r '.headRefName')
      remaining_labels=$(echo "${remaining_pr}" | jq -r '[.labels[]?.name] | join(",")')
      if [ "${remaining_number}" != "${pr_number}" ]; then
        if csv_has_label "${remaining_labels:-}" "${READY_TO_MERGE_LABEL}"; then
          log "INFO: Skipping post-merge rebase for PR #${remaining_number} (${remaining_branch}) because it is labeled ${READY_TO_MERGE_LABEL}"
          continue
        fi
        log "INFO: Rebasing remaining PR #${remaining_number} (${remaining_branch})"
        gh pr update-branch --rebase "${remaining_number}" 2>/dev/null || \
          log "WARN: PR #${remaining_number}: Rebase failed (continuing)"
      fi
    done < <(echo "${REMAINING_JSON}" | jq -c '.[]')
  else
    log "WARN: PR #${pr_number}: Merge failed"
    FAILED_PRS=$((FAILED_PRS + 1))
  fi

  PROCESSED=$((PROCESSED + 1))

  # Check max PRs per run limit
  if [ "${MAX_PRS_PER_RUN}" -gt "0" ] && [ "${PROCESSED}" -ge "${MAX_PRS_PER_RUN}" ]; then
    log "INFO: Reached max PRs per run limit (${MAX_PRS_PER_RUN}). Stopping."
    break
  fi

  # Enforce global timeout
  elapsed=$(( $(date +%s) - SCRIPT_START_TIME ))
  if [ "${elapsed}" -ge "${MAX_RUNTIME}" ]; then
    log "WARN: Global timeout reached (${MAX_RUNTIME}s), stopping early"
    break
  fi
done < <(echo "${PR_LIST_JSON}" | jq -c '.[]')

# Trim trailing comma from PR list
MERGED_PR_LIST="${MERGED_PR_LIST%,}"

log "========================================"
log "RUN-END: merger complete merged=${MERGED_PRS} failed=${FAILED_PRS}"
log "========================================"

emit_result "success" "merged=${MERGED_PRS}|failed=${FAILED_PRS}|prs=${MERGED_PR_LIST}"
exit 0
