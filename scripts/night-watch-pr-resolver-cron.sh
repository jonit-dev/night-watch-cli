#!/usr/bin/env bash
set -euo pipefail

# Night Watch PR Resolver Cron Runner (project-agnostic)
# Usage: night-watch-pr-resolver-cron.sh /path/to/project
#
# NOTE: This script expects environment variables to be set by the caller.
# The Node.js CLI will inject config values via environment variables.
# Required env vars (with defaults shown):
#   NW_PR_RESOLVER_MAX_RUNTIME=3600          - Maximum runtime in seconds (1 hour)
#   NW_PROVIDER_CMD=claude                   - AI provider CLI to use (claude, codex, etc.)
#   NW_DRY_RUN=0                             - Set to 1 for dry-run mode (prints diagnostics only)
#   NW_PR_RESOLVER_MAX_PRS_PER_RUN=0         - Max PRs to process per run (0 = unlimited)
#   NW_PR_RESOLVER_PER_PR_TIMEOUT=600        - Per-PR AI timeout in seconds
#   NW_PR_RESOLVER_AI_CONFLICT_RESOLUTION=1  - Set to 1 to use AI for conflict resolution
#   NW_PR_RESOLVER_AI_REVIEW_RESOLUTION=0    - Set to 1 to also address review comments
#   NW_PR_RESOLVER_READY_LABEL=ready-to-merge - Label to add when PR is conflict-free
#   NW_PR_RESOLVER_BRANCH_PATTERNS=          - Comma-separated branch prefixes to filter (empty = all)

PROJECT_DIR="${1:?Usage: $0 /path/to/project}"
PROJECT_NAME=$(basename "${PROJECT_DIR}")
LOG_DIR="${PROJECT_DIR}/logs"
LOG_FILE="${LOG_DIR}/pr-resolver.log"
MAX_RUNTIME="${NW_PR_RESOLVER_MAX_RUNTIME:-3600}"  # 1 hour
MAX_LOG_SIZE="524288"  # 512 KB
PROVIDER_CMD="${NW_PROVIDER_CMD:-claude}"
PROVIDER_LABEL="${NW_PROVIDER_LABEL:-}"
MAX_PRS_PER_RUN="${NW_PR_RESOLVER_MAX_PRS_PER_RUN:-0}"
PER_PR_TIMEOUT="${NW_PR_RESOLVER_PER_PR_TIMEOUT:-600}"
AI_CONFLICT_RESOLUTION="${NW_PR_RESOLVER_AI_CONFLICT_RESOLUTION:-1}"
AI_REVIEW_RESOLUTION="${NW_PR_RESOLVER_AI_REVIEW_RESOLUTION:-0}"
READY_LABEL="${NW_PR_RESOLVER_READY_LABEL:-ready-to-merge}"
BRANCH_PATTERNS_RAW="${NW_PR_RESOLVER_BRANCH_PATTERNS:-}"
SCRIPT_START_TIME=$(date +%s)

# Normalize numeric settings to safe ranges
if ! [[ "${MAX_PRS_PER_RUN}" =~ ^[0-9]+$ ]]; then
  MAX_PRS_PER_RUN="0"
fi
if ! [[ "${PER_PR_TIMEOUT}" =~ ^[0-9]+$ ]]; then
  PER_PR_TIMEOUT="600"
fi
if [ "${MAX_PRS_PER_RUN}" -gt 100 ]; then
  MAX_PRS_PER_RUN="100"
fi
if [ "${PER_PR_TIMEOUT}" -gt 3600 ]; then
  PER_PR_TIMEOUT="3600"
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
# NOTE: Lock file path must match resolverLockPath() in src/utils/status-data.ts
LOCK_FILE="/tmp/night-watch-pr-resolver-${PROJECT_RUNTIME_KEY}.lock"
SCRIPT_TYPE="pr-resolver"

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

# PR discovery: returns JSON array of open PRs with required fields
discover_open_prs() {
  gh pr list --state open \
    --json number,title,headRefName,mergeable,isDraft,labels \
    2>/dev/null || echo "[]"
}

# Check if a branch matches any configured branch prefix patterns.
# Returns 0 (match/pass) or 1 (no match, skip PR).
matches_branch_patterns() {
  local branch="${1}"
  if [ -z "${BRANCH_PATTERNS_RAW}" ]; then
    return 0  # No filter configured = match all
  fi
  IFS=',' read -ra patterns <<< "${BRANCH_PATTERNS_RAW}"
  for pattern in "${patterns[@]}"; do
    pattern="${pattern# }"  # trim leading space
    if [[ "${branch}" == ${pattern}* ]]; then
      return 0
    fi
  done
  return 1
}

# Process a single PR: resolve conflicts and/or review comments, then label.
# Echoes "ready" if the PR ends up conflict-free, "conflicted" otherwise.
# Returns 0 on success, 1 on unrecoverable failure.
process_pr() {
  local pr_number="${1:?pr_number required}"
  local pr_branch="${2:?pr_branch required}"
  local pr_title="${3:-}"
  local worktree_dir="/tmp/nw-resolver-pr${pr_number}-$$"

  log "INFO: Processing PR #${pr_number}: ${pr_title}" "branch=${pr_branch}"

  # Inner cleanup for worktree created during this PR's processing
  cleanup_pr_worktree() {
    if git -C "${PROJECT_DIR}" worktree list --porcelain 2>/dev/null \
        | grep -qF "worktree ${worktree_dir}"; then
      git -C "${PROJECT_DIR}" worktree remove --force "${worktree_dir}" 2>/dev/null || true
    fi
    rm -rf "${worktree_dir}" 2>/dev/null || true
  }

  # ── Determine default branch ─────────────────────────────────────────────
  local default_branch
  default_branch="${NW_DEFAULT_BRANCH:-}"
  if [ -z "${default_branch}" ]; then
    default_branch=$(detect_default_branch "${PROJECT_DIR}")
  fi

  # ── Check current mergeable status ──────────────────────────────────────
  local mergeable
  mergeable=$(gh pr view "${pr_number}" --json mergeable --jq '.mergeable' 2>/dev/null || echo "UNKNOWN")

  if [ "${mergeable}" = "CONFLICTING" ]; then
    log "INFO: PR #${pr_number} has conflicts, attempting resolution" "branch=${pr_branch}"

    # Fetch the PR branch so we have an up-to-date ref
    git -C "${PROJECT_DIR}" fetch --quiet origin "${pr_branch}" 2>/dev/null || true

    # Create an isolated worktree on the PR branch
    if ! prepare_branch_worktree "${PROJECT_DIR}" "${worktree_dir}" "${pr_branch}" "${default_branch}" "${LOG_FILE}"; then
      log "WARN: Failed to create worktree for PR #${pr_number}" "branch=${pr_branch}"
      cleanup_pr_worktree
      return 1
    fi

    local rebase_success=0

    # Attempt a clean rebase first (no AI needed if it auto-resolves)
    if git -C "${worktree_dir}" rebase "origin/${default_branch}" --quiet 2>/dev/null; then
      rebase_success=1
      log "INFO: PR #${pr_number} rebased cleanly (no conflicts)" "branch=${pr_branch}"
    else
      # Clean up the failed rebase state
      git -C "${worktree_dir}" rebase --abort 2>/dev/null || true

      if [ "${AI_CONFLICT_RESOLUTION}" = "1" ]; then
        log "INFO: Invoking AI to resolve conflicts for PR #${pr_number}" "branch=${pr_branch}"

        local ai_prompt
        local force_push_cmd
        force_push_cmd=$(project_git_push_command "${pr_branch}" "force-with-lease")
        ai_prompt="You are working in a git repository at ${worktree_dir}. \
Branch '${pr_branch}' has merge conflicts with '${default_branch}'. \
Please resolve the merge conflicts by: \
1) Running: git rebase origin/${default_branch} \
2) Resolving any conflict markers in the affected files \
3) Staging resolved files with: git add <files> \
4) Continuing the rebase with: git rebase --continue \
5) Finally pushing with: ${force_push_cmd} \
Work exclusively in the directory: ${worktree_dir}"

        local -a cmd_parts
        mapfile -d '' -t cmd_parts < <(build_provider_cmd "${worktree_dir}" "${ai_prompt}")

        if timeout "${PER_PR_TIMEOUT}" "${cmd_parts[@]}" >> "${LOG_FILE}" 2>&1; then
          rebase_success=1
          log "INFO: AI resolved conflicts for PR #${pr_number}" "branch=${pr_branch}"
        else
          log "WARN: AI failed to resolve conflicts for PR #${pr_number}" "branch=${pr_branch}"
          cleanup_pr_worktree
          return 1
        fi
      else
        log "WARN: Skipping PR #${pr_number} — conflicts exist and AI resolution is disabled" "branch=${pr_branch}"
        cleanup_pr_worktree
        return 1
      fi
    fi

    if [ "${rebase_success}" = "1" ]; then
      # Safety: never force-push to the default branch
      if [ "${pr_branch}" = "${default_branch}" ]; then
        log "WARN: Refusing to force-push to default branch ${default_branch} for PR #${pr_number}"
        cleanup_pr_worktree
        return 1
      fi
      # Push the rebased branch (AI may have already pushed; --force-with-lease is idempotent)
      git_push_for_project "${worktree_dir}" --force-with-lease origin "${pr_branch}" >> "${LOG_FILE}" 2>&1 || {
        log "WARN: Push after rebase failed for PR #${pr_number}" "branch=${pr_branch}"
      }
    fi
  fi

  # ── Secondary: AI review comment resolution (opt-in) ────────────────────
  if [ "${AI_REVIEW_RESOLUTION}" = "1" ]; then
    local unresolved_count
    unresolved_count=$(gh api "repos/{owner}/{repo}/pulls/${pr_number}/reviews" \
      --jq '[.[] | select(.state == "CHANGES_REQUESTED")] | length' 2>/dev/null || echo "0")

    if [ "${unresolved_count}" -gt "0" ]; then
      log "INFO: PR #${pr_number} has ${unresolved_count} change request(s), invoking AI" "branch=${pr_branch}"

      local review_workdir="${worktree_dir}"
      if [ ! -d "${review_workdir}" ]; then
        review_workdir="${PROJECT_DIR}"
      fi

      local review_prompt
      local review_push_cmd
      review_push_cmd=$(project_git_push_command "${pr_branch}")
      review_prompt="You are working in the git repository at ${review_workdir}. \
PR #${pr_number} on branch '${pr_branch}' has unresolved review comments requesting changes. \
Please: \
1) Run 'gh pr view ${pr_number} --comments' to read the review comments \
2) Implement the requested changes \
3) Commit the changes with a descriptive message \
4) Push with: ${review_push_cmd} \
Work in the directory: ${review_workdir}"

      local -a review_cmd_parts
      mapfile -d '' -t review_cmd_parts < <(build_provider_cmd "${review_workdir}" "${review_prompt}")

      if timeout "${PER_PR_TIMEOUT}" "${review_cmd_parts[@]}" >> "${LOG_FILE}" 2>&1; then
        log "INFO: AI addressed review comments for PR #${pr_number}" "branch=${pr_branch}"
      else
        log "WARN: AI failed to address review comments for PR #${pr_number}" "branch=${pr_branch}"
      fi
    fi
  fi

  # ── Re-check mergeable status after processing ──────────────────────────
  # Brief wait for GitHub to propagate the push and recompute mergeability
  sleep 3
  local final_mergeable
  final_mergeable=$(gh pr view "${pr_number}" --json mergeable --jq '.mergeable' 2>/dev/null || echo "UNKNOWN")

  # ── Labeling ─────────────────────────────────────────────────────────────
  local result
  if [ "${final_mergeable}" != "CONFLICTING" ]; then
    # Ensure the ready label exists in the repo (idempotent)
    gh label create "${READY_LABEL}" \
      --color "0075ca" \
      --description "PR is conflict-free and ready to merge" \
      2>/dev/null || true
    gh pr edit "${pr_number}" --add-label "${READY_LABEL}" 2>/dev/null || true
    log "INFO: PR #${pr_number} marked as '${READY_LABEL}'" "branch=${pr_branch}"
    result="ready"
  else
    gh pr edit "${pr_number}" --remove-label "${READY_LABEL}" 2>/dev/null || true
    log "WARN: PR #${pr_number} still has conflicts after processing" "branch=${pr_branch}"
    result="conflicted"
  fi

  cleanup_pr_worktree
  echo "${result}"
}

# ── Validate provider ────────────────────────────────────────────────────────
if ! validate_provider "${PROVIDER_CMD}"; then
  echo "ERROR: Unknown provider: ${PROVIDER_CMD}" >&2
  exit 1
fi

rotate_log
log_separator
log "RUN-START: pr-resolver invoked project=${PROJECT_DIR} provider=${PROVIDER_CMD} dry_run=${NW_DRY_RUN:-0}"
log "CONFIG: max_runtime=${MAX_RUNTIME}s max_prs=${MAX_PRS_PER_RUN} per_pr_timeout=${PER_PR_TIMEOUT}s ai_conflict=${AI_CONFLICT_RESOLUTION} ai_review=${AI_REVIEW_RESOLUTION} ready_label=${READY_LABEL} branch_patterns=${BRANCH_PATTERNS_RAW:-<all>}"

if ! acquire_lock "${LOCK_FILE}"; then
  emit_result "skip_locked"
  exit 0
fi

cd "${PROJECT_DIR}"

# ── Dry-run mode ────────────────────────────────────────────────────────────
if [ "${NW_DRY_RUN:-0}" = "1" ]; then
  echo "=== Dry Run: PR Resolver ==="
  echo "Provider (model): ${PROVIDER_MODEL_DISPLAY}"
  echo "Branch Patterns: ${BRANCH_PATTERNS_RAW:-<all>}"
  echo "Max PRs Per Run: ${MAX_PRS_PER_RUN}"
  echo "Per-PR Timeout: ${PER_PR_TIMEOUT}s"
  echo "AI Conflict Resolution: ${AI_CONFLICT_RESOLUTION}"
  echo "AI Review Resolution: ${AI_REVIEW_RESOLUTION}"
  echo "Ready Label: ${READY_LABEL}"
  echo "Max Runtime: ${MAX_RUNTIME}s"
  log "INFO: Dry run mode — exiting without processing"
  emit_result "skip_dry_run"
  exit 0
fi

send_telegram_status_message "Night Watch PR Resolver: started" "Project: ${PROJECT_NAME}
Provider (model): ${PROVIDER_MODEL_DISPLAY}
Branch patterns: ${BRANCH_PATTERNS_RAW:-all}
Action: scanning open PRs for merge conflicts."

# ── Discover open PRs ────────────────────────────────────────────────────────
pr_json=$(discover_open_prs)

if [ -z "${pr_json}" ] || [ "${pr_json}" = "[]" ]; then
  log "SKIP: No open PRs found"
  send_telegram_status_message "Night Watch PR Resolver: nothing to do" "Project: ${PROJECT_NAME}
Provider (model): ${PROVIDER_MODEL_DISPLAY}
Result: no open PRs found."
  emit_result "skip_no_open_prs"
  exit 0
fi

pr_count=$(printf '%s' "${pr_json}" | jq 'length' 2>/dev/null || echo "0")
log "INFO: Found ${pr_count} open PR(s) to evaluate"

# ── Main processing loop ─────────────────────────────────────────────────────
processed=0
conflicts_resolved=0
reviews_addressed=0
prs_ready=0
prs_failed=0

while IFS= read -r pr_line; do
  [ -z "${pr_line}" ] && continue

  pr_number=$(printf '%s' "${pr_line}" | jq -r '.number')
  pr_branch=$(printf '%s' "${pr_line}" | jq -r '.headRefName')
  pr_title=$(printf '%s' "${pr_line}" | jq -r '.title')
  is_draft=$(printf '%s' "${pr_line}" | jq -r '.isDraft')
  labels=$(printf '%s' "${pr_line}" | jq -r '[.labels[].name] | join(",")')

  [ -z "${pr_number}" ] || [ -z "${pr_branch}" ] && continue

  # Skip draft PRs
  if [ "${is_draft}" = "true" ]; then
    log "INFO: Skipping draft PR #${pr_number}" "branch=${pr_branch}"
    continue
  fi

  # Skip PRs labelled skip-resolver
  if [[ "${labels}" == *"skip-resolver"* ]]; then
    log "INFO: Skipping PR #${pr_number} (skip-resolver label)" "branch=${pr_branch}"
    continue
  fi

  # Apply branch pattern filter
  if ! matches_branch_patterns "${pr_branch}"; then
    log "DEBUG: Skipping PR #${pr_number} — branch '${pr_branch}' does not match patterns" "patterns=${BRANCH_PATTERNS_RAW}"
    continue
  fi

  # Enforce max PRs per run
  if [ "${MAX_PRS_PER_RUN}" -gt "0" ] && [ "${processed}" -ge "${MAX_PRS_PER_RUN}" ]; then
    log "INFO: Reached max PRs per run (${MAX_PRS_PER_RUN}), stopping"
    break
  fi

  # Enforce global timeout
  elapsed=$(( $(date +%s) - SCRIPT_START_TIME ))
  if [ "${elapsed}" -ge "${MAX_RUNTIME}" ]; then
    log "WARN: Global timeout reached (${MAX_RUNTIME}s), stopping early"
    break
  fi

  processed=$(( processed + 1 ))

  result=""
  if result=$(process_pr "${pr_number}" "${pr_branch}" "${pr_title}" 2>&1); then
    # process_pr echoes "ready" or "conflicted" on the last line; extract it
    last_line=$(printf '%s' "${result}" | tail -1)
    if [ "${last_line}" = "ready" ]; then
      prs_ready=$(( prs_ready + 1 ))
      conflicts_resolved=$(( conflicts_resolved + 1 ))
    fi
  else
    prs_failed=$(( prs_failed + 1 ))
  fi

done < <(printf '%s' "${pr_json}" | jq -c '.[]')

log "RUN-END: pr-resolver complete processed=${processed} conflicts_resolved=${conflicts_resolved} prs_ready=${prs_ready} prs_failed=${prs_failed}"

send_telegram_status_message "Night Watch PR Resolver: completed" "Project: ${PROJECT_NAME}
Provider (model): ${PROVIDER_MODEL_DISPLAY}
PRs processed: ${processed}
Conflicts resolved: ${conflicts_resolved}
PRs marked '${READY_LABEL}': ${prs_ready}
PRs failed: ${prs_failed}"

emit_result "success" "prs_processed=${processed}|conflicts_resolved=${conflicts_resolved}|reviews_addressed=${reviews_addressed}|prs_ready=${prs_ready}|prs_failed=${prs_failed}"
