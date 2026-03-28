import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';

vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

vi.mock('@night-watch/core', () => ({
  DEFAULT_QUEUE_MAX_WAIT_TIME: 7200,
  clearQueue: vi.fn(),
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
  })),
  dispatchNextJob: vi.fn(),
  enqueueJob: vi.fn(),
  expireStaleJobs: vi.fn(),
  getQueueStatus: vi.fn(() => ({
    enabled: true,
    running: null,
    pending: { total: 0, byType: {} },
    items: [],
  })),
  getScriptPath: vi.fn(),
  loadConfig: vi.fn(),
  markJobRunning: vi.fn(),
  removeJob: vi.fn(),
  resolveJobProvider: vi.fn(() => 'claude'),
  resolvePreset: vi.fn(() => ({ command: 'claude', envVars: {} })),
  resolveProviderBucketKey: vi.fn((provider: string, _env: Record<string, string>) =>
    provider === 'codex' ? 'codex' : 'claude-native',
  ),
  canStartJob: vi.fn(),
  claimJobSlot: vi.fn(),
  updateJobStatus: vi.fn(),
}));

vi.mock('@/cli/commands/shared/env-builder.js', () => ({
  buildQueuedJobEnv: vi.fn(),
}));

import { spawn } from 'child_process';
import { queueCommand } from '@/cli/commands/queue.js';
import {
  claimJobSlot,
  dispatchNextJob,
  getScriptPath,
  loadConfig,
  markJobRunning,
  resolveJobProvider,
  resolvePreset,
  resolveProviderBucketKey,
} from '@night-watch/core';
import { buildQueuedJobEnv } from '@/cli/commands/shared/env-builder.js';

function buildProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.configureOutput({
    writeErr: () => {},
    writeOut: () => {},
  });
  queueCommand(program);
  return program;
}

async function runQueue(args: string[]): Promise<void> {
  const program = buildProgram();
  await program.parseAsync(['node', 'night-watch', 'queue', ...args]);
}

describe('queue command', () => {
  const queueConfig = {
    enabled: true,
    maxConcurrency: 3,
    maxWaitTime: 1800,
    priority: {
      executor: 5,
      reviewer: 4,
      slicer: 3,
      qa: 2,
      audit: 1,
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(process, 'cwd').mockReturnValue('/projects/current');
    vi.mocked(loadConfig).mockReturnValue({ queue: queueConfig } as never);
    vi.mocked(getScriptPath).mockReturnValue('/pkg/dist/scripts/night-watch-pr-reviewer-cron.sh');
    vi.mocked(spawn).mockReturnValue({
      pid: 4321,
      unref: vi.fn(),
    } as never);
    vi.mocked(buildQueuedJobEnv).mockReturnValue({});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('dispatch resolves the bundled script path and uses queue config from the current runtime', async () => {
    vi.mocked(dispatchNextJob).mockReturnValue({
      id: 42,
      projectPath: '/projects/foo',
      projectName: 'foo',
      jobType: 'reviewer',
      priority: 4,
      status: 'dispatched',
      envJson: {},
      enqueuedAt: 100,
      dispatchedAt: 110,
      expiredAt: null,
    } as never);

    await runQueue(['dispatch']);

    expect(loadConfig).toHaveBeenCalledWith('/projects/current');
    expect(dispatchNextJob).toHaveBeenCalledWith(queueConfig);
    expect(getScriptPath).toHaveBeenCalledWith('night-watch-pr-reviewer-cron.sh');
    expect(spawn).toHaveBeenCalledWith(
      'bash',
      ['/pkg/dist/scripts/night-watch-pr-reviewer-cron.sh', '/projects/foo'],
      expect.objectContaining({
        cwd: '/projects/foo',
        detached: true,
        stdio: 'ignore',
        env: expect.objectContaining({
          NW_QUEUE_DISPATCHED: '1',
          NW_QUEUE_ENTRY_ID: '42',
        }),
      }),
    );
    expect(markJobRunning).toHaveBeenCalledWith(42);
  });

  it('dispatch resolves the merger cron script for merger jobs', async () => {
    vi.mocked(dispatchNextJob).mockReturnValue({
      id: 77,
      projectPath: '/projects/foo',
      projectName: 'foo',
      jobType: 'merger',
      priority: 4,
      status: 'dispatched',
      envJson: {},
      enqueuedAt: 100,
      dispatchedAt: 110,
      expiredAt: null,
    } as never);

    vi.mocked(getScriptPath).mockReturnValue('/pkg/dist/scripts/night-watch-merger-cron.sh');

    await runQueue(['dispatch']);

    expect(getScriptPath).toHaveBeenCalledWith('night-watch-merger-cron.sh');
    expect(spawn).toHaveBeenCalledWith(
      'bash',
      ['/pkg/dist/scripts/night-watch-merger-cron.sh', '/projects/foo'],
      expect.objectContaining({
        cwd: '/projects/foo',
      }),
    );
  });

  it('dispatch is a no-op when there are no pending jobs', async () => {
    vi.mocked(dispatchNextJob).mockReturnValue(null);

    await runQueue(['dispatch']);

    expect(spawn).not.toHaveBeenCalled();
    expect(getScriptPath).not.toHaveBeenCalled();
    expect(markJobRunning).not.toHaveBeenCalled();
  });

  it('dispatch rebuilds env from queued project config', async () => {
    vi.mocked(buildQueuedJobEnv).mockReturnValue({
      ANTHROPIC_BASE_URL: 'https://project-a-proxy.com',
      NW_PROVIDER_CMD: 'claude',
      NW_PROVIDER_LABEL: 'Claude (proxy)',
    });

    vi.mocked(dispatchNextJob).mockReturnValue({
      id: 7,
      projectPath: '/projects/project-a',
      projectName: 'project-a',
      jobType: 'reviewer',
      priority: 4,
      status: 'dispatched',
      envJson: {
        ANTHROPIC_BASE_URL: 'https://dispatcher-proxy.com',
      },
      enqueuedAt: 200,
      dispatchedAt: 210,
      expiredAt: null,
    } as never);

    vi.mocked(getScriptPath).mockReturnValue('/pkg/dist/scripts/night-watch-pr-reviewer-cron.sh');

    await runQueue(['dispatch']);

    expect(buildQueuedJobEnv).toHaveBeenCalledWith(
      expect.objectContaining({ projectPath: '/projects/project-a', jobType: 'reviewer' }),
    );

    const spawnCall = vi.mocked(spawn).mock.calls[0];
    const spawnEnv = (spawnCall[2] as { env: Record<string, string> }).env;

    // Provider env comes from the queued project's config (via buildQueuedJobEnv), not envJson
    expect(spawnEnv.ANTHROPIC_BASE_URL).toBe('https://project-a-proxy.com');
    expect(spawnEnv.NW_PROVIDER_CMD).toBe('claude');
  });

  describe('resolve-key', () => {
    it('should return the bucket key for claude provider', async () => {
      vi.mocked(loadConfig).mockReturnValue({ provider: 'claude', providerEnv: {} } as never);
      vi.mocked(resolveJobProvider).mockReturnValue('claude');
      vi.mocked(resolvePreset).mockReturnValue({ command: 'claude', envVars: {} } as never);
      vi.mocked(resolveProviderBucketKey).mockReturnValue('claude-native');

      const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

      await runQueue(['resolve-key', '--project', '/projects/foo', '--job-type', 'executor']);

      expect(resolveProviderBucketKey).toHaveBeenCalled();
      expect(writeSpy).toHaveBeenCalledWith('claude-native\n');
      expect(exitSpy).toHaveBeenCalledWith(0);

      writeSpy.mockRestore();
      exitSpy.mockRestore();
    });

    it('should return codex bucket key for codex provider', async () => {
      vi.mocked(loadConfig).mockReturnValue({ provider: 'codex', providerEnv: {} } as never);
      vi.mocked(resolveJobProvider).mockReturnValue('codex');
      vi.mocked(resolvePreset).mockReturnValue({ command: 'codex', envVars: {} } as never);
      vi.mocked(resolveProviderBucketKey).mockReturnValue('codex');

      const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

      await runQueue(['resolve-key', '--project', '/projects/foo', '--job-type', 'executor']);

      expect(writeSpy).toHaveBeenCalledWith('codex\n');
      expect(exitSpy).toHaveBeenCalledWith(0);

      writeSpy.mockRestore();
      exitSpy.mockRestore();
    });
  });

  it('claim accepts pr-resolver jobs', async () => {
    vi.mocked(claimJobSlot).mockReturnValue({ claimed: true, id: 88 } as never);

    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    await runQueue(['claim', 'pr-resolver', '/projects/foo']);

    expect(claimJobSlot).toHaveBeenCalledWith(
      '/projects/foo',
      'foo',
      'pr-resolver',
      undefined,
      queueConfig,
    );
    expect(writeSpy).toHaveBeenCalledWith('88\n');
    expect(exitSpy).toHaveBeenCalledWith(0);

    writeSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('dispatch preserves persisted reviewer runtime markers from the queue entry', async () => {
    vi.mocked(buildQueuedJobEnv).mockReturnValue({
      NW_PROVIDER_CMD: 'claude',
    });

    vi.mocked(dispatchNextJob).mockReturnValue({
      id: 99,
      projectPath: '/projects/project-b',
      projectName: 'project-b',
      jobType: 'executor',
      priority: 5,
      status: 'dispatched',
      envJson: {
        NW_DRY_RUN: '1',
        NW_CRON_TRIGGER: '1',
        NW_TARGET_PR: '92',
        NW_REVIEWER_WORKER_MODE: '1',
        NW_REVIEWER_PARALLEL: '0',
        NW_REVIEWER_MAX_RUNTIME: '1800',
        NW_BRANCH_PATTERNS: 'night-watch/',
        ANTHROPIC_BASE_URL: 'https://wrong-proxy.com',
      },
      enqueuedAt: 300,
      dispatchedAt: 310,
      expiredAt: null,
    } as never);

    vi.mocked(getScriptPath).mockReturnValue('/pkg/dist/scripts/night-watch-cron.sh');

    await runQueue(['dispatch']);

    const spawnCall = vi.mocked(spawn).mock.calls[0];
    const spawnEnv = (spawnCall[2] as { env: Record<string, string> }).env;

    // Queue dispatch markers are always present
    expect(spawnEnv.NW_QUEUE_DISPATCHED).toBe('1');
    expect(spawnEnv.NW_QUEUE_ENTRY_ID).toBe('99');

    // Legitimate queue markers from envJson are preserved
    expect(spawnEnv.NW_DRY_RUN).toBe('1');
    expect(spawnEnv.NW_CRON_TRIGGER).toBe('1');
    expect(spawnEnv.NW_TARGET_PR).toBe('92');
    expect(spawnEnv.NW_REVIEWER_WORKER_MODE).toBe('1');
    expect(spawnEnv.NW_REVIEWER_PARALLEL).toBe('0');
    expect(spawnEnv.NW_REVIEWER_MAX_RUNTIME).toBe('1800');
    expect(spawnEnv.NW_BRANCH_PATTERNS).toBe('night-watch/');

    // Non-queue-marker keys from envJson are dropped (provider identity must come from config)
    expect(spawnEnv.ANTHROPIC_BASE_URL).not.toBe('https://wrong-proxy.com');
  });
});
