/**
 * Tests for the cron command and its subcommands.
 *
 * The cron subcommands use process.exit() for bash-integration signaling.
 * We spy on process.exit (throwing to stop execution) and process.stdout.write
 * to assert output and exit-code paths without a real process exit.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';

// ---------------------------------------------------------------------------
// Module mocks — must be declared before any import of the mocked modules
// ---------------------------------------------------------------------------

vi.mock('@night-watch/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@night-watch/core')>();
  return {
    ...actual,
    acquireLock: vi.fn(),
    checkRateLimited: vi.fn(),
    cleanupWorktrees: vi.fn(),
    detectDefaultBranch: vi.fn(),
    prepareBranchWorktree: vi.fn(),
    prepareDetachedWorktree: vi.fn(),
    releaseLock: vi.fn(),
    rotateLog: vi.fn(),
  };
});

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { cronCommand } from '@/cli/commands/cron.js';
import {
  acquireLock,
  checkRateLimited,
  cleanupWorktrees,
  detectDefaultBranch,
  prepareBranchWorktree,
  prepareDetachedWorktree,
  releaseLock,
  rotateLog,
} from '@night-watch/core';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a fresh Commander program with the cron subcommand registered.
 * exitOverride() makes Commander throw instead of calling process.exit on
 * parse errors (e.g. missing required arguments).
 */
function buildProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.configureOutput({
    writeErr: () => {},
    writeOut: () => {},
  });
  cronCommand(program);
  return program;
}

/**
 * Run a cron subcommand by parsing the given argument list.
 * process.exit is mocked to throw `Error('process.exit(<code>)')` so that
 * test execution stops at the exit call.
 */
async function runCron(args: string[]): Promise<void> {
  const program = buildProgram();
  await program.parseAsync(['node', 'night-watch', 'cron', ...args]);
}

// ---------------------------------------------------------------------------
// Shared spies — set up once, reset between tests
// ---------------------------------------------------------------------------

let exitSpy: ReturnType<typeof vi.spyOn>;
let stdoutSpy: ReturnType<typeof vi.spyOn>;
let stderrSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();

  exitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => {
    throw new Error(`process.exit(${code})`);
  });

  stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(() => {
  exitSpy.mockRestore();
  stdoutSpy.mockRestore();
  stderrSpy.mockRestore();
});

// ---------------------------------------------------------------------------
// detect-branch
// ---------------------------------------------------------------------------

describe('cron detect-branch', () => {
  it('writes the detected branch name followed by a newline', async () => {
    vi.mocked(detectDefaultBranch).mockReturnValue('main');

    await runCron(['detect-branch', '/some/project']);

    expect(stdoutSpy).toHaveBeenCalledWith('main\n');
  });
});

// ---------------------------------------------------------------------------
// acquire-lock
// ---------------------------------------------------------------------------

describe('cron acquire-lock', () => {
  it('exits 0 when the lock is acquired', async () => {
    vi.mocked(acquireLock).mockReturnValue(true);

    await expect(runCron(['acquire-lock', '/tmp/nw.lock', '--pid', '1234'])).rejects.toThrow(
      'process.exit(0)',
    );
  });

  it('exits 1 when the lock is already held', async () => {
    vi.mocked(acquireLock).mockReturnValue(false);

    await expect(runCron(['acquire-lock', '/tmp/nw.lock', '--pid', '1234'])).rejects.toThrow(
      'process.exit(1)',
    );
  });

  it('exits 2 when the pid argument is not a number', async () => {
    await expect(runCron(['acquire-lock', '/tmp/nw.lock', '--pid', 'NaN'])).rejects.toThrow(
      'process.exit(2)',
    );
    expect(acquireLock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// release-lock
// ---------------------------------------------------------------------------

describe('cron release-lock', () => {
  it('calls releaseLock and exits 0', async () => {
    vi.mocked(releaseLock).mockReturnValue(undefined);

    await expect(runCron(['release-lock', '/tmp/nw.lock'])).rejects.toThrow('process.exit(0)');
    expect(releaseLock).toHaveBeenCalledWith('/tmp/nw.lock');
  });
});

// ---------------------------------------------------------------------------
// prepare-worktree
// ---------------------------------------------------------------------------

describe('cron prepare-worktree', () => {
  it('exits 2 with an error message when neither --branch nor --detached is provided', async () => {
    await expect(runCron(['prepare-worktree', '/some/project', '/some/worktree'])).rejects.toThrow(
      'process.exit(2)',
    );
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('--branch or --detached'));
  });

  it('exits 0 when --detached succeeds', async () => {
    vi.mocked(prepareDetachedWorktree).mockReturnValue({ success: true });

    await expect(
      runCron(['prepare-worktree', '/some/project', '/some/worktree', '--detached']),
    ).rejects.toThrow('process.exit(0)');
  });

  it('exits 1 when --detached fails', async () => {
    vi.mocked(prepareDetachedWorktree).mockReturnValue({
      success: false,
      error: 'git error',
    });

    await expect(
      runCron(['prepare-worktree', '/some/project', '/some/worktree', '--detached']),
    ).rejects.toThrow('process.exit(1)');
  });

  it('exits 0 when --branch succeeds', async () => {
    vi.mocked(prepareBranchWorktree).mockReturnValue({ success: true });

    await expect(
      runCron(['prepare-worktree', '/some/project', '/some/worktree', '--branch', 'feat/my-work']),
    ).rejects.toThrow('process.exit(0)');
  });

  it('exits 1 when --branch fails', async () => {
    vi.mocked(prepareBranchWorktree).mockReturnValue({
      success: false,
      error: 'branch already exists',
    });

    await expect(
      runCron(['prepare-worktree', '/some/project', '/some/worktree', '--branch', 'feat/my-work']),
    ).rejects.toThrow('process.exit(1)');
  });
});

// ---------------------------------------------------------------------------
// check-rate-limit
// ---------------------------------------------------------------------------

describe('cron check-rate-limit', () => {
  it('exits 0 when the log file contains a rate limit error', async () => {
    vi.mocked(checkRateLimited).mockReturnValue(true);

    await expect(runCron(['check-rate-limit', '/var/log/nw.log'])).rejects.toThrow(
      'process.exit(0)',
    );
  });

  it('exits 1 when the log file does not contain a rate limit error', async () => {
    vi.mocked(checkRateLimited).mockReturnValue(false);

    await expect(runCron(['check-rate-limit', '/var/log/nw.log'])).rejects.toThrow(
      'process.exit(1)',
    );
  });
});

// ---------------------------------------------------------------------------
// rotate-log
// ---------------------------------------------------------------------------

describe('cron rotate-log', () => {
  it('exits 0 when the log was rotated', async () => {
    vi.mocked(rotateLog).mockReturnValue(true);

    await expect(runCron(['rotate-log', '/var/log/nw.log'])).rejects.toThrow('process.exit(0)');
  });

  it('exits 1 when no rotation was needed', async () => {
    vi.mocked(rotateLog).mockReturnValue(false);

    await expect(runCron(['rotate-log', '/var/log/nw.log'])).rejects.toThrow('process.exit(1)');
  });
});
