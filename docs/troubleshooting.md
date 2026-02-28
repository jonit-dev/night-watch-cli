# Troubleshooting

> Related: [DEV-ONBOARDING](DEV-ONBOARDING.md) | [Commands Reference](commands.md) | [Configuration](configuration.md) | [Local Testing](local-testing.md)

## "Current directory is not a git repository"

Run `night-watch init` from the root of a git repository:

```bash
cd your-project
git init  # if not already a git repo
night-watch init
```

---

## "GitHub CLI (gh) is not authenticated"

Authenticate with GitHub:

```bash
gh auth login
```

---

## "Provider CLI is not available"

Install the appropriate provider CLI:

```bash
# Claude CLI
# Follow instructions at https://docs.anthropic.com/en/docs/claude-cli

# Codex CLI
# Follow instructions at https://github.com/openai/codex
```

---

## "Night Watch is already installed"

Uninstall first, then reinstall:

```bash
night-watch uninstall
night-watch install
```

---

## "Lock file exists but process not running"

Remove stale lock files:

```bash
rm /tmp/night-watch-*.lock
```

Or use `night-watch status --verbose` to check which lock files are stale.

---

## Logs not being created

Ensure the logs directory exists and is writable:

```bash
mkdir -p logs
chmod 755 logs
```

---

## PRD not being processed

Check:

1. PRD is in the correct directory (`docs/PRDs/night-watch/`)
2. Dependencies are satisfied (check `done/` directory)
3. No open PR already exists for this PRD
4. Run `night-watch run --dry-run` to see what would be processed
