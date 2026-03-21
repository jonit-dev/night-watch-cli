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
#   NW_QA_ARTIFACTS=both              - Artifact mode (screenshot, video, both)
#   NW_QA_AUTO_INSTALL_PLAYWRIGHT=1   - Auto-install Playwright browsers
#   NW_DRY_RUN=0                      - Set to 1 for dry-run mode (prints diagnostics only)

PROJECT_DIR="${1:?Usage: $0 /path/to/project}"
PROJECT_NAME=$(basename "${PROJECT_DIR}")
LOG_DIR="${PROJECT_DIR}/logs"
LOG_FILE="${LOG_DIR}/night-watch-qa.log"
MAX_RUNTIME="${NW_QA_MAX_RUNTIME:-3600}"  # 1 hour
MAX_LOG_SIZE="524288"  # 512 KB
PROVIDER_CMD="${NW_PROVIDER_CMD:-claude}"
PROVIDER_LABEL="${NW_PROVIDER_LABEL:-}"
BRANCH_PATTERNS_RAW="${NW_BRANCH_PATTERNS:-feat/,night-watch/}"
SKIP_LABEL="${NW_QA_SKIP_LABEL:-skip-qa}"
QA_ARTIFACTS="${NW_QA_ARTIFACTS:-both}"
QA_AUTO_INSTALL_PLAYWRIGHT="${NW_QA_AUTO_INSTALL_PLAYWRIGHT:-1}"
SCRIPT_START_TIME=$(date +%s)

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
# NOTE: Lock file path must match qaLockPath() in src/utils/status-data.ts
LOCK_FILE="/tmp/night-watch-qa-${PROJECT_RUNTIME_KEY}.lock"
SCRIPT_TYPE="qa"

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

decode_base64_value() {
  local value="${1:-}"
  if [ -z "${value}" ]; then
    return 0
  fi
  if printf '%s' "${value}" | base64 --decode >/dev/null 2>&1; then
    printf '%s' "${value}" | base64 --decode
  else
    printf '%s' "${value}" | base64 -d 2>/dev/null || true
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

csv_or_none() {
  local value="${1:-}"
  if [ -n "${value}" ]; then
    printf "%s" "${value}"
  else
    printf "none"
  fi
}

describe_qa_artifacts() {
  local mode="${1:-both}"
  case "${mode}" in
    screenshot)
      printf "screenshots only"
      ;;
    video)
      printf "videos only"
      ;;
    both)
      printf "screenshots + videos"
      ;;
    *)
      printf "custom (%s)" "${mode}"
      ;;
  esac
}

normalize_qa_screenshot_url() {
  local raw_url="${1:-}"
  if [ -z "${raw_url}" ]; then
    return 0
  fi

  if printf '%s' "${raw_url}" | grep -Eq '^https?://'; then
    printf '%s' "${raw_url}"
    return 0
  fi

  if [ -n "${REPO:-}" ] && printf '%s' "${raw_url}" | grep -q '^\.\./blob/'; then
    printf 'https://github.com/%s/%s' "${REPO}" "${raw_url#../}"
    return 0
  fi

  if [ -n "${REPO:-}" ] && printf '%s' "${raw_url}" | grep -q '^blob/'; then
    printf 'https://github.com/%s/%s' "${REPO}" "${raw_url}"
    return 0
  fi

  printf '%s' "${raw_url}"
}

extract_url_host() {
  local raw_url="${1:-}"
  if [ -z "${raw_url}" ]; then
    return 0
  fi
  printf '%s' "${raw_url}" | sed -E 's#^[[:alpha:]][[:alnum:]+.-]*://##; s#/.*$##'
}

resolve_claude_model_hint() {
  local sonnet="${ANTHROPIC_DEFAULT_SONNET_MODEL:-}"
  local opus="${ANTHROPIC_DEFAULT_OPUS_MODEL:-}"
  local native_model="${NW_CLAUDE_MODEL_ID:-}"

  if [ -n "${sonnet}" ] && [ -n "${opus}" ]; then
    if [ "${sonnet}" = "${opus}" ]; then
      printf "%s" "${sonnet}"
    else
      printf "sonnet=%s, opus=%s" "${sonnet}" "${opus}"
    fi
    return 0
  fi
  if [ -n "${sonnet}" ]; then
    printf "%s" "${sonnet}"
    return 0
  fi
  if [ -n "${opus}" ]; then
    printf "%s" "${opus}"
    return 0
  fi
  if [ -n "${native_model}" ]; then
    printf "%s" "${native_model}"
    return 0
  fi
  printf "default"
}

resolve_provider_model_display() {
  local provider_cmd="${1:?provider command required}"
  local provider_label="${2:-}"
  local label_trimmed=""
  local model_hint=""
  local endpoint_host=""
  local details=""

  label_trimmed=$(printf '%s' "${provider_label}" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')

  case "${provider_cmd}" in
    claude)
      model_hint=$(resolve_claude_model_hint)
      endpoint_host=$(extract_url_host "${ANTHROPIC_BASE_URL:-}")
      details="${model_hint}"
      if [ -n "${endpoint_host}" ]; then
        details="${details} via ${endpoint_host}"
      fi
      if [ -n "${label_trimmed}" ] && [ "${label_trimmed}" != "Claude" ] && [ "${label_trimmed}" != "Claude (proxy)" ]; then
        details="${label_trimmed}; ${details}"
      fi
      printf "%s (%s)" "${provider_cmd}" "${details}"
      ;;
    codex)
      if [ -n "${label_trimmed}" ] && [ "${label_trimmed}" != "Codex" ]; then
        printf "%s (%s)" "${provider_cmd}" "${label_trimmed}"
      else
        printf "%s" "${provider_cmd}"
      fi
      ;;
    *)
      if [ -n "${label_trimmed}" ]; then
        printf "%s (%s)" "${provider_cmd}" "${label_trimmed}"
      else
        printf "%s" "${provider_cmd}"
      fi
      ;;
  esac
}

get_pr_comment_bodies_base64() {
  local pr_number="${1:?PR number required}"
  gh pr view "${pr_number}" --json comments --jq '.comments[]?.body | @base64' 2>/dev/null || true
  if [ -n "${REPO:-}" ]; then
    gh api "repos/${REPO}/issues/${pr_number}/comments" --jq '.[].body | @base64' 2>/dev/null || true
  fi
}

get_latest_qa_comment_body() {
  local pr_number="${1:?PR number required}"
  local latest=""
  local encoded=""
  local decoded=""

  while IFS= read -r encoded; do
    [ -z "${encoded}" ] && continue
    decoded=$(decode_base64_value "${encoded}")
    if printf '%s' "${decoded}" | grep -q '<!-- night-watch-qa-marker -->'; then
      latest="${decoded}"
    fi
  done < <(get_pr_comment_bodies_base64 "${pr_number}")

  printf "%s" "${latest}"
}

get_qa_screenshot_links() {
  local pr_number="${1:?PR number required}"
  local qa_comment=""

  qa_comment=$(get_latest_qa_comment_body "${pr_number}")
  if [ -z "${qa_comment}" ]; then
    return 0
  fi

  printf '%s' "${qa_comment}" \
    | { grep -Eo '!\[[^]]*\]\(([^)]*qa-artifacts/[^)]*)\)' || true; } \
    | sed -E 's/^!\[[^]]*\]\(([^)]*)\)$/\1/' \
    | while IFS= read -r raw_url; do
      [ -z "${raw_url}" ] && continue
      normalize_qa_screenshot_url "${raw_url}"
      printf '\n'
    done \
    | awk 'NF && !seen[$0]++'
}

classify_qa_comment_outcome() {
  local pr_number="${1:?PR number required}"
  local qa_comment=""
  local status_lines=""

  qa_comment=$(get_latest_qa_comment_body "${pr_number}")
  if [ -z "${qa_comment}" ]; then
    printf "unclassified"
    return 0
  fi

  if printf '%s' "${qa_comment}" | grep -Eqi 'QA: No tests needed for this PR|No tests needed'; then
    printf "no_tests_needed"
    return 0
  fi

  status_lines=$(printf '%s' "${qa_comment}" | grep -E '^- \*\*Status\*\*:' || true)
  if [ -z "${status_lines}" ]; then
    printf "unclassified"
    return 0
  fi

  if printf '%s' "${status_lines}" | grep -Eqi 'failing|failed|error|timed out|timeout'; then
    printf "issues_found"
    return 0
  fi

  if printf '%s' "${status_lines}" | grep -Eqi 'all passing'; then
    printf "passing"
    return 0
  fi

  printf "unclassified"
}

pr_has_qa_generated_files() {
  local pr_number="${1:?PR number required}"
  gh pr view "${pr_number}" --json files --jq '.files[]?.path' 2>/dev/null \
    | grep -Eq '^(qa-artifacts/|tests/.*/qa/)'
}

provider_output_looks_invalid() {
  local from_line="${1:-0}"
  if [ ! -f "${LOG_FILE}" ]; then
    return 1
  fi

  tail -n "+$((from_line + 1))" "${LOG_FILE}" 2>/dev/null \
    | grep -Eqi 'Unknown skill:|session is in a broken state|working directory .* no longer exists|Please restart this session'
}

validate_qa_evidence() {
  local pr_number="${1:?PR number required}"
  local qa_comment=""

  qa_comment=$(get_latest_qa_comment_body "${pr_number}")
  if [ -z "${qa_comment}" ]; then
    log "FAIL-QA-EVIDENCE: PR #${pr_number} has no QA marker comment (<!-- night-watch-qa-marker -->)"
    return 1
  fi

  if printf '%s' "${qa_comment}" | grep -Eqi 'QA: No tests needed for this PR|No tests needed'; then
    return 0
  fi

  if ! pr_has_qa_generated_files "${pr_number}"; then
    log "WARN-QA-EVIDENCE: PR #${pr_number} has QA marker comment but no qa-artifacts/ or tests/*/qa/ files"
    return 2
  fi

  if [ "${QA_ARTIFACTS}" = "screenshot" ] || [ "${QA_ARTIFACTS}" = "both" ]; then
    if printf '%s' "${qa_comment}" | grep -q '#### UI Tests (Playwright)'; then
      if ! printf '%s' "${qa_comment}" | grep -Eq '!\[[^]]*\]\([^)]*qa-artifacts/[^)]*\)'; then
        log "FAIL-QA-EVIDENCE: PR #${pr_number} reports UI tests but comment lacks screenshot links to qa-artifacts/"
        return 1
      fi
    fi
  fi

  return 0
}

# Validate provider
if ! validate_provider "${PROVIDER_CMD}"; then
  echo "ERROR: Unknown provider: ${PROVIDER_CMD}" >&2
  exit 1
fi

rotate_log
log_separator
log "RUN-START: qa invoked project=${PROJECT_DIR} provider=${PROVIDER_CMD} dry_run=${NW_DRY_RUN:-0}"
log "CONFIG: max_runtime=${MAX_RUNTIME}s artifacts=${QA_ARTIFACTS} skip_label=${SKIP_LABEL} branch_patterns=${BRANCH_PATTERNS_RAW}"

if ! acquire_lock "${LOCK_FILE}"; then
  emit_result "skip_locked"
  exit 0
fi

cd "${PROJECT_DIR}"

PROVIDER_MODEL_DISPLAY=$(resolve_provider_model_display "${PROVIDER_CMD}" "${PROVIDER_LABEL}")
QA_ARTIFACTS_DESC=$(describe_qa_artifacts "${QA_ARTIFACTS}")

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
    } | awk '!seen[$0]++'
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
  echo "Provider (model): ${PROVIDER_MODEL_DISPLAY}"
  echo "Branch Patterns: ${BRANCH_PATTERNS_RAW}"
  echo "Skip Label: ${SKIP_LABEL}"
  echo "QA Artifacts: ${QA_ARTIFACTS_DESC} (mode=${QA_ARTIFACTS})"
  echo "Auto-install Playwright: ${QA_AUTO_INSTALL_PLAYWRIGHT}"
  echo "Open PRs needing QA:${PRS_NEEDING_QA}"
  echo "Default Branch: ${DEFAULT_BRANCH}"
  echo "QA Worktree: ${QA_WORKTREE_DIR}"
  echo "Timeout: ${MAX_RUNTIME}s"
  exit 0
fi

EXIT_CODE=0
PROCESSED_PRS_CSV=""
PASSING_PRS_CSV=""
ISSUES_FOUND_PRS_CSV=""
NO_TESTS_PRS_CSV=""
UNCLASSIFIED_PRS_CSV=""
WARNING_PRS_CSV=""
FAILED_AUTOMATION_PRS_CSV=""
FAILED_PR=""
FAILED_REASON="unknown"
QA_SCREENSHOT_SUMMARY=""
QA_WARNING_SUMMARY=""

# Process each PR that needs QA
for pr_ref in ${PRS_NEEDING_QA}; do
  pr_num="${pr_ref#\#}"
  PROCESSED_PRS_CSV=$(append_csv "${PROCESSED_PRS_CSV}" "#${pr_num}")
  log "QA: Processing PR #${pr_num}"

  cleanup_worktrees "${PROJECT_DIR}"
  if ! prepare_detached_worktree "${PROJECT_DIR}" "${QA_WORKTREE_DIR}" "${DEFAULT_BRANCH}" "${LOG_FILE}"; then
    log "FAIL: Unable to create isolated QA worktree ${QA_WORKTREE_DIR} for PR #${pr_num}"
    FAILED_AUTOMATION_PRS_CSV=$(append_csv "${FAILED_AUTOMATION_PRS_CSV}" "#${pr_num}")
    FAILED_PR="#${pr_num}"
    FAILED_REASON="worktree_setup_failed"
    EXIT_CODE=1
    break
  fi

  if ! assert_isolated_worktree "${PROJECT_DIR}" "${QA_WORKTREE_DIR}" "qa"; then
    log "FAIL: QA worktree guard rejected ${QA_WORKTREE_DIR} for PR #${pr_num}"
    FAILED_AUTOMATION_PRS_CSV=$(append_csv "${FAILED_AUTOMATION_PRS_CSV}" "#${pr_num}")
    FAILED_PR="#${pr_num}"
    FAILED_REASON="worktree_guard_failed"
    EXIT_CODE=1
    break
  fi

  log "QA: Checking out PR #${pr_num} in worktree"
  # Prefer detached checkout to avoid "branch already used by worktree" failures
  # when the same branch is already checked out in another local worktree.
  if ! (cd "${QA_WORKTREE_DIR}" && gh pr checkout "${pr_num}" --detach >> "${LOG_FILE}" 2>&1); then
    log "WARN: Detached checkout failed for PR #${pr_num}; retrying with standard checkout"
    if ! (cd "${QA_WORKTREE_DIR}" && gh pr checkout "${pr_num}" >> "${LOG_FILE}" 2>&1); then
      log "WARN: Failed to checkout PR #${pr_num}, skipping"
      FAILED_AUTOMATION_PRS_CSV=$(append_csv "${FAILED_AUTOMATION_PRS_CSV}" "#${pr_num}")
      FAILED_PR="#${pr_num}"
      FAILED_REASON="checkout_failed"
      EXIT_CODE=1
      cleanup_worktrees "${PROJECT_DIR}"
      continue
    fi
  fi

  QA_PROMPT_PATH=$(resolve_instruction_path_with_fallback "${QA_WORKTREE_DIR}" "qa.md" "night-watch-qa.md" || true)
  if [ -z "${QA_PROMPT_PATH}" ]; then
    log "FAIL: Missing QA prompt file for PR #${pr_num}. Checked qa.md/night-watch-qa.md in instructions/, .claude/commands/, and bundled templates/"
    FAILED_AUTOMATION_PRS_CSV=$(append_csv "${FAILED_AUTOMATION_PRS_CSV}" "#${pr_num}")
    FAILED_PR="#${pr_num}"
    FAILED_REASON="missing_prompt"
    EXIT_CODE=1
    break
  fi
  QA_PROMPT_BUNDLED_NAME="qa.md"
  if [[ "${QA_PROMPT_PATH}" == */night-watch-qa.md ]]; then
    QA_PROMPT_BUNDLED_NAME="night-watch-qa.md"
  fi
  QA_PROMPT_PATH=$(prefer_bundled_prompt_if_legacy_command "${QA_WORKTREE_DIR}" "${QA_PROMPT_PATH}" "${QA_PROMPT_BUNDLED_NAME}")
  QA_PROMPT=$(cat "${QA_PROMPT_PATH}")
  QA_PROMPT_REF=$(instruction_ref_for_prompt "${QA_WORKTREE_DIR}" "${QA_PROMPT_PATH}")
  log "QA: PR #${pr_num} — using prompt from ${QA_PROMPT_REF}"

  # Inject provider attribution requirement into the QA prompt.
  QA_PROVIDER_LABEL="${NW_PROVIDER_LABEL:-${PROVIDER_CMD}}"
  QA_PROMPT="${QA_PROMPT}"$'\n\n'"## QA Attribution (Required)"$'\n'"At the very end of each QA result comment you post, add this footer on its own line:"$'\n'"> 🧪 QA run by ${QA_PROVIDER_LABEL}"

  LOG_LINE_BEFORE=$(wc -l < "${LOG_FILE}" 2>/dev/null || echo 0)
  QA_ATTEMPT_START=$(date +%s)
  log "QA: PR #${pr_num} — starting provider=${PROVIDER_CMD} timeout=${MAX_RUNTIME}s"
  PROVIDER_OK=0

  # Build provider command array using generic helper
  mapfile -d '' -t PROVIDER_CMD_PARTS < <(build_provider_cmd "${QA_WORKTREE_DIR}" "${QA_PROMPT}")

  # Execute — always cd into worktree so provider tools resolve project files correctly
  if (cd "${QA_WORKTREE_DIR}" && timeout "${MAX_RUNTIME}" "${PROVIDER_CMD_PARTS[@]}" 2>&1 | tee -a "${LOG_FILE}"); then
    PROVIDER_OK=1
  else
    local_exit=$?
    QA_ATTEMPT_ELAPSED=$(( $(date +%s) - QA_ATTEMPT_START ))
    log "QA: PR #${pr_num} — provider exited with code ${local_exit} elapsed=${QA_ATTEMPT_ELAPSED}s"
    if [ ${local_exit} -eq 124 ]; then
      FAILED_AUTOMATION_PRS_CSV=$(append_csv "${FAILED_AUTOMATION_PRS_CSV}" "#${pr_num}")
      FAILED_PR="#${pr_num}"
      FAILED_REASON="timeout"
      EXIT_CODE=124
      break
    fi
    FAILED_AUTOMATION_PRS_CSV=$(append_csv "${FAILED_AUTOMATION_PRS_CSV}" "#${pr_num}")
    FAILED_PR="#${pr_num}"
    FAILED_REASON="provider_exit_${local_exit}"
    EXIT_CODE=${local_exit}
  fi

  if [ "${PROVIDER_OK}" -eq 1 ]; then
    QA_ATTEMPT_ELAPSED=$(( $(date +%s) - QA_ATTEMPT_START ))
    log "QA: PR #${pr_num} — provider completed exit_code=0 elapsed=${QA_ATTEMPT_ELAPSED}s"
    if provider_output_looks_invalid "${LOG_LINE_BEFORE}"; then
      log "FAIL-QA-EVIDENCE: PR #${pr_num} provider output indicates an invalid automation run"
      FAILED_AUTOMATION_PRS_CSV=$(append_csv "${FAILED_AUTOMATION_PRS_CSV}" "#${pr_num}")
      FAILED_PR="#${pr_num}"
      FAILED_REASON="invalid_provider_output"
      EXIT_CODE=1
    else
      if validate_qa_evidence "${pr_num}"; then
        QA_EVIDENCE_STATUS=0
      else
        QA_EVIDENCE_STATUS=$?
      fi
      if [ ${QA_EVIDENCE_STATUS} -eq 2 ]; then
        WARNING_PRS_CSV=$(append_csv "${WARNING_PRS_CSV}" "#${pr_num}")
        QA_WARNING_SUMMARY="${QA_WARNING_SUMMARY}${QA_WARNING_SUMMARY:+$'\n'}#${pr_num}: no qa-artifacts/ or tests/*/qa/ files"
        log "QA: PR #${pr_num} — provider completed with warning-only QA evidence"
      elif [ ${QA_EVIDENCE_STATUS} -ne 0 ]; then
        FAILED_AUTOMATION_PRS_CSV=$(append_csv "${FAILED_AUTOMATION_PRS_CSV}" "#${pr_num}")
        FAILED_PR="#${pr_num}"
        FAILED_REASON="qa_evidence_validation_failed"
        EXIT_CODE=1
      else
        QA_OUTCOME=$(classify_qa_comment_outcome "${pr_num}")
        case "${QA_OUTCOME}" in
          passing)
            PASSING_PRS_CSV=$(append_csv "${PASSING_PRS_CSV}" "#${pr_num}")
            ;;
          issues_found)
            ISSUES_FOUND_PRS_CSV=$(append_csv "${ISSUES_FOUND_PRS_CSV}" "#${pr_num}")
            ;;
          no_tests_needed)
            NO_TESTS_PRS_CSV=$(append_csv "${NO_TESTS_PRS_CSV}" "#${pr_num}")
            ;;
          *)
            UNCLASSIFIED_PRS_CSV=$(append_csv "${UNCLASSIFIED_PRS_CSV}" "#${pr_num}")
            ;;
        esac

        PR_FIRST_SCREENSHOT=$(get_qa_screenshot_links "${pr_num}" | head -n 1 || true)
        if [ -n "${PR_FIRST_SCREENSHOT}" ]; then
          QA_SCREENSHOT_SUMMARY="${QA_SCREENSHOT_SUMMARY}${QA_SCREENSHOT_SUMMARY:+$'\n'}#${pr_num}: ${PR_FIRST_SCREENSHOT}"
        fi

        log "QA: PR #${pr_num} — provider completed with verifiable QA evidence"
      fi
    fi
  fi

  cleanup_worktrees "${PROJECT_DIR}"
done

cleanup_worktrees "${PROJECT_DIR}"

FINAL_PROCESSED_PRS_CSV="${PROCESSED_PRS_CSV:-${PRS_NEEDING_QA_CSV}}"
PASSING_PRS_SUMMARY=$(csv_or_none "${PASSING_PRS_CSV}")
ISSUES_FOUND_PRS_SUMMARY=$(csv_or_none "${ISSUES_FOUND_PRS_CSV}")
NO_TESTS_PRS_SUMMARY=$(csv_or_none "${NO_TESTS_PRS_CSV}")
UNCLASSIFIED_PRS_SUMMARY=$(csv_or_none "${UNCLASSIFIED_PRS_CSV}")
WARNING_PRS_SUMMARY=$(csv_or_none "${WARNING_PRS_CSV}")
FAILED_AUTOMATION_PRS_SUMMARY=$(csv_or_none "${FAILED_AUTOMATION_PRS_CSV}")
FAILED_PR_SUMMARY=$(csv_or_none "${FAILED_PR}")

QA_TOTAL_ELAPSED=$(( $(date +%s) - SCRIPT_START_TIME ))
log "OUTCOME: exit_code=${EXIT_CODE} total_elapsed=${QA_TOTAL_ELAPSED}s processed_prs=${FINAL_PROCESSED_PRS_CSV:-none}"

if [ ${EXIT_CODE} -eq 0 ]; then
  if [ -n "${WARNING_PRS_CSV}" ]; then
    log "DONE-WARN: QA runner completed with warnings"
    TELEGRAM_WARNING_BODY="Project: ${PROJECT_NAME}
Provider (model): ${PROVIDER_MODEL_DISPLAY}
Artifacts: ${QA_ARTIFACTS_DESC} (mode=${QA_ARTIFACTS})
Processed PRs: ${FINAL_PROCESSED_PRS_CSV}
Passing tests: ${PASSING_PRS_SUMMARY}
Issues found by tests: ${ISSUES_FOUND_PRS_SUMMARY}
No tests needed: ${NO_TESTS_PRS_SUMMARY}
Reported (unclassified): ${UNCLASSIFIED_PRS_SUMMARY}
Warnings: ${WARNING_PRS_SUMMARY}"
    if [ -n "${QA_WARNING_SUMMARY}" ]; then
      TELEGRAM_WARNING_BODY="${TELEGRAM_WARNING_BODY}
Warning details:
${QA_WARNING_SUMMARY}"
    fi
    if [ -n "${QA_SCREENSHOT_SUMMARY}" ]; then
      TELEGRAM_WARNING_BODY="${TELEGRAM_WARNING_BODY}
Screenshot links:
${QA_SCREENSHOT_SUMMARY}"
    fi
    send_telegram_status_message "🧪 Night Watch QA: warning" "${TELEGRAM_WARNING_BODY}"
    if [ -n "${REPO}" ]; then
      emit_result "warning_qa" "prs=${FINAL_PROCESSED_PRS_CSV}|passing=${PASSING_PRS_SUMMARY}|issues=${ISSUES_FOUND_PRS_SUMMARY}|no_tests=${NO_TESTS_PRS_SUMMARY}|unclassified=${UNCLASSIFIED_PRS_SUMMARY}|warnings=${WARNING_PRS_SUMMARY}|repo=${REPO}"
    else
      emit_result "warning_qa" "prs=${FINAL_PROCESSED_PRS_CSV}|passing=${PASSING_PRS_SUMMARY}|issues=${ISSUES_FOUND_PRS_SUMMARY}|no_tests=${NO_TESTS_PRS_SUMMARY}|unclassified=${UNCLASSIFIED_PRS_SUMMARY}|warnings=${WARNING_PRS_SUMMARY}"
    fi
  else
    log "DONE: QA runner completed successfully"
    TELEGRAM_SUCCESS_BODY="Project: ${PROJECT_NAME}
Provider (model): ${PROVIDER_MODEL_DISPLAY}
Artifacts: ${QA_ARTIFACTS_DESC} (mode=${QA_ARTIFACTS})
Processed PRs: ${FINAL_PROCESSED_PRS_CSV}
Passing tests: ${PASSING_PRS_SUMMARY}
Issues found by tests: ${ISSUES_FOUND_PRS_SUMMARY}
No tests needed: ${NO_TESTS_PRS_SUMMARY}
Reported (unclassified): ${UNCLASSIFIED_PRS_SUMMARY}"
    if [ -n "${QA_SCREENSHOT_SUMMARY}" ]; then
      TELEGRAM_SUCCESS_BODY="${TELEGRAM_SUCCESS_BODY}
Screenshot links:
${QA_SCREENSHOT_SUMMARY}"
    fi
    send_telegram_status_message "🧪 Night Watch QA: completed" "${TELEGRAM_SUCCESS_BODY}"
    if [ -n "${REPO}" ]; then
      emit_result "success_qa" "prs=${FINAL_PROCESSED_PRS_CSV}|passing=${PASSING_PRS_SUMMARY}|issues=${ISSUES_FOUND_PRS_SUMMARY}|no_tests=${NO_TESTS_PRS_SUMMARY}|unclassified=${UNCLASSIFIED_PRS_SUMMARY}|repo=${REPO}"
    else
      emit_result "success_qa" "prs=${FINAL_PROCESSED_PRS_CSV}|passing=${PASSING_PRS_SUMMARY}|issues=${ISSUES_FOUND_PRS_SUMMARY}|no_tests=${NO_TESTS_PRS_SUMMARY}|unclassified=${UNCLASSIFIED_PRS_SUMMARY}"
    fi
  fi
elif [ ${EXIT_CODE} -eq 124 ]; then
  log "TIMEOUT: QA runner killed after ${MAX_RUNTIME}s"
  send_telegram_status_message "🧪 Night Watch QA: timeout" "Project: ${PROJECT_NAME}
Provider (model): ${PROVIDER_MODEL_DISPLAY}
Timeout: ${MAX_RUNTIME}s
Failed PR: ${FAILED_PR_SUMMARY}
Failure reason: ${FAILED_REASON}
Processed PRs: ${FINAL_PROCESSED_PRS_CSV}
Passing tests: ${PASSING_PRS_SUMMARY}
Issues found by tests: ${ISSUES_FOUND_PRS_SUMMARY}
No tests needed: ${NO_TESTS_PRS_SUMMARY}
Failed automation: ${FAILED_AUTOMATION_PRS_SUMMARY}"
  if [ -n "${REPO}" ]; then
    emit_result "timeout" "prs=${FINAL_PROCESSED_PRS_CSV}|failed_pr=${FAILED_PR_SUMMARY}|reason=${FAILED_REASON}|passing=${PASSING_PRS_SUMMARY}|issues=${ISSUES_FOUND_PRS_SUMMARY}|no_tests=${NO_TESTS_PRS_SUMMARY}|failed_automation=${FAILED_AUTOMATION_PRS_SUMMARY}|repo=${REPO}"
  else
    emit_result "timeout" "prs=${FINAL_PROCESSED_PRS_CSV}|failed_pr=${FAILED_PR_SUMMARY}|reason=${FAILED_REASON}|passing=${PASSING_PRS_SUMMARY}|issues=${ISSUES_FOUND_PRS_SUMMARY}|no_tests=${NO_TESTS_PRS_SUMMARY}|failed_automation=${FAILED_AUTOMATION_PRS_SUMMARY}"
  fi
else
  log "FAIL: QA runner exited with code ${EXIT_CODE}"
  send_telegram_status_message "🧪 Night Watch QA: failed" "Project: ${PROJECT_NAME}
Provider (model): ${PROVIDER_MODEL_DISPLAY}
Exit code: ${EXIT_CODE}
Failed PR: ${FAILED_PR_SUMMARY}
Failure reason: ${FAILED_REASON}
Processed PRs: ${FINAL_PROCESSED_PRS_CSV}
Passing tests: ${PASSING_PRS_SUMMARY}
Issues found by tests: ${ISSUES_FOUND_PRS_SUMMARY}
No tests needed: ${NO_TESTS_PRS_SUMMARY}
Failed automation: ${FAILED_AUTOMATION_PRS_SUMMARY}"
  if [ -n "${REPO}" ]; then
    emit_result "failure" "prs=${FINAL_PROCESSED_PRS_CSV}|failed_pr=${FAILED_PR_SUMMARY}|reason=${FAILED_REASON}|passing=${PASSING_PRS_SUMMARY}|issues=${ISSUES_FOUND_PRS_SUMMARY}|no_tests=${NO_TESTS_PRS_SUMMARY}|failed_automation=${FAILED_AUTOMATION_PRS_SUMMARY}|repo=${REPO}"
  else
    emit_result "failure" "prs=${FINAL_PROCESSED_PRS_CSV}|failed_pr=${FAILED_PR_SUMMARY}|reason=${FAILED_REASON}|passing=${PASSING_PRS_SUMMARY}|issues=${ISSUES_FOUND_PRS_SUMMARY}|no_tests=${NO_TESTS_PRS_SUMMARY}|failed_automation=${FAILED_AUTOMATION_PRS_SUMMARY}"
  fi
fi
exit "${EXIT_CODE}"
