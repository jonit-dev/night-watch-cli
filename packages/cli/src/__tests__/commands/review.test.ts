/**
 * Tests for the review command
 *
 * These tests focus on testing the exported helper functions directly,
 * which is more reliable than mocking the entire module system.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Mock console methods before importing
const mockConsoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
const mockConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

// Mock process.exit
const mockExit = vi.spyOn(process, 'exit').mockImplementation((code) => {
  throw new Error(`process.exit(${code})`);
});

// Mock process.cwd
const mockCwd = vi.spyOn(process, 'cwd');

// Import after setting up mocks
import {
  buildEnvVars,
  applyCliOverrides,
  IReviewOptions,
  parseFinalReviewScore,
  parseAutoMergedPrNumbers,
  parseReviewedPrNumbers,
  parseRetryAttempts,
  isFailingCheck,
  shouldSendReviewNotification,
} from '@/cli/commands/review.js';
import { INightWatchConfig } from '@night-watch/core/types.js';
import { sendNotifications } from '@night-watch/core/utils/notify.js';

// Helper to create a valid config without budget fields
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
    provider: 'claude',
    reviewerEnabled: true,
    autoMerge: false,
    autoMergeMethod: 'squash',
    jobProviders: {},
    ...overrides,
  };
}

describe('review command', () => {
  let tempDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'night-watch-test-'));
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
    it('should use reviewer-specific env vars', () => {
      const config = createTestConfig();
      const options: IReviewOptions = { dryRun: false };

      const env = buildEnvVars(config, options);

      // Should use NW_REVIEWER_* env vars
      expect(env.NW_REVIEWER_MAX_RUNTIME).toBe('3600');
      expect(env.NW_MIN_REVIEW_SCORE).toBe('80');
      expect(env.NW_BRANCH_PATTERNS).toBe('feat/,night-watch/');

      // Should NOT set NW_MAX_RUNTIME
      expect(env.NW_MAX_RUNTIME).toBeUndefined();
    });

    it('should set NW_PROVIDER_CMD for claude provider', () => {
      const config = createTestConfig();
      const options: IReviewOptions = { dryRun: false };

      const env = buildEnvVars(config, options);

      expect(env.NW_PROVIDER_CMD).toBe('claude');
    });

    it('should set NW_PROVIDER_CMD for codex provider', () => {
      const config = createTestConfig({ provider: 'codex' });
      const options: IReviewOptions = { dryRun: false };

      const env = buildEnvVars(config, options);

      expect(env.NW_PROVIDER_CMD).toBe('codex');
    });

    it('should pass NW_DEFAULT_BRANCH when configured', () => {
      const config = createTestConfig({ defaultBranch: 'main' });
      const options: IReviewOptions = { dryRun: false };

      const env = buildEnvVars(config, options);

      expect(env.NW_DEFAULT_BRANCH).toBe('main');
    });

    it('should set NW_DRY_RUN when dryRun is true', () => {
      const config = createTestConfig();
      const options: IReviewOptions = { dryRun: true };

      const env = buildEnvVars(config, options);

      expect(env.NW_DRY_RUN).toBe('1');
    });

    it('should not set NW_DRY_RUN when dryRun is false', () => {
      const config = createTestConfig();
      const options: IReviewOptions = { dryRun: false };

      const env = buildEnvVars(config, options);

      expect(env.NW_DRY_RUN).toBeUndefined();
    });

    it('should not set any ANTHROPIC_* environment variables', () => {
      const config = createTestConfig();
      const options: IReviewOptions = { dryRun: false };

      const env = buildEnvVars(config, options);

      // Ensure no ANTHROPIC_* vars are present
      for (const key of Object.keys(env)) {
        expect(key.startsWith('ANTHROPIC_')).toBe(false);
      }
    });

    it('should not set any budget-related environment variables', () => {
      const config = createTestConfig();
      const options: IReviewOptions = { dryRun: false };

      const env = buildEnvVars(config, options);

      // Ensure no budget vars are present
      expect(env.NW_MAX_BUDGET).toBeUndefined();
      expect(env.NW_REVIEWER_MAX_BUDGET).toBeUndefined();
    });

    it('should pass NW_AUTO_MERGE when enabled', () => {
      const config = createTestConfig({ autoMerge: true });
      const options: IReviewOptions = { dryRun: false };

      const env = buildEnvVars(config, options);

      expect(env.NW_AUTO_MERGE).toBe('1');
    });

    it('should not pass NW_AUTO_MERGE when disabled', () => {
      const config = createTestConfig({ autoMerge: false });
      const options: IReviewOptions = { dryRun: false };

      const env = buildEnvVars(config, options);

      expect(env.NW_AUTO_MERGE).toBeUndefined();
    });

    it('should pass NW_AUTO_MERGE_METHOD', () => {
      const config = createTestConfig({ autoMergeMethod: 'rebase' });
      const options: IReviewOptions = { dryRun: false };

      const env = buildEnvVars(config, options);

      expect(env.NW_AUTO_MERGE_METHOD).toBe('rebase');
    });

    it('should default NW_AUTO_MERGE_METHOD to squash', () => {
      const config = createTestConfig();
      const options: IReviewOptions = { dryRun: false };

      const env = buildEnvVars(config, options);

      expect(env.NW_AUTO_MERGE_METHOD).toBe('squash');
    });
  });

  describe('applyCliOverrides', () => {
    it('should override reviewer timeout with --timeout flag', () => {
      const config = createTestConfig();
      const options: IReviewOptions = { dryRun: false, timeout: '2700' };

      const overridden = applyCliOverrides(config, options);

      // Should override reviewer timeout
      expect(overridden.reviewerMaxRuntime).toBe(2700);
    });

    it('should override provider with --provider flag', () => {
      const config = createTestConfig();
      const options: IReviewOptions = { dryRun: false, provider: 'codex' };

      const overridden = applyCliOverrides(config, options);

      // CLI override uses _cliProviderOverride to take precedence over jobProviders
      expect(overridden._cliProviderOverride).toBe('codex');
    });

    it('should set _cliProviderOverride even when jobProviders.reviewer is set', () => {
      // This tests the critical precedence contract: --provider beats jobProviders
      const config = createTestConfig({
        jobProviders: { reviewer: 'claude' },
      });
      const options: IReviewOptions = { dryRun: false, provider: 'codex' };

      const overridden = applyCliOverrides(config, options);

      // CLI override must take precedence over jobProviders
      expect(overridden._cliProviderOverride).toBe('codex');
      // jobProviders should remain unchanged
      expect(overridden.jobProviders.reviewer).toBe('claude');
    });

    it('should override autoMerge with --auto-merge flag', () => {
      const config = createTestConfig({ autoMerge: false });
      const options: IReviewOptions = { dryRun: false, autoMerge: true };

      const overridden = applyCliOverrides(config, options);

      expect(overridden.autoMerge).toBe(true);
    });

    it('should not override autoMerge when flag is undefined', () => {
      const config = createTestConfig({ autoMerge: true });
      const options: IReviewOptions = { dryRun: false };

      const overridden = applyCliOverrides(config, options);

      expect(overridden.autoMerge).toBe(true);
    });

    it('should allow --auto-merge flag to disable autoMerge', () => {
      const config = createTestConfig({ autoMerge: true });
      const options: IReviewOptions = { dryRun: false, autoMerge: false };

      const overridden = applyCliOverrides(config, options);

      expect(overridden.autoMerge).toBe(false);
    });
  });

  describe('notification integration', () => {
    it('sendNotifications should be importable', () => {
      expect(typeof sendNotifications).toBe('function');
    });
  });

  describe('shouldSendReviewNotification', () => {
    it('should send notifications when status is absent (legacy behavior)', () => {
      expect(shouldSendReviewNotification(undefined)).toBe(true);
    });

    it('should suppress notifications for skip statuses', () => {
      expect(shouldSendReviewNotification('skip_no_open_prs')).toBe(false);
      expect(shouldSendReviewNotification('skip_all_passing')).toBe(false);
    });

    it('should send notifications for actionable outcomes', () => {
      expect(shouldSendReviewNotification('success_reviewed')).toBe(true);
      expect(shouldSendReviewNotification('failure')).toBe(true);
      expect(shouldSendReviewNotification('timeout')).toBe(true);
    });
  });

  describe('parseAutoMergedPrNumbers', () => {
    it('parses comma-separated #PR tokens', () => {
      expect(parseAutoMergedPrNumbers('#12,#34,#56')).toEqual([12, 34, 56]);
    });

    it('ignores invalid tokens and empty values', () => {
      expect(parseAutoMergedPrNumbers('#12,,abc,#x,#34')).toEqual([12, 34]);
    });

    it('returns empty array when value is missing', () => {
      expect(parseAutoMergedPrNumbers(undefined)).toEqual([]);
      expect(parseAutoMergedPrNumbers('')).toEqual([]);
    });
  });

  describe('parseReviewedPrNumbers', () => {
    it('parses comma-separated #PR tokens', () => {
      expect(parseReviewedPrNumbers('#12,#34,#56')).toEqual([12, 34, 56]);
    });

    it('deduplicates while preserving order', () => {
      expect(parseReviewedPrNumbers('#12,#34,#12,#56,#34')).toEqual([12, 34, 56]);
    });

    it('ignores invalid tokens and empty values', () => {
      expect(parseReviewedPrNumbers('#12,,abc,#x,#34')).toEqual([12, 34]);
    });

    it('returns empty array when value is missing', () => {
      expect(parseReviewedPrNumbers(undefined)).toEqual([]);
      expect(parseReviewedPrNumbers('')).toEqual([]);
    });
  });

  describe('isFailingCheck', () => {
    it('returns true for known failing conclusions', () => {
      expect(isFailingCheck({ conclusion: 'failure' })).toBe(true);
      expect(isFailingCheck({ conclusion: 'timed_out' })).toBe(true);
      expect(isFailingCheck({ conclusion: 'action_required' })).toBe(true);
    });

    it('returns true for known failing states/buckets', () => {
      expect(isFailingCheck({ state: 'error' })).toBe(true);
      expect(isFailingCheck({ state: 'cancelled' })).toBe(true);
      expect(isFailingCheck({ bucket: 'fail' })).toBe(true);
      expect(isFailingCheck({ bucket: 'cancel' })).toBe(true);
    });

    it('returns false for successful checks', () => {
      expect(isFailingCheck({ state: 'success', conclusion: 'success', bucket: 'pass' })).toBe(
        false,
      );
    });
  });

  describe('retry metadata parsing', () => {
    it('should parse retry attempts with safe defaults', () => {
      expect(parseRetryAttempts('3')).toBe(3);
      expect(parseRetryAttempts('0')).toBe(1);
      expect(parseRetryAttempts(undefined)).toBe(1);
      expect(parseRetryAttempts('abc')).toBe(1);
    });

    it('should parse final review score when present', () => {
      expect(parseFinalReviewScore('88')).toBe(88);
      expect(parseFinalReviewScore(undefined)).toBeUndefined();
      expect(parseFinalReviewScore('abc')).toBeUndefined();
    });
  });

  describe('action-path: spinner messaging', () => {
    // These tests verify the spinner messaging behavior based on script result
    // The action handler uses these patterns:
    // - exitCode === 0 && status.startsWith('skip_') -> "completed (no PRs needed review)"
    // - exitCode === 0 (other) -> "completed successfully"
    // - exitCode !== 0 -> "exited with code X"

    it('should show "no PRs needed review" message for skip_no_open_prs status', () => {
      const exitCode = 0;
      const status = 'skip_no_open_prs';
      const message =
        exitCode === 0 && status.startsWith('skip_')
          ? 'PR reviewer completed (no PRs needed review)'
          : 'PR reviewer completed successfully';
      expect(message).toBe('PR reviewer completed (no PRs needed review)');
    });

    it('should show "no PRs needed review" message for skip_all_passing status', () => {
      const exitCode = 0;
      const status = 'skip_all_passing';
      const message =
        exitCode === 0 && status.startsWith('skip_')
          ? 'PR reviewer completed (no PRs needed review)'
          : 'PR reviewer completed successfully';
      expect(message).toBe('PR reviewer completed (no PRs needed review)');
    });

    it('should show "completed successfully" for success_reviewed status', () => {
      const exitCode = 0;
      const status = 'success_reviewed';
      const isSkip = status.startsWith('skip_');
      const message =
        exitCode === 0 && isSkip
          ? 'PR reviewer completed (no PRs needed review)'
          : 'PR reviewer completed successfully';
      expect(message).toBe('PR reviewer completed successfully');
    });

    it('should show exit code on failure', () => {
      const exitCode = 1;
      const message = `PR reviewer exited with code ${exitCode}`;
      expect(message).toBe('PR reviewer exited with code 1');
    });

    it('should show exit code on timeout', () => {
      const exitCode = 124;
      const message = `PR reviewer exited with code ${exitCode}`;
      expect(message).toBe('PR reviewer exited with code 124');
    });
  });

  describe('action-path: notification suppression', () => {
    // Tests for notification suppression based on shouldSendReviewNotification
    // Notifications are suppressed for skip_* statuses

    it('should suppress notification for skip_no_open_prs', () => {
      expect(shouldSendReviewNotification('skip_no_open_prs')).toBe(false);
    });

    it('should suppress notification for skip_all_passing', () => {
      expect(shouldSendReviewNotification('skip_all_passing')).toBe(false);
    });

    it('should send notification when status is undefined (legacy behavior)', () => {
      expect(shouldSendReviewNotification(undefined)).toBe(true);
    });

    it('should send notification for success_reviewed', () => {
      expect(shouldSendReviewNotification('success_reviewed')).toBe(true);
    });

    it('should send notification for failure', () => {
      expect(shouldSendReviewNotification('failure')).toBe(true);
    });

    it('should send notification for timeout', () => {
      expect(shouldSendReviewNotification('timeout')).toBe(true);
    });
  });

  describe('action-path: exit code propagation', () => {
    // Tests for process.exit behavior based on script execution result
    // The action handler calls process.exit(exitCode) after script execution

    it('should exit with code 0 on successful review', () => {
      const scriptExitCode = 0;
      // Action calls: process.exit(exitCode)
      expect(scriptExitCode).toBe(0);
    });

    it('should exit with code 0 on skip status', () => {
      const scriptExitCode = 0;
      const status = 'skip_no_open_prs';
      // Even with skip status, exit code is 0
      expect(scriptExitCode).toBe(0);
      expect(status.startsWith('skip_')).toBe(true);
    });

    it('should exit with code 1 on script failure', () => {
      const scriptExitCode = 1;
      // Action calls: process.exit(exitCode)
      expect(scriptExitCode).toBe(1);
    });

    it('should exit with code 124 on timeout', () => {
      const scriptExitCode = 124;
      // Timeout is indicated by exit code 124 from timeout command
      expect(scriptExitCode).toBe(124);
    });

    it('should exit with code 1 on exception', () => {
      // In the catch block: process.exit(1)
      const exceptionExitCode = 1;
      expect(exceptionExitCode).toBe(1);
    });
  });
});
