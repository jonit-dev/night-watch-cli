/**
 * Tests for GitHub webhook job dispatch endpoints.
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

const SECRET_ENV = 'NIGHT_WATCH_TEST_GITHUB_WEBHOOK_SECRET';
const WEBHOOK_SECRET = 'test-github-secret';
const originalSecret = process.env[SECRET_ENV];

interface IGithubTestConfigOptions {
  onlyOnFailure?: boolean;
}

function signBody(rawBody: string): string {
  return `sha256=${createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex')}`;
}

function writeConfig(projectDir: string, options: IGithubTestConfigOptions = {}): void {
  const configData = {
    projectName: 'test-project',
    defaultBranch: 'main',
    provider: 'claude',
    reviewerEnabled: true,
    prdDirectory: 'docs/PRDs/night-watch',
    webhookTriggers: {
      enabled: true,
      secretEnv: SECRET_ENV,
      allowedJobIds: ['reviewer', 'qa'],
      github: {
        enabled: true,
        events: ['workflow_run'],
        rules: [
          {
            event: 'workflow_run',
            action: 'completed',
            jobId: 'qa',
            branchPatterns: ['feat/*'],
            onlyOnFailure: options.onlyOnFailure ?? true,
          },
        ],
      },
    },
  };

  fs.writeFileSync(
    path.join(projectDir, 'night-watch.config.json'),
    JSON.stringify(configData, null, 2),
  );
}

function createWorkflowRunPayload(conclusion: string): string {
  return JSON.stringify({
    action: 'completed',
    workflow_run: {
      conclusion,
      head_branch: 'feat/webhook-adapter',
      pull_requests: [{ number: 42 }],
    },
  });
}

describe('server GitHub jobs API', () => {
  let tempDir: string;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    vi.resetAllMocks();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'night-watch-jobs-github-test-'));

    process.env[SECRET_ENV] = WEBHOOK_SECRET;

    fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({ name: 'test-project' }));
    fs.mkdirSync(path.join(tempDir, 'docs', 'PRDs', 'night-watch'), { recursive: true });
    writeConfig(tempDir);

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
  });

  it('should accept GitHub sha256 signature', async () => {
    const rawBody = createWorkflowRunPayload('failure');

    const response = await request(app)
      .post('/api/jobs/reviewer/run')
      .set('Content-Type', 'application/json')
      .set('X-GitHub-Event', 'workflow_run')
      .set('X-GitHub-Delivery', 'delivery-123')
      .set('X-Hub-Signature-256', signBody(rawBody))
      .send(rawBody);

    expect(response.status).toBe(202);
    expect(response.body).toMatchObject({
      accepted: true,
      jobId: 'qa',
      pid: 12345,
    });

    expect(vi.mocked(spawn)).toHaveBeenCalledWith(
      'night-watch',
      ['qa'],
      expect.objectContaining({
        detached: true,
        stdio: 'ignore',
        cwd: tempDir,
      }),
    );

    const spawnCall = vi.mocked(spawn).mock.calls[0];
    const env = spawnCall?.[2]?.env as NodeJS.ProcessEnv | undefined;
    expect(env?.NW_WEBHOOK_SOURCE).toBe('github');
    expect(env?.NW_WEBHOOK_EVENT).toBe('workflow_run');
    expect(env?.NW_WEBHOOK_DELIVERY).toBe('delivery-123');
    expect(env?.NW_WEBHOOK_PR_NUMBER).toBe('42');
    expect(env?.NW_WEBHOOK_BRANCH).toBe('feat/webhook-adapter');
    expect(env?.NW_WEBHOOK_JOB_ID).toBe('qa');
    expect(env?.NW_WEBHOOK_DISPATCH_ID).toBe(response.body.dispatchId);
  });

  it('should ignore unmatched GitHub event', async () => {
    const rawBody = createWorkflowRunPayload('success');

    const response = await request(app)
      .post('/api/jobs/reviewer/run')
      .set('Content-Type', 'application/json')
      .set('X-GitHub-Event', 'workflow_run')
      .set('X-GitHub-Delivery', 'delivery-456')
      .set('X-Hub-Signature-256', signBody(rawBody))
      .send(rawBody);

    expect(response.status).toBe(202);
    expect(response.body).toMatchObject({
      accepted: false,
      ignored: true,
    });
    expect(vi.mocked(spawn)).not.toHaveBeenCalled();
  });
});
