/**
 * Tests for status data layer utilities
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// exec is callback-based; promisify wraps it to call the last arg as a callback.
// We mock it so tests can control its behavior by setting mockExecImpl.
let mockExecImpl: (cmd: string) => string = () => '';
vi.mock('child_process', () => ({
  exec: vi.fn(
    (
      cmd: string,
      _optsOrCb: unknown,
      cb?: (err: Error | null, result: { stdout: string; stderr: string }) => void,
    ) => {
      // Handle both exec(cmd, cb) and exec(cmd, opts, cb) signatures
      const callback =
        typeof _optsOrCb === 'function'
          ? (_optsOrCb as (err: Error | null, result: { stdout: string; stderr: string }) => void)
          : cb!;
      try {
        const result = mockExecImpl(cmd);
        callback(null, { stdout: result, stderr: '' });
      } catch (err) {
        callback(err instanceof Error ? err : new Error(String(err)), { stdout: '', stderr: '' });
      }
    },
  ),
  spawn: vi.fn(),
}));

vi.mock('../../utils/crontab.js', () => ({
  getEntries: vi.fn(() => []),
  getProjectEntries: vi.fn(() => []),
  generateMarker: vi.fn((name: string) => `# night-watch-cli: ${name}`),
}));

import { exec } from 'child_process';
import { getEntries, getProjectEntries } from '../../utils/crontab.js';
import {
  acquireLock,
  auditLockPath,
  checkLockFile,
  collectLogInfo,
  collectPrdInfo,
  collectPrInfo,
  countOpenPRs,
  countPRDs,
  executorLockPath,
  fetchStatusSnapshot,
  getCrontabInfo,
  getLastLogLines,
  getLogInfo,
  getProjectName,
  isProcessRunning,
  parsePrdDependencies,
  plannerLockPath,
  projectRuntimeKey,
  qaLockPath,
  releaseLock,
  reviewerLockPath,
} from '../../utils/status-data.js';
import { INightWatchConfig } from '../../types.js';

function makeConfig(overrides: Partial<INightWatchConfig> = {}): INightWatchConfig {
  return {
    defaultBranch: 'main',
    prdDir: 'docs/prds',
    maxRuntime: 7200,
    reviewerMaxRuntime: 3600,
    branchPrefix: 'night-watch',
    branchPatterns: ['feat/', 'night-watch/'],
    minReviewScore: 80,
    maxLogSize: 524288,
    cronSchedule: '0 0-21 * * *',
    reviewerSchedule: '0 0,3,6,9,12,15,18,21 * * *',
    provider: 'claude',
    reviewerEnabled: true,
    providerEnv: {},
    notifications: { webhooks: [] },
    ...overrides,
  };
}

describe('status-data utilities', () => {
  let tempDir: string;

  beforeEach(() => {
    vi.resetAllMocks();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'night-watch-status-data-test-'));

    // Default: exec fails for git/gh commands (simulates non-git-repo)
    mockExecImpl = (cmd: string) => {
      if (cmd.includes('git rev-parse')) {
        throw new Error('not a git repo');
      }
      return '';
    };

    // Re-wire the vi.fn() to use the current mockExecImpl
    vi.mocked(exec).mockImplementation(
      (
        cmd: string,
        _optsOrCb: unknown,
        cb?: (err: Error | null, result: { stdout: string; stderr: string }) => void,
      ) => {
        const callback =
          typeof _optsOrCb === 'function'
            ? (_optsOrCb as (err: Error | null, result: { stdout: string; stderr: string }) => void)
            : cb!;
        try {
          const result = mockExecImpl(cmd);
          callback(null, { stdout: result, stderr: '' });
        } catch (err) {
          callback(err instanceof Error ? err : new Error(String(err)), { stdout: '', stderr: '' });
        }
      },
    );

    vi.mocked(getEntries).mockReturnValue([]);
    vi.mocked(getProjectEntries).mockReturnValue([]);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  describe('getProjectName', () => {
    it('should return name from package.json', async () => {
      fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({ name: 'my-project' }));
      expect(getProjectName(tempDir)).toBe('my-project');
    });

    it('should fall back to directory name if no package.json', async () => {
      expect(getProjectName(tempDir)).toBe(path.basename(tempDir));
    });

    it('should fall back to directory name if package.json has no name', async () => {
      fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({ version: '1.0.0' }));
      expect(getProjectName(tempDir)).toBe(path.basename(tempDir));
    });

    it('should fall back to directory name if package.json is invalid', async () => {
      fs.writeFileSync(path.join(tempDir, 'package.json'), 'not json');
      expect(getProjectName(tempDir)).toBe(path.basename(tempDir));
    });
  });

  describe('isProcessRunning', () => {
    it('should return true when process exists', async () => {
      const originalKill = process.kill;
      (process as any).kill = vi.fn().mockReturnValue(true);
      try {
        expect(isProcessRunning(12345)).toBe(true);
      } finally {
        (process as any).kill = originalKill;
      }
    });

    it('should return false when process does not exist', async () => {
      const originalKill = process.kill;
      (process as any).kill = vi.fn().mockImplementation(() => {
        throw new Error('ESRCH');
      });
      try {
        expect(isProcessRunning(99999)).toBe(false);
      } finally {
        (process as any).kill = originalKill;
      }
    });
  });

  describe('checkLockFile', () => {
    it('should return not running when lock file does not exist', async () => {
      const result = checkLockFile('/tmp/nonexistent-lock-file.lock');
      expect(result).toEqual({ running: false, pid: null });
    });

    it('should detect a running process from lock file', async () => {
      const lockPath = path.join(tempDir, 'test.lock');
      fs.writeFileSync(lockPath, '12345');

      const originalKill = process.kill;
      (process as any).kill = vi.fn().mockReturnValue(true);
      try {
        const result = checkLockFile(lockPath);
        expect(result.running).toBe(true);
        expect(result.pid).toBe(12345);
      } finally {
        (process as any).kill = originalKill;
      }
    });

    it('should detect a stopped process from lock file', async () => {
      const lockPath = path.join(tempDir, 'test.lock');
      fs.writeFileSync(lockPath, '99999');

      const originalKill = process.kill;
      (process as any).kill = vi.fn().mockImplementation(() => {
        throw new Error('ESRCH');
      });
      try {
        const result = checkLockFile(lockPath);
        expect(result.running).toBe(false);
        expect(result.pid).toBe(99999);
      } finally {
        (process as any).kill = originalKill;
      }
    });

    it('should handle invalid PID in lock file', async () => {
      const lockPath = path.join(tempDir, 'test.lock');
      fs.writeFileSync(lockPath, 'not-a-number');

      const result = checkLockFile(lockPath);
      expect(result).toEqual({ running: false, pid: null });
    });
  });

  describe('projectRuntimeKey', () => {
    it('should return basename-hash format', async () => {
      const key = projectRuntimeKey('/home/user/projects/my-project');
      expect(key).toMatch(/^my-project-[a-f0-9]{12}$/);
    });

    it('should produce different keys for different paths with same basename', async () => {
      const key1 = projectRuntimeKey('/home/user1/my-project');
      const key2 = projectRuntimeKey('/home/user2/my-project');
      expect(key1).not.toBe(key2);
      expect(key1.startsWith('my-project-')).toBe(true);
      expect(key2.startsWith('my-project-')).toBe(true);
    });

    it('should produce stable keys for the same path', async () => {
      const key1 = projectRuntimeKey('/home/user/projects/my-project');
      const key2 = projectRuntimeKey('/home/user/projects/my-project');
      expect(key1).toBe(key2);
    });
  });

  describe('lock path helpers', () => {
    it('should use runtime key in executor lock path', async () => {
      const lockPath = executorLockPath('/home/user/my-project');
      expect(lockPath).toMatch(/^\/tmp\/night-watch-my-project-[a-f0-9]{12}\.lock$/);
    });

    it('should use runtime key in reviewer lock path', async () => {
      const lockPath = reviewerLockPath('/home/user/my-project');
      expect(lockPath).toMatch(/^\/tmp\/night-watch-pr-reviewer-my-project-[a-f0-9]{12}\.lock$/);
    });

    it('should use runtime key in qa lock path', async () => {
      const lockPath = qaLockPath('/home/user/my-project');
      expect(lockPath).toMatch(/^\/tmp\/night-watch-qa-my-project-[a-f0-9]{12}\.lock$/);
    });

    it('should use runtime key in audit lock path', async () => {
      const lockPath = auditLockPath('/home/user/my-project');
      expect(lockPath).toMatch(/^\/tmp\/night-watch-audit-my-project-[a-f0-9]{12}\.lock$/);
    });

    it('should use runtime key in planner lock path', async () => {
      const lockPath = plannerLockPath('/home/user/my-project');
      expect(lockPath).toMatch(/^\/tmp\/night-watch-slicer-my-project-[a-f0-9]{12}\.lock$/);
    });
  });

  describe('countPRDs', () => {
    it('should return zeros when PRD directory does not exist', async () => {
      const result = countPRDs(tempDir, 'docs/prds', 7200);
      expect(result).toEqual({ pending: 0, claimed: 0, done: 0 });
    });

    it('should count pending and done PRDs', async () => {
      const prdDir = path.join(tempDir, 'docs', 'prds');
      fs.mkdirSync(prdDir, { recursive: true });
      fs.mkdirSync(path.join(prdDir, 'done'), { recursive: true });

      fs.writeFileSync(path.join(prdDir, 'phase1.md'), '# Phase 1');
      fs.writeFileSync(path.join(prdDir, 'phase2.md'), '# Phase 2');
      fs.writeFileSync(path.join(prdDir, 'done', 'phase0.md'), '# Phase 0');

      const result = countPRDs(tempDir, 'docs/prds', 7200);
      expect(result.pending).toBe(2);
      expect(result.claimed).toBe(0);
      expect(result.done).toBe(1);
    });

    it('should count claimed PRDs separately', async () => {
      const prdDir = path.join(tempDir, 'docs', 'prds');
      fs.mkdirSync(prdDir, { recursive: true });

      fs.writeFileSync(path.join(prdDir, 'phase1.md'), '# Phase 1');
      fs.writeFileSync(path.join(prdDir, 'phase2.md'), '# Phase 2');

      // Active claim for phase1
      fs.writeFileSync(
        path.join(prdDir, 'phase1.md.claim'),
        JSON.stringify({ timestamp: Math.floor(Date.now() / 1000), hostname: 'test', pid: 1234 }),
      );

      const result = countPRDs(tempDir, 'docs/prds', 7200);
      expect(result.pending).toBe(1);
      expect(result.claimed).toBe(1);
    });

    it('should treat expired claims as pending', async () => {
      const prdDir = path.join(tempDir, 'docs', 'prds');
      fs.mkdirSync(prdDir, { recursive: true });

      fs.writeFileSync(path.join(prdDir, 'phase1.md'), '# Phase 1');
      // Old claim (timestamp older than maxRuntime)
      fs.writeFileSync(
        path.join(prdDir, 'phase1.md.claim'),
        JSON.stringify({
          timestamp: Math.floor(Date.now() / 1000) - 10000,
          hostname: 'test',
          pid: 1234,
        }),
      );

      const result = countPRDs(tempDir, 'docs/prds', 7200);
      expect(result.pending).toBe(1);
      expect(result.claimed).toBe(0);
    });
  });

  describe('collectPrdInfo', () => {
    it('should return empty array when PRD directory does not exist', async () => {
      const result = collectPrdInfo(tempDir, 'docs/prds', 7200);
      expect(result).toEqual([]);
    });

    it('should collect PRD info with correct statuses', async () => {
      const prdDir = path.join(tempDir, 'docs', 'prds');
      fs.mkdirSync(prdDir, { recursive: true });
      fs.mkdirSync(path.join(prdDir, 'done'), { recursive: true });

      fs.writeFileSync(path.join(prdDir, 'phase1.md'), '# Phase 1');
      fs.writeFileSync(path.join(prdDir, 'phase2.md'), '# Phase 2');
      fs.writeFileSync(path.join(prdDir, 'done', 'phase0.md'), '# Phase 0');

      // Active claim for phase1
      fs.writeFileSync(
        path.join(prdDir, 'phase1.md.claim'),
        JSON.stringify({ timestamp: Math.floor(Date.now() / 1000), hostname: 'test', pid: 1234 }),
      );

      // Create executor lock file to simulate running executor
      const lockPath = executorLockPath(tempDir);
      fs.writeFileSync(lockPath, '12345');

      // Mock process.kill to simulate executor running (required for cross-validation)
      const originalKill = process.kill;
      (process as any).kill = vi.fn().mockReturnValue(true);

      try {
        const result = collectPrdInfo(tempDir, 'docs/prds', 7200);
        expect(result).toHaveLength(3);

        const phase0 = result.find((p) => p.name === 'phase0');
        expect(phase0).toBeDefined();
        expect(phase0!.status).toBe('done');

        const phase1 = result.find((p) => p.name === 'phase1');
        expect(phase1).toBeDefined();
        expect(phase1!.status).toBe('in-progress');

        const phase2 = result.find((p) => p.name === 'phase2');
        expect(phase2).toBeDefined();
        expect(phase2!.status).toBe('ready');
      } finally {
        (process as any).kill = originalKill;
        // Clean up lock file
        try {
          fs.unlinkSync(lockPath);
        } catch {
          /* ignore */
        }
      }
    });

    it('marks PRD ready when claim exists but lock is gone', async () => {
      const prdDir = path.join(tempDir, 'docs', 'prds');
      fs.mkdirSync(prdDir, { recursive: true });

      fs.writeFileSync(path.join(prdDir, 'my-prd.md'), '# My PRD');

      // Fresh claim file
      fs.writeFileSync(
        path.join(prdDir, 'my-prd.md.claim'),
        JSON.stringify({ timestamp: Math.floor(Date.now() / 1000), hostname: 'test', pid: 1234 }),
      );

      // Mock process.kill to simulate executor NOT running
      const originalKill = process.kill;
      (process as any).kill = vi.fn().mockImplementation(() => {
        throw new Error('ESRCH');
      });

      try {
        const result = collectPrdInfo(tempDir, 'docs/prds', 7200);
        const myPrd = result.find((p) => p.name === 'my-prd');
        expect(myPrd).toBeDefined();
        expect(myPrd!.status).toBe('ready');
      } finally {
        (process as any).kill = originalKill;
      }
    });

    it('marks PRD in-progress when claim AND lock both exist', async () => {
      const prdDir = path.join(tempDir, 'docs', 'prds');
      fs.mkdirSync(prdDir, { recursive: true });

      fs.writeFileSync(path.join(prdDir, 'my-prd.md'), '# My PRD');

      // Fresh claim file
      fs.writeFileSync(
        path.join(prdDir, 'my-prd.md.claim'),
        JSON.stringify({ timestamp: Math.floor(Date.now() / 1000), hostname: 'test', pid: 1234 }),
      );

      // Create executor lock file to simulate running executor
      const lockPath = executorLockPath(tempDir);
      fs.writeFileSync(lockPath, '12345');

      // Mock process.kill to simulate executor running
      const originalKill = process.kill;
      (process as any).kill = vi.fn().mockReturnValue(true);

      try {
        const result = collectPrdInfo(tempDir, 'docs/prds', 7200);
        const myPrd = result.find((p) => p.name === 'my-prd');
        expect(myPrd).toBeDefined();
        expect(myPrd!.status).toBe('in-progress');
      } finally {
        (process as any).kill = originalKill;
        // Clean up lock file
        try {
          fs.unlinkSync(lockPath);
        } catch {
          /* ignore */
        }
      }
    });

    it('deletes orphaned claim file when lock is gone', async () => {
      const prdDir = path.join(tempDir, 'docs', 'prds');
      fs.mkdirSync(prdDir, { recursive: true });

      fs.writeFileSync(path.join(prdDir, 'my-prd.md'), '# My PRD');

      const claimPath = path.join(prdDir, 'my-prd.md.claim');
      fs.writeFileSync(
        claimPath,
        JSON.stringify({ timestamp: Math.floor(Date.now() / 1000), hostname: 'test', pid: 1234 }),
      );

      // Verify claim exists before calling collectPrdInfo
      expect(fs.existsSync(claimPath)).toBe(true);

      // Mock process.kill to simulate executor NOT running
      const originalKill = process.kill;
      (process as any).kill = vi.fn().mockImplementation(() => {
        throw new Error('ESRCH');
      });

      try {
        collectPrdInfo(tempDir, 'docs/prds', 7200);

        // Claim file should have been deleted
        expect(fs.existsSync(claimPath)).toBe(false);
      } finally {
        (process as any).kill = originalKill;
      }
    });
  });

  describe('countOpenPRs', () => {
    it('should return 0 when not in a git repo', async () => {
      const result = await countOpenPRs(tempDir, ['feat/', 'night-watch/']);
      expect(result).toBe(0);
    });

    it('should return 0 when gh is not available', async () => {
      mockExecImpl = (cmd: string) => {
        if (cmd.includes('git rev-parse')) return '.git';
        if (cmd.includes('which gh')) throw new Error('not found');
        return '';
      };

      const result = await countOpenPRs(tempDir, ['feat/', 'night-watch/']);
      expect(result).toBe(0);
    });

    it('should return 0 when gh pr list returns empty array', async () => {
      mockExecImpl = (cmd: string) => {
        if (cmd.includes('git rev-parse')) return '.git';
        if (cmd.includes('which gh')) return '/usr/bin/gh';
        if (cmd.includes('gh pr list')) {
          return '[]';
        }
        return '';
      };

      const result = await countOpenPRs(tempDir, ['feat/', 'night-watch/']);
      expect(result).toBe(0);
    });

    it('should return 0 when gh pr list returns whitespace-only output', async () => {
      mockExecImpl = (cmd: string) => {
        if (cmd.includes('git rev-parse')) return '.git';
        if (cmd.includes('which gh')) return '/usr/bin/gh';
        if (cmd.includes('gh pr list')) {
          return '   \n  ';
        }
        return '';
      };

      const result = await countOpenPRs(tempDir, ['feat/', 'night-watch/']);
      expect(result).toBe(0);
    });

    it('should count matching PRs', async () => {
      mockExecImpl = (cmd: string) => {
        if (cmd.includes('git rev-parse')) return '.git';
        if (cmd.includes('which gh')) return '/usr/bin/gh';
        if (cmd.includes('gh pr list')) {
          return JSON.stringify([
            { headRefName: 'feat/new-feature', number: 1 },
            { headRefName: 'night-watch/phase-1', number: 2 },
            { headRefName: 'fix/bugfix', number: 3 },
          ]);
        }
        return '';
      };

      const result = await countOpenPRs(tempDir, ['feat/', 'night-watch/']);
      expect(result).toBe(2);
    });
  });

  describe('collectPrInfo', () => {
    it('should return empty array when not in a git repo', async () => {
      const result = await collectPrInfo(tempDir, ['feat/', 'night-watch/']);
      expect(result).toEqual([]);
    });

    it('should return empty array when gh pr list returns empty array', async () => {
      mockExecImpl = (cmd: string) => {
        if (cmd.includes('git rev-parse')) return '.git';
        if (cmd.includes('which gh')) return '/usr/bin/gh';
        if (cmd.includes('gh pr list')) {
          return '[]';
        }
        return '';
      };

      const result = await collectPrInfo(tempDir, ['feat/', 'night-watch/']);
      expect(result).toEqual([]);
    });

    it('should return empty array when gh pr list returns whitespace-only output', async () => {
      mockExecImpl = (cmd: string) => {
        if (cmd.includes('git rev-parse')) return '.git';
        if (cmd.includes('which gh')) return '/usr/bin/gh';
        if (cmd.includes('gh pr list')) {
          return '   \n  ';
        }
        return '';
      };

      const result = await collectPrInfo(tempDir, ['feat/', 'night-watch/']);
      expect(result).toEqual([]);
    });

    it("should filter out PRs whose branches don't match patterns", async () => {
      mockExecImpl = (cmd: string) => {
        if (cmd.includes('git rev-parse')) return '.git';
        if (cmd.includes('which gh')) return '/usr/bin/gh';
        if (cmd.includes('gh pr list')) {
          return JSON.stringify([
            {
              headRefName: 'feat/new-feature',
              number: 1,
              title: 'New Feature',
              url: 'https://github.com/test/repo/pull/1',
            },
            {
              headRefName: 'dependabot/npm/foo',
              number: 2,
              title: 'Dependabot update',
              url: 'https://github.com/test/repo/pull/2',
            },
            {
              headRefName: 'fix/bugfix',
              number: 3,
              title: 'Bugfix',
              url: 'https://github.com/test/repo/pull/3',
            },
            {
              headRefName: 'night-watch/issue-4',
              number: 4,
              title: 'Night Watch',
              url: 'https://github.com/test/repo/pull/4',
            },
          ]);
        }
        return '';
      };

      const result = await collectPrInfo(tempDir, ['feat/', 'night-watch/']);
      expect(result).toHaveLength(2);
      expect(result.map((p) => p.number)).toEqual([1, 4]);
    });

    it('should collect matching PR info with no CI data', async () => {
      mockExecImpl = (cmd: string) => {
        if (cmd.includes('git rev-parse')) return '.git';
        if (cmd.includes('which gh')) return '/usr/bin/gh';
        if (cmd.includes('gh pr list')) {
          return JSON.stringify([
            {
              headRefName: 'feat/new-feature',
              number: 1,
              title: 'New Feature',
              url: 'https://github.com/test/repo/pull/1',
            },
            {
              headRefName: 'night-watch/phase-1',
              number: 2,
              title: 'Phase 1',
              url: 'https://github.com/test/repo/pull/2',
            },
            {
              headRefName: 'fix/bugfix',
              number: 3,
              title: 'Bugfix',
              url: 'https://github.com/test/repo/pull/3',
            },
          ]);
        }
        return '';
      };

      const result = await collectPrInfo(tempDir, ['feat/', 'night-watch/']);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        number: 1,
        title: 'New Feature',
        branch: 'feat/new-feature',
        url: 'https://github.com/test/repo/pull/1',
        ciStatus: 'unknown',
        reviewScore: null,
        labels: [],
      });
      expect(result[1]).toEqual({
        number: 2,
        title: 'Phase 1',
        branch: 'night-watch/phase-1',
        url: 'https://github.com/test/repo/pull/2',
        ciStatus: 'unknown',
        reviewScore: null,
        labels: [],
      });
    });

    it('should derive CI status and review score from gh data', async () => {
      mockExecImpl = (cmd: string) => {
        if (cmd.includes('git rev-parse')) return '.git';
        if (cmd.includes('which gh')) return '/usr/bin/gh';
        if (cmd.includes('gh pr list')) {
          return JSON.stringify([
            {
              headRefName: 'feat/passing',
              number: 1,
              title: 'Passing PR',
              url: 'https://github.com/test/repo/pull/1',
              // CheckRun format: status + conclusion
              statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'SUCCESS' }],
              reviewDecision: 'APPROVED',
            },
            {
              headRefName: 'feat/failing',
              number: 2,
              title: 'Failing PR',
              url: 'https://github.com/test/repo/pull/2',
              statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'FAILURE' }],
              reviewDecision: 'CHANGES_REQUESTED',
            },
            {
              headRefName: 'feat/pending',
              number: 3,
              title: 'Pending PR',
              url: 'https://github.com/test/repo/pull/3',
              // In-progress check has no conclusion yet
              statusCheckRollup: [{ status: 'IN_PROGRESS', conclusion: null }],
              reviewDecision: 'REVIEW_REQUIRED',
            },
          ]);
        }
        return '';
      };

      const result = await collectPrInfo(tempDir, ['feat/']);
      expect(result).toHaveLength(3);

      expect(result[0].ciStatus).toBe('pass');
      expect(result[0].reviewScore).toBe(100);

      expect(result[1].ciStatus).toBe('fail');
      expect(result[1].reviewScore).toBe(0);

      expect(result[2].ciStatus).toBe('pending');
      expect(result[2].reviewScore).toBe(null);
    });
  });

  describe('CI status edge cases', () => {
    it("should return 'unknown' for null statusCheckRollup", async () => {
      mockExecImpl = (cmd: string) => {
        if (cmd.includes('git rev-parse')) return '.git';
        if (cmd.includes('which gh')) return '/usr/bin/gh';
        if (cmd.includes('gh pr list')) {
          return JSON.stringify([
            {
              headRefName: 'feat/test',
              number: 1,
              title: 'Test PR',
              url: 'https://github.com/test/repo/pull/1',
              statusCheckRollup: null,
              reviewDecision: null,
            },
          ]);
        }
        return '';
      };

      const result = await collectPrInfo(tempDir, ['feat/']);
      expect(result).toHaveLength(1);
      expect(result[0].ciStatus).toBe('unknown');
    });

    it("should return 'unknown' for empty statusCheckRollup array", async () => {
      mockExecImpl = (cmd: string) => {
        if (cmd.includes('git rev-parse')) return '.git';
        if (cmd.includes('which gh')) return '/usr/bin/gh';
        if (cmd.includes('gh pr list')) {
          return JSON.stringify([
            {
              headRefName: 'feat/test',
              number: 1,
              title: 'Test PR',
              url: 'https://github.com/test/repo/pull/1',
              statusCheckRollup: [],
              reviewDecision: null,
            },
          ]);
        }
        return '';
      };

      const result = await collectPrInfo(tempDir, ['feat/']);
      expect(result).toHaveLength(1);
      expect(result[0].ciStatus).toBe('unknown');
    });

    it("should return 'fail' for ERROR conclusion", async () => {
      mockExecImpl = (cmd: string) => {
        if (cmd.includes('git rev-parse')) return '.git';
        if (cmd.includes('which gh')) return '/usr/bin/gh';
        if (cmd.includes('gh pr list')) {
          return JSON.stringify([
            {
              headRefName: 'feat/test',
              number: 1,
              title: 'Test PR',
              url: 'https://github.com/test/repo/pull/1',
              statusCheckRollup: [{ conclusion: 'ERROR', status: 'COMPLETED' }],
              reviewDecision: null,
            },
          ]);
        }
        return '';
      };

      const result = await collectPrInfo(tempDir, ['feat/']);
      expect(result).toHaveLength(1);
      expect(result[0].ciStatus).toBe('fail');
    });

    it("should return 'fail' for CANCELLED conclusion", async () => {
      mockExecImpl = (cmd: string) => {
        if (cmd.includes('git rev-parse')) return '.git';
        if (cmd.includes('which gh')) return '/usr/bin/gh';
        if (cmd.includes('gh pr list')) {
          return JSON.stringify([
            {
              headRefName: 'feat/test',
              number: 1,
              title: 'Test PR',
              url: 'https://github.com/test/repo/pull/1',
              statusCheckRollup: [{ conclusion: 'CANCELLED', status: 'COMPLETED' }],
              reviewDecision: null,
            },
          ]);
        }
        return '';
      };

      const result = await collectPrInfo(tempDir, ['feat/']);
      expect(result).toHaveLength(1);
      expect(result[0].ciStatus).toBe('fail');
    });

    it("should return 'fail' for TIMED_OUT conclusion", async () => {
      mockExecImpl = (cmd: string) => {
        if (cmd.includes('git rev-parse')) return '.git';
        if (cmd.includes('which gh')) return '/usr/bin/gh';
        if (cmd.includes('gh pr list')) {
          return JSON.stringify([
            {
              headRefName: 'feat/test',
              number: 1,
              title: 'Test PR',
              url: 'https://github.com/test/repo/pull/1',
              statusCheckRollup: [{ conclusion: 'TIMED_OUT', status: 'COMPLETED' }],
              reviewDecision: null,
            },
          ]);
        }
        return '';
      };

      const result = await collectPrInfo(tempDir, ['feat/']);
      expect(result).toHaveLength(1);
      expect(result[0].ciStatus).toBe('fail');
    });

    it("should return 'pending' for IN_PROGRESS status", async () => {
      mockExecImpl = (cmd: string) => {
        if (cmd.includes('git rev-parse')) return '.git';
        if (cmd.includes('which gh')) return '/usr/bin/gh';
        if (cmd.includes('gh pr list')) {
          return JSON.stringify([
            {
              headRefName: 'feat/test',
              number: 1,
              title: 'Test PR',
              url: 'https://github.com/test/repo/pull/1',
              statusCheckRollup: [{ status: 'IN_PROGRESS', conclusion: null }],
              reviewDecision: null,
            },
          ]);
        }
        return '';
      };

      const result = await collectPrInfo(tempDir, ['feat/']);
      expect(result).toHaveLength(1);
      expect(result[0].ciStatus).toBe('pending');
    });

    it("should return 'pending' for QUEUED status", async () => {
      mockExecImpl = (cmd: string) => {
        if (cmd.includes('git rev-parse')) return '.git';
        if (cmd.includes('which gh')) return '/usr/bin/gh';
        if (cmd.includes('gh pr list')) {
          return JSON.stringify([
            {
              headRefName: 'feat/test',
              number: 1,
              title: 'Test PR',
              url: 'https://github.com/test/repo/pull/1',
              statusCheckRollup: [{ status: 'QUEUED', conclusion: null }],
              reviewDecision: null,
            },
          ]);
        }
        return '';
      };

      const result = await collectPrInfo(tempDir, ['feat/']);
      expect(result).toHaveLength(1);
      expect(result[0].ciStatus).toBe('pending');
    });

    it("should return 'pass' for NEUTRAL conclusion", async () => {
      mockExecImpl = (cmd: string) => {
        if (cmd.includes('git rev-parse')) return '.git';
        if (cmd.includes('which gh')) return '/usr/bin/gh';
        if (cmd.includes('gh pr list')) {
          return JSON.stringify([
            {
              headRefName: 'feat/test',
              number: 1,
              title: 'Test PR',
              url: 'https://github.com/test/repo/pull/1',
              statusCheckRollup: [{ conclusion: 'NEUTRAL', status: 'COMPLETED' }],
              reviewDecision: null,
            },
          ]);
        }
        return '';
      };

      const result = await collectPrInfo(tempDir, ['feat/']);
      expect(result).toHaveLength(1);
      expect(result[0].ciStatus).toBe('pass');
    });

    it("should return 'pass' for SKIPPED conclusion (treated as complete)", async () => {
      mockExecImpl = (cmd: string) => {
        if (cmd.includes('git rev-parse')) return '.git';
        if (cmd.includes('which gh')) return '/usr/bin/gh';
        if (cmd.includes('gh pr list')) {
          return JSON.stringify([
            {
              headRefName: 'feat/test',
              number: 1,
              title: 'Test PR',
              url: 'https://github.com/test/repo/pull/1',
              statusCheckRollup: [{ conclusion: 'SKIPPED', status: 'COMPLETED' }],
              reviewDecision: null,
            },
          ]);
        }
        return '';
      };

      const result = await collectPrInfo(tempDir, ['feat/']);
      expect(result).toHaveLength(1);
      expect(result[0].ciStatus).toBe('pass');
    });

    it('should handle StatusContext format with state field (SUCCESS)', async () => {
      mockExecImpl = (cmd: string) => {
        if (cmd.includes('git rev-parse')) return '.git';
        if (cmd.includes('which gh')) return '/usr/bin/gh';
        if (cmd.includes('gh pr list')) {
          return JSON.stringify([
            {
              headRefName: 'feat/test',
              number: 1,
              title: 'Test PR',
              url: 'https://github.com/test/repo/pull/1',
              // StatusContext format: only has state, no conclusion
              statusCheckRollup: [{ state: 'SUCCESS' }],
              reviewDecision: null,
            },
          ]);
        }
        return '';
      };

      const result = await collectPrInfo(tempDir, ['feat/']);
      expect(result).toHaveLength(1);
      expect(result[0].ciStatus).toBe('pass');
    });

    it('should handle StatusContext format with state field (FAILURE)', async () => {
      mockExecImpl = (cmd: string) => {
        if (cmd.includes('git rev-parse')) return '.git';
        if (cmd.includes('which gh')) return '/usr/bin/gh';
        if (cmd.includes('gh pr list')) {
          return JSON.stringify([
            {
              headRefName: 'feat/test',
              number: 1,
              title: 'Test PR',
              url: 'https://github.com/test/repo/pull/1',
              statusCheckRollup: [{ state: 'FAILURE' }],
              reviewDecision: null,
            },
          ]);
        }
        return '';
      };

      const result = await collectPrInfo(tempDir, ['feat/']);
      expect(result).toHaveLength(1);
      expect(result[0].ciStatus).toBe('fail');
    });

    it('should handle StatusContext format with state field (PENDING)', async () => {
      mockExecImpl = (cmd: string) => {
        if (cmd.includes('git rev-parse')) return '.git';
        if (cmd.includes('which gh')) return '/usr/bin/gh';
        if (cmd.includes('gh pr list')) {
          return JSON.stringify([
            {
              headRefName: 'feat/test',
              number: 1,
              title: 'Test PR',
              url: 'https://github.com/test/repo/pull/1',
              statusCheckRollup: [{ state: 'PENDING' }],
              reviewDecision: null,
            },
          ]);
        }
        return '';
      };

      const result = await collectPrInfo(tempDir, ['feat/']);
      expect(result).toHaveLength(1);
      expect(result[0].ciStatus).toBe('pending');
    });

    it('should handle mixed CheckRun and StatusContext formats', async () => {
      mockExecImpl = (cmd: string) => {
        if (cmd.includes('git rev-parse')) return '.git';
        if (cmd.includes('which gh')) return '/usr/bin/gh';
        if (cmd.includes('gh pr list')) {
          return JSON.stringify([
            {
              headRefName: 'feat/test',
              number: 1,
              title: 'Test PR',
              url: 'https://github.com/test/repo/pull/1',
              statusCheckRollup: [
                // CheckRun format
                { status: 'COMPLETED', conclusion: 'SUCCESS' },
                // StatusContext format
                { state: 'SUCCESS' },
              ],
              reviewDecision: null,
            },
          ]);
        }
        return '';
      };

      const result = await collectPrInfo(tempDir, ['feat/']);
      expect(result).toHaveLength(1);
      expect(result[0].ciStatus).toBe('pass');
    });

    it('should handle nested contexts array structure', async () => {
      mockExecImpl = (cmd: string) => {
        if (cmd.includes('git rev-parse')) return '.git';
        if (cmd.includes('which gh')) return '/usr/bin/gh';
        if (cmd.includes('gh pr list')) {
          return JSON.stringify([
            {
              headRefName: 'feat/test',
              number: 1,
              title: 'Test PR',
              url: 'https://github.com/test/repo/pull/1',
              // Nested structure with contexts array
              statusCheckRollup: [
                {
                  contexts: [
                    { conclusion: 'SUCCESS', status: 'COMPLETED' },
                    { conclusion: 'SUCCESS', status: 'COMPLETED' },
                  ],
                },
              ],
              reviewDecision: null,
            },
          ]);
        }
        return '';
      };

      const result = await collectPrInfo(tempDir, ['feat/']);
      expect(result).toHaveLength(1);
      expect(result[0].ciStatus).toBe('pass');
    });

    it('should handle nested contexts with failure', async () => {
      mockExecImpl = (cmd: string) => {
        if (cmd.includes('git rev-parse')) return '.git';
        if (cmd.includes('which gh')) return '/usr/bin/gh';
        if (cmd.includes('gh pr list')) {
          return JSON.stringify([
            {
              headRefName: 'feat/test',
              number: 1,
              title: 'Test PR',
              url: 'https://github.com/test/repo/pull/1',
              statusCheckRollup: [
                {
                  contexts: [
                    { conclusion: 'SUCCESS', status: 'COMPLETED' },
                    { conclusion: 'FAILURE', status: 'COMPLETED' },
                  ],
                },
              ],
              reviewDecision: null,
            },
          ]);
        }
        return '';
      };

      const result = await collectPrInfo(tempDir, ['feat/']);
      expect(result).toHaveLength(1);
      expect(result[0].ciStatus).toBe('fail');
    });

    it('should handle case-insensitive conclusion values', async () => {
      mockExecImpl = (cmd: string) => {
        if (cmd.includes('git rev-parse')) return '.git';
        if (cmd.includes('which gh')) return '/usr/bin/gh';
        if (cmd.includes('gh pr list')) {
          return JSON.stringify([
            {
              headRefName: 'feat/test',
              number: 1,
              title: 'Test PR',
              url: 'https://github.com/test/repo/pull/1',
              statusCheckRollup: [{ conclusion: 'success', status: 'completed' }],
              reviewDecision: null,
            },
          ]);
        }
        return '';
      };

      const result = await collectPrInfo(tempDir, ['feat/']);
      expect(result).toHaveLength(1);
      expect(result[0].ciStatus).toBe('pass');
    });
  });

  describe('review score edge cases', () => {
    it('should return null for undefined reviewDecision', async () => {
      mockExecImpl = (cmd: string) => {
        if (cmd.includes('git rev-parse')) return '.git';
        if (cmd.includes('which gh')) return '/usr/bin/gh';
        if (cmd.includes('gh pr list')) {
          return JSON.stringify([
            {
              headRefName: 'feat/test',
              number: 1,
              title: 'Test PR',
              url: 'https://github.com/test/repo/pull/1',
              statusCheckRollup: [],
              reviewDecision: undefined,
            },
          ]);
        }
        return '';
      };

      const result = await collectPrInfo(tempDir, ['feat/']);
      expect(result).toHaveLength(1);
      expect(result[0].reviewScore).toBeNull();
    });

    it('should return null for empty string reviewDecision', async () => {
      mockExecImpl = (cmd: string) => {
        if (cmd.includes('git rev-parse')) return '.git';
        if (cmd.includes('which gh')) return '/usr/bin/gh';
        if (cmd.includes('gh pr list')) {
          return JSON.stringify([
            {
              headRefName: 'feat/test',
              number: 1,
              title: 'Test PR',
              url: 'https://github.com/test/repo/pull/1',
              statusCheckRollup: [],
              reviewDecision: '',
            },
          ]);
        }
        return '';
      };

      const result = await collectPrInfo(tempDir, ['feat/']);
      expect(result).toHaveLength(1);
      expect(result[0].reviewScore).toBeNull();
    });

    it('should return null for REVIEW_REQUIRED', async () => {
      mockExecImpl = (cmd: string) => {
        if (cmd.includes('git rev-parse')) return '.git';
        if (cmd.includes('which gh')) return '/usr/bin/gh';
        if (cmd.includes('gh pr list')) {
          return JSON.stringify([
            {
              headRefName: 'feat/test',
              number: 1,
              title: 'Test PR',
              url: 'https://github.com/test/repo/pull/1',
              statusCheckRollup: [],
              reviewDecision: 'REVIEW_REQUIRED',
            },
          ]);
        }
        return '';
      };

      const result = await collectPrInfo(tempDir, ['feat/']);
      expect(result).toHaveLength(1);
      expect(result[0].reviewScore).toBeNull();
    });

    it('should handle lowercase reviewDecision values', async () => {
      mockExecImpl = (cmd: string) => {
        if (cmd.includes('git rev-parse')) return '.git';
        if (cmd.includes('which gh')) return '/usr/bin/gh';
        if (cmd.includes('gh pr list')) {
          return JSON.stringify([
            {
              headRefName: 'feat/test',
              number: 1,
              title: 'Test PR',
              url: 'https://github.com/test/repo/pull/1',
              statusCheckRollup: [],
              reviewDecision: 'approved',
            },
          ]);
        }
        return '';
      };

      const result = await collectPrInfo(tempDir, ['feat/']);
      expect(result).toHaveLength(1);
      expect(result[0].reviewScore).toBe(100);
    });

    it('should handle mixed case reviewDecision values', async () => {
      mockExecImpl = (cmd: string) => {
        if (cmd.includes('git rev-parse')) return '.git';
        if (cmd.includes('which gh')) return '/usr/bin/gh';
        if (cmd.includes('gh pr list')) {
          return JSON.stringify([
            {
              headRefName: 'feat/test',
              number: 1,
              title: 'Test PR',
              url: 'https://github.com/test/repo/pull/1',
              statusCheckRollup: [],
              reviewDecision: 'Changes_Requested',
            },
          ]);
        }
        return '';
      };

      const result = await collectPrInfo(tempDir, ['feat/']);
      expect(result).toHaveLength(1);
      expect(result[0].reviewScore).toBe(0);
    });

    it('should return null for unknown reviewDecision values', async () => {
      mockExecImpl = (cmd: string) => {
        if (cmd.includes('git rev-parse')) return '.git';
        if (cmd.includes('which gh')) return '/usr/bin/gh';
        if (cmd.includes('gh pr list')) {
          return JSON.stringify([
            {
              headRefName: 'feat/test',
              number: 1,
              title: 'Test PR',
              url: 'https://github.com/test/repo/pull/1',
              statusCheckRollup: [],
              reviewDecision: 'UNKNOWN_STATUS',
            },
          ]);
        }
        return '';
      };

      const result = await collectPrInfo(tempDir, ['feat/']);
      expect(result).toHaveLength(1);
      expect(result[0].reviewScore).toBeNull();
    });
  });

  describe('getLastLogLines', () => {
    it('should return empty array when file does not exist', async () => {
      const result = getLastLogLines('/tmp/nonexistent-log.log', 5);
      expect(result).toEqual([]);
    });

    it('should return last N lines', async () => {
      const logPath = path.join(tempDir, 'test.log');
      fs.writeFileSync(logPath, 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6');

      const result = getLastLogLines(logPath, 3);
      expect(result).toEqual(['Line 4', 'Line 5', 'Line 6']);
    });

    it('should return all lines when file has fewer than N lines', async () => {
      const logPath = path.join(tempDir, 'test.log');
      fs.writeFileSync(logPath, 'Line 1\nLine 2');

      const result = getLastLogLines(logPath, 5);
      expect(result).toEqual(['Line 1', 'Line 2']);
    });
  });

  describe('getLogInfo', () => {
    it('should return info for existing log file', async () => {
      const logPath = path.join(tempDir, 'test.log');
      fs.writeFileSync(logPath, 'Line 1\nLine 2\nLine 3');

      const result = getLogInfo(logPath);
      expect(result.exists).toBe(true);
      expect(result.size).toBeGreaterThan(0);
      expect(result.lastLines).toEqual(['Line 1', 'Line 2', 'Line 3']);
      expect(result.path).toBe(logPath);
    });

    it('should return info for non-existing log file', async () => {
      const result = getLogInfo('/tmp/nonexistent-log-file.log');
      expect(result.exists).toBe(false);
      expect(result.size).toBe(0);
      expect(result.lastLines).toEqual([]);
    });
  });

  describe('collectLogInfo', () => {
    it('should collect info for executor/reviewer/qa/audit/planner/analytics/pr-resolver/merger logs', async () => {
      const logDir = path.join(tempDir, 'logs');
      fs.mkdirSync(logDir, { recursive: true });
      fs.writeFileSync(path.join(logDir, 'executor.log'), 'Executor line 1');

      const result = collectLogInfo(tempDir);
      expect(result).toHaveLength(8);

      const executorLog = result.find((l) => l.name === 'executor');
      expect(executorLog).toBeDefined();
      expect(executorLog!.exists).toBe(true);
      expect(executorLog!.size).toBeGreaterThan(0);

      const reviewerLog = result.find((l) => l.name === 'reviewer');
      expect(reviewerLog).toBeDefined();
      expect(reviewerLog!.exists).toBe(false);

      const qaLog = result.find((l) => l.name === 'qa');
      expect(qaLog).toBeDefined();
      expect(qaLog!.exists).toBe(false);

      const auditLog = result.find((l) => l.name === 'audit');
      expect(auditLog).toBeDefined();
      expect(auditLog!.exists).toBe(false);

      const plannerLog = result.find((l) => l.name === 'planner');
      expect(plannerLog).toBeDefined();
      expect(plannerLog!.exists).toBe(false);

      const analyticsLog = result.find((l) => l.name === 'analytics');
      expect(analyticsLog).toBeDefined();
      expect(analyticsLog!.exists).toBe(false);

      const prResolverLog = result.find((l) => l.name === 'pr-resolver');
      expect(prResolverLog).toBeDefined();
      expect(prResolverLog!.exists).toBe(false);

      const mergerLog = result.find((l) => l.name === 'merger');
      expect(mergerLog).toBeDefined();
      expect(mergerLog!.exists).toBe(false);
    });

    it('should use correct file names (executor.log, reviewer.log, night-watch-qa.log, analytics.log, pr-resolver.log, merger.log)', async () => {
      const logDir = path.join(tempDir, 'logs');
      fs.mkdirSync(logDir, { recursive: true });
      fs.writeFileSync(path.join(logDir, 'executor.log'), 'Executor line 1');
      fs.writeFileSync(path.join(logDir, 'reviewer.log'), 'Reviewer line 1');
      fs.writeFileSync(path.join(logDir, 'night-watch-qa.log'), 'QA line 1');
      fs.writeFileSync(path.join(logDir, 'audit.log'), 'Audit line 1');
      fs.writeFileSync(path.join(logDir, 'slicer.log'), 'Planner line 1');
      fs.writeFileSync(path.join(logDir, 'analytics.log'), 'Analytics line 1');
      fs.writeFileSync(path.join(logDir, 'pr-resolver.log'), 'PR Resolver line 1');
      fs.writeFileSync(path.join(logDir, 'merger.log'), 'Merger line 1');

      const result = collectLogInfo(tempDir);
      expect(result).toHaveLength(8);

      const executorLog = result.find((l) => l.name === 'executor');
      expect(executorLog).toBeDefined();
      expect(executorLog!.exists).toBe(true);
      expect(executorLog!.path).toContain('executor.log');

      const reviewerLog = result.find((l) => l.name === 'reviewer');
      expect(reviewerLog).toBeDefined();
      expect(reviewerLog!.exists).toBe(true);
      expect(reviewerLog!.path).toContain('reviewer.log');

      const qaLog = result.find((l) => l.name === 'qa');
      expect(qaLog).toBeDefined();
      expect(qaLog!.exists).toBe(true);
      expect(qaLog!.path).toContain('night-watch-qa.log');

      const auditLog = result.find((l) => l.name === 'audit');
      expect(auditLog).toBeDefined();
      expect(auditLog!.exists).toBe(true);
      expect(auditLog!.path).toContain('audit.log');

      const plannerLog = result.find((l) => l.name === 'planner');
      expect(plannerLog).toBeDefined();
      expect(plannerLog!.exists).toBe(true);
      expect(plannerLog!.path).toContain('slicer.log');

      const prResolverLog = result.find((l) => l.name === 'pr-resolver');
      expect(prResolverLog).toBeDefined();
      expect(prResolverLog!.exists).toBe(true);
      expect(prResolverLog!.path).toContain('pr-resolver.log');

      const mergerLog = result.find((l) => l.name === 'merger');
      expect(mergerLog).toBeDefined();
      expect(mergerLog!.exists).toBe(true);
      expect(mergerLog!.path).toContain('merger.log');
    });
  });

  describe('getCrontabInfo', () => {
    it('should return not installed when no entries', async () => {
      vi.mocked(getEntries).mockReturnValue([]);
      vi.mocked(getProjectEntries).mockReturnValue([]);

      const result = getCrontabInfo('test-project', tempDir);
      expect(result.installed).toBe(false);
      expect(result.entries).toEqual([]);
    });

    it('should return installed with entries', async () => {
      vi.mocked(getEntries).mockReturnValue([
        '0 * * * * night-watch run  # night-watch-cli: test-project',
      ]);
      vi.mocked(getProjectEntries).mockReturnValue([]);

      const result = getCrontabInfo('test-project', tempDir);
      expect(result.installed).toBe(true);
      expect(result.entries).toHaveLength(1);
    });

    it('should deduplicate entries from both sources', async () => {
      const entry = '0 * * * * night-watch run  # night-watch-cli: test-project';
      vi.mocked(getEntries).mockReturnValue([entry]);
      vi.mocked(getProjectEntries).mockReturnValue([entry]);

      const result = getCrontabInfo('test-project', tempDir);
      expect(result.entries).toHaveLength(1);
    });
  });

  describe('parsePrdDependencies', () => {
    it("should parse 'depends on' line", async () => {
      const prdPath = path.join(tempDir, 'phase2.md');
      fs.writeFileSync(prdPath, '# Phase 2\n\nDepends on: `phase0`, `phase1`\n\nSome content.');

      const result = parsePrdDependencies(prdPath);
      expect(result).toEqual(['phase0', 'phase1']);
    });

    it('should handle no dependencies', async () => {
      const prdPath = path.join(tempDir, 'phase1.md');
      fs.writeFileSync(prdPath, '# Phase 1\n\nNo dependency info here.');

      const result = parsePrdDependencies(prdPath);
      expect(result).toEqual([]);
    });

    it('should handle missing file', async () => {
      const result = parsePrdDependencies('/tmp/nonexistent-prd-file.md');
      expect(result).toEqual([]);
    });

    it('should handle depends on without backticks', async () => {
      const prdPath = path.join(tempDir, 'phase3.md');
      fs.writeFileSync(prdPath, '# Phase 3\n\nDepends on: phase1, phase2\n\nSome content.');

      const result = parsePrdDependencies(prdPath);
      expect(result).toEqual(['phase1', 'phase2']);
    });

    it('should handle bold markdown depends on format', async () => {
      const prdPath = path.join(tempDir, 'phase4.md');
      fs.writeFileSync(prdPath, '# Phase 4\n\n**Depends on:** `phase1`, `phase2`\n\nSome content.');

      const result = parsePrdDependencies(prdPath);
      expect(result).toEqual(['phase1', 'phase2']);
    });

    it('should return empty array for bold depends on with no deps', async () => {
      const prdPath = path.join(tempDir, 'phase5.md');
      fs.writeFileSync(prdPath, '# Phase 5\n\n**Depends on:**\n\nSome content.');

      const result = parsePrdDependencies(prdPath);
      expect(result).toEqual([]);
    });
  });

  describe('collectPrdInfo with dependencies', () => {
    it('should mark PRDs with unmet dependencies as blocked', async () => {
      const prdDir = path.join(tempDir, 'docs', 'prds');
      fs.mkdirSync(prdDir, { recursive: true });
      fs.mkdirSync(path.join(prdDir, 'done'), { recursive: true });

      // phase0 is done
      fs.writeFileSync(path.join(prdDir, 'done', 'phase0.md'), '# Phase 0');
      // phase1 depends on phase0 (which is done) => ready
      fs.writeFileSync(path.join(prdDir, 'phase1.md'), '# Phase 1\n\nDepends on: `phase0`');
      // phase2 depends on phase1 (which is NOT done) => blocked
      fs.writeFileSync(path.join(prdDir, 'phase2.md'), '# Phase 2\n\nDepends on: `phase1`');

      const result = collectPrdInfo(tempDir, 'docs/prds', 7200);

      const phase1 = result.find((p) => p.name === 'phase1');
      expect(phase1).toBeDefined();
      expect(phase1!.status).toBe('ready');
      expect(phase1!.dependencies).toEqual(['phase0']);
      expect(phase1!.unmetDependencies).toEqual([]);

      const phase2 = result.find((p) => p.name === 'phase2');
      expect(phase2).toBeDefined();
      expect(phase2!.status).toBe('blocked');
      expect(phase2!.dependencies).toEqual(['phase1']);
      expect(phase2!.unmetDependencies).toEqual(['phase1']);
    });

    it('should resolve deps with .md extension against done PRDs', async () => {
      const prdDir = path.join(tempDir, 'docs', 'prds');
      fs.mkdirSync(prdDir, { recursive: true });
      fs.mkdirSync(path.join(prdDir, 'done'), { recursive: true });

      // phase0 is done (stored as phase0.md, name becomes "phase0")
      fs.writeFileSync(path.join(prdDir, 'done', 'phase0.md'), '# Phase 0');
      // phase1 depends on "phase0.md" (with extension) => should still resolve as ready
      fs.writeFileSync(path.join(prdDir, 'phase1.md'), '# Phase 1\n\n**Depends on:** `phase0.md`');

      const result = collectPrdInfo(tempDir, 'docs/prds', 7200);

      const phase1 = result.find((p) => p.name === 'phase1');
      expect(phase1).toBeDefined();
      expect(phase1!.status).toBe('ready');
      expect(phase1!.unmetDependencies).toEqual([]);
    });
  });

  describe('fetchStatusSnapshot', () => {
    it('should return all expected fields', async () => {
      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify({ name: 'test-project' }),
      );

      const config = makeConfig();
      const snapshot = await fetchStatusSnapshot(tempDir, config);

      expect(snapshot.projectName).toBe('test-project');
      expect(snapshot.projectDir).toBe(tempDir);
      expect(snapshot.config).toBe(config);
      expect(Array.isArray(snapshot.prds)).toBe(true);
      expect(Array.isArray(snapshot.processes)).toBe(true);
      expect(snapshot.processes).toHaveLength(8);
      expect(snapshot.processes[0].name).toBe('executor');
      expect(snapshot.processes[1].name).toBe('reviewer');
      expect(snapshot.processes[2].name).toBe('qa');
      expect(snapshot.processes[3].name).toBe('audit');
      expect(snapshot.processes[4].name).toBe('planner');
      expect(snapshot.processes[5].name).toBe('analytics');
      expect(snapshot.processes[6].name).toBe('pr-resolver');
      expect(snapshot.processes[7].name).toBe('merger');
      expect(Array.isArray(snapshot.prs)).toBe(true);
      expect(Array.isArray(snapshot.logs)).toBe(true);
      expect(snapshot.logs).toHaveLength(8);
      expect(snapshot.crontab).toHaveProperty('installed');
      expect(snapshot.crontab).toHaveProperty('entries');
      expect(snapshot.activePrd).toBeNull();
      expect(snapshot.timestamp).toBeInstanceOf(Date);
    });

    it('should detect PRDs in the snapshot', async () => {
      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify({ name: 'test-project' }),
      );

      const prdDir = path.join(tempDir, 'docs', 'prds');
      fs.mkdirSync(prdDir, { recursive: true });
      fs.mkdirSync(path.join(prdDir, 'done'), { recursive: true });

      fs.writeFileSync(path.join(prdDir, 'phase1.md'), '# Phase 1');
      fs.writeFileSync(path.join(prdDir, 'done', 'phase0.md'), '# Phase 0');

      const config = makeConfig();
      const snapshot = await fetchStatusSnapshot(tempDir, config);

      expect(snapshot.prds).toHaveLength(2);
      expect(snapshot.prds.find((p) => p.name === 'phase1')?.status).toBe('ready');
      expect(snapshot.prds.find((p) => p.name === 'phase0')?.status).toBe('done');
    });

    it('should detect log files in the snapshot', async () => {
      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify({ name: 'test-project' }),
      );

      const logDir = path.join(tempDir, 'logs');
      fs.mkdirSync(logDir, { recursive: true });
      fs.writeFileSync(path.join(logDir, 'executor.log'), 'Log line 1\nLog line 2');

      const config = makeConfig();
      const snapshot = await fetchStatusSnapshot(tempDir, config);

      const executorLog = snapshot.logs.find((l) => l.name === 'executor');
      expect(executorLog).toBeDefined();
      expect(executorLog!.exists).toBe(true);
      expect(executorLog!.lastLines).toEqual(['Log line 1', 'Log line 2']);

      const reviewerLog = snapshot.logs.find((l) => l.name === 'reviewer');
      expect(reviewerLog).toBeDefined();
      expect(reviewerLog!.exists).toBe(false);
    });

    it('should include crontab info in the snapshot', async () => {
      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify({ name: 'test-project' }),
      );

      vi.mocked(getEntries).mockReturnValue([
        '0 * * * * night-watch run  # night-watch-cli: test-project',
      ]);

      const config = makeConfig();
      const snapshot = await fetchStatusSnapshot(tempDir, config);

      expect(snapshot.crontab.installed).toBe(true);
      expect(snapshot.crontab.entries).toHaveLength(1);
    });

    it('activePrd is set when executor running with claimed PRD', async () => {
      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify({ name: 'test-project' }),
      );

      const prdDir = path.join(tempDir, 'docs', 'prds');
      fs.mkdirSync(prdDir, { recursive: true });

      fs.writeFileSync(path.join(prdDir, 'my-prd.md'), '# My PRD');

      // Fresh claim file
      fs.writeFileSync(
        path.join(prdDir, 'my-prd.md.claim'),
        JSON.stringify({ timestamp: Math.floor(Date.now() / 1000), hostname: 'test', pid: 1234 }),
      );

      // Create executor lock file to simulate running executor
      const lockPath = executorLockPath(tempDir);
      fs.writeFileSync(lockPath, '12345');

      // Mock process.kill to simulate executor running
      const originalKill = process.kill;
      (process as any).kill = vi.fn().mockReturnValue(true);

      try {
        const config = makeConfig();
        const snapshot = await fetchStatusSnapshot(tempDir, config);

        expect(snapshot.activePrd).toBe('my-prd');
      } finally {
        (process as any).kill = originalKill;
        // Clean up lock file
        try {
          fs.unlinkSync(lockPath);
        } catch {
          /* ignore */
        }
      }
    });

    it('activePrd is null when executor not running', async () => {
      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify({ name: 'test-project' }),
      );

      const prdDir = path.join(tempDir, 'docs', 'prds');
      fs.mkdirSync(prdDir, { recursive: true });

      fs.writeFileSync(path.join(prdDir, 'my-prd.md'), '# My PRD');

      // Fresh claim file (but executor is not running)
      fs.writeFileSync(
        path.join(prdDir, 'my-prd.md.claim'),
        JSON.stringify({ timestamp: Math.floor(Date.now() / 1000), hostname: 'test', pid: 1234 }),
      );

      // Mock process.kill to simulate executor NOT running
      const originalKill = process.kill;
      (process as any).kill = vi.fn().mockImplementation(() => {
        throw new Error('ESRCH');
      });

      try {
        const config = makeConfig();
        const snapshot = await fetchStatusSnapshot(tempDir, config);

        expect(snapshot.activePrd).toBeNull();
      } finally {
        (process as any).kill = originalKill;
      }
    });
  });

  describe('acquireLock', () => {
    it('should acquire lock when no lock file exists', async () => {
      const lockPath = path.join(tempDir, 'test.lock');
      const result = acquireLock(lockPath);

      expect(result).toBe(true);
      expect(fs.existsSync(lockPath)).toBe(true);
      expect(fs.readFileSync(lockPath, 'utf-8').trim()).toBe(String(process.pid));
    });

    it('should acquire lock with custom PID', async () => {
      const lockPath = path.join(tempDir, 'test-custom.lock');
      const result = acquireLock(lockPath, 99999);

      expect(result).toBe(true);
      expect(fs.readFileSync(lockPath, 'utf-8').trim()).toBe('99999');
    });

    it('should fail to acquire lock when held by running process', async () => {
      const lockPath = path.join(tempDir, 'test-held.lock');

      // Create lock file with current PID (which is running)
      fs.writeFileSync(lockPath, String(process.pid));

      const result = acquireLock(lockPath);
      expect(result).toBe(false);
    });

    it('should remove stale lock and acquire when process is not running', async () => {
      const lockPath = path.join(tempDir, 'test-stale.lock');

      // Create lock file with a PID that's definitely not running
      fs.writeFileSync(lockPath, '99999999');

      const result = acquireLock(lockPath);
      expect(result).toBe(true);
      expect(fs.readFileSync(lockPath, 'utf-8').trim()).toBe(String(process.pid));
    });
  });

  describe('releaseLock', () => {
    it('should remove lock file', async () => {
      const lockPath = path.join(tempDir, 'test-release.lock');
      fs.writeFileSync(lockPath, String(process.pid));

      releaseLock(lockPath);
      expect(fs.existsSync(lockPath)).toBe(false);
    });

    it('should be silent when lock file does not exist', async () => {
      const lockPath = path.join(tempDir, 'nonexistent.lock');
      // Should not throw
      expect(() => releaseLock(lockPath)).not.toThrow();
    });
  });
});
