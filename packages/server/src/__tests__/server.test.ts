/**
 * Tests for server API endpoints
 */

import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import request from 'supertest';
import { createApp } from '../index.js';
import { INightWatchConfig } from '@night-watch/core/types.js';

// Mock process.cwd to return our temp directory
let mockProjectDir: string;

vi.mock('child_process', () => ({
  execSync: vi.fn(),
  spawn: vi.fn(),
}));

// Mock board factory
const mockBoardProvider = {
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
};
vi.mock('@night-watch/core/board/factory.js', () => ({
  createBoardProvider: vi.fn(() => mockBoardProvider),
}));

vi.mock('@night-watch/core/utils/crontab.js', () => ({
  getEntries: vi.fn(() => []),
  getProjectEntries: vi.fn(() => []),
  generateMarker: vi.fn((name: string) => `# night-watch-cli: ${name}`),
}));

import { execSync, spawn } from 'child_process';
import { getEntries, getProjectEntries } from '@night-watch/core/utils/crontab.js';

// Mock process.cwd before importing server module
const originalCwd = process.cwd;
process.cwd = () => mockProjectDir;

describe('server API', () => {
  let tempDir: string;
  let app: any;
  let config: INightWatchConfig;

  beforeEach(() => {
    vi.resetAllMocks();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'night-watch-server-test-'));
    mockProjectDir = tempDir;

    // Create basic package.json
    fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({ name: 'test-project' }));

    // Create config file
    const configData = {
      projectName: 'test-project',
      defaultBranch: 'main',
      provider: 'claude',
      reviewerEnabled: true,
      prdDirectory: 'docs/PRDs/night-watch',
      maxRuntime: 7200,
      reviewerMaxRuntime: 3600,
      cron: {
        executorSchedule: '0 0-21 * * *',
        reviewerSchedule: '0 0,3,6,9,12,15,18,21 * * *',
      },
      review: {
        minScore: 80,
        branchPatterns: ['feat/', 'night-watch/'],
      },
      logging: {
        maxLogSize: 524288,
      },
    };
    fs.writeFileSync(
      path.join(tempDir, 'night-watch.config.json'),
      JSON.stringify(configData, null, 2),
    );

    // Create PRD directory
    const prdDir = path.join(tempDir, 'docs', 'PRDs', 'night-watch');
    fs.mkdirSync(prdDir, { recursive: true });
    fs.mkdirSync(path.join(prdDir, 'done'), { recursive: true });

    // Create some PRD files
    fs.writeFileSync(path.join(prdDir, 'phase1.md'), '# Phase 1\n\nSome content.');
    fs.writeFileSync(path.join(prdDir, 'phase2.md'), '# Phase 2\n\nOther content.');
    fs.writeFileSync(path.join(prdDir, 'done', 'phase0.md'), '# Phase 0\n\nDone.');

    // Create log directory and files
    const logDir = path.join(tempDir, 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    fs.writeFileSync(
      path.join(logDir, 'executor.log'),
      'Executor log line 1\nExecutor log line 2\nExecutor log line 3',
    );
    fs.writeFileSync(
      path.join(logDir, 'reviewer.log'),
      'Reviewer log line 1\nReviewer log line 2\nReviewer log line 3',
    );

    // Mock getEntries
    vi.mocked(getEntries).mockReturnValue([]);
    vi.mocked(getProjectEntries).mockReturnValue([]);

    // Mock execSync
    vi.mocked(execSync).mockImplementation((cmd: string) => {
      if (cmd.includes('git rev-parse')) {
        return 'true';
      }
      if (cmd.includes('which claude')) {
        return '/usr/bin/claude';
      }
      return '';
    });

    // Mock spawn
    vi.mocked(spawn).mockReturnValue({
      pid: 12345,
      unref: vi.fn(),
      on: vi.fn(),
    } as any);

    // Create app
    app = createApp(tempDir);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  afterAll(() => {
    process.cwd = originalCwd;
  });

  describe('GET /api/status', () => {
    it('should return status snapshot', async () => {
      const response = await request(app).get('/api/status');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('projectName', 'test-project');
      expect(response.body).toHaveProperty('config');
      expect(response.body).toHaveProperty('prds');
      expect(response.body).toHaveProperty('processes');
      expect(response.body).toHaveProperty('prs');
      expect(response.body).toHaveProperty('logs');
      expect(response.body).toHaveProperty('crontab');
      expect(response.body).toHaveProperty('timestamp');
    });

    it('should include PRD counts in status', async () => {
      const response = await request(app).get('/api/status');

      expect(response.status).toBe(200);
      expect(response.body.prds).toHaveLength(3);
      const phase1 = response.body.prds.find((p: any) => p.name === 'phase1');
      const phase0 = response.body.prds.find((p: any) => p.name === 'phase0');
      expect(phase1.status).toBe('ready');
      expect(phase0.status).toBe('done');
    });
  });

  describe('GET /api/prds', () => {
    it('should return 410 Gone (endpoint deprecated)', async () => {
      const response = await request(app).get('/api/prds');

      expect(response.status).toBe(410);
      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toContain('deprecated');
    });
  });

  describe('GET /api/prds/:name', () => {
    it('should return 410 Gone (endpoint deprecated)', async () => {
      const response = await request(app).get('/api/prds/phase1');

      expect(response.status).toBe(410);
      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toContain('deprecated');
    });
  });

  describe('GET /api/prs', () => {
    it('should return PR list', async () => {
      // Mock gh CLI to return empty PR list
      vi.mocked(execSync).mockImplementation((cmd: string) => {
        if (cmd.includes('gh pr list')) {
          return '[]';
        }
        if (cmd.includes('git rev-parse')) {
          return 'true';
        }
        if (cmd.includes('which gh')) {
          return '/usr/bin/gh';
        }
        return '';
      });

      const response = await request(app).get('/api/prs');

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });
  });

  describe('GET /api/logs/:name', () => {
    it('should return executor log lines', async () => {
      const response = await request(app).get('/api/logs/executor');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('name', 'executor');
      expect(response.body).toHaveProperty('lines');
      expect(Array.isArray(response.body.lines)).toBe(true);
      expect(response.body.lines).toContain('Executor log line 1');
      expect(response.body.lines).toContain('Executor log line 3');
    });

    it('should return reviewer log lines', async () => {
      const response = await request(app).get('/api/logs/reviewer');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('name', 'reviewer');
      expect(response.body.lines).toContain('Reviewer log line 1');
    });

    it('should respect lines query parameter', async () => {
      const response = await request(app).get('/api/logs/executor?lines=2');

      expect(response.status).toBe(200);
      expect(response.body.lines).toHaveLength(2);
      expect(response.body.lines).not.toContain('Executor log line 1');
      expect(response.body.lines).toContain('Executor log line 3');
    });

    it('should return 400 for invalid log name', async () => {
      const response = await request(app).get('/api/logs/invalid');

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toContain('Invalid log name');
    });
  });

  describe('GET /api/config', () => {
    it('should return current config', async () => {
      const response = await request(app).get('/api/config');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('provider', 'claude');
      expect(response.body).toHaveProperty('reviewerEnabled', true);
      expect(response.body).toHaveProperty('maxRuntime', 7200);
    });
  });

  describe('PUT /api/config', () => {
    it('should update and return config', async () => {
      const response = await request(app).put('/api/config').send({ provider: 'codex' });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('provider', 'codex');
    });

    it('should validate provider', async () => {
      const response = await request(app).put('/api/config').send({ provider: 'invalid' });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
    });

    it('should validate reviewerEnabled is boolean', async () => {
      const response = await request(app).put('/api/config').send({ reviewerEnabled: 'true' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('boolean');
    });

    it('should validate maxRuntime is number >= 60', async () => {
      const response = await request(app).put('/api/config').send({ maxRuntime: 30 });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('maxRuntime');
    });

    it('should validate minReviewScore is between 0 and 100', async () => {
      const response = await request(app).put('/api/config').send({ minReviewScore: 150 });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('minReviewScore');
    });

    it('should validate branchPatterns is array of strings', async () => {
      const response = await request(app)
        .put('/api/config')
        .send({ branchPatterns: 'not-an-array' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('branchPatterns');
    });

    it('should validate prdPriority is array of strings', async () => {
      const response = await request(app)
        .put('/api/config')
        .send({ prdPriority: ['phase1', 123] });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('prdPriority');
    });

    it('should validate cronSchedule is non-empty string', async () => {
      const response = await request(app).put('/api/config').send({ cronSchedule: '' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('cronSchedule');
    });

    it('should validate reviewerSchedule is non-empty string', async () => {
      const response = await request(app).put('/api/config').send({ reviewerSchedule: '' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('reviewerSchedule');
    });

    it('should reject invalid request body', async () => {
      const response = await request(app).put('/api/config').send('not an object');

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
    });

    it('should validate webhook configuration', async () => {
      const response = await request(app)
        .put('/api/config')
        .send({
          notifications: {
            webhooks: [
              {
                type: 'slack',
                url: 'https://invalid-url.com',
                events: ['run_succeeded'],
              },
            ],
          },
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('webhook');
    });

    it('should accept valid webhook configuration', async () => {
      const response = await request(app)
        .put('/api/config')
        .send({
          notifications: {
            webhooks: [
              {
                type: 'slack',
                url: 'https://hooks.slack.com/services/ABC/123/xyz',
                events: ['run_succeeded', 'run_failed'],
              },
            ],
          },
        });

      expect(response.status).toBe(200);
    });
  });

  describe('GET /api/doctor', () => {
    it('should return health check results', async () => {
      const response = await request(app).get('/api/doctor');

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThan(0);
    });

    it('should include git check', async () => {
      const response = await request(app).get('/api/doctor');

      expect(response.status).toBe(200);
      const gitCheck = response.body.find((c: any) => c.name === 'git');
      expect(gitCheck).toBeDefined();
      expect(gitCheck.status).toBe('pass');
    });

    it('should include provider check', async () => {
      const response = await request(app).get('/api/doctor');

      expect(response.status).toBe(200);
      const providerCheck = response.body.find((c: any) => c.name === 'provider');
      expect(providerCheck).toBeDefined();
      expect(providerCheck.status).toBe('pass');
    });

    it('should include config check', async () => {
      const response = await request(app).get('/api/doctor');

      expect(response.status).toBe(200);
      const configCheck = response.body.find((c: any) => c.name === 'config');
      expect(configCheck).toBeDefined();
      expect(configCheck.status).toBe('pass');
    });

    it('should include prdDir check', async () => {
      const response = await request(app).get('/api/doctor');

      expect(response.status).toBe(200);
      const prdDirCheck = response.body.find((c: any) => c.name === 'prdDir');
      expect(prdDirCheck).toBeDefined();
      expect(prdDirCheck.status).toBe('pass');
    });

    it('should include crontab check', async () => {
      const response = await request(app).get('/api/doctor');

      expect(response.status).toBe(200);
      const crontabCheck = response.body.find((c: any) => c.name === 'crontab');
      expect(crontabCheck).toBeDefined();
    });
  });

  describe('POST /api/actions/run', () => {
    it('should spawn executor process', async () => {
      const response = await request(app).post('/api/actions/run');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('started', true);
      expect(response.body).toHaveProperty('pid');
      expect(spawn).toHaveBeenCalledWith(
        'night-watch',
        ['run'],
        expect.objectContaining({
          detached: true,
          stdio: 'ignore',
        }),
      );
    });
  });

  describe('POST /api/actions/review', () => {
    it('should spawn reviewer process', async () => {
      const response = await request(app).post('/api/actions/review');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('started', true);
      expect(response.body).toHaveProperty('pid');
      expect(spawn).toHaveBeenCalledWith(
        'night-watch',
        ['review'],
        expect.objectContaining({
          detached: true,
          stdio: 'ignore',
        }),
      );
    });
  });

  describe('POST /api/actions/install-cron', () => {
    it('should spawn install process', async () => {
      const response = await request(app).post('/api/actions/install-cron');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('started', true);
      expect(spawn).toHaveBeenCalledWith(
        'night-watch',
        ['install'],
        expect.objectContaining({
          detached: true,
          stdio: 'ignore',
        }),
      );
    });
  });

  describe('POST /api/actions/uninstall-cron', () => {
    it('should spawn uninstall process', async () => {
      const response = await request(app).post('/api/actions/uninstall-cron');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('started', true);
      expect(spawn).toHaveBeenCalledWith(
        'night-watch',
        ['uninstall'],
        expect.objectContaining({
          detached: true,
          stdio: 'ignore',
        }),
      );
    });
  });

  describe('POST /api/actions/cancel', () => {
    it('should cancel all processes when no type specified', async () => {
      const response = await request(app).post('/api/actions/cancel').send({});

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('results');
      expect(Array.isArray(response.body.results)).toBe(true);
    });

    it('should cancel executor when type is run', async () => {
      const response = await request(app).post('/api/actions/cancel').send({ type: 'run' });

      expect(response.status).toBe(200);
      expect(response.body.results).toHaveLength(1);
      expect(response.body.results[0].success).toBe(true);
    });

    it('should cancel reviewer when type is review', async () => {
      const response = await request(app).post('/api/actions/cancel').send({ type: 'review' });

      expect(response.status).toBe(200);
      expect(response.body.results).toHaveLength(1);
      expect(response.body.results[0].success).toBe(true);
    });

    it('should return 400 for invalid type', async () => {
      const response = await request(app).post('/api/actions/cancel').send({ type: 'invalid' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Invalid type');
    });
  });

  describe('POST /api/actions/retry', () => {
    it('should move a done PRD back to pending', async () => {
      const prdDir = path.join(tempDir, 'docs', 'PRDs', 'night-watch');

      // Verify phase0.md is in done/ before retry
      expect(fs.existsSync(path.join(prdDir, 'done', 'phase0.md'))).toBe(true);
      expect(fs.existsSync(path.join(prdDir, 'phase0.md'))).toBe(false);

      const response = await request(app).post('/api/actions/retry').send({ prdName: 'phase0' });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('message');
      expect(response.body.message).toContain('phase0.md');

      // Verify file was moved
      expect(fs.existsSync(path.join(prdDir, 'phase0.md'))).toBe(true);
      expect(fs.existsSync(path.join(prdDir, 'done', 'phase0.md'))).toBe(false);
    });

    it('should work with .md extension in prdName', async () => {
      const prdDir = path.join(tempDir, 'docs', 'PRDs', 'night-watch');
      const response = await request(app).post('/api/actions/retry').send({ prdName: 'phase0.md' });

      expect(response.status).toBe(200);
      expect(fs.existsSync(path.join(prdDir, 'phase0.md'))).toBe(true);
    });

    it('should return message when PRD is already pending', async () => {
      const response = await request(app).post('/api/actions/retry').send({ prdName: 'phase1' });

      expect(response.status).toBe(200);
      expect(response.body.message).toContain('already pending');
    });

    it('should return 404 for PRD not found in done/', async () => {
      const response = await request(app)
        .post('/api/actions/retry')
        .send({ prdName: 'nonexistent' });

      expect(response.status).toBe(404);
      expect(response.body.error).toContain('not found in done/');
    });

    it('should return 400 when prdName is missing', async () => {
      const response = await request(app).post('/api/actions/retry').send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('prdName is required');
    });

    it('should return 400 for invalid PRD name', async () => {
      const response = await request(app)
        .post('/api/actions/retry')
        .send({ prdName: '../etc/passwd' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Invalid PRD name');
    });
  });

  describe('Board endpoints', () => {
    const boardIssue = {
      id: 'issue-node-1',
      number: 10,
      title: 'Test Issue',
      body: 'Issue body',
      url: 'https://github.com/owner/repo/issues/10',
      column: 'Ready' as const,
      labels: [],
      assignees: [],
    };

    describe('when board is not configured', () => {
      it('GET /api/board/status returns 404', async () => {
        const response = await request(app).get('/api/board/status');
        expect(response.status).toBe(404);
        expect(response.body.error).toBe('Board not configured');
      });

      it('GET /api/board/issues returns 404', async () => {
        const response = await request(app).get('/api/board/issues');
        expect(response.status).toBe(404);
        expect(response.body.error).toBe('Board not configured');
      });
    });

    describe('when board is configured', () => {
      beforeEach(() => {
        // Write config with boardProvider set
        const configWithBoard = {
          projectName: 'test-project',
          defaultBranch: 'main',
          provider: 'claude',
          reviewerEnabled: true,
          prdDirectory: 'docs/PRDs/night-watch',
          maxRuntime: 7200,
          reviewerMaxRuntime: 3600,
          cron: {
            executorSchedule: '0 0-21 * * *',
            reviewerSchedule: '0 0,3,6,9,12,15,18,21 * * *',
          },
          review: {
            minScore: 80,
            branchPatterns: ['feat/', 'night-watch/'],
          },
          logging: { maxLogSize: 524288 },
          boardProvider: { enabled: true, provider: 'github', projectNumber: 6 },
        };
        fs.writeFileSync(
          path.join(tempDir, 'night-watch.config.json'),
          JSON.stringify(configWithBoard, null, 2),
        );
        app = createApp(tempDir);

        vi.mocked(mockBoardProvider.getAllIssues).mockReset();
        vi.mocked(mockBoardProvider.createIssue).mockReset();
        vi.mocked(mockBoardProvider.moveIssue).mockReset();
        vi.mocked(mockBoardProvider.closeIssue).mockReset();
        vi.mocked(mockBoardProvider.commentOnIssue).mockReset();
      });

      it('GET /api/board/status returns grouped issues', async () => {
        vi.mocked(mockBoardProvider.getAllIssues).mockResolvedValue([boardIssue]);
        const response = await request(app).get('/api/board/status');
        expect(response.status).toBe(200);
        expect(response.body.enabled).toBe(true);
        expect(response.body.columns.Ready).toHaveLength(1);
        expect(response.body.columns.Ready[0].number).toBe(10);
        expect(response.body.columns.Draft).toHaveLength(0);
      });

      it('GET /api/board/issues returns flat list', async () => {
        vi.mocked(mockBoardProvider.getAllIssues).mockResolvedValue([boardIssue]);
        const response = await request(app).get('/api/board/issues');
        expect(response.status).toBe(200);
        expect(response.body).toHaveLength(1);
        expect(response.body[0].number).toBe(10);
      });

      it('POST /api/board/issues creates an issue', async () => {
        vi.mocked(mockBoardProvider.createIssue).mockResolvedValue(boardIssue);
        const response = await request(app)
          .post('/api/board/issues')
          .send({ title: 'New Issue', body: 'Body text', column: 'Ready' });
        expect(response.status).toBe(201);
        expect(response.body.number).toBe(10);
      });

      it('POST /api/board/issues returns 400 without title', async () => {
        const response = await request(app).post('/api/board/issues').send({ body: 'Body text' });
        expect(response.status).toBe(400);
        expect(response.body.error).toContain('title is required');
      });

      it('POST /api/board/issues returns 400 for invalid column', async () => {
        const response = await request(app)
          .post('/api/board/issues')
          .send({ title: 'Test', column: 'InvalidColumn' });
        expect(response.status).toBe(400);
        expect(response.body.error).toContain('Invalid column');
      });

      it('PATCH /api/board/issues/:number/move moves issue', async () => {
        vi.mocked(mockBoardProvider.moveIssue).mockResolvedValue(undefined);
        const response = await request(app)
          .patch('/api/board/issues/10/move')
          .send({ column: 'In Progress' });
        expect(response.status).toBe(200);
        expect(response.body.moved).toBe(true);
        expect(mockBoardProvider.moveIssue).toHaveBeenCalledWith(10, 'In Progress');
      });

      it('PATCH /api/board/issues/:number/move returns 400 for invalid column', async () => {
        const response = await request(app)
          .patch('/api/board/issues/10/move')
          .send({ column: 'Bogus' });
        expect(response.status).toBe(400);
        expect(response.body.error).toContain('Invalid column');
      });

      it('POST /api/board/issues/:number/comment adds a comment', async () => {
        vi.mocked(mockBoardProvider.commentOnIssue).mockResolvedValue(undefined);
        const response = await request(app)
          .post('/api/board/issues/10/comment')
          .send({ body: 'Great progress!' });
        expect(response.status).toBe(200);
        expect(response.body.commented).toBe(true);
        expect(mockBoardProvider.commentOnIssue).toHaveBeenCalledWith(10, 'Great progress!');
      });

      it('POST /api/board/issues/:number/comment returns 400 without body', async () => {
        const response = await request(app).post('/api/board/issues/10/comment').send({});
        expect(response.status).toBe(400);
        expect(response.body.error).toContain('body is required');
      });

      it('DELETE /api/board/issues/:number closes issue', async () => {
        vi.mocked(mockBoardProvider.closeIssue).mockResolvedValue(undefined);
        const response = await request(app).delete('/api/board/issues/10');
        expect(response.status).toBe(200);
        expect(response.body.closed).toBe(true);
        expect(mockBoardProvider.closeIssue).toHaveBeenCalledWith(10);
      });
    });
  });
});
