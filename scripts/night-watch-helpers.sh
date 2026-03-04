#!/usr/bin/env bash
# Night Watch helper functions — shared by cron scripts.
# Source this file, don't execute it directly.

# ── Provider validation ───────────────────────────────────────────────────────

# Validates that the provider command is supported.
# Returns 0 if valid, 1 if unknown.
# Supported providers: claude, codex
validate_provider() {
  local provider="${1:?provider required}"
  case "${provider}" in
    claude|codex)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

# Resolve a usable night-watch CLI binary for nested script calls.
# Resolution order:
# 1) NW_CLI_BIN from parent environment (absolute path set by installer/runtime)
# 2) `night-watch` found in PATH
# 3) bundled bin path next to scripts/ in this package checkout/install
resolve_night_watch_cli() {
  if [ -n "${NW_CLI_BIN:-}" ] && [ -x "${NW_CLI_BIN}" ]; then
    printf "%s" "${NW_CLI_BIN}"
    return 0
  fi

  if command -v night-watch >/dev/null 2>&1; then
    printf "%s" "night-watch"
    return 0
  fi

  local script_dir
  if [ -n "${SCRIPT_DIR:-}" ]; then
    script_dir="${SCRIPT_DIR}"
  else
    script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  fi

  local bundled_bin="${script_dir}/../bin/night-watch.mjs"
  if [ -x "${bundled_bin}" ]; then
    printf "%s" "${bundled_bin}"
    return 0
  fi

  return 1
}

resolve_instruction_path() {
  local project_dir="${1:?project_dir required}"
  local instruction_file="${2:?instruction_file required}"
  local script_dir=""
  local candidate=""

  if [ -n "${SCRIPT_DIR:-}" ]; then
    script_dir="${SCRIPT_DIR}"
  else
    script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  fi

  for candidate in \
    "${project_dir}/instructions/${instruction_file}" \
    "${project_dir}/.claude/commands/${instruction_file}" \
    "${script_dir}/../templates/${instruction_file}"; do
    if [ -f "${candidate}" ]; then
      printf "%s" "${candidate}"
      return 0
    fi
  done

  return 1
}

resolve_instruction_path_with_fallback() {
  local project_dir="${1:?project_dir required}"
  shift || true
  local instruction_file=""
  local resolved_path=""

  for instruction_file in "$@"; do
    [ -z "${instruction_file}" ] && continue
    resolved_path=$(resolve_instruction_path "${project_dir}" "${instruction_file}" || true)
    if [ -n "${resolved_path}" ]; then
      printf "%s" "${resolved_path}"
      return 0
    fi
  done

  return 1
}

instruction_ref_for_prompt() {
  local root_dir="${1:?root_dir required}"
  local instruction_path="${2:?instruction_path required}"

  if [[ "${instruction_path}" == "${root_dir}/"* ]]; then
    printf "%s" "${instruction_path#${root_dir}/}"
  else
    printf "%s" "${instruction_path}"
  fi
}

prefer_bundled_prompt_if_legacy_command() {
  local project_root="${1:?project_root required}"
  local resolved_prompt_path="${2:?resolved_prompt_path required}"
  local bundled_prompt_name="${3:?bundled_prompt_name required}"
  local script_dir=""
  local bundled_prompt_path=""
  local rel_path=""

  if [ -n "${SCRIPT_DIR:-}" ]; then
    script_dir="${SCRIPT_DIR}"
  else
    script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  fi

  bundled_prompt_path="${script_dir}/../templates/${bundled_prompt_name}"

  # Legacy .claude command prompt files often contain slash-command wrappers
  # rather than the full automation prompt. Prefer bundled templates in that case.
  if [[ "${resolved_prompt_path}" == "${project_root}/.claude/commands/"* ]] && [ -f "${bundled_prompt_path}" ]; then
    rel_path="${resolved_prompt_path#${project_root}/}"
    if grep -Eqi '^[[:space:]]*/[a-z0-9._/-]+' "${resolved_prompt_path}" 2>/dev/null; then
      log "WARN: Prompt ${rel_path} looks like a slash-command wrapper; using bundled template ${bundled_prompt_name}"
      printf "%s" "${bundled_prompt_path}"
      return 0
    fi
  fi

  printf "%s" "${resolved_prompt_path}"
}

night_watch_history() {
  local cli_bin
  cli_bin=$(resolve_night_watch_cli) || return 127
  "${cli_bin}" history "$@"
}

# ── Logging ──────────────────────────────────────────────────────────────────

log() {
  local log_file="${LOG_FILE:?LOG_FILE not set}"
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "${log_file}"
}

# ── Log rotation ─────────────────────────────────────────────────────────────

rotate_log() {
  local log_file="${LOG_FILE:?LOG_FILE not set}"
  local max_size="${MAX_LOG_SIZE:-524288}"

  if [ -f "${log_file}" ] && [ "$(stat -c%s "${log_file}" 2>/dev/null || echo 0)" -gt "${max_size}" ]; then
    mv "${log_file}" "${log_file}.old"
  fi
}

# ── Lock management ──────────────────────────────────────────────────────────

project_runtime_key() {
  local project_dir="${1:?project_dir required}"
  local project_name
  local project_hash=""
  project_name=$(basename "${project_dir}")

  if command -v sha1sum >/dev/null 2>&1; then
    project_hash=$(printf '%s' "${project_dir}" | sha1sum | awk '{print $1}')
  elif command -v shasum >/dev/null 2>&1; then
    project_hash=$(printf '%s' "${project_dir}" | shasum -a 1 | awk '{print $1}')
  elif command -v openssl >/dev/null 2>&1; then
    project_hash=$(printf '%s' "${project_dir}" | openssl sha1 | awk '{print $NF}')
  else
    return 1
  fi

  printf '%s-%s' "${project_name}" "${project_hash:0:12}"
}

acquire_lock() {
  local lock_file="${1:?lock_file required}"

  if [ -f "${lock_file}" ]; then
    local lock_pid
    lock_pid=$(cat "${lock_file}" 2>/dev/null || echo "")
    if [ -n "${lock_pid}" ] && kill -0 "${lock_pid}" 2>/dev/null; then
      log "SKIP: Previous run (PID ${lock_pid}) still active"
      return 1
    fi
    log "WARN: Stale lock file found (PID ${lock_pid}), removing"
    rm -f "${lock_file}"
  fi

  trap "rm -f '${lock_file}'" EXIT
  echo $$ > "${lock_file}"
  return 0
}

# ── Detect default branch ───────────────────────────────────────────────────

get_branch_tip_timestamp() {
  local project_dir="${1:?project_dir required}"
  local branch="${2:?branch required}"
  local remote_ts=""
  local local_ts=""
  local latest_ts=""

  remote_ts=$(git -C "${project_dir}" log -1 --format=%ct "refs/remotes/origin/${branch}" 2>/dev/null || true)
  local_ts=$(git -C "${project_dir}" log -1 --format=%ct "refs/heads/${branch}" 2>/dev/null || true)

  if [ -n "${remote_ts}" ]; then
    latest_ts="${remote_ts}"
  fi
  if [ -n "${local_ts}" ] && { [ -z "${latest_ts}" ] || [ "${local_ts}" -gt "${latest_ts}" ]; }; then
    latest_ts="${local_ts}"
  fi

  printf "%s" "${latest_ts}"
}

detect_default_branch() {
  local project_dir="${1:?project_dir required}"
  local main_ts=""
  local master_ts=""
  local remote_head=""

  main_ts=$(get_branch_tip_timestamp "${project_dir}" "main")
  master_ts=$(get_branch_tip_timestamp "${project_dir}" "master")

  if [ -n "${main_ts}" ] && [ -n "${master_ts}" ]; then
    if [ "${main_ts}" -ge "${master_ts}" ]; then
      echo "main"
    else
      echo "master"
    fi
    return 0
  fi

  if [ -n "${main_ts}" ]; then
    echo "main"
    return 0
  fi

  if [ -n "${master_ts}" ]; then
    echo "master"
    return 0
  fi

  remote_head=$(git -C "${project_dir}" symbolic-ref refs/remotes/origin/HEAD 2>/dev/null \
    | sed 's@^refs/remotes/origin/@@' || true)
  if [ -n "${remote_head}" ]; then
    echo "${remote_head}"
    return 0
  fi

  echo "main"
}

# ── Claim management ─────────────────────────────────────────────────────────

claim_prd() {
  local prd_dir="${1:?prd_dir required}"
  local prd_file="${2:?prd_file required}"
  local claim_file="${prd_dir}/${prd_file}.claim"

  printf '{"timestamp":%d,"hostname":"%s","pid":%d}\n' \
    "$(date +%s)" "$(hostname)" "$$" > "${claim_file}"
}

release_claim() {
  local prd_dir="${1:?prd_dir required}"
  local prd_file="${2:?prd_file required}"
  local claim_file="${prd_dir}/${prd_file}.claim"

  rm -f "${claim_file}"
}

is_claimed() {
  local prd_dir="${1:?prd_dir required}"
  local prd_file="${2:?prd_file required}"
  local max_runtime="${3:-7200}"
  local claim_file="${prd_dir}/${prd_file}.claim"

  if [ ! -f "${claim_file}" ]; then
    return 1
  fi

  local claim_ts
  claim_ts=$(grep -o '"timestamp":[0-9]*' "${claim_file}" 2>/dev/null | grep -o '[0-9]*' || echo "0")
  local now
  now=$(date +%s)
  local age=$(( now - claim_ts ))

  if [ "${age}" -lt "${max_runtime}" ]; then
    return 0  # actively claimed
  else
    # Stale claim — remove it
    rm -f "${claim_file}"
    return 1
  fi
}

# ── Find next eligible PRD ───────────────────────────────────────────────────

find_eligible_prd() {
  local prd_dir="${1:?prd_dir required}"
  local max_runtime="${2:-7200}"
  local project_dir="${3:-}"
  local done_dir="${prd_dir}/done"

  local prd_files
  prd_files=$(find "${prd_dir}" -maxdepth 1 -name '*.md' -type f 2>/dev/null | sort)

  if [ -z "${prd_files}" ]; then
    return 0
  fi

  # Apply priority ordering if NW_PRD_PRIORITY is set (colon-separated PRD names)
  if [ -n "${NW_PRD_PRIORITY:-}" ]; then
    local ordered=""
    IFS=':' read -ra prio_list <<< "${NW_PRD_PRIORITY}"
    for pname in "${prio_list[@]}"; do
      local match
      match=$(echo "${prd_files}" | grep "/${pname}\.md$" || true)
      if [ -n "${match}" ]; then
        ordered="${ordered}${match}"$'\n'
      fi
    done
    # Append remaining files not in priority list
    while IFS= read -r pf; do
      if [ -n "${pf}" ] && ! echo "${ordered}" | grep -qF "${pf}"; then
        ordered="${ordered}${pf}"$'\n'
      fi
    done <<< "${prd_files}"
    prd_files=$(echo "${ordered}" | sed '/^$/d')
  fi

  local open_branches
  open_branches=$(gh pr list --state open --json headRefName --jq '.[].headRefName' 2>/dev/null || echo "")

  for prd_path in ${prd_files}; do
    local prd_file
    prd_file=$(basename "${prd_path}")
    local prd_name="${prd_file%.md}"

    # Skip if claimed by another process
    if is_claimed "${prd_dir}" "${prd_file}" "${max_runtime}"; then
      log "SKIP-PRD: ${prd_file} — claimed by another process"
      continue
    fi

    # Skip if in cooldown after a recent failure (checked via execution history ledger)
    if [ -n "${project_dir}" ] && night_watch_history check "${project_dir}" "${prd_file}" --cooldown "${max_runtime}" 2>/dev/null; then
      log "SKIP-PRD: ${prd_file} — in cooldown after recent failure"
      continue
    fi

    # Skip if a PR already exists for this PRD
    if echo "${open_branches}" | grep -qF "${prd_name}"; then
      log "SKIP-PRD: ${prd_file} — open PR already exists"
      continue
    fi

    # Check dependencies
    local depends_on
    depends_on=$(grep -i 'depends on' "${prd_path}" 2>/dev/null \
      | head -1 \
      | grep -oP '[a-z0-9_-]+\.md' || echo "")
    if [ -n "${depends_on}" ]; then
      local dep_met=true
      for dep_file in ${depends_on}; do
        if [ ! -f "${done_dir}/${dep_file}" ]; then
          log "SKIP-PRD: ${prd_file} — unmet dependency: ${dep_file}"
          dep_met=false
          break
        fi
      done
      if [ "${dep_met}" = false ]; then
        continue
      fi
    fi

    echo "${prd_file}"
    return 0
  done
}

# ── Clean up worktrees ───────────────────────────────────────────────────────
# Removes night-watch worktrees for this project.
# Optional second argument narrows cleanup to worktrees containing that token.
# This prevents parallel reviewer workers from deleting each other's worktrees.

cleanup_worktrees() {
  local project_dir="${1:?project_dir required}"
  local scope="${2:-}"
  local project_name
  project_name=$(basename "${project_dir}")

  local match_token="${project_name}-nw"
  if [ -n "${scope}" ]; then
    match_token="${scope}"
  fi

  git -C "${project_dir}" worktree list --porcelain 2>/dev/null \
    | grep '^worktree ' \
    | awk '{print $2}' \
    | grep -F "${match_token}" \
    | while read -r wt; do
        log "CLEANUP: Removing leftover worktree ${wt}"
        git -C "${project_dir}" worktree remove --force "${wt}" 2>/dev/null || true
      done || true
}

# Pick the best available ref for creating a new detached worktree.
resolve_worktree_base_ref() {
  local project_dir="${1:?project_dir required}"
  local default_branch="${2:?default_branch required}"

  if git -C "${project_dir}" rev-parse --verify --quiet "refs/remotes/origin/${default_branch}" >/dev/null; then
    printf "%s" "origin/${default_branch}"
    return 0
  fi

  if git -C "${project_dir}" rev-parse --verify --quiet "refs/heads/${default_branch}" >/dev/null; then
    printf "%s" "${default_branch}"
    return 0
  fi

  if git -C "${project_dir}" rev-parse --verify --quiet "refs/remotes/origin/HEAD" >/dev/null; then
    printf "%s" "origin/HEAD"
    return 0
  fi

  # Final fallback: use current HEAD (handles local-only repos with no remote)
  if git -C "${project_dir}" rev-parse --verify --quiet HEAD >/dev/null; then
    printf "%s" "HEAD"
    return 0
  fi

  return 1
}

# Create an isolated worktree on a branch without checking out that branch
# in the user's current project directory.
prepare_branch_worktree() {
  local project_dir="${1:?project_dir required}"
  local worktree_dir="${2:?worktree_dir required}"
  local branch_name="${3:?branch_name required}"
  local default_branch="${4:?default_branch required}"
  local log_file="${5:-${LOG_FILE:-/dev/null}}"
  local base_ref=""

  git -C "${project_dir}" fetch origin "${default_branch}" >> "${log_file}" 2>&1 || true
  base_ref=$(resolve_worktree_base_ref "${project_dir}" "${default_branch}") || return 1

  if git -C "${project_dir}" rev-parse --verify --quiet "refs/heads/${branch_name}" >/dev/null; then
    git -C "${project_dir}" worktree add "${worktree_dir}" "${branch_name}" >> "${log_file}" 2>&1
    return $?
  fi

  if git -C "${project_dir}" rev-parse --verify --quiet "refs/remotes/origin/${branch_name}" >/dev/null; then
    git -C "${project_dir}" worktree add -b "${branch_name}" "${worktree_dir}" "origin/${branch_name}" >> "${log_file}" 2>&1
    return $?
  fi

  git -C "${project_dir}" worktree add -b "${branch_name}" "${worktree_dir}" "${base_ref}" >> "${log_file}" 2>&1
}

# Create an isolated detached worktree (useful for reviewer/controller flows).
prepare_detached_worktree() {
  local project_dir="${1:?project_dir required}"
  local worktree_dir="${2:?worktree_dir required}"
  local default_branch="${3:?default_branch required}"
  local log_file="${4:-${LOG_FILE:-/dev/null}}"
  local base_ref=""

  # Remove stale directory that exists on disk but is not registered in git's
  # worktree list (left over from a killed or interrupted previous run).
  if [ -d "${worktree_dir}" ]; then
    if ! git -C "${project_dir}" worktree list --porcelain 2>/dev/null \
        | grep -qF "worktree ${worktree_dir}"; then
      log "WARN: Removing unregistered stale worktree directory ${worktree_dir}"
      rm -rf "${worktree_dir}"
    fi
  fi

  git -C "${project_dir}" fetch origin "${default_branch}" >> "${log_file}" 2>&1 || true
  base_ref=$(resolve_worktree_base_ref "${project_dir}" "${default_branch}") || return 1

  git -C "${project_dir}" worktree add --detach "${worktree_dir}" "${base_ref}" >> "${log_file}" 2>&1
}

# ── Mark PRD as done ─────────────────────────────────────────────────────────

mark_prd_done() {
  local prd_dir="${1:?prd_dir required}"
  local prd_file="${2:?prd_file required}"
  local done_dir="${prd_dir}/done"

  mkdir -p "${done_dir}"

  if [ -f "${prd_dir}/${prd_file}" ]; then
    mv "${prd_dir}/${prd_file}" "${done_dir}/${prd_file}"
    log "DONE-PRD: Moved ${prd_file} to done/"
    return 0
  else
    log "WARN: PRD file not found: ${prd_dir}/${prd_file}"
    return 1
  fi
}

# ── Rate limit detection ────────────────────────────────────────────────────

# Check if the log contains a 429 rate limit error since a given line number.
# Usage: check_rate_limited <log_file> [start_line]
# When start_line is provided, only lines after that position are checked,
# preventing false positives from 429 errors in previous runs.
# Returns 0 if rate limited, 1 otherwise.
check_rate_limited() {
  local log_file="${1:?log_file required}"
  local start_line="${2:-0}"
  if [ "${start_line}" -gt 0 ] 2>/dev/null; then
    tail -n "+$((start_line + 1))" "${log_file}" 2>/dev/null | grep -q "429"
  else
    tail -20 "${log_file}" 2>/dev/null | grep -q "429"
  fi
}

# Send a generic Telegram status message.
# Preferred input: NW_TELEGRAM_STATUS_WEBHOOKS (JSON array with botToken/chatId).
# Legacy fallback: NW_TELEGRAM_BOT_TOKEN + NW_TELEGRAM_CHAT_ID.
# Usage: send_telegram_status_message <title> [body]
send_telegram_status_message() {
  local title="${1:-Night Watch}"
  local body="${2:-}"
  local msg="${title}"
  if [ -n "${body}" ]; then
    msg="${title}

${body}"
  fi

  # Preferred path: iterate all configured Telegram webhooks.
  if [ -n "${NW_TELEGRAM_STATUS_WEBHOOKS:-}" ] && command -v jq >/dev/null 2>&1; then
    local sent=0
    local webhook_json
    while IFS= read -r webhook_json; do
      [ -z "${webhook_json}" ] && continue
      local bot_token
      local chat_id
      bot_token=$(printf '%s' "${webhook_json}" | jq -r '.botToken // empty' 2>/dev/null || true)
      chat_id=$(printf '%s' "${webhook_json}" | jq -r '.chatId // empty' 2>/dev/null || true)
      if [ -n "${bot_token}" ] && [ -n "${chat_id}" ]; then
        curl -s -X POST "https://api.telegram.org/bot${bot_token}/sendMessage" \
          --data-urlencode "chat_id=${chat_id}" \
          --data-urlencode "text=${msg}" > /dev/null 2>&1 || true
        sent=1
      fi
    done < <(printf '%s' "${NW_TELEGRAM_STATUS_WEBHOOKS}" | jq -c '.[]?' 2>/dev/null || true)

    if [ "${sent}" -eq 1 ]; then
      return 0
    fi
  fi

  # Legacy single-webhook fallback.
  if [ -z "${NW_TELEGRAM_BOT_TOKEN:-}" ] || [ -z "${NW_TELEGRAM_CHAT_ID:-}" ]; then
    return 0
  fi
  curl -s -X POST "https://api.telegram.org/bot${NW_TELEGRAM_BOT_TOKEN}/sendMessage" \
    --data-urlencode "chat_id=${NW_TELEGRAM_CHAT_ID}" \
    --data-urlencode "text=${msg}" > /dev/null 2>&1 || true
}

# Send an immediate Telegram warning when the rate-limit fallback is triggered.
# Preferred input: NW_TELEGRAM_RATE_LIMIT_WEBHOOKS (JSON array with botToken/chatId).
# Legacy fallback: NW_TELEGRAM_BOT_TOKEN + NW_TELEGRAM_CHAT_ID.
# Usage: send_rate_limit_fallback_warning <model> <project_name>
send_rate_limit_fallback_warning() {
  local model="${1:-native Claude}"
  local project_name="${2:-unknown}"
  local msg="⚠️ Rate Limit Fallback

Project: ${project_name}
Proxy quota exhausted - falling back to native Claude (${model})"

  # Preferred path: iterate all opted-in Telegram webhooks.
  if [ -n "${NW_TELEGRAM_RATE_LIMIT_WEBHOOKS:-}" ] && command -v jq >/dev/null 2>&1; then
    local sent=0
    local webhook_json
    while IFS= read -r webhook_json; do
      [ -z "${webhook_json}" ] && continue
      local bot_token
      local chat_id
      bot_token=$(printf '%s' "${webhook_json}" | jq -r '.botToken // empty' 2>/dev/null || true)
      chat_id=$(printf '%s' "${webhook_json}" | jq -r '.chatId // empty' 2>/dev/null || true)
      if [ -n "${bot_token}" ] && [ -n "${chat_id}" ]; then
        curl -s -X POST "https://api.telegram.org/bot${bot_token}/sendMessage" \
          --data-urlencode "chat_id=${chat_id}" \
          --data-urlencode "text=${msg}" > /dev/null 2>&1 || true
        sent=1
      fi
    done < <(printf '%s' "${NW_TELEGRAM_RATE_LIMIT_WEBHOOKS}" | jq -c '.[]?' 2>/dev/null || true)

    if [ "${sent}" -eq 1 ]; then
      return 0
    fi
  fi

  # Legacy single-webhook fallback.
  if [ -z "${NW_TELEGRAM_BOT_TOKEN:-}" ] || [ -z "${NW_TELEGRAM_CHAT_ID:-}" ]; then
    return 0
  fi
  curl -s -X POST "https://api.telegram.org/bot${NW_TELEGRAM_BOT_TOKEN}/sendMessage" \
    --data-urlencode "chat_id=${NW_TELEGRAM_CHAT_ID}" \
    --data-urlencode "text=${msg}" > /dev/null 2>&1 || true
}

# ── Board mode issue discovery ────────────────────────────────────────────────

# Get the next eligible issue from the board provider.
# Iterates through Ready issues sorted by priority, skipping any in cooldown.
# Prints the JSON of the first eligible issue to stdout, or nothing if none found.
# Returns 0 on success, 1 if no issue found or CLI unavailable.
#
# Args:
#   $1 - project directory (for cooldown history lookup)
#   $2 - max runtime in seconds (cooldown window, default 7200)
find_eligible_board_issue() {
  local project_dir="${1:-}"
  local max_runtime="${2:-7200}"

  local cli_bin
  cli_bin=$(resolve_night_watch_cli) || {
    log "WARN: Cannot find night-watch CLI for board mode"
    return 1
  }

  # Fetch all Ready issues sorted by priority
  local all_issues
  all_issues=$("${cli_bin}" board next-issue --column "Ready" --all --json 2>/dev/null) || true
  if [ -z "${all_issues}" ] || [ "${all_issues}" = "[]" ]; then
    return 1
  fi

  # Require valid JSON array
  local count
  count=$(printf '%s' "${all_issues}" | jq 'if type == "array" then length else 0 end' 2>/dev/null || echo 0)
  if [ "${count}" -eq 0 ]; then
    return 1
  fi

  local i=0
  while [ "${i}" -lt "${count}" ]; do
    local issue
    issue=$(printf '%s' "${all_issues}" | jq ".[$i]" 2>/dev/null)

    # Validate issue has a number
    if ! printf '%s' "${issue}" | jq -e '.number and (.number | type == "number")' >/dev/null 2>&1; then
      i=$((i + 1))
      continue
    fi

    local number title prd_name
    number=$(printf '%s' "${issue}" | jq -r '.number' 2>/dev/null)
    title=$(printf '%s' "${issue}" | jq -r '.title // empty' 2>/dev/null)

    # Derive PRD name (same slug format used by the cron script for history keys)
    prd_name="${number}-$(printf '%s' "${title}" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '-' | sed 's/^-\|-$//g')"

    # Check cooldown — skip issues that failed recently
    if [ -n "${project_dir}" ] && "${cli_bin}" history check "${project_dir}" "${prd_name}" --cooldown "${max_runtime}" 2>/dev/null; then
      log "SKIP-BOARD: Issue #${number} — in cooldown after recent failure"
      i=$((i + 1))
      continue
    fi

    printf '%s' "${issue}"
    return 0
  done

  return 1
}
