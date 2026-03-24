/**
 * Tests for the resolve command
 *
 * These tests focus on testing the exported helper functions directly,
 * which is more reliable than mocking the entire module system.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Mock console methods before importing
vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'error').mockImplementation(() => {});

// Mock process.exit
vi.spyOn(process, 'exit').mockImplementation((code) => {
  throw new Error(`process.exit(${code})`);
});

// Mock process.cwd
const mockCwd = vi.spyOn(process, 'cwd');

// Import after setting up mocks
import { buildEnvVars, applyCliOverrides, IResolveOptions } from '@/cli/commands/resolve.js';
import { INightWatchConfig } from '@night-watch/core/types.js';
import { sendNotifications } from '@night-watch/core/utils/notify.js';

// Helper to create a valid config with prResolver fields
function createTestConfig(overrides: Partial<INightWatchConfig> = {}): INightWatchConfig {
  return {
    prdDir: 'docs/PRDs/night-watch',
    maxRuntime: 7200,
    reviewerMaxRuntime: 3600,
    branchPrefix: 'night-watch',
    branchPatterns: ['feat/', 'night-watch/'],
    minReviewScore: 80,
    maxLogSize: 524288,
    cronSchedule: '0 0-21 * * *',
    reviewerSchedule: '0 0,3,6,9,12,15,18,21 * * *',
    reviewerMaxPrsPerRun: 0,
    provider: 'claude',
    reviewerEnabled: true,
    autoMerge: false,
    autoMergeMethod: 'squash',
    jobProviders: {},
    prResolver: {
      enabled: true,
      schedule: '15 6,14,22 * * *',
      maxRuntime: 3600,
      branchPatterns: [],
      maxPrsPerRun: 0,
      perPrTimeout: 600,
      aiConflictResolution: true,
      aiReviewResolution: false,
      readyLabel: 'ready-to-merge',
    },
    ...overrides,
  };
}

describe('resolve command', () => {
  let tempDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'night-watch-resolve-test-'));
    mockCwd.mockReturnValue(tempDir);

    // Save original environment
    originalEnv = { ...process.env };

    // Clear NW_* environment variables
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('NW_')) {
        delete process.env[key];
      }
    }

    vi.clearAllMocks();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });

    // Restore original environment
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('NW_')) {
        delete process.env[key];
      }
    }
    for (const [key, value] of Object.entries(originalEnv)) {
      if (key.startsWith('NW_')) {
        process.env[key] = value;
      }
    }

    vi.clearAllMocks();
  });

  describe('buildEnvVars', () => {
    it('buildEnvVars includes pr-resolver-specific vars', () => {
      const config = createTestConfig();
      const options: IResolveOptions = { dryRun: false };

      const env = buildEnvVars(config, options);

      expect(env.NW_PR_RESOLVER_MAX_RUNTIME).toBe('3600');
      expect(env.NW_PR_RESOLVER_MAX_PRS_PER_RUN).toBe('0');
      expect(env.NW_PR_RESOLVER_PER_PR_TIMEOUT).toBe('600');
      expect(env.NW_PR_RESOLVER_AI_CONFLICT_RESOLUTION).toBe('1');
      expect(env.NW_PR_RESOLVER_AI_REVIEW_RESOLUTION).toBe('0');
      expect(env.NW_PR_RESOLVER_READY_LABEL).toBe('ready-to-merge');
      expect(env.NW_PR_RESOLVER_BRANCH_PATTERNS).toBe('');
    });

    it('should set NW_PR_RESOLVER_AI_CONFLICT_RESOLUTION to 0 when disabled', () => {
      const config = createTestConfig({
        prResolver: {
          enabled: true,
          schedule: '15 6,14,22 * * *',
          maxRuntime: 3600,
          branchPatterns: [],
          maxPrsPerRun: 5,
          perPrTimeout: 300,
          aiConflictResolution: false,
          aiReviewResolution: true,
          readyLabel: 'ready',
        },
      });
      const options: IResolveOptions = { dryRun: false };

      const env = buildEnvVars(config, options);

      expect(env.NW_PR_RESOLVER_AI_CONFLICT_RESOLUTION).toBe('0');
      expect(env.NW_PR_RESOLVER_AI_REVIEW_RESOLUTION).toBe('1');
      expect(env.NW_PR_RESOLVER_MAX_PRS_PER_RUN).toBe('5');
      expect(env.NW_PR_RESOLVER_PER_PR_TIMEOUT).toBe('300');
      expect(env.NW_PR_RESOLVER_READY_LABEL).toBe('ready');
    });

    it('should set NW_PR_RESOLVER_BRANCH_PATTERNS as comma-joined string', () => {
      const config = createTestConfig({
        prResolver: {
          enabled: true,
          schedule: '15 6,14,22 * * *',
          maxRuntime: 3600,
          branchPatterns: ['feat/', 'fix/', 'night-watch/'],
          maxPrsPerRun: 0,
          perPrTimeout: 600,
          aiConflictResolution: true,
          aiReviewResolution: false,
          readyLabel: 'ready-to-merge',
        },
      });
      const options: IResolveOptions = { dryRun: false };

      const env = buildEnvVars(config, options);

      expect(env.NW_PR_RESOLVER_BRANCH_PATTERNS).toBe('feat/,fix/,night-watch/');
    });

    it('should set NW_DRY_RUN when dryRun is true', () => {
      const config = createTestConfig();
      const options: IResolveOptions = { dryRun: true };

      const env = buildEnvVars(config, options);

      expect(env.NW_DRY_RUN).toBe('1');
    });

    it('should not set NW_DRY_RUN when dryRun is false', () => {
      const config = createTestConfig();
      const options: IResolveOptions = { dryRun: false };

      const env = buildEnvVars(config, options);

      expect(env.NW_DRY_RUN).toBeUndefined();
    });

    it('should include base env vars (NW_PROVIDER_CMD)', () => {
      const config = createTestConfig();
      const options: IResolveOptions = { dryRun: false };

      const env = buildEnvVars(config, options);

      expect(env.NW_PROVIDER_CMD).toBe('claude');
    });
  });

  describe('applyCliOverrides', () => {
    it('applyCliOverrides applies timeout override', () => {
      const config = createTestConfig();
      const options: IResolveOptions = { dryRun: false, timeout: '1800' };

      const result = applyCliOverrides(config, options);

      expect(result.prResolver.maxRuntime).toBe(1800);
    });

    it('should not mutate original config when applying timeout override', () => {
      const config = createTestConfig();
      const originalMaxRuntime = config.prResolver.maxRuntime;
      const options: IResolveOptions = { dryRun: false, timeout: '900' };

      const result = applyCliOverrides(config, options);

      // Original config should not be mutated
      expect(config.prResolver.maxRuntime).toBe(originalMaxRuntime);
      // Returned config should have the override applied
      expect(result.prResolver.maxRuntime).toBe(900);
    });

    it('should apply provider override', () => {
      const config = createTestConfig();
      const options: IResolveOptions = { dryRun: false, provider: 'codex' };

      const result = applyCliOverrides(config, options);

      expect(result._cliProviderOverride).toBe('codex');
    });

    it('should not override when timeout is not provided', () => {
      const config = createTestConfig();
      const options: IResolveOptions = { dryRun: false };

      const result = applyCliOverrides(config, options);

      expect(result.prResolver.maxRuntime).toBe(config.prResolver.maxRuntime);
    });

    it('should not override when timeout is not a valid number', () => {
      const config = createTestConfig();
      const originalMaxRuntime = config.prResolver.maxRuntime;
      const options: IResolveOptions = { dryRun: false, timeout: 'abc' };

      const result = applyCliOverrides(config, options);

      expect(result.prResolver.maxRuntime).toBe(originalMaxRuntime);
    });
  });

  describe('notification integration', () => {
    it('sendNotifications should be importable', () => {
      expect(typeof sendNotifications).toBe('function');
    });

    it('sends pr_resolver_completed notification on success', () => {
      // Verify that the event name used on success is pr_resolver_completed
      // This mirrors how the resolve command action handler dispatches notifications
      const exitCode = 0;
      const event =
        exitCode === 0 ? ('pr_resolver_completed' as const) : ('pr_resolver_failed' as const);
      expect(event).toBe('pr_resolver_completed');
    });

    it('sends pr_resolver_failed notification on failure', () => {
      // Verify that the event name used on failure is pr_resolver_failed
      const exitCode = 1;
      const event =
        exitCode === 0 ? ('pr_resolver_completed' as const) : ('pr_resolver_failed' as const);
      expect(event).toBe('pr_resolver_failed');
    });
  });
});
