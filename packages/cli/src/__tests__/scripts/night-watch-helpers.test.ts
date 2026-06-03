import { describe, expect, it } from 'vitest';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../../../../');
const helpersScript = path.join(repoRoot, 'scripts', 'night-watch-helpers.sh');

function runShell(script: string, cwd?: string, env?: NodeJS.ProcessEnv) {
  return spawnSync('bash', ['-lc', script], {
    cwd,
    encoding: 'utf-8',
    env: env ?? process.env,
  });
}

describe('night-watch helpers', () => {
  it('resolve_provider_key falls back to empty string when CLI is not found', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'night-watch-helpers-fallback-'));
    const isolatedHelpersScript = path.join(tempDir, 'night-watch-helpers.sh');
    fs.copyFileSync(helpersScript, isolatedHelpersScript);

    const emptyPathDir = path.join(tempDir, 'empty-path');
    fs.mkdirSync(emptyPathDir);

    // Call resolve_provider_key with a non-existent project dir; the helper
    // falls back gracefully to an empty string when the CLI binary is missing.
    const result = runShell(
      `PATH="${emptyPathDir}"; source "${isolatedHelpersScript}"; resolve_provider_key /tmp/no-such-project executor`,
      undefined,
      {
        ...process.env,
        PATH: '/usr/bin:/bin',
      },
    );

    // The function always exits 0 (fallback) and writes an empty string
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('');
  });

  it('cleanup_worktrees prunes stale registrations left by deleted agent worktrees', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'night-watch-helpers-'));
    const repoDir = path.join(tempDir, 'repo');
    const staleWorktreeDir = path.join(repoDir, '.claude', 'worktrees', 'agent-stale1234');
    const logFile = path.join(tempDir, 'cleanup.log');

    fs.mkdirSync(repoDir, { recursive: true });

    expect(runShell('git init', repoDir).status).toBe(0);
    expect(runShell('git config user.name "Night Watch Test"', repoDir).status).toBe(0);
    expect(runShell('git config user.email "night-watch@example.com"', repoDir).status).toBe(0);

    fs.writeFileSync(path.join(repoDir, 'README.md'), '# test\n');
    expect(runShell('git add README.md && git commit -m "init"', repoDir).status).toBe(0);

    fs.mkdirSync(path.dirname(staleWorktreeDir), { recursive: true });
    expect(
      runShell(`git worktree add -b "night-watch/stale-branch" "${staleWorktreeDir}" HEAD`, repoDir)
        .status,
    ).toBe(0);

    fs.rmSync(staleWorktreeDir, { recursive: true, force: true });

    const staleBefore = runShell('git worktree list --porcelain', repoDir);
    expect(staleBefore.status).toBe(0);
    expect(staleBefore.stdout).toContain(staleWorktreeDir);

    const cleanupResult = runShell(
      `source "${helpersScript}"; LOG_FILE="${logFile}"; NW_CRON_TRIGGER=1; cleanup_worktrees "${repoDir}"`,
      repoDir,
    );
    expect(cleanupResult.status).toBe(0);

    const staleAfter = runShell('git worktree list --porcelain', repoDir);
    expect(staleAfter.status).toBe(0);
    expect(staleAfter.stdout).not.toContain(staleWorktreeDir);
    expect(staleAfter.stdout).not.toContain('night-watch/stale-branch');
  });

  it('cleanup_worktrees removes unregistered stale night-watch worktree directories on disk', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'night-watch-helpers-orphan-'));
    const repoDir = path.join(tempDir, 'repo');
    const orphanWorktreeDir = path.join(tempDir, 'repo-nw-review-runner-pr-42-orphan');
    const logFile = path.join(tempDir, 'cleanup-orphan.log');

    fs.mkdirSync(repoDir, { recursive: true });

    expect(runShell('git init', repoDir).status).toBe(0);
    expect(runShell('git config user.name "Night Watch Test"', repoDir).status).toBe(0);
    expect(runShell('git config user.email "night-watch@example.com"', repoDir).status).toBe(0);

    fs.writeFileSync(path.join(repoDir, 'README.md'), '# test\n');
    expect(runShell('git add README.md && git commit -m "init"', repoDir).status).toBe(0);

    fs.mkdirSync(orphanWorktreeDir, { recursive: true });
    fs.writeFileSync(path.join(orphanWorktreeDir, 'stale.txt'), 'stale\n');

    const cleanupResult = runShell(
      `source "${helpersScript}"; LOG_FILE="${logFile}"; NW_CRON_TRIGGER=1; cleanup_worktrees "${repoDir}"`,
      repoDir,
    );
    expect(cleanupResult.status).toBe(0);
    expect(fs.existsSync(orphanWorktreeDir)).toBe(false);
  });

  it('find_executor_resume_pr ignores resumable PRs already labeled ready-to-merge', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'night-watch-helpers-resume-ready-'));
    const fakeBinDir = path.join(tempDir, 'bin');
    fs.mkdirSync(fakeBinDir, { recursive: true });

    fs.writeFileSync(
      path.join(fakeBinDir, 'gh'),
      `#!/usr/bin/env bash
if [[ "$1" == "pr" && "$2" == "list" ]]; then
  cat <<'EOF'
[{"number":1,"headRefName":"night-watch/frozen","url":"https://example.test/pull/1","title":"Frozen PR","isDraft":false,"createdAt":"2026-04-19T12:00:00Z","labels":[{"name":"nw:resumable"},{"name":"ready-to-merge"}]}]
EOF
  exit 0
fi
exit 0
`,
      { mode: 0o755 },
    );

    const result = runShell(
      `source "${helpersScript}"; find_executor_resume_pr "night-watch"`,
      tempDir,
      {
        ...process.env,
        PATH: `${fakeBinDir}:${process.env.PATH}`,
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('');
  });

  it('send_missing_fallback_configuration_warning includes configuration guidance', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'night-watch-helpers-telegram-'));
    const curlBin = path.join(tempDir, 'curl');
    const captureFile = path.join(tempDir, 'curl-args.txt');

    fs.writeFileSync(
      curlBin,
      `#!/usr/bin/env bash
printf '%s\\n' "$@" > "${captureFile}"
`,
      { mode: 0o755 },
    );

    const result = runShell(
      `source "${helpersScript}"; send_missing_fallback_configuration_warning "demo-project"`,
      undefined,
      {
        ...process.env,
        PATH: `${tempDir}:${process.env.PATH}`,
        NW_TELEGRAM_BOT_TOKEN: 'bot-token',
        NW_TELEGRAM_CHAT_ID: 'chat-id',
      },
    );

    expect(result.status).toBe(0);
    const curlArgs = fs.readFileSync(captureFile, 'utf-8');
    expect(curlArgs).toContain('bot-token');
    expect(curlArgs).toContain('chat-id');
    expect(curlArgs).toContain('Reliability & Fallbacks');
    expect(curlArgs).toContain('primaryFallbackPreset / primaryFallbackModel');
  });
});
