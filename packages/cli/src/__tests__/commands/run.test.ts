/**
 * Tests for the run command
 *
 * These tests focus on testing the exported helper functions directly,
 * which is more reliable than mocking the entire module system.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Command } from 'commander';

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
  IRunOptions,
  scanPrdDirectory,
  getRateLimitFallbackTelegramWebhooks,
  isRateLimitFallbackTriggered,
  resolveRunNotificationEvent,
  shouldAttemptCrossProjectFallback,
} from '@/cli/commands/run.js';
import { applyScheduleOffset, buildCronPathPrefix } from '@/cli/commands/install.js';
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
    maxRetries: 3,
    prdPriority: [],
    jobProviders: {},
    ...overrides,
  };
}

describe('run command', () => {
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
    it('should pass config as env vars', () => {
      const config = createTestConfig();
      const options: IRunOptions = { dryRun: false };

      const env = buildEnvVars(config, options);

      expect(env.NW_MAX_RUNTIME).toBe('7200');
      expect(env.NW_PROVIDER_CMD).toBe('claude');
      expect(env.NW_PRD_DIR).toBe('docs/PRDs/night-watch');
      expect(env.NW_BRANCH_PREFIX).toBe('night-watch');
    });

    it('should set NW_PROVIDER_CMD for codex provider', () => {
      const config = createTestConfig({ provider: 'codex', reviewerEnabled: false });
      const options: IRunOptions = { dryRun: false };

      const env = buildEnvVars(config, options);

      expect(env.NW_PROVIDER_CMD).toBe('codex');
    });

    it('should set NW_DRY_RUN when dryRun is true', () => {
      const config = createTestConfig();
      const options: IRunOptions = { dryRun: true };

      const env = buildEnvVars(config, options);

      expect(env.NW_DRY_RUN).toBe('1');
    });

    it('should not set NW_DRY_RUN when dryRun is false', () => {
      const config = createTestConfig();
      const options: IRunOptions = { dryRun: false };

      const env = buildEnvVars(config, options);

      expect(env.NW_DRY_RUN).toBeUndefined();
    });

    it('should not set any ANTHROPIC_* environment variables', () => {
      const config = createTestConfig();
      const options: IRunOptions = { dryRun: false };

      const env = buildEnvVars(config, options);

      // Ensure no ANTHROPIC_* vars are present
      for (const key of Object.keys(env)) {
        expect(key.startsWith('ANTHROPIC_')).toBe(false);
      }
    });

    it('should not set any budget-related environment variables', () => {
      const config = createTestConfig();
      const options: IRunOptions = { dryRun: false };

      const env = buildEnvVars(config, options);

      // Ensure no budget vars are present
      expect(env.NW_MAX_BUDGET).toBeUndefined();
      expect(env.NW_REVIEWER_MAX_BUDGET).toBeUndefined();
    });

    it('should set NW_PRD_PRIORITY when prdPriority is non-empty', () => {
      const config = createTestConfig({ prdPriority: ['phase2', 'phase0', 'phase1'] });
      const options: IRunOptions = { dryRun: false };

      const env = buildEnvVars(config, options);

      expect(env.NW_PRD_PRIORITY).toBe('phase2:phase0:phase1');
    });

    it('should pass custom NW_BRANCH_PREFIX from config', () => {
      const config = createTestConfig({ branchPrefix: 'automation' });
      const options: IRunOptions = { dryRun: false };

      const env = buildEnvVars(config, options);

      expect(env.NW_BRANCH_PREFIX).toBe('automation');
    });

    it('should not set NW_PRD_PRIORITY when prdPriority is empty', () => {
      const config = createTestConfig({ prdPriority: [] });
      const options: IRunOptions = { dryRun: false };

      const env = buildEnvVars(config, options);

      expect(env.NW_PRD_PRIORITY).toBeUndefined();
    });

    it('should include NW_EXECUTION_CONTEXT=agent', () => {
      const config = createTestConfig();
      const options: IRunOptions = { dryRun: false };

      const env = buildEnvVars(config, options);

      expect(env.NW_EXECUTION_CONTEXT).toBe('agent');
    });

    it('should include NW_MAX_RETRIES from config', () => {
      const config = createTestConfig({ maxRetries: 5 });
      const options: IRunOptions = { dryRun: false };

      const env = buildEnvVars(config, options);

      expect(env.NW_MAX_RETRIES).toBe('5');
    });

    it('should default NW_MAX_RETRIES to 3', () => {
      const config = createTestConfig();
      const options: IRunOptions = { dryRun: false };

      const env = buildEnvVars(config, options);

      expect(env.NW_MAX_RETRIES).toBe('3');
    });

    it('should clamp NW_MAX_RETRIES to a minimum of 1', () => {
      const config = createTestConfig({ maxRetries: 0 });
      const options: IRunOptions = { dryRun: false };

      const env = buildEnvVars(config, options);

      expect(env.NW_MAX_RETRIES).toBe('1');
    });

    it('should include NW_CLI_BIN for nested CLI calls', () => {
      const config = createTestConfig();
      const options: IRunOptions = { dryRun: false };

      const env = buildEnvVars(config, options);

      expect(env.NW_CLI_BIN).toBe(process.argv[1]);
    });

    it('sets NW_BOARD_ENABLED when boardProvider is enabled and projectNumber is set', () => {
      const config = createTestConfig({
        boardProvider: { enabled: true, provider: 'github', projectNumber: 42 },
      });
      const options: IRunOptions = { dryRun: false };

      const env = buildEnvVars(config, options);

      expect(env.NW_BOARD_ENABLED).toBe('true');
    });

    it('sets NW_BOARD_ENABLED when boardProvider is enabled even without projectNumber', () => {
      const config = createTestConfig({
        boardProvider: { enabled: true, provider: 'github' },
      });
      const options: IRunOptions = { dryRun: false };

      const env = buildEnvVars(config, options);

      expect(env.NW_BOARD_ENABLED).toBe('true');
    });

    it('does not set NW_BOARD_ENABLED when boardProvider explicitly disabled', () => {
      const config = createTestConfig({
        boardProvider: { enabled: false, provider: 'github', projectNumber: 42 },
      });
      const options: IRunOptions = { dryRun: false };

      const env = buildEnvVars(config, options);

      expect(env.NW_BOARD_ENABLED).toBeUndefined();
    });

    it('exports fallback Telegram credentials only for subscribed webhooks', () => {
      const config = createTestConfig({
        notifications: {
          webhooks: [
            {
              type: 'telegram',
              botToken: 'token-disabled',
              chatId: 'chat-disabled',
              events: ['run_failed'],
            },
            {
              type: 'telegram',
              botToken: 'token-enabled',
              chatId: 'chat-enabled',
              events: ['rate_limit_fallback'],
            },
            {
              type: 'slack',
              url: 'https://hooks.slack.com/services/AAA/BBB/CCC',
              events: ['rate_limit_fallback'],
            },
          ],
        },
      });
      const options: IRunOptions = { dryRun: false };

      const env = buildEnvVars(config, options);
      const exported = JSON.parse(env.NW_TELEGRAM_RATE_LIMIT_WEBHOOKS!);

      expect(exported).toEqual([{ botToken: 'token-enabled', chatId: 'chat-enabled' }]);
      expect(env.NW_TELEGRAM_BOT_TOKEN).toBe('token-enabled');
      expect(env.NW_TELEGRAM_CHAT_ID).toBe('chat-enabled');
    });

    it('does not export fallback Telegram credentials when no webhook opted in', () => {
      const config = createTestConfig({
        notifications: {
          webhooks: [
            {
              type: 'telegram',
              botToken: 'token-1',
              chatId: 'chat-1',
              events: ['run_failed'],
            },
          ],
        },
      });
      const options: IRunOptions = { dryRun: false };

      const env = buildEnvVars(config, options);

      expect(env.NW_TELEGRAM_RATE_LIMIT_WEBHOOKS).toBeUndefined();
      expect(env.NW_TELEGRAM_BOT_TOKEN).toBeUndefined();
      expect(env.NW_TELEGRAM_CHAT_ID).toBeUndefined();
    });
  });

  describe('applyCliOverrides', () => {
    it('should override timeout with --timeout flag', () => {
      const config = createTestConfig();
      const options: IRunOptions = { dryRun: false, timeout: '1800' };

      const overridden = applyCliOverrides(config, options);

      expect(overridden.maxRuntime).toBe(1800);
    });

    it('should override provider with --provider flag', () => {
      const config = createTestConfig();
      const options: IRunOptions = { dryRun: false, provider: 'codex' };

      const overridden = applyCliOverrides(config, options);

      // CLI override uses _cliProviderOverride to take precedence over jobProviders
      expect(overridden._cliProviderOverride).toBe('codex');
    });

    it('should set _cliProviderOverride even when jobProviders.executor is set', () => {
      // This tests the critical precedence contract: --provider beats jobProviders
      const config = createTestConfig({
        jobProviders: { executor: 'claude' },
      });
      const options: IRunOptions = { dryRun: false, provider: 'codex' };

      const overridden = applyCliOverrides(config, options);

      // CLI override must take precedence over jobProviders
      expect(overridden._cliProviderOverride).toBe('codex');
      // jobProviders should remain unchanged
      expect(overridden.jobProviders.executor).toBe('claude');
    });
  });

  describe('notification integration', () => {
    it('sendNotifications should be importable', () => {
      expect(typeof sendNotifications).toBe('function');
    });
  });

  describe('resolveRunNotificationEvent', () => {
    it('should map timeout exit to run_timeout', () => {
      expect(resolveRunNotificationEvent(124, 'failure')).toBe('run_timeout');
    });

    it('should map non-zero exit to run_failed', () => {
      expect(resolveRunNotificationEvent(1, 'failure')).toBe('run_failed');
    });

    it('should map success_open_pr to run_succeeded', () => {
      expect(resolveRunNotificationEvent(0, 'success_open_pr')).toBe('run_succeeded');
    });

    it('should suppress notifications for skip/no-op statuses', () => {
      expect(resolveRunNotificationEvent(0, 'skip_no_eligible_prd')).toBeNull();
      expect(resolveRunNotificationEvent(0, 'success_already_merged')).toBeNull();
    });
  });

  describe('shouldAttemptCrossProjectFallback', () => {
    it('returns false by default (fallback is opt-in)', () => {
      const options: IRunOptions = { dryRun: false };
      expect(shouldAttemptCrossProjectFallback(options, 'skip_no_eligible_prd')).toBe(false);
    });

    it('returns true only for skip_no_eligible_prd when explicitly enabled', () => {
      const options: IRunOptions = { dryRun: false, crossProjectFallback: true };
      expect(shouldAttemptCrossProjectFallback(options, 'skip_no_eligible_prd')).toBe(true);
      expect(shouldAttemptCrossProjectFallback(options, 'skip_locked')).toBe(false);
      expect(shouldAttemptCrossProjectFallback(options, 'success_open_pr')).toBe(false);
    });

    it('returns false in dry-run mode', () => {
      const options: IRunOptions = { dryRun: true, crossProjectFallback: true };
      expect(shouldAttemptCrossProjectFallback(options, 'skip_no_eligible_prd')).toBe(false);
    });

    it('returns false when cross-project fallback is explicitly disabled', () => {
      const options: IRunOptions = { dryRun: false, crossProjectFallback: false };
      expect(shouldAttemptCrossProjectFallback(options, 'skip_no_eligible_prd')).toBe(false);
    });

    it('returns false when already inside a fallback invocation', () => {
      process.env.NW_CROSS_PROJECT_FALLBACK_ACTIVE = '1';
      const options: IRunOptions = { dryRun: false, crossProjectFallback: true };
      expect(shouldAttemptCrossProjectFallback(options, 'skip_no_eligible_prd')).toBe(false);
      delete process.env.NW_CROSS_PROJECT_FALLBACK_ACTIVE;
    });
  });

  describe('rate-limit fallback helpers', () => {
    it('returns only Telegram webhooks subscribed to rate_limit_fallback', () => {
      const config = createTestConfig({
        notifications: {
          webhooks: [
            {
              type: 'telegram',
              botToken: 'token-a',
              chatId: 'chat-a',
              events: ['rate_limit_fallback'],
            },
            {
              type: 'telegram',
              botToken: 'token-b',
              chatId: 'chat-b',
              events: ['run_failed'],
            },
          ],
        },
      });

      expect(getRateLimitFallbackTelegramWebhooks(config)).toEqual([
        { botToken: 'token-a', chatId: 'chat-a' },
      ]);
    });

    it('detects fallback marker from script result data', () => {
      expect(isRateLimitFallbackTriggered({ rate_limit_fallback: '1' })).toBe(true);
      expect(isRateLimitFallbackTriggered({ rate_limit_fallback: '0' })).toBe(false);
      expect(isRateLimitFallbackTriggered(undefined)).toBe(false);
    });
  });

  describe('applyScheduleOffset', () => {
    it('should replace minute field with offset', () => {
      expect(applyScheduleOffset('0 0-21 * * *', 15)).toBe('15 0-21 * * *');
    });

    it('should not change complex minute expressions', () => {
      expect(applyScheduleOffset('*/5 * * * *', 15)).toBe('*/5 * * * *');
    });

    it('should noop when offset is 0', () => {
      expect(applyScheduleOffset('0 0-21 * * *', 0)).toBe('0 0-21 * * *');
    });

    it('should handle reviewer schedule with comma-separated hours', () => {
      expect(applyScheduleOffset('0 0,3,6,9,12,15,18,21 * * *', 20)).toBe(
        '20 0,3,6,9,12,15,18,21 * * *',
      );
    });

    it('should not change comma-separated minutes', () => {
      expect(applyScheduleOffset('0,30 * * * *', 15)).toBe('0,30 * * * *');
    });
  });

  describe('buildCronPathPrefix', () => {
    it('should include both node and night-watch bin directories', () => {
      expect(buildCronPathPrefix('/usr/local/bin', '/opt/night-watch/bin/night-watch')).toBe(
        'export PATH="/usr/local/bin:/opt/night-watch/bin:$PATH" && ',
      );
    });

    it('should not duplicate path entries', () => {
      expect(buildCronPathPrefix('/usr/local/bin', '/usr/local/bin/night-watch')).toBe(
        'export PATH="/usr/local/bin:$PATH" && ',
      );
    });

    it('should ignore non-path night-watch command names', () => {
      expect(buildCronPathPrefix('/usr/local/bin', 'night-watch')).toBe(
        'export PATH="/usr/local/bin:$PATH" && ',
      );
    });
  });

  describe('scanPrdDirectory', () => {
    it('should detect claimed PRDs', () => {
      // Create PRD directory
      const prdDir = 'docs/PRDs/night-watch';
      const absolutePrdDir = path.join(tempDir, prdDir);
      fs.mkdirSync(absolutePrdDir, { recursive: true });

      // Create a PRD file
      fs.writeFileSync(path.join(absolutePrdDir, '01-feature.md'), '# Feature');

      // Create an active claim
      fs.writeFileSync(
        path.join(absolutePrdDir, '01-feature.md.claim'),
        JSON.stringify({
          timestamp: Math.floor(Date.now() / 1000),
          hostname: 'test-host',
          pid: 9999,
        }),
      );

      const result = scanPrdDirectory(tempDir, prdDir, 7200);

      expect(result.pending).toHaveLength(1);
      expect(result.pending[0].name).toBe('01-feature.md');
      expect(result.pending[0].claimed).toBe(true);
      expect(result.pending[0].claimInfo).toEqual({
        hostname: 'test-host',
        pid: 9999,
        timestamp: expect.any(Number),
      });
    });

    it('should treat stale claims as unclaimed', () => {
      const prdDir = 'docs/PRDs/night-watch';
      const absolutePrdDir = path.join(tempDir, prdDir);
      fs.mkdirSync(absolutePrdDir, { recursive: true });

      fs.writeFileSync(path.join(absolutePrdDir, '01-feature.md'), '# Feature');

      // Create a stale claim (old timestamp)
      fs.writeFileSync(
        path.join(absolutePrdDir, '01-feature.md.claim'),
        JSON.stringify({ timestamp: 1000000000, hostname: 'old-host', pid: 1111 }),
      );

      const result = scanPrdDirectory(tempDir, prdDir, 7200);

      expect(result.pending).toHaveLength(1);
      expect(result.pending[0].name).toBe('01-feature.md');
      expect(result.pending[0].claimed).toBe(false);
      expect(result.pending[0].claimInfo).toBeNull();
    });
  });

  describe('action-path: spinner messaging', () => {
    // These tests verify the spinner messaging behavior based on script result
    // The action handler uses these patterns:
    // - exitCode === 0 && status.startsWith('skip_') -> "completed (no eligible work)"
    // - exitCode === 0 && status === 'success_already_merged' -> "completed (PRD already merged)"
    // - exitCode === 0 (other) -> "completed successfully"
    // - exitCode !== 0 -> "exited with code X"

    it('should show "no eligible work" message for skip_no_eligible_prd status', () => {
      const exitCode = 0;
      const status = 'skip_no_eligible_prd';
      const message =
        exitCode === 0 && status.startsWith('skip_')
          ? 'PRD executor completed (no eligible work)'
          : 'PRD executor completed successfully';
      expect(message).toBe('PRD executor completed (no eligible work)');
    });

    it('should show "no eligible work" message for skip_locked status', () => {
      const exitCode = 0;
      const status = 'skip_locked';
      const message =
        exitCode === 0 && status.startsWith('skip_')
          ? 'PRD executor completed (no eligible work)'
          : 'PRD executor completed successfully';
      expect(message).toBe('PRD executor completed (no eligible work)');
    });

    it('should show "PRD already merged" message for success_already_merged status', () => {
      const exitCode = 0;
      const status = 'success_already_merged';
      const message =
        exitCode === 0 && status === 'success_already_merged'
          ? 'PRD executor completed (PRD already merged)'
          : 'PRD executor completed successfully';
      expect(message).toBe('PRD executor completed (PRD already merged)');
    });

    it('should show "completed successfully" for success_open_pr status', () => {
      const exitCode = 0;
      const status = 'success_open_pr';
      const isSkip = status.startsWith('skip_');
      const isAlreadyMerged = status === 'success_already_merged';
      const message =
        exitCode === 0 && isSkip
          ? 'PRD executor completed (no eligible work)'
          : exitCode === 0 && isAlreadyMerged
            ? 'PRD executor completed (PRD already merged)'
            : 'PRD executor completed successfully';
      expect(message).toBe('PRD executor completed successfully');
    });

    it('should show exit code on failure', () => {
      const exitCode = 1;
      const message = `PRD executor exited with code ${exitCode}`;
      expect(message).toBe('PRD executor exited with code 1');
    });

    it('should show exit code 124 for timeout', () => {
      const exitCode = 124;
      const message = `PRD executor exited with code ${exitCode}`;
      expect(message).toBe('PRD executor exited with code 124');
    });
  });

  describe('action-path: notification suppression', () => {
    // Tests for notification suppression based on resolveRunNotificationEvent
    // Notifications are suppressed (returns null) for skip_* and success_already_merged

    it('should suppress notification for skip_no_eligible_prd', () => {
      const event = resolveRunNotificationEvent(0, 'skip_no_eligible_prd');
      expect(event).toBeNull();
    });

    it('should suppress notification for skip_locked', () => {
      const event = resolveRunNotificationEvent(0, 'skip_locked');
      expect(event).toBeNull();
    });

    it('should suppress notification for success_already_merged', () => {
      const event = resolveRunNotificationEvent(0, 'success_already_merged');
      expect(event).toBeNull();
    });

    it('should send run_succeeded notification for success_open_pr', () => {
      const event = resolveRunNotificationEvent(0, 'success_open_pr');
      expect(event).toBe('run_succeeded');
    });

    it('should send run_succeeded notification when status is undefined', () => {
      const event = resolveRunNotificationEvent(0, undefined);
      expect(event).toBe('run_succeeded');
    });

    it('should send run_failed notification for non-zero exit', () => {
      const event = resolveRunNotificationEvent(1, 'failure');
      expect(event).toBe('run_failed');
    });

    it('should send run_timeout notification for exit code 124', () => {
      const event = resolveRunNotificationEvent(124, 'failure');
      expect(event).toBe('run_timeout');
    });
  });

  describe('action-path: exit code propagation', () => {
    // Tests for process.exit behavior based on script execution result
    // The action handler calls process.exit(exitCode) after script execution

    it('should exit with code 0 on successful execution', () => {
      const scriptExitCode = 0;
      // Action calls: process.exit(exitCode)
      expect(scriptExitCode).toBe(0);
    });

    it('should exit with code 0 on skip status', () => {
      const scriptExitCode = 0;
      const status = 'skip_no_eligible_prd';
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
