/**
 * Tests for the scheduling utilities
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isJobTypeEnabled, getSchedulingPlan } from '../utils/scheduling.js';
import { loadRegistry } from '../utils/registry.js';
import { loadConfig } from '../config.js';
import { INightWatchConfig } from '../types.js';

vi.mock('../utils/registry.js', () => ({
  loadRegistry: vi.fn(() => []),
}));

vi.mock('../config.js', () => ({
  loadConfig: vi.fn(),
}));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: vi.fn(() => true),
  };
});

describe('scheduling', () => {
  describe('isJobTypeEnabled', () => {
    const baseConfig: INightWatchConfig = {
      defaultBranch: 'main',
      prdDir: 'docs/prds',
      maxRuntime: 7200,
      reviewerMaxRuntime: 1800,
      branchPrefix: 'night-watch/',
      branchPatterns: ['night-watch/'],
      minReviewScore: 70,
      maxLogSize: 10485760,
      cronSchedule: '0 2 * * *',
      reviewerSchedule: '50 3 * * 1',
      scheduleBundleId: null,
      cronScheduleOffset: 0,
      schedulingPriority: 3,
      maxRetries: 3,
      reviewerMaxRetries: 2,
      reviewerRetryDelay: 30,
      provider: 'claude',
      executorEnabled: true,
      reviewerEnabled: true,
      providerEnv: {},
      notifications: { webhooks: [] },
      prdPriority: [],
      roadmapScanner: {
        enabled: false,
        roadmapPath: 'ROADMAP.md',
        autoScanInterval: 300,
        slicerSchedule: '0 4 * * *',
        slicerMaxRuntime: 900,
        priorityMode: 'roadmap-first',
        issueColumn: 'Draft',
      },
      templatesDir: 'templates',
      boardProvider: {
        enabled: false,
        provider: 'github',
      },
      autoMerge: false,
      autoMergeMethod: 'squash',
      fallbackOnRateLimit: true,
      claudeModel: 'sonnet',
      qa: {
        enabled: false,
        schedule: '0 3 * * *',
        maxRuntime: 1800,
        branchPatterns: ['night-watch/'],
        artifacts: 'both',
        skipLabel: 'qa-skip',
        autoInstallPlaywright: true,
      },
      audit: {
        enabled: true,
        schedule: '50 3 * * 1',
        maxRuntime: 1800,
      },
      analytics: {
        enabled: false,
        schedule: '0 6 * * 1',
        maxRuntime: 900,
        lookbackDays: 7,
        targetColumn: 'Draft',
        analysisPrompt: 'Default prompt',
      },
      jobProviders: {},
      queue: {
        enabled: false,
        mode: 'conservative',
        maxConcurrency: 1,
        maxWaitTime: 3600,
        priority: {
          executor: 100,
          reviewer: 90,
          qa: 80,
          audit: 10,
          slicer: 70,
          analytics: 10,
        },
        providerBuckets: {},
      },
    };

    it('should report analytics as disabled when config.analytics.enabled is false', () => {
      expect(isJobTypeEnabled(baseConfig, 'analytics')).toBe(false);
    });

    it('should report analytics as enabled when config.analytics.enabled is true', () => {
      const config = { ...baseConfig, analytics: { ...baseConfig.analytics, enabled: true } };
      expect(isJobTypeEnabled(config, 'analytics')).toBe(true);
    });

    it('should report executor as enabled when config.executorEnabled is not false', () => {
      expect(isJobTypeEnabled(baseConfig, 'executor')).toBe(true);
    });

    it('should report executor as disabled when config.executorEnabled is false', () => {
      const config = { ...baseConfig, executorEnabled: false };
      expect(isJobTypeEnabled(config, 'executor')).toBe(false);
    });

    it('should report reviewer as enabled when config.reviewerEnabled is true', () => {
      expect(isJobTypeEnabled(baseConfig, 'reviewer')).toBe(true);
    });

    it('should report reviewer as disabled when config.reviewerEnabled is false', () => {
      const config = { ...baseConfig, reviewerEnabled: false };
      expect(isJobTypeEnabled(config, 'reviewer')).toBe(false);
    });

    it('should report qa as enabled when config.qa.enabled is true', () => {
      const config = { ...baseConfig, qa: { ...baseConfig.qa, enabled: true } };
      expect(isJobTypeEnabled(config, 'qa')).toBe(true);
    });

    it('should report qa as disabled when config.qa.enabled is false', () => {
      expect(isJobTypeEnabled(baseConfig, 'qa')).toBe(false);
    });

    it('should report audit as enabled when config.audit.enabled is true', () => {
      expect(isJobTypeEnabled(baseConfig, 'audit')).toBe(true);
    });

    it('should report audit as disabled when config.audit.enabled is false', () => {
      const config = { ...baseConfig, audit: { ...baseConfig.audit, enabled: false } };
      expect(isJobTypeEnabled(config, 'audit')).toBe(false);
    });

    it('should report slicer as enabled when config.roadmapScanner.enabled is true', () => {
      const config = { ...baseConfig, roadmapScanner: { ...baseConfig.roadmapScanner, enabled: true } };
      expect(isJobTypeEnabled(config, 'slicer')).toBe(true);
    });

    it('should report slicer as disabled when config.roadmapScanner.enabled is false', () => {
      expect(isJobTypeEnabled(baseConfig, 'slicer')).toBe(false);
    });

    it('should return true for unknown job types', () => {
      expect(isJobTypeEnabled(baseConfig, 'unknown' as never)).toBe(true);
    });
  });

  describe('getSchedulingPlan — schedule equivalence filtering', () => {
    const makeConfig = (overrides: Partial<INightWatchConfig>): INightWatchConfig => ({
      defaultBranch: 'main',
      prdDir: 'docs/prds',
      maxRuntime: 7200,
      reviewerMaxRuntime: 1800,
      branchPrefix: 'night-watch/',
      branchPatterns: ['night-watch/'],
      minReviewScore: 70,
      maxLogSize: 10485760,
      cronSchedule: '5 * * * *',
      reviewerSchedule: '50 3 * * 1',
      scheduleBundleId: null,
      cronScheduleOffset: 0,
      schedulingPriority: 3,
      maxRetries: 3,
      reviewerMaxRetries: 2,
      reviewerRetryDelay: 30,
      provider: 'claude',
      executorEnabled: true,
      reviewerEnabled: true,
      providerEnv: {},
      notifications: { webhooks: [] },
      prdPriority: [],
      roadmapScanner: {
        enabled: false,
        roadmapPath: 'ROADMAP.md',
        autoScanInterval: 300,
        slicerSchedule: '0 4 * * *',
        slicerMaxRuntime: 900,
        priorityMode: 'roadmap-first',
        issueColumn: 'Draft',
      },
      templatesDir: 'templates',
      boardProvider: { enabled: false, provider: 'github' },
      autoMerge: false,
      autoMergeMethod: 'squash',
      fallbackOnRateLimit: true,
      claudeModel: 'sonnet',
      qa: {
        enabled: false,
        schedule: '0 3 * * *',
        maxRuntime: 1800,
        branchPatterns: ['night-watch/'],
        artifacts: 'both',
        skipLabel: 'qa-skip',
        autoInstallPlaywright: true,
      },
      audit: {
        enabled: false,
        schedule: '50 3 * * 1',
        maxRuntime: 1800,
      },
      analytics: {
        enabled: false,
        schedule: '0 6 * * 1',
        maxRuntime: 900,
        lookbackDays: 7,
        targetColumn: 'Draft',
        analysisPrompt: 'Default prompt',
      },
      jobProviders: {},
      queue: {
        enabled: false,
        mode: 'conservative',
        maxConcurrency: 1,
        maxWaitTime: 3600,
        priority: {
          executor: 100,
          reviewer: 90,
          qa: 80,
          audit: 10,
          slicer: 70,
          analytics: 10,
        },
        providerBuckets: {},
      },
      ...overrides,
    });

    const CURRENT_DIR = '/projects/alpha';
    const PEER_DIR = '/projects/beta';

    beforeEach(() => {
      vi.resetAllMocks();
    });

    it('excludes peers with a different cronSchedule from balancing', () => {
      const currentConfig = makeConfig({ cronSchedule: '5 * * * *' });
      const peerConfig = makeConfig({ cronSchedule: '0 */6 * * *' });

      vi.mocked(loadRegistry).mockReturnValue([{ name: 'beta', path: PEER_DIR }]);
      vi.mocked(loadConfig).mockReturnValue(peerConfig);

      const plan = getSchedulingPlan(CURRENT_DIR, currentConfig, 'executor');

      // The peer has a different schedule so only the current project counts
      expect(plan.peerCount).toBe(1);
      expect(plan.balancedDelayMinutes).toBe(0);
    });

    it('includes peers with the same cronSchedule in balancing', () => {
      const sharedSchedule = '5 * * * *';
      const currentConfig = makeConfig({ cronSchedule: sharedSchedule });
      const peerConfig = makeConfig({ cronSchedule: sharedSchedule });

      vi.mocked(loadRegistry).mockReturnValue([{ name: 'beta', path: PEER_DIR }]);
      vi.mocked(loadConfig).mockReturnValue(peerConfig);

      const plan = getSchedulingPlan(CURRENT_DIR, currentConfig, 'executor');

      // Both projects share the same schedule, so peerCount should be 2
      expect(plan.peerCount).toBe(2);
    });
  });
});
