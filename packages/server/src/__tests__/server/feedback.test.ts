/**
 * Tests for feedback dashboard API routes.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeDb, getRepositories, resetRepositories } from '@night-watch/core';
import { createApp } from '../../index.js';

vi.mock('child_process', () => ({
  exec: vi.fn(
    (
      _cmd: string,
      _opts: unknown,
      cb?: (err: Error | null, result: { stdout: string; stderr: string }) => void,
    ) => {
      const callback = typeof _opts === 'function' ? (_opts as typeof cb) : cb;
      callback?.(null, { stdout: '', stderr: '' });
    },
  ),
  execFile: vi.fn(),
  execSync: vi.fn(() => ''),
  spawn: vi.fn(),
}));

vi.mock('@night-watch/core/board/factory.js', () => ({
  createBoardProvider: vi.fn(() => ({
    closeIssue: vi.fn(),
    commentOnIssue: vi.fn(),
    createIssue: vi.fn(),
    getAllIssues: vi.fn(),
    getBoard: vi.fn(),
    getColumns: vi.fn(),
    getIssue: vi.fn(),
    getIssuesByColumn: vi.fn(),
    moveIssue: vi.fn(),
    setupBoard: vi.fn(),
  })),
}));

vi.mock('@night-watch/core/utils/crontab.js', () => ({
  generateMarker: vi.fn((name: string) => `# night-watch-cli: ${name}`),
  getEntries: vi.fn(() => []),
  getProjectEntries: vi.fn(() => []),
}));

function writeMinimalConfig(dir: string): void {
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'test-project' }));
  fs.writeFileSync(
    path.join(dir, 'night-watch.config.json'),
    JSON.stringify({
      defaultBranch: 'main',
      projectName: 'test-project',
      provider: 'claude',
      reviewerEnabled: true,
    }),
  );
  fs.mkdirSync(path.join(dir, 'docs', 'PRDs', 'night-watch', 'done'), { recursive: true });
}

describe('feedback API routes', () => {
  let app: ReturnType<typeof createApp>;
  let tempDir: string;

  beforeEach(() => {
    vi.resetAllMocks();
    closeDb();
    resetRepositories();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-feedback-routes-test-'));
    process.env.NIGHT_WATCH_HOME = tempDir;
    writeMinimalConfig(tempDir);
    app = createApp(tempDir);
  });

  afterEach(() => {
    closeDb();
    resetRepositories();
    delete process.env.NIGHT_WATCH_HOME;
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('should return feedback summary', async () => {
    const repo = getRepositories().sessionOutcomes;
    const now = Date.now();

    repo.insertOutcome({
      projectPath: tempDir,
      jobType: 'executor',
      providerKey: 'codex',
      startedAt: now - 30_000,
      finishedAt: now - 10_000,
      durationSeconds: 20,
      outcome: 'success',
    });
    repo.insertOutcome({
      projectPath: tempDir,
      jobType: 'reviewer',
      providerKey: 'claude',
      startedAt: now - 70_000,
      finishedAt: now - 40_000,
      durationSeconds: 30,
      outcome: 'failure',
      failureCategory: 'tests',
      failureSignature: 'vitest failed',
    });
    repo.insertOutcome({
      projectPath: tempDir,
      jobType: 'executor',
      providerKey: 'codex',
      startedAt: now - 10 * 24 * 60 * 60 * 1000,
      finishedAt: now - 10 * 24 * 60 * 60 * 1000 + 20_000,
      durationSeconds: 20,
      outcome: 'failure',
      failureCategory: 'lint',
      failureSignature: 'eslint failed',
    });
    repo.createAugmentation({
      projectPath: tempDir,
      jobType: 'reviewer',
      promptText: 'Check for repeated test failures before editing.',
      status: 'active',
    });

    const response = await request(app).get('/api/feedback/summary');

    expect(response.status).toBe(200);
    expect(response.body.projectPath).toBe(tempDir);
    expect(response.body.windows.last7Days.totalCount).toBe(2);
    expect(response.body.windows.last7Days.successCount).toBe(1);
    expect(response.body.windows.last7Days.failureCount).toBe(1);
    expect(response.body.windows.last7Days.successRate).toBe(0.5);
    expect(response.body.windows.last7Days.byJobType.executor.totalCount).toBe(1);
    expect(response.body.windows.last7Days.byProvider.codex.successCount).toBe(1);
    expect(response.body.windows.last30Days.totalCount).toBe(3);
    expect(response.body.activeAugmentations).toHaveLength(1);
  });

  it('should disable augmentation', async () => {
    const repo = getRepositories().sessionOutcomes;
    const augmentation = repo.createAugmentation({
      projectPath: tempDir,
      jobType: 'executor',
      promptText: 'Prefer the known fix for flaky tests.',
      status: 'active',
    });

    const response = await request(app)
      .patch(`/api/feedback/augmentations/${augmentation.id}`)
      .send({ enabled: false });

    expect(response.status).toBe(200);
    expect(response.body.augmentation.id).toBe(augmentation.id);
    expect(response.body.augmentation.status).toBe('paused');

    const summary = await request(app).get('/api/feedback/summary');
    expect(summary.status).toBe(200);
    expect(summary.body.windows.last7Days.totalCount).toBe(0);
    expect(summary.body.windows.last7Days.successRate).toBeNull();
    expect(summary.body.windows.last7Days.byJobType).toEqual({});
    expect(summary.body.windows.last7Days.byProvider).toEqual({});
    expect(summary.body.activeAugmentations).toHaveLength(0);
  });
});
