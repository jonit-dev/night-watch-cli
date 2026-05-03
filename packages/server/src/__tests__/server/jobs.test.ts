/**
 * Tests for signed server job dispatch endpoints.
 */

import { createHmac } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

vi.mock('@night-watch/core/utils/crontab.js', () => ({
  getEntries: vi.fn(() => []),
  getProjectEntries: vi.fn(() => []),
  generateMarker: vi.fn((name: string) => `# night-watch-cli: ${name}`),
}));

import { spawn } from 'child_process';

const SECRET_ENV = 'NIGHT_WATCH_TEST_WEBHOOK_SECRET';
const WEBHOOK_SECRET = 'test-secret';
const originalSecret = process.env[SECRET_ENV];
const originalQueueEnabled = process.env.NW_QUEUE_ENABLED;

function signBody(rawBody: string): string {
  return `sha256=${createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex')}`;
}

function writeConfig(projectDir: string, allowedJobIds: string[]): void {
  const configData = {
    projectName: 'test-project',
    defaultBranch: 'main',
    provider: 'claude',
    reviewerEnabled: true,
    prdDirectory: 'docs/PRDs/night-watch',
    webhookTriggers: {
      enabled: true,
      secretEnv: SECRET_ENV,
      allowedJobIds,
    },
  };

  fs.writeFileSync(
    path.join(projectDir, 'night-watch.config.json'),
    JSON.stringify(configData, null, 2),
  );
}

describe('server jobs API', () => {
  let tempDir: string;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    vi.resetAllMocks();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'night-watch-jobs-test-'));

    process.env[SECRET_ENV] = WEBHOOK_SECRET;
    delete process.env.NW_QUEUE_ENABLED;

    fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({ name: 'test-project' }));
    fs.mkdirSync(path.join(tempDir, 'docs', 'PRDs', 'night-watch'), { recursive: true });
    writeConfig(tempDir, ['reviewer']);

    vi.mocked(spawn).mockReturnValue({
      pid: 12345,
      unref: vi.fn(),
      on: vi.fn(),
    } as any);

    app = createApp(tempDir);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    if (originalSecret === undefined) {
      delete process.env[SECRET_ENV];
    } else {
      process.env[SECRET_ENV] = originalSecret;
    }
    if (originalQueueEnabled === undefined) {
      delete process.env.NW_QUEUE_ENABLED;
    } else {
      process.env.NW_QUEUE_ENABLED = originalQueueEnabled;
    }
  });

  it('should reject unsigned job dispatch', async () => {
    const response = await request(app).post('/api/jobs/reviewer/run').send({});

    expect(response.status).toBe(401);
    expect(vi.mocked(spawn)).not.toHaveBeenCalled();
  });

  it('should dispatch signed allowed job', async () => {
    const rawBody = JSON.stringify({ source: 'test' });

    const response = await request(app)
      .post('/api/jobs/reviewer/run')
      .set('Content-Type', 'application/json')
      .set('X-Night-Watch-Signature', signBody(rawBody))
      .send(rawBody);

    expect(response.status).toBe(202);
    expect(response.body).toMatchObject({
      accepted: true,
      jobId: 'reviewer',
      pid: 12345,
    });
    expect(response.body.dispatchId).toEqual(expect.any(String));

    expect(vi.mocked(spawn)).toHaveBeenCalledWith(
      'night-watch',
      ['review'],
      expect.objectContaining({
        detached: true,
        stdio: 'ignore',
        cwd: tempDir,
      }),
    );

    const spawnCall = vi.mocked(spawn).mock.calls[0];
    const env = spawnCall?.[2]?.env as NodeJS.ProcessEnv | undefined;
    expect(env?.NW_QUEUE_ENABLED).toBeUndefined();
    expect(env?.NW_WEBHOOK_JOB_ID).toBe('reviewer');
    expect(env?.NW_WEBHOOK_DISPATCH_ID).toBe(response.body.dispatchId);
  });

  it('should reject disallowed job id', async () => {
    const rawBody = JSON.stringify({});

    const response = await request(app)
      .post('/api/jobs/qa/run')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', signBody(rawBody))
      .send(rawBody);

    expect(response.status).toBe(403);
    expect(vi.mocked(spawn)).not.toHaveBeenCalled();
  });
});
