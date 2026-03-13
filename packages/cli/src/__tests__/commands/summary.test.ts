/**
 * Tests for summary command
 */

import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Mock process.cwd to return our temp directory
let mockProjectDir: string;

vi.mock('child_process', () => ({
  exec: vi.fn(),
  execFile: vi.fn(),
  execSync: vi.fn(),
  spawn: vi.fn(),
}));

vi.mock('@night-watch/core/utils/crontab.js', () => ({
  getEntries: vi.fn(() => []),
  getProjectEntries: vi.fn(() => []),
  generateMarker: vi.fn((name: string) => `# night-watch-cli: ${name}`),
}));

// Mock job-queue module
vi.mock('@night-watch/core/utils/job-queue.js', () => ({
  getJobRunsAnalytics: vi.fn(() => ({
    recentRuns: [],
    byProviderBucket: {},
    averageWaitSeconds: null,
    oldestPendingAge: null,
  })),
  getQueueStatus: vi.fn(() => ({
    enabled: true,
    running: null,
    pending: { total: 0, byType: {}, byProviderBucket: {} },
    items: [],
    averageWaitSeconds: null,
    oldestPendingAge: null,
  })),
}));

// Mock status-data module
vi.mock('@night-watch/core/utils/status-data.js', () => ({
  collectPrInfo: vi.fn(async () => []),
}));

// Mock process.cwd before importing module
const originalCwd = process.cwd;
process.cwd = () => mockProjectDir;

// Import after mocking
import { summaryCommand } from '@/cli/commands/summary.js';
import { Command } from 'commander';
import { getJobRunsAnalytics, getQueueStatus } from '@night-watch/core/utils/job-queue.js';
import { collectPrInfo } from '@night-watch/core/utils/status-data.js';

describe('summary command', () => {
  let tempDir: string;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'night-watch-summary-test-'));
    mockProjectDir = tempDir;

    // Create basic package.json
    fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({ name: 'test-project' }));

    // Create config file
    fs.writeFileSync(
      path.join(tempDir, 'night-watch.config.json'),
      JSON.stringify(
        {
          projectName: 'test-project',
          defaultBranch: 'main',
          provider: 'claude',
          reviewerEnabled: true,
          prdDir: 'docs/PRDs/night-watch',
          maxRuntime: 7200,
          reviewerMaxRuntime: 3600,
          branchPatterns: ['feat/', 'night-watch/'],
          notifications: { webhooks: [] },
        },
        null,
        2,
      ),
    );

    // Reset mocks to return default values
    vi.mocked(getJobRunsAnalytics).mockReturnValue({
      recentRuns: [],
      byProviderBucket: {},
      averageWaitSeconds: null,
      oldestPendingAge: null,
    });

    vi.mocked(getQueueStatus).mockReturnValue({
      enabled: true,
      running: null,
      pending: { total: 0, byType: {}, byProviderBucket: {} },
      items: [],
      averageWaitSeconds: null,
      oldestPendingAge: null,
    });

    vi.mocked(collectPrInfo).mockResolvedValue([]);

    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    consoleSpy.mockRestore();
  });

  afterAll(() => {
    process.cwd = originalCwd;
  });

  describe('help text', () => {
    it('should show help text with --help flag', async () => {
      const program = new Command();
      summaryCommand(program);

      program.exitOverride();
      let capturedOutput = '';
      program.configureOutput({
        writeOut: (str: string) => {
          capturedOutput += str;
        },
      });

      try {
        await program.parseAsync(['node', 'test', 'summary', '--help']);
      } catch {
        // Help throws by default in commander
      }

      expect(capturedOutput).toContain('--hours');
      expect(capturedOutput).toContain('--json');
    });
  });

  describe('formatted output', () => {
    it('should display summary header with time window', async () => {
      const program = new Command();
      summaryCommand(program);

      await program.parseAsync(['node', 'test', 'summary']);

      const output = consoleSpy.mock.calls.map((call) => call.join(' ')).join('\n');
      expect(output).toContain('Night Watch Summary');
      expect(output).toContain('last 12h');
    });
  });
  describe('JSON output', () => {
    it('should output valid JSON when --json flag is used', async () => {
      const program = new Command();
      summaryCommand(program);

      await program.parseAsync(['node', 'test', 'summary', '--json']);

      const output = consoleSpy.mock.calls[0]?.[0] || '';
      const parsed = JSON.parse(output);

      expect(parsed).toHaveProperty('windowHours');
      expect(parsed).toHaveProperty('jobRuns');
      expect(parsed).toHaveProperty('counts');
      expect(parsed).toHaveProperty('openPrs');
      expect(parsed).toHaveProperty('pendingQueueItems');
      expect(parsed).toHaveProperty('actionItems');
    });

    it('should include correct windowHours in JSON output', async () => {
      const program = new Command();
      summaryCommand(program);

      await program.parseAsync(['node', 'test', 'summary', '--json', '--hours', '8']);

      const output = consoleSpy.mock.calls[0]?.[0] || '';
      const parsed = JSON.parse(output);

      expect(parsed.windowHours).toBe(8);
    });
  });

  describe('job counts', () => {
    it('should use default 12 hours when --hours not specified', async () => {
      const program = new Command();
      summaryCommand(program);

      await program.parseAsync(['node', 'test', 'summary']);

      expect(vi.mocked(getJobRunsAnalytics)).toHaveBeenCalledWith(12);
    });

    it('should respect custom --hours value', async () => {
      const program = new Command();
      summaryCommand(program);

      await program.parseAsync(['node', 'test', 'summary', '--hours', '24']);

      expect(vi.mocked(getJobRunsAnalytics)).toHaveBeenCalledWith(24);
    });

    it('should show "No recent activity" when no jobs ran', async () => {
      const program = new Command();
      summaryCommand(program);

      await program.parseAsync(['node', 'test', 'summary']);

      const output = consoleSpy.mock.calls.map((call) => call.join(' ')).join('\n');
      expect(output).toContain('No recent activity');
    });

    it('should show job counts from analytics data', async () => {
      vi.mocked(getJobRunsAnalytics).mockReturnValue({
        recentRuns: [
          {
            id: 1,
            projectPath: '/project',
            jobType: 'executor',
            providerKey: 'claude',
            status: 'success',
            startedAt: Math.floor(Date.now() / 1000) - 3600,
            finishedAt: Math.floor(Date.now() / 1000),
            waitSeconds: 10,
            durationSeconds: 300,
            throttledCount: 0,
          },
          {
            id: 2,
            projectPath: '/project',
            jobType: 'reviewer',
            providerKey: 'claude',
            status: 'failure',
            startedAt: Math.floor(Date.now() / 1000) - 3600,
            finishedAt: Math.floor(Date.now() / 1000),
            waitSeconds: 5,
            durationSeconds: 180,
            throttledCount: 0,
          },
        ],
        byProviderBucket: {},
        averageWaitSeconds: 7,
        oldestPendingAge: null,
      });

      const program = new Command();
      summaryCommand(program);

      await program.parseAsync(['node', 'test', 'summary']);

      const output = consoleSpy.mock.calls.map((call) => call.join(' ')).join('\n');
      expect(output).toContain('1 succeeded');
      expect(output).toContain('1 failed');
    });

    it('should generate action items for failed jobs', async () => {
      vi.mocked(getJobRunsAnalytics).mockReturnValue({
        recentRuns: [
          {
            id: 1,
            projectPath: '/project',
            jobType: 'executor',
            providerKey: 'claude',
            status: 'failure',
            startedAt: Math.floor(Date.now() / 1000) - 3600,
            finishedAt: Math.floor(Date.now() / 1000),
            waitSeconds: 10,
            durationSeconds: 300,
            throttledCount: 0,
          },
        ],
        byProviderBucket: {},
        averageWaitSeconds: null,
        oldestPendingAge: null,
      });

      const program = new Command();
      summaryCommand(program);

      await program.parseAsync(['node', 'test', 'summary']);

      const output = consoleSpy.mock.calls.map((call) => call.join(' ')).join('\n');
      expect(output).toContain('Action needed');
      expect(output).toContain('night-watch logs');
    });

    it('should show "No action needed" when all jobs healthy', async () => {
      vi.mocked(getJobRunsAnalytics).mockReturnValue({
        recentRuns: [
          {
            id: 1,
            projectPath: '/project',
            jobType: 'executor',
            providerKey: 'claude',
            status: 'success',
            startedAt: Math.floor(Date.now() / 1000) - 3600,
            finishedAt: Math.floor(Date.now() / 1000),
            waitSeconds: 10,
            durationSeconds: 300,
            throttledCount: 0,
          },
        ],
        byProviderBucket: {},
        averageWaitSeconds: null,
        oldestPendingAge: null,
      });

      vi.mocked(getQueueStatus).mockReturnValue({
        enabled: true,
        running: null,
        pending: { total: 0, byType: {}, byProviderBucket: {} },
        items: [],
        averageWaitSeconds: null,
        oldestPendingAge: null,
      });

      const program = new Command();
      summaryCommand(program);

      await program.parseAsync(['node', 'test', 'summary']);

      const output = consoleSpy.mock.calls.map((call) => call.join(' ')).join('\n');
      expect(output).toContain('No action needed');
    });
  });

  describe('PR data', () => {
    it('should generate action items for PRs with failing CI', async () => {
      vi.mocked(getJobRunsAnalytics).mockReturnValue({
        recentRuns: [
          {
            id: 1,
            projectPath: '/project',
            jobType: 'executor',
            providerKey: 'claude',
            status: 'success',
            startedAt: Math.floor(Date.now() / 1000) - 3600,
            finishedAt: Math.floor(Date.now() / 1000),
            waitSeconds: 10,
            durationSeconds: 300,
            throttledCount: 0,
          },
        ],
        byProviderBucket: {},
        averageWaitSeconds: null,
        oldestPendingAge: null,
      });

      vi.mocked(collectPrInfo).mockResolvedValue([
        {
          number: 42,
          title: 'Test PR',
          branch: 'feat/test',
          url: 'https://github.com/test/repo/pull/42',
          ciStatus: 'fail',
          reviewScore: null,
        },
      ]);

      const program = new Command();
      summaryCommand(program);

      await program.parseAsync(['node', 'test', 'summary']);

      const output = consoleSpy.mock.calls.map((call) => call.join(' ')).join('\n');
      expect(output).toContain('Action needed');
      expect(output).toContain('PR #42');
    });
  });
});
