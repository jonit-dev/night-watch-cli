/**
 * Additional QA coverage for feedback API validation and aggregation behavior.
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

describe('feedback API validation', () => {
  let app: ReturnType<typeof createApp>;
  let tempDir: string;

  beforeEach(() => {
    vi.resetAllMocks();
    closeDb();
    resetRepositories();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-feedback-validation-test-'));
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

  it('should reject invalid augmentation update requests', async () => {
    const invalidId = await request(app)
      .patch('/api/feedback/augmentations/not-a-number')
      .send({ action: 'disable' });
    expect(invalidId.status).toBe(400);
    expect(invalidId.body.error).toBe('Invalid augmentation id');

    const invalidBody = await request(app).patch('/api/feedback/augmentations/1').send({});
    expect(invalidBody.status).toBe(400);
    expect(invalidBody.body.error).toBe('Expected action, enabled, or status update');
  });

  it('should not update augmentations from another project', async () => {
    const repo = getRepositories().sessionOutcomes;
    const otherProjectAugmentation = repo.createAugmentation({
      projectPath: `${tempDir}-other-project`,
      jobType: 'executor',
      promptText: 'Do not leak across project scopes.',
      status: 'active',
    });

    const response = await request(app)
      .patch(`/api/feedback/augmentations/${otherProjectAugmentation.id}`)
      .send({ action: 'disable' });

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('Augmentation not found');
    expect(repo.listAugmentations({ projectPath: `${tempDir}-other-project` })[0].status).toBe(
      'active',
    );
  });

  it('should return stored patterns with aggregated top failure signatures', async () => {
    const repo = getRepositories().sessionOutcomes;
    const now = Date.now();

    repo.upsertPattern({
      projectPath: tempDir,
      patternKey: 'executor:tests',
      jobType: 'executor',
      category: 'tests',
      title: 'Repeated test failures',
      description: 'Executor runs repeatedly fail in vitest.',
      sampleCount: 4,
      confidence: 0.9,
      status: 'active',
      firstSeenAt: now - 10_000,
      lastSeenAt: now,
    });
    repo.upsertPattern({
      projectPath: tempDir,
      patternKey: 'reviewer:lint',
      jobType: 'reviewer',
      category: 'lint',
      title: 'Lint regressions',
      description: 'Reviewer fixes repeatedly trigger lint failures.',
      sampleCount: 2,
      confidence: 0.75,
      status: 'observing',
      firstSeenAt: now - 20_000,
      lastSeenAt: now - 1_000,
    });

    for (let i = 0; i < 3; i += 1) {
      repo.insertOutcome({
        projectPath: tempDir,
        jobType: 'executor',
        providerKey: 'codex',
        startedAt: now - 30_000 + i,
        finishedAt: now - 20_000 + i,
        durationSeconds: 10,
        outcome: 'failure',
        failureCategory: 'tests',
        failureSignature: 'vitest failed',
      });
    }
    repo.insertOutcome({
      projectPath: tempDir,
      jobType: 'reviewer',
      providerKey: 'claude',
      startedAt: now - 15_000,
      finishedAt: now - 10_000,
      durationSeconds: 5,
      outcome: 'failure',
      failureCategory: 'lint',
      failureSignature: 'eslint failed',
    });

    const response = await request(app).get('/api/feedback/patterns');

    expect(response.status).toBe(200);
    expect(response.body.patterns.map((pattern: { title: string }) => pattern.title)).toEqual([
      'Repeated test failures',
      'Lint regressions',
    ]);
    expect(response.body.topFailurePatterns[0]).toMatchObject({
      jobType: 'executor',
      providerKey: 'codex',
      category: 'tests',
      signature: 'vitest failed',
      sampleCount: 3,
    });
  });
});
