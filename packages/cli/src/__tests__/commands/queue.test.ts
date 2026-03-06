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
}));

import { spawn } from 'child_process';
import { queueCommand } from '@/cli/commands/queue.js';
import { dispatchNextJob, getScriptPath, loadConfig, markJobRunning } from '@night-watch/core';

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
      envJson: {
        FOO: 'bar',
      },
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
          FOO: 'bar',
          NW_QUEUE_DISPATCHED: '1',
          NW_QUEUE_ENTRY_ID: '42',
        }),
      }),
    );
    expect(markJobRunning).toHaveBeenCalledWith(42);
  });

  it('dispatch is a no-op when there are no pending jobs', async () => {
    vi.mocked(dispatchNextJob).mockReturnValue(null);

    await runQueue(['dispatch']);

    expect(spawn).not.toHaveBeenCalled();
    expect(getScriptPath).not.toHaveBeenCalled();
    expect(markJobRunning).not.toHaveBeenCalled();
  });
});
