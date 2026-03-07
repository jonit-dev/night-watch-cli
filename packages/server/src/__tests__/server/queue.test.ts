/**
 * Tests for queue API routes: /api/queue/status, /api/queue/analytics
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import request from 'supertest';
import { runMigrations } from '@night-watch/core/storage/sqlite/migrations.js';
import { createApp, createGlobalApp } from '../../index.js';

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
  execSync: vi.fn(() => ''),
  execFile: vi.fn(),
  spawn: vi.fn(),
}));

vi.mock('@night-watch/core/board/factory.js', () => ({
  createBoardProvider: vi.fn(() => ({
    getAllIssues: vi.fn(),
    createIssue: vi.fn(),
    moveIssue: vi.fn(),
    closeIssue: vi.fn(),
    commentOnIssue: vi.fn(),
    getBoard: vi.fn(),
    getColumns: vi.fn(),
    getIssue: vi.fn(),
    getIssuesByColumn: vi.fn(),
    setupBoard: vi.fn(),
  })),
}));

vi.mock('@night-watch/core/utils/crontab.js', () => ({
  getEntries: vi.fn(() => []),
  getProjectEntries: vi.fn(() => []),
  generateMarker: vi.fn((name: string) => `# night-watch-cli: ${name}`),
}));

let mockProjectDir: string;
const originalCwd = process.cwd;
process.cwd = () => mockProjectDir;

function writeMinimalConfig(dir: string): void {
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'test-project' }));
  fs.writeFileSync(
    path.join(dir, 'night-watch.config.json'),
    JSON.stringify({
      projectName: 'test-project',
      defaultBranch: 'main',
      provider: 'claude',
      reviewerEnabled: true,
    }),
  );
  const prdDir = path.join(dir, 'docs', 'PRDs', 'night-watch');
  fs.mkdirSync(prdDir, { recursive: true });
  fs.mkdirSync(path.join(prdDir, 'done'), { recursive: true });
}

describe('queue API routes', () => {
  let tempDir: string;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    vi.resetAllMocks();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-queue-routes-test-'));
    mockProjectDir = tempDir;

    // Point the state DB to an isolated temp dir so the global queue is clean
    process.env.NIGHT_WATCH_HOME = tempDir;

    // Bootstrap the schema so job_queue and job_runs tables exist
    const db = new Database(path.join(tempDir, 'state.db'));
    runMigrations(db);
    db.close();

    writeMinimalConfig(tempDir);
    app = createApp(tempDir);
  });

  afterEach(() => {
    delete process.env.NIGHT_WATCH_HOME;
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.cwd = originalCwd;
  });

  describe('GET /api/queue/status', () => {
    it('returns queue status with enriched shape', async () => {
      const response = await request(app).get('/api/queue/status');

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        enabled: expect.any(Boolean),
        running: null,
        pending: expect.objectContaining({
          total: expect.any(Number),
          byType: expect.any(Object),
          byProviderBucket: expect.any(Object),
        }),
        items: expect.any(Array),
      });
      // averageWaitSeconds and oldestPendingAge should be present (null when queue empty)
      expect('averageWaitSeconds' in response.body).toBe(true);
      expect('oldestPendingAge' in response.body).toBe(true);
    });

    it('returns empty queue with zero totals when no jobs are queued', async () => {
      const response = await request(app).get('/api/queue/status');

      expect(response.status).toBe(200);
      expect(response.body.pending.total).toBe(0);
      expect(response.body.items).toHaveLength(0);
      expect(response.body.averageWaitSeconds).toBeNull();
      expect(response.body.oldestPendingAge).toBeNull();
    });
  });

  describe('GET /api/queue/analytics', () => {
    it('returns analytics payload with correct shape', async () => {
      const response = await request(app).get('/api/queue/analytics');

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        recentRuns: expect.any(Array),
        byProviderBucket: expect.any(Object),
      });
      expect('averageWaitSeconds' in response.body).toBe(true);
      expect('oldestPendingAge' in response.body).toBe(true);
    });

    it('accepts a custom window parameter', async () => {
      const response = await request(app).get('/api/queue/analytics?window=48');

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        recentRuns: expect.any(Array),
        byProviderBucket: expect.any(Object),
      });
    });

    it('returns empty recentRuns and null averages when no runs have been recorded', async () => {
      const response = await request(app).get('/api/queue/analytics');

      expect(response.status).toBe(200);
      expect(response.body.recentRuns).toHaveLength(0);
      expect(response.body.averageWaitSeconds).toBeNull();
      expect(response.body.oldestPendingAge).toBeNull();
    });

    it('falls back to default 24h window for invalid window param', async () => {
      const response = await request(app).get('/api/queue/analytics?window=notanumber');

      // Should not error, just use the default window
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('recentRuns');
    });
  });
});

describe('queue API routes in global mode', () => {
  let tempDir: string;
  let globalApp: ReturnType<typeof createGlobalApp>;

  beforeEach(() => {
    vi.resetAllMocks();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-queue-global-test-'));
    mockProjectDir = tempDir;
    process.env.NIGHT_WATCH_HOME = tempDir;

    // Bootstrap the schema so job_queue and job_runs tables exist
    const db = new Database(path.join(tempDir, 'state.db'));
    runMigrations(db);
    db.close();

    // Register at least one project so createGlobalApp does not exit
    const registryPath = path.join(tempDir, 'registry.json');
    writeMinimalConfig(tempDir);
    fs.writeFileSync(
      registryPath,
      JSON.stringify([{ name: 'test-project', path: tempDir }]),
    );

    globalApp = createGlobalApp();
  });

  afterEach(() => {
    delete process.env.NIGHT_WATCH_HOME;
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('GET /api/queue/status responds in global mode', async () => {
    const response = await request(globalApp).get('/api/queue/status');

    // Should succeed (global app mounts the route too)
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('pending');
  });

  it('GET /api/queue/analytics responds in global mode', async () => {
    const response = await request(globalApp).get('/api/queue/analytics');

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('recentRuns');
    expect(response.body).toHaveProperty('byProviderBucket');
  });

  it('POST /api/queue/clear responds in global mode', async () => {
    const response = await request(globalApp)
      .post('/api/queue/clear')
      .send({ force: true });

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('cleared');
    expect(typeof response.body.cleared).toBe('number');
  });

  it('GET /api/mode reports global mode', async () => {
    const response = await request(globalApp).get('/api/mode');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ globalMode: true });
  });
});
