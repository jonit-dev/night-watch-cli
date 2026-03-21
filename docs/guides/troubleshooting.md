# Troubleshooting Guide

> Related: [Commands Reference](../reference/commands.md) | [Configuration](../reference/configuration.md) | [Bash Scripts](../reference/bash-scripts.md) | [Local Testing](local-testing.md)

---

## Quick Diagnostics

```bash
# Run system health check
night-watch doctor

# Check current status
night-watch status --verbose

# View recent logs
night-watch logs -n 100

# See what would run
night-watch run --dry-run
```

---

## Common Errors

### "Current directory is not a git repository"

**Cause:** Running Night Watch outside a git repository.

**Fix:**

```bash
cd your-project
git init  # if not already a git repo
night-watch init
```

---

### "GitHub CLI (gh) is not authenticated"

**Cause:** `gh` CLI not installed or not logged in.

**Fix:**

```bash
# Install GitHub CLI
brew install gh  # macOS
# or follow https://cli.github.com/ for other platforms

# Authenticate
gh auth login
```

---

### "Provider CLI is not available"

**Cause:** Claude or Codex CLI not found in PATH.

**Fix:**

```bash
# Check if installed
claude --version
# or
codex --version

# Install Claude CLI
npm install -g @anthropic-ai/claude-cli

# If using nvm/fnm, ensure provider is installed in the right Node version
nvm use default
claude --version
```

**Common PATH issues:**

Night Watch searches these locations for provider CLIs:

- nvm: `~/.nvm/versions/node/*/bin`
- fnm: `~/.local/share/fnm`
- volta: `~/.volta/bin`
- Global npm: `~/.npm-global/bin`
- Homebrew: `/opt/homebrew/bin`, `/usr/local/bin`

---

### "Lock file exists but process not running"

**Cause:** Previous run crashed or was killed without cleanup.

**Fix:**

```bash
# Safe cleanup via CLI
night-watch cancel

# Or manually remove stale locks
rm /tmp/night-watch-*.lock
```

---

### "No eligible PRDs found"

**Cause:** Multiple possible reasons.

**Diagnosis:**

```bash
night-watch prds  # Show PRD status
night-watch run --dry-run  # See why PRDs are skipped
```

**Common causes:**

| Reason                 | Log Message                        | Fix                            |
| ---------------------- | ---------------------------------- | ------------------------------ |
| PRD in `done/`         | Not shown in pending list          | PRD already processed          |
| Unmet dependency       | `unmet dependency: xxx.md`         | Process dependency first       |
| Open PR exists         | `open PR already exists`           | Review/merge existing PR       |
| Claimed by another run | `claimed by another process`       | Wait or cancel other run       |
| In cooldown            | `in cooldown after recent failure` | Wait for cooldown (default 2h) |

---

### "PRD keeps getting skipped"

**Diagnosis:**

```bash
# Check logs for skip reason
night-watch logs --type run | grep -i skip

# Check PRD dependencies
cat docs/prds/your-prd.md | grep -i "depends on"

# Check for existing PRs
gh pr list --head "night-watch/your-prd"
```

**Common fixes:**

- If dependency missing: process the dependency PRD first
- If PR exists: review and merge it, or close it
- If in cooldown: wait or clear history: `night-watch history record . prd.md success`

---

### "Rate limit / 429 errors"

**Cause:** API quota exhausted on proxy or Anthropic.

**Fix options:**

1. **Enable fallback to native Claude:**

   ```json
   {
     "fallbackOnRateLimit": true,
     "claudeModel": "sonnet"
   }
   ```

2. **Wait and retry:** Night Watch automatically retries with exponential backoff.

3. **Use a different provider:** Configure `provider: "codex"` temporarily.

---

### "Timeout / maxRuntime exceeded"

**Cause:** PRD too large or AI stuck.

**Diagnosis:**

```bash
# Check logs for timeout message
night-watch logs --type run | grep -i timeout

# Check PRD size
cat docs/prds/your-prd.md | wc -l
```

**Fix:**

- Split large PRDs into smaller ones
- Increase `maxRuntime` in config (default: 7200s = 2h)
- Check for infinite loops in AI output

---

### "Context window exhausted"

**Cause:** PRD implementation too large for single context.

**Fix:**

- Night Watch auto-checkpoints and resumes
- If still failing, split PRD into phases
- Each phase should fit in ~30-45 minutes of work

---

### "Worktree creation failed"

**Cause:** Git state issues or disk space.

**Diagnosis:**

```bash
# Check worktree status
git worktree list

# Check for leftover worktrees
ls -la ../ | grep "$(basename $PWD)-nw-"
```

**Fix:**

```bash
# Clean up worktrees
night-watch cancel  # Safe cleanup

# Or manually
git worktree prune
git worktree remove --force /path/to/worktree
```

---

### "Branch already exists"

**Cause:** Previous run created the branch but didn't complete.

**Fix:**

```bash
# Check if PR exists
gh pr list --head "night-watch/prd-name"

# If PR exists, review/merge it
# If no PR, delete the branch and retry
git branch -D night-watch/prd-name
git push origin --delete night-watch/prd-name
```

---

### "Logs not being created"

**Cause:** Permissions or directory issues.

**Fix:**

```bash
# Ensure logs directory exists
mkdir -p logs
chmod 755 logs

# Check if writable
touch logs/test.log && rm logs/test.log
```

---

## Queue Issues

### "Job stuck in queue"

**Diagnosis:**

```bash
night-watch queue status
night-watch queue list --status pending
```

**Fix:**

```bash
# Clear stuck jobs
night-watch queue clear

# Or clear specific type
night-watch queue clear --type executor
```

### "Multiple jobs running at once"

**Cause:** Queue disabled or race condition.

**Fix:**

```bash
# Check queue status
night-watch queue status

# Ensure only one job runs
night-watch cancel
```

---

## Git Issues

### "Detached HEAD in worktree"

**Cause:** Worktree created from remote ref.

**Fix:** This is normal for detached worktrees used by reviewer. For executor worktrees, ensure branch exists.

### "Push rejected (non-fast-forward)"

**Cause:** Remote branch diverged.

**Fix:**

```bash
# In worktree
git pull --rebase origin branch-name
git push origin branch-name
```

---

## Web UI Issues

### "Web UI not loading"

**Cause:** Server not running or web assets not built.

**Fix:**

```bash
# Start server
night-watch serve

# If using dev mode
yarn dev:web

# Build web assets
cd web && yarn build
```

### "Settings not saving"

**Cause:** Invalid config or permissions.

**Fix:**

```bash
# Validate config
night-watch doctor

# Check config file
cat night-watch.config.json | jq .
```

---

## Debugging Commands

```bash
# Verbose status with log snippets
night-watch status --verbose

# JSON output for scripting
night-watch status --json

# Dry run with full diagnostics
night-watch run --dry-run

# Debug provider invocation
night-watch run --dry-run 2>&1 | grep -i provider

# Follow logs in real-time
night-watch logs --follow

# Check crontab entries
crontab -l | grep night-watch
```

---

## Log File Locations

| Log      | Path                | Contents                |
| -------- | ------------------- | ----------------------- |
| Executor | `logs/executor.log` | PRD implementation runs |
| Reviewer | `logs/reviewer.log` | PR review cycles        |
| QA       | `logs/qa.log`       | QA test runs            |
| Audit    | `logs/audit.log`    | Code audit runs         |
| Server   | `logs/server.log`   | Web UI API requests     |

---

## Getting Help

1. **Check logs:** `night-watch logs -n 200`
2. **Run diagnostics:** `night-watch doctor`
3. **Dry run:** `night-watch run --dry-run`
4. **Search issues:** [GitHub Issues](https://github.com/jonit-dev/night-watch-cli/issues)
5. **Open a new issue:** Include:
   - `night-watch doctor` output
   - `night-watch status --verbose` output
   - Relevant log excerpts
   - Your `night-watch.config.json` (redact secrets)
