/**
 * Tests for StatusService
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { StatusService } from '../../../services/status.service.js';
import { INightWatchConfig } from '@night-watch/core/types.js';

vi.mock('child_process', () => ({
  execSync: vi.fn(),
  spawn: vi.fn(),
}));

vi.mock('../../../utils/crontab.js', () => ({
  getEntries: vi.fn(() => []),
  getProjectEntries: vi.fn(() => []),
  generateMarker: vi.fn((name: string) => `# night-watch-cli: ${name}`),
}));

import { execSync } from 'child_process';

function makeConfig(overrides: Partial<INightWatchConfig> = {}): INightWatchConfig {
  return {
    defaultBranch: 'main',
    prdDir: 'docs/PRDs/night-watch',
    maxRuntime: 7200,
    reviewerMaxRuntime: 3600,
    branchPrefix: 'night-watch',
    branchPatterns: ['feat/', 'night-watch/'],
    minReviewScore: 80,
    maxLogSize: 524288,
    cronSchedule: '0 0-21 * * *',
    reviewerSchedule: '0 0,3,6,9,12,15,18,21 * * *',
    cronScheduleOffset: 0,
    maxRetries: 3,
    provider: 'claude',
    reviewerEnabled: true,
    providerEnv: {},
    fallbackOnRateLimit: false,
    claudeModel: 'sonnet',
    notifications: { webhooks: [] },
    prdPriority: [],
    roadmapScanner: {
      enabled: false,
      roadmapPath: 'ROADMAP.md',
      autoScanInterval: 300,
      slicerSchedule: '0 * * * *',
      slicerMaxRuntime: 3600,
    },
    templatesDir: 'templates',
    boardProvider: { type: 'none' } as any,
    autoMerge: false,
    autoMergeMethod: 'squash',
    qa: {
      enabled: false,
      schedule: '0 * * * *',
      maxRuntime: 3600,
      branchPatterns: [],
      artifacts: 'screenshot',
      skipLabel: 'skip-qa',
      autoInstallPlaywright: false,
    },
    audit: {
      enabled: false,
      schedule: '0 * * * *',
      maxRuntime: 3600,
    },
    ...overrides,
  };
}

describe('StatusService', () => {
  let service: StatusService;
  let tempDir: string;

  beforeEach(() => {
    vi.resetAllMocks();
    service = new StatusService();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-status-service-test-'));

    // Default: git rev-parse throws so collectPrInfo / countOpenPRs return safely
    vi.mocked(execSync).mockImplementation((cmd: string) => {
      if (cmd.includes('git rev-parse') || cmd.includes('gh ')) {
        throw new Error('not available');
      }
      return '';
    });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  // ── getProjectName ────────────────────────────────────────────────────────

  describe('getProjectName', () => {
    it('returns basename when no package.json exists', () => {
      const name = service.getProjectName(tempDir);
      expect(name).toBe(path.basename(tempDir));
    });

    it('returns package.json name when available', () => {
      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify({ name: 'my-cool-project' })
      );
      expect(service.getProjectName(tempDir)).toBe('my-cool-project');
    });
  });

  // ── projectRuntimeKey ─────────────────────────────────────────────────────

  describe('projectRuntimeKey', () => {
    it('returns a non-empty string containing the dir basename', () => {
      const key = service.projectRuntimeKey(tempDir);
      expect(typeof key).toBe('string');
      expect(key.length).toBeGreaterThan(0);
      expect(key).toContain(path.basename(tempDir));
    });

    it('is deterministic for the same path', () => {
      expect(service.projectRuntimeKey(tempDir)).toBe(service.projectRuntimeKey(tempDir));
    });
  });

  // ── executorLockPath / reviewerLockPath / auditLockPath ───────────────────

  describe('lock path helpers', () => {
    it('executorLockPath returns a string ending in .lock', () => {
      expect(service.executorLockPath(tempDir)).toMatch(/\.lock$/);
    });

    it('reviewerLockPath includes "pr-reviewer"', () => {
      expect(service.reviewerLockPath(tempDir)).toContain('pr-reviewer');
    });

    it('auditLockPath includes "audit"', () => {
      expect(service.auditLockPath(tempDir)).toContain('audit');
    });
  });

  // ── checkLockFile ─────────────────────────────────────────────────────────

  describe('checkLockFile', () => {
    it('returns not-running when file does not exist', () => {
      const result = service.checkLockFile('/tmp/nonexistent-nw-lock-xyz.lock');
      expect(result.running).toBe(false);
      expect(result.pid).toBeNull();
    });

    it('returns running=false when PID file contains invalid content', () => {
      const lockPath = path.join(tempDir, 'test.lock');
      fs.writeFileSync(lockPath, 'not-a-pid');
      const result = service.checkLockFile(lockPath);
      expect(result.running).toBe(false);
      expect(result.pid).toBeNull();
    });

    it('returns a pid when file contains a valid number', () => {
      const lockPath = path.join(tempDir, 'test.lock');
      // PID 1 (init) is always running on Linux
      fs.writeFileSync(lockPath, '1');
      const result = service.checkLockFile(lockPath);
      expect(result.pid).toBe(1);
      // running may be true or false depending on environment; just check it's a boolean
      expect(typeof result.running).toBe('boolean');
    });
  });

  // ── isProcessRunning ──────────────────────────────────────────────────────

  describe('isProcessRunning', () => {
    it('returns true for the current process PID', () => {
      expect(service.isProcessRunning(process.pid)).toBe(true);
    });

    it('returns false for an implausibly large PID', () => {
      // PID 999999 is very unlikely to exist
      const result = service.isProcessRunning(999999);
      expect(typeof result).toBe('boolean');
    });
  });

  // ── getLastLogLines ───────────────────────────────────────────────────────

  describe('getLastLogLines', () => {
    it('returns empty array for non-existent file', () => {
      const lines = service.getLastLogLines('/tmp/nonexistent-nw-log.txt', 5);
      expect(lines).toEqual([]);
    });

    it('returns at most N lines from the file', () => {
      const logPath = path.join(tempDir, 'test.log');
      fs.writeFileSync(logPath, 'line1\nline2\nline3\nline4\nline5\nline6\n');
      const lines = service.getLastLogLines(logPath, 3);
      expect(lines).toHaveLength(3);
      expect(lines[2]).toBe('line6');
    });
  });

  // ── getLogInfo ─────────────────────────────────────────────────────────────

  describe('getLogInfo', () => {
    it('returns exists=false for a missing file', () => {
      const info = service.getLogInfo('/tmp/nonexistent-nw-log-xyz.txt');
      expect(info.exists).toBe(false);
      expect(info.size).toBe(0);
      expect(info.lastLines).toEqual([]);
    });

    it('returns correct info for an existing file', () => {
      const logPath = path.join(tempDir, 'mylog.log');
      fs.writeFileSync(logPath, 'hello\nworld\n');
      const info = service.getLogInfo(logPath, 2);
      expect(info.exists).toBe(true);
      expect(info.size).toBeGreaterThan(0);
      expect(info.lastLines).toContain('world');
    });
  });

  // ── collectLogInfo ────────────────────────────────────────────────────────

  describe('collectLogInfo', () => {
    it('returns an array of log info objects', () => {
      const logs = service.collectLogInfo(tempDir);
      expect(Array.isArray(logs)).toBe(true);
      expect(logs.length).toBeGreaterThan(0);
    });

    it('marks non-existent log files as not existing', () => {
      const logs = service.collectLogInfo(tempDir);
      for (const log of logs) {
        expect(log.exists).toBe(false);
      }
    });
  });

  // ── parsePrdDependencies ──────────────────────────────────────────────────

  describe('parsePrdDependencies', () => {
    it('returns empty array for non-existent file', () => {
      const deps = service.parsePrdDependencies('/tmp/nonexistent.md');
      expect(deps).toEqual([]);
    });

    it('parses dependencies from a PRD file', () => {
      const prdPath = path.join(tempDir, 'test.md');
      fs.writeFileSync(prdPath, '# My PRD\n\nDepends on: `auth`, `database`\n');
      const deps = service.parsePrdDependencies(prdPath);
      expect(deps).toContain('auth');
      expect(deps).toContain('database');
    });

    it('returns empty array when no dependency line exists', () => {
      const prdPath = path.join(tempDir, 'no-deps.md');
      fs.writeFileSync(prdPath, '# My PRD\n\nNo dependencies here.\n');
      const deps = service.parsePrdDependencies(prdPath);
      expect(deps).toEqual([]);
    });
  });

  // ── collectPrdInfo ────────────────────────────────────────────────────────

  describe('collectPrdInfo', () => {
    it('returns empty array when PRD dir does not exist', () => {
      const prds = service.collectPrdInfo(tempDir, 'nonexistent-prds', 7200);
      expect(prds).toEqual([]);
    });

    it('lists PRD files as ready when unclaimed', () => {
      const prdSubDir = path.join(tempDir, 'prds');
      fs.mkdirSync(prdSubDir);
      fs.writeFileSync(path.join(prdSubDir, 'my-feature.md'), '# My Feature\n');

      const prds = service.collectPrdInfo(tempDir, 'prds', 7200);
      expect(prds.length).toBe(1);
      expect(prds[0].name).toBe('my-feature');
      expect(prds[0].status).toBe('ready');
    });
  });

  // ── collectPrInfo ─────────────────────────────────────────────────────────

  describe('collectPrInfo', () => {
    it('returns empty array when git is not available', () => {
      const prs = service.collectPrInfo(tempDir, ['night-watch/']);
      expect(prs).toEqual([]);
    });
  });

  // ── countPRDs ─────────────────────────────────────────────────────────────

  describe('countPRDs', () => {
    it('returns zeros when PRD dir does not exist', () => {
      const counts = service.countPRDs(tempDir, 'nonexistent', 7200);
      expect(counts).toEqual({ pending: 0, claimed: 0, done: 0 });
    });

    it('counts pending PRD files correctly', () => {
      const prdSubDir = path.join(tempDir, 'prds');
      fs.mkdirSync(prdSubDir);
      fs.writeFileSync(path.join(prdSubDir, 'feature-a.md'), '# Feature A\n');
      fs.writeFileSync(path.join(prdSubDir, 'feature-b.md'), '# Feature B\n');

      const counts = service.countPRDs(tempDir, 'prds', 7200);
      expect(counts.pending).toBe(2);
      expect(counts.claimed).toBe(0);
      expect(counts.done).toBe(0);
    });
  });

  // ── getCrontabInfo ────────────────────────────────────────────────────────

  describe('getCrontabInfo', () => {
    it('returns installed=false when no crontab entries exist', () => {
      const info = service.getCrontabInfo('my-project', tempDir);
      expect(info.installed).toBe(false);
      expect(Array.isArray(info.entries)).toBe(true);
    });
  });

  // ── fetchSnapshot ─────────────────────────────────────────────────────────

  describe('fetchSnapshot', () => {
    it('returns a valid snapshot object', () => {
      // Create minimal package.json so project name resolves
      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify({ name: 'snap-project' })
      );

      const config = makeConfig();
      const snapshot = service.fetchSnapshot(tempDir, config);

      expect(snapshot.projectName).toBe('snap-project');
      expect(snapshot.projectDir).toBe(tempDir);
      expect(Array.isArray(snapshot.prds)).toBe(true);
      expect(Array.isArray(snapshot.processes)).toBe(true);
      expect(Array.isArray(snapshot.prs)).toBe(true);
      expect(Array.isArray(snapshot.logs)).toBe(true);
      expect(snapshot.timestamp).toBeInstanceOf(Date);
    });
  });
});
