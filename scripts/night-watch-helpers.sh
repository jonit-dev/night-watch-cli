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
  prd_files=$(find "${prd_dir}" -maxdepth 1 -name '*.md' ! -name 'NIGHT-WATCH-SUMMARY.md' -type f 2>/dev/null | sort)

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
# Removes any worktrees with "-nw-" in the path (night-watch worktrees).

cleanup_worktrees() {
  local project_dir="${1:?project_dir required}"
  local project_name
  project_name=$(basename "${project_dir}")
  local marker="${2:-${project_name}-nw}"

  git -C "${project_dir}" worktree list --porcelain 2>/dev/null \
    | grep '^worktree ' \
    | awk '{print $2}' \
    | grep "${marker}" \
    | while read -r wt; do
        log "CLEANUP: Removing leftover worktree ${wt}"
        git -C "${project_dir}" worktree remove --force "${wt}" 2>/dev/null || true
      done || true
}

# ── Runtime workspace isolation ───────────────────────────────────────────────

project_runtime_key() {
  local project_dir="${1:?project_dir required}"
  local project_name
  local hash
  project_name=$(basename "${project_dir}")

  if command -v sha1sum >/dev/null 2>&1; then
    hash=$(printf "%s" "${project_dir}" | sha1sum | awk '{print $1}')
  elif command -v shasum >/dev/null 2>&1; then
    hash=$(printf "%s" "${project_dir}" | shasum | awk '{print $1}')
  else
    hash=$(printf "%s" "${project_dir}" | cksum | awk '{print $1}')
  fi

  printf "%s-%s" "${project_name}" "${hash:0:12}"
}

resolve_runtime_base_ref() {
  local git_dir="${1:?git_dir required}"
  local default_branch="${2:?default_branch required}"

  if git -C "${git_dir}" rev-parse --verify --quiet "refs/remotes/origin/${default_branch}" >/dev/null; then
    printf "%s" "refs/remotes/origin/${default_branch}"
    return 0
  fi

  if git -C "${git_dir}" rev-parse --verify --quiet "refs/heads/${default_branch}" >/dev/null; then
    printf "%s" "refs/heads/${default_branch}"
    return 0
  fi

  if git -C "${git_dir}" rev-parse --verify --quiet "refs/remotes/origin/HEAD" >/dev/null; then
    printf "%s" "refs/remotes/origin/HEAD"
    return 0
  fi

  return 1
}

prepare_runtime_workspace() {
  local project_dir="${1:?project_dir required}"
  local default_branch="${2:?default_branch required}"
  local log_file="${3:-${LOG_FILE:-/dev/null}}"
  local runtime_root="${NW_RUNTIME_ROOT:-${HOME}/.night-watch/runtime}"
  local runtime_key
  local runtime_base
  local mirror_dir
  local runs_dir
  local worktree_dir
  local clone_source=""
  local base_ref=""

  runtime_key=$(project_runtime_key "${project_dir}")
  runtime_base="${runtime_root}/${runtime_key}"
  mirror_dir="${runtime_base}/mirror.git"
  runs_dir="${runtime_base}/runs"
  worktree_dir="${runs_dir}/run-$(date +%Y%m%d-%H%M%S)-$$"

  mkdir -p "${runs_dir}"

  if [ ! -d "${mirror_dir}" ]; then
    clone_source=$(git -C "${project_dir}" config --get remote.origin.url 2>/dev/null || echo "")

    if [ -n "${clone_source}" ]; then
      if ! git clone --mirror "${clone_source}" "${mirror_dir}" >> "${log_file}" 2>&1; then
        git clone --mirror "${project_dir}" "${mirror_dir}" >> "${log_file}" 2>&1
      fi
    else
      git clone --mirror "${project_dir}" "${mirror_dir}" >> "${log_file}" 2>&1
    fi
  fi

  git -C "${mirror_dir}" remote update --prune >> "${log_file}" 2>&1 || true

  base_ref=$(resolve_runtime_base_ref "${mirror_dir}" "${default_branch}") || return 1
  git -C "${mirror_dir}" worktree add --detach "${worktree_dir}" "${base_ref}" >> "${log_file}" 2>&1

  printf "%s\n%s\n" "${mirror_dir}" "${worktree_dir}"
}

cleanup_runtime_workspace() {
  local mirror_dir="${1:?mirror_dir required}"
  local worktree_dir="${2:?worktree_dir required}"

  git -C "${mirror_dir}" worktree remove --force "${worktree_dir}" 2>/dev/null || true
  git -C "${mirror_dir}" worktree prune 2>/dev/null || true
}

prepare_branch_checkout() {
  local repo_dir="${1:?repo_dir required}"
  local branch_name="${2:?branch_name required}"
  local default_branch="${3:?default_branch required}"
  local log_file="${4:-${LOG_FILE:-/dev/null}}"
  local base_ref=""

  git -C "${repo_dir}" fetch origin "${default_branch}" "${branch_name}" >> "${log_file}" 2>&1 || true

  if git -C "${repo_dir}" rev-parse --verify --quiet "refs/heads/${branch_name}" >/dev/null; then
    git -C "${repo_dir}" checkout "${branch_name}" >> "${log_file}" 2>&1
    return $?
  fi

  if git -C "${repo_dir}" rev-parse --verify --quiet "refs/remotes/origin/${branch_name}" >/dev/null; then
    git -C "${repo_dir}" checkout -b "${branch_name}" "origin/${branch_name}" >> "${log_file}" 2>&1
    return $?
  fi

  base_ref=$(resolve_runtime_base_ref "${repo_dir}" "${default_branch}") || return 1
  git -C "${repo_dir}" checkout -b "${branch_name}" "${base_ref}" >> "${log_file}" 2>&1
}

checkout_default_branch() {
  local repo_dir="${1:?repo_dir required}"
  local default_branch="${2:?default_branch required}"
  local log_file="${3:-${LOG_FILE:-/dev/null}}"

  git -C "${repo_dir}" fetch origin "${default_branch}" >> "${log_file}" 2>&1 || true

  if git -C "${repo_dir}" rev-parse --verify --quiet "refs/remotes/origin/${default_branch}" >/dev/null; then
    git -C "${repo_dir}" checkout -B "${default_branch}" "origin/${default_branch}" >> "${log_file}" 2>&1
    return $?
  fi

  if git -C "${repo_dir}" rev-parse --verify --quiet "refs/heads/${default_branch}" >/dev/null; then
    git -C "${repo_dir}" checkout "${default_branch}" >> "${log_file}" 2>&1
    return $?
  fi

  git -C "${repo_dir}" checkout -B "${default_branch}" HEAD >> "${log_file}" 2>&1
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

# Check if the last N lines of the log contain a 429 rate limit error.
# Returns 0 if rate limited, 1 otherwise.
check_rate_limited() {
  local log_file="${1:?log_file required}"
  tail -20 "${log_file}" 2>/dev/null | grep -q "429"
}
