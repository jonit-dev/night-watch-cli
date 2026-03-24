/**
 * Tests for summary data aggregator utility
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Mock dependencies
vi.mock('../../utils/job-queue.js', () => ({
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

vi.mock('../../utils/status-data.js', () => ({
  collectPrInfo: vi.fn(async () => []),
}));

// Import after mocking
import { getSummaryData } from '../../utils/summary.js';
import { getJobRunsAnalytics, getQueueStatus } from '../../utils/job-queue.js';
import { collectPrInfo } from '../../utils/status-data.js';

describe('getSummaryData', () => {
  let tempDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-summary-test-'));

    // Reset mocks to default values
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
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('windowHours', () => {
    it('should default to 12 hours', async () => {
      const data = await getSummaryData(tempDir);
      expect(data.windowHours).toBe(12);
    });

    it('should respect custom window hours', async () => {
      const data = await getSummaryData(tempDir, 24);
      expect(data.windowHours).toBe(24);
      expect(getJobRunsAnalytics).toHaveBeenCalledWith(24);
    });
  });

  describe('job counts', () => {
    it('should return zero counts when no job runs', async () => {
      const data = await getSummaryData(tempDir);
      expect(data.counts.total).toBe(0);
      expect(data.counts.succeeded).toBe(0);
      expect(data.counts.failed).toBe(0);
      expect(data.counts.timedOut).toBe(0);
      expect(data.counts.rateLimited).toBe(0);
      expect(data.counts.skipped).toBe(0);
    });

    it('should count succeeded jobs', async () => {
      vi.mocked(getJobRunsAnalytics).mockReturnValue({
        recentRuns: [
          {
            id: 1,
            projectPath: tempDir,
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
            projectPath: tempDir,
            jobType: 'reviewer',
            providerKey: 'claude',
            status: 'success',
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

      const data = await getSummaryData(tempDir);
      expect(data.counts.total).toBe(2);
      expect(data.counts.succeeded).toBe(2);
    });

    it('should count failed jobs', async () => {
      vi.mocked(getJobRunsAnalytics).mockReturnValue({
        recentRuns: [
          {
            id: 1,
            projectPath: tempDir,
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

      const data = await getSummaryData(tempDir);
      expect(data.counts.failed).toBe(1);
    });

    it('should count timed out jobs', async () => {
      vi.mocked(getJobRunsAnalytics).mockReturnValue({
        recentRuns: [
          {
            id: 1,
            projectPath: tempDir,
            jobType: 'executor',
            providerKey: 'claude',
            status: 'timeout',
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

      const data = await getSummaryData(tempDir);
      expect(data.counts.timedOut).toBe(1);
    });

    it('should count rate limited jobs', async () => {
      vi.mocked(getJobRunsAnalytics).mockReturnValue({
        recentRuns: [
          {
            id: 1,
            projectPath: tempDir,
            jobType: 'executor',
            providerKey: 'claude',
            status: 'rate_limited',
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

      const data = await getSummaryData(tempDir);
      expect(data.counts.rateLimited).toBe(1);
    });

    it('should count skipped jobs', async () => {
      vi.mocked(getJobRunsAnalytics).mockReturnValue({
        recentRuns: [
          {
            id: 1,
            projectPath: tempDir,
            jobType: 'executor',
            providerKey: 'claude',
            status: 'skipped',
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

      const data = await getSummaryData(tempDir);
      expect(data.counts.skipped).toBe(1);
    });

    it('should count mixed job statuses correctly', async () => {
      vi.mocked(getJobRunsAnalytics).mockReturnValue({
        recentRuns: [
          {
            id: 1,
            projectPath: tempDir,
            jobType: 'executor',
            providerKey: 'claude',
            status: 'success',
            startedAt: 1,
            finishedAt: 2,
            waitSeconds: 0,
            durationSeconds: 1,
            throttledCount: 0,
          },
          {
            id: 2,
            projectPath: tempDir,
            jobType: 'executor',
            providerKey: 'claude',
            status: 'failure',
            startedAt: 1,
            finishedAt: 2,
            waitSeconds: 0,
            durationSeconds: 1,
            throttledCount: 0,
          },
          {
            id: 3,
            projectPath: tempDir,
            jobType: 'executor',
            providerKey: 'claude',
            status: 'timeout',
            startedAt: 1,
            finishedAt: 2,
            waitSeconds: 0,
            durationSeconds: 1,
            throttledCount: 0,
          },
          {
            id: 4,
            projectPath: tempDir,
            jobType: 'executor',
            providerKey: 'claude',
            status: 'rate_limited',
            startedAt: 1,
            finishedAt: 2,
            waitSeconds: 0,
            durationSeconds: 1,
            throttledCount: 0,
          },
          {
            id: 5,
            projectPath: tempDir,
            jobType: 'executor',
            providerKey: 'claude',
            status: 'skipped',
            startedAt: 1,
            finishedAt: 2,
            waitSeconds: 0,
            durationSeconds: 1,
            throttledCount: 0,
          },
        ],
        byProviderBucket: {},
        averageWaitSeconds: null,
        oldestPendingAge: null,
      });

      const data = await getSummaryData(tempDir);
      expect(data.counts.total).toBe(5);
      expect(data.counts.succeeded).toBe(1);
      expect(data.counts.failed).toBe(1);
      expect(data.counts.timedOut).toBe(1);
      expect(data.counts.rateLimited).toBe(1);
      expect(data.counts.skipped).toBe(1);
    });
  });

  describe('action items', () => {
    it('should return empty action items when all healthy', async () => {
      vi.mocked(getJobRunsAnalytics).mockReturnValue({
        recentRuns: [
          {
            id: 1,
            projectPath: tempDir,
            jobType: 'executor',
            providerKey: 'claude',
            status: 'success',
            startedAt: 1,
            finishedAt: 2,
            waitSeconds: 0,
            durationSeconds: 1,
            throttledCount: 0,
          },
        ],
        byProviderBucket: {},
        averageWaitSeconds: null,
        oldestPendingAge: null,
      });

      const data = await getSummaryData(tempDir);
      expect(data.actionItems).toHaveLength(0);
    });

    it('should include action item for failed jobs', async () => {
      vi.mocked(getJobRunsAnalytics).mockReturnValue({
        recentRuns: [
          {
            id: 1,
            projectPath: tempDir,
            jobType: 'executor',
            providerKey: 'claude',
            status: 'failure',
            startedAt: 1,
            finishedAt: 2,
            waitSeconds: 0,
            durationSeconds: 1,
            throttledCount: 0,
          },
        ],
        byProviderBucket: {},
        averageWaitSeconds: null,
        oldestPendingAge: null,
      });

      const data = await getSummaryData(tempDir);
      expect(data.actionItems).toHaveLength(1);
      expect(data.actionItems[0]).toContain('failed job');
      expect(data.actionItems[0]).toContain('night-watch logs');
    });

    it('should include action item for timed out jobs', async () => {
      vi.mocked(getJobRunsAnalytics).mockReturnValue({
        recentRuns: [
          {
            id: 1,
            projectPath: tempDir,
            jobType: 'executor',
            providerKey: 'claude',
            status: 'timeout',
            startedAt: 1,
            finishedAt: 2,
            waitSeconds: 0,
            durationSeconds: 1,
            throttledCount: 0,
          },
        ],
        byProviderBucket: {},
        averageWaitSeconds: null,
        oldestPendingAge: null,
      });

      const data = await getSummaryData(tempDir);
      expect(data.actionItems).toHaveLength(1);
      expect(data.actionItems[0]).toContain('timed out job');
    });

    it('should include action item for rate limited jobs', async () => {
      vi.mocked(getJobRunsAnalytics).mockReturnValue({
        recentRuns: [
          {
            id: 1,
            projectPath: tempDir,
            jobType: 'executor',
            providerKey: 'claude',
            status: 'rate_limited',
            startedAt: 1,
            finishedAt: 2,
            waitSeconds: 0,
            durationSeconds: 1,
            throttledCount: 0,
          },
        ],
        byProviderBucket: {},
        averageWaitSeconds: null,
        oldestPendingAge: null,
      });

      const data = await getSummaryData(tempDir);
      expect(data.actionItems).toHaveLength(1);
      expect(data.actionItems[0]).toContain('rate-limited job');
    });

    it('should include action item for PRs with failing CI', async () => {
      vi.mocked(getJobRunsAnalytics).mockReturnValue({
        recentRuns: [
          {
            id: 1,
            projectPath: tempDir,
            jobType: 'executor',
            providerKey: 'claude',
            status: 'success',
            startedAt: 1,
            finishedAt: 2,
            waitSeconds: 0,
            durationSeconds: 1,
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
          labels: [],
        },
      ]);

      const data = await getSummaryData(tempDir);
      const ciActionItem = data.actionItems.find((item) => item.includes('PR #42'));
      expect(ciActionItem).toBeDefined();
      expect(ciActionItem).toContain('failing CI');
    });

    it('should include action item for PRs with ready-to-merge label', async () => {
      vi.mocked(collectPrInfo).mockResolvedValue([
        {
          number: 7,
          title: 'Ready PR',
          branch: 'feat/ready',
          url: 'https://github.com/test/repo/pull/7',
          ciStatus: 'pass',
          reviewScore: 100,
          labels: ['ready-to-merge'],
        },
      ]);

      const data = await getSummaryData(tempDir);
      const readyActionItem = data.actionItems.find((item) => item.includes('ready-to-merge'));
      expect(readyActionItem).toBeDefined();
      expect(readyActionItem).toContain('1 PR');
    });

    it('should include action item for pending queue items', async () => {
      vi.mocked(getJobRunsAnalytics).mockReturnValue({
        recentRuns: [
          {
            id: 1,
            projectPath: tempDir,
            jobType: 'executor',
            providerKey: 'claude',
            status: 'success',
            startedAt: 1,
            finishedAt: 2,
            waitSeconds: 0,
            durationSeconds: 1,
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
        pending: { total: 1, byType: { executor: 1 }, byProviderBucket: {} },
        items: [
          {
            id: 100,
            projectPath: tempDir,
            projectName: 'test-project',
            jobType: 'executor',
            providerKey: 'claude',
            status: 'pending',
            envJson: {},
            createdAt: Math.floor(Date.now() / 1000),
          },
        ],
        averageWaitSeconds: null,
        oldestPendingAge: null,
      });

      const data = await getSummaryData(tempDir);
      const queueActionItem = data.actionItems.find((item) => item.includes('pending in queue'));
      expect(queueActionItem).toBeDefined();
    });

    it('should use singular "job" for single items', async () => {
      vi.mocked(getJobRunsAnalytics).mockReturnValue({
        recentRuns: [
          {
            id: 1,
            projectPath: tempDir,
            jobType: 'executor',
            providerKey: 'claude',
            status: 'failure',
            startedAt: 1,
            finishedAt: 2,
            waitSeconds: 0,
            durationSeconds: 1,
            throttledCount: 0,
          },
        ],
        byProviderBucket: {},
        averageWaitSeconds: null,
        oldestPendingAge: null,
      });

      const data = await getSummaryData(tempDir);
      expect(data.actionItems[0]).toContain('1 failed job');
      expect(data.actionItems[0]).not.toContain('jobs');
    });

    it('should use plural "jobs" for multiple items', async () => {
      vi.mocked(getJobRunsAnalytics).mockReturnValue({
        recentRuns: [
          {
            id: 1,
            projectPath: tempDir,
            jobType: 'executor',
            providerKey: 'claude',
            status: 'failure',
            startedAt: 1,
            finishedAt: 2,
            waitSeconds: 0,
            durationSeconds: 1,
            throttledCount: 0,
          },
          {
            id: 2,
            projectPath: tempDir,
            jobType: 'executor',
            providerKey: 'claude',
            status: 'failure',
            startedAt: 1,
            finishedAt: 2,
            waitSeconds: 0,
            durationSeconds: 1,
            throttledCount: 0,
          },
        ],
        byProviderBucket: {},
        averageWaitSeconds: null,
        oldestPendingAge: null,
      });

      const data = await getSummaryData(tempDir);
      expect(data.actionItems[0]).toContain('2 failed jobs');
    });
  });

  describe('PR integration', () => {
    it('should pass branch patterns to collectPrInfo', async () => {
      await getSummaryData(tempDir, 12, ['feat/', 'fix/']);
      expect(collectPrInfo).toHaveBeenCalledWith(tempDir, ['feat/', 'fix/']);
    });

    it('should include open PRs in response', async () => {
      vi.mocked(collectPrInfo).mockResolvedValue([
        {
          number: 1,
          title: 'Test PR',
          branch: 'feat/test',
          url: 'https://github.com/test/repo/pull/1',
          ciStatus: 'pass',
          reviewScore: 85,
          labels: [],
        },
      ]);

      const data = await getSummaryData(tempDir);
      expect(data.openPrs).toHaveLength(1);
      expect(data.openPrs[0].number).toBe(1);
    });
  });

  describe('queue integration', () => {
    it('should only include pending queue items', async () => {
      vi.mocked(getQueueStatus).mockReturnValue({
        enabled: true,
        running: {
          id: 50,
          projectPath: tempDir,
          projectName: 'test',
          jobType: 'executor',
          providerKey: 'claude',
          status: 'running',
          envJson: {},
          createdAt: Math.floor(Date.now() / 1000),
          startedAt: Math.floor(Date.now() / 1000),
        },
        pending: { total: 1, byType: {}, byProviderBucket: {} },
        items: [
          {
            id: 100,
            projectPath: tempDir,
            projectName: 'test-project',
            jobType: 'executor',
            providerKey: 'claude',
            status: 'pending',
            envJson: {},
            createdAt: Math.floor(Date.now() / 1000),
          },
          {
            id: 50,
            projectPath: tempDir,
            projectName: 'test-project',
            jobType: 'executor',
            providerKey: 'claude',
            status: 'running',
            envJson: {},
            createdAt: Math.floor(Date.now() / 1000),
            startedAt: Math.floor(Date.now() / 1000),
          },
        ],
        averageWaitSeconds: null,
        oldestPendingAge: null,
      });

      const data = await getSummaryData(tempDir);
      expect(data.pendingQueueItems).toHaveLength(1);
      expect(data.pendingQueueItems[0].status).toBe('pending');
    });
  });
});
