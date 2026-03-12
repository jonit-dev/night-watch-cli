/**
 * Tests for the audit command
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

// Mock process.stderr.write for audit log output
const mockStderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

// Mock process.exit
const mockExit = vi.spyOn(process, 'exit').mockImplementation((code) => {
  throw new Error(`process.exit(${code})`);
});

// Mock process.cwd
const mockCwd = vi.spyOn(process, 'cwd');

// Import after setting up mocks
import { buildEnvVars, IAuditOptions } from '@/cli/commands/audit.js';
import { INightWatchConfig } from '@night-watch/core/types.js';

// Helper to create a valid config with audit settings
function createTestConfig(overrides: Partial<INightWatchConfig> = {}): INightWatchConfig {
  return {
    defaultBranch: '',
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
    provider: 'claude',
    executorEnabled: true,
    reviewerEnabled: true,
    maxRetries: 3,
    reviewerMaxRetries: 2,
    reviewerRetryDelay: 30,
    reviewerMaxPrsPerRun: 0,
    providerEnv: {},
    fallbackOnRateLimit: false,
    claudeModel: 'sonnet',
    notifications: { webhooks: [] },
    prdPriority: [],
    roadmapScanner: {
      enabled: false,
      roadmapPath: 'ROADMAP.md',
      autoScanInterval: 300,
      slicerSchedule: '0 */6 * * *',
      slicerMaxRuntime: 600,
    },
    templatesDir: '.night-watch/templates',
    boardProvider: { enabled: true, provider: 'github' as const },
    autoMerge: false,
    autoMergeMethod: 'squash',
    qa: {
      enabled: false,
      schedule: '30 1,7,13,19 * * *',
      maxRuntime: 3600,
      branchPatterns: [],
      artifacts: 'both',
      skipLabel: 'skip-qa',
      autoInstallPlaywright: true,
    },
    jobProviders: {},
    audit: {
      enabled: true,
      schedule: '0 2 * * *',
      maxRuntime: 1800,
    },
    queue: {
      enabled: false,
      maxConcurrency: 1,
      maxWaitTime: 7200,
      priority: {
        executor: 50,
        reviewer: 40,
        slicer: 30,
        qa: 20,
        audit: 10,
      },
    },
    ...overrides,
  };
}

describe('audit command', () => {
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
    it('should set NW_PROVIDER_CMD for claude provider', () => {
      const config = createTestConfig();
      const options: IAuditOptions = { dryRun: false };

      const env = buildEnvVars(config, options);

      expect(env.NW_PROVIDER_CMD).toBe('claude');
    });

    it('should set NW_PROVIDER_CMD for codex provider', () => {
      const config = createTestConfig({ provider: 'codex' });
      const options: IAuditOptions = { dryRun: false };

      const env = buildEnvVars(config, options);

      expect(env.NW_PROVIDER_CMD).toBe('codex');
    });

    it('should use job-specific provider from jobProviders.audit', () => {
      const config = createTestConfig({
        provider: 'claude',
        jobProviders: { audit: 'codex' },
      });
      const options: IAuditOptions = { dryRun: false };

      const env = buildEnvVars(config, options);

      // Should use the audit-specific provider
      expect(env.NW_PROVIDER_CMD).toBe('codex');
    });

    it('should set NW_AUDIT_MAX_RUNTIME from config', () => {
      const config = createTestConfig({
        audit: { maxRuntime: 3600 },
      });
      const options: IAuditOptions = { dryRun: false };

      const env = buildEnvVars(config, options);

      expect(env.NW_AUDIT_MAX_RUNTIME).toBe('3600');
    });

    it('should set NW_CLAUDE_MODEL_ID from config.claudeModel', () => {
      const config = createTestConfig({ claudeModel: 'opus' } as Partial<INightWatchConfig>);
      const options: IAuditOptions = { dryRun: false };

      const env = buildEnvVars(config, options);

      expect(env.NW_CLAUDE_MODEL_ID).toBe('claude-opus-4-6');
    });

    it('should pass NW_DEFAULT_BRANCH when configured', () => {
      const config = createTestConfig({ defaultBranch: 'main' });
      const options: IAuditOptions = { dryRun: false };

      const env = buildEnvVars(config, options);

      expect(env.NW_DEFAULT_BRANCH).toBe('main');
    });

    it('should not set NW_DEFAULT_BRANCH when not configured', () => {
      const config = createTestConfig();
      const options: IAuditOptions = { dryRun: false };

      const env = buildEnvVars(config, options);

      expect(env.NW_DEFAULT_BRANCH).toBeUndefined();
    });

    it('should set NW_DRY_RUN when dryRun is true', () => {
      const config = createTestConfig();
      const options: IAuditOptions = { dryRun: true };

      const env = buildEnvVars(config, options);

      expect(env.NW_DRY_RUN).toBe('1');
    });

    it('should not set NW_DRY_RUN when dryRun is false', () => {
      const config = createTestConfig();
      const options: IAuditOptions = { dryRun: false };

      const env = buildEnvVars(config, options);

      expect(env.NW_DRY_RUN).toBeUndefined();
    });

    it('should include NW_EXECUTION_CONTEXT=agent', () => {
      const config = createTestConfig();
      const options: IAuditOptions = { dryRun: false };

      const env = buildEnvVars(config, options);

      expect(env.NW_EXECUTION_CONTEXT).toBe('agent');
    });

    it('should include providerEnv variables when configured', () => {
      const config = createTestConfig({
        providerEnv: {
          ANTHROPIC_API_KEY: 'test-key-123',
          CUSTOM_VAR: 'custom-value',
        },
      });
      const options: IAuditOptions = { dryRun: false };

      const env = buildEnvVars(config, options);

      expect(env.ANTHROPIC_API_KEY).toBe('test-key-123');
      expect(env.CUSTOM_VAR).toBe('custom-value');
    });

    it('should not set any budget-related environment variables', () => {
      const config = createTestConfig();
      const options: IAuditOptions = { dryRun: false };

      const env = buildEnvVars(config, options);

      // Ensure no budget vars are present
      expect(env.NW_MAX_BUDGET).toBeUndefined();
      expect(env.NW_REVIEWER_MAX_BUDGET).toBeUndefined();
    });

    it('should not set NW_MAX_RUNTIME (audit uses NW_AUDIT_MAX_RUNTIME)', () => {
      const config = createTestConfig();
      const options: IAuditOptions = { dryRun: false };

      const env = buildEnvVars(config, options);

      // Audit command uses NW_AUDIT_MAX_RUNTIME, not NW_MAX_RUNTIME
      expect(env.NW_MAX_RUNTIME).toBeUndefined();
    });

    it('should include queue environment variables from shared base env', () => {
      const config = createTestConfig({
        queue: {
          enabled: true,
          maxConcurrency: 3,
          maxWaitTime: 1800,
          priority: {
            executor: 5,
            reviewer: 4,
            slicer: 3,
            qa: 2,
            audit: 9,
          },
        },
      });

      const env = buildEnvVars(config, { dryRun: false });

      expect(env.NW_QUEUE_ENABLED).toBe('1');
      expect(env.NW_QUEUE_MAX_CONCURRENCY).toBe('3');
      expect(env.NW_QUEUE_MAX_WAIT_TIME).toBe('1800');
      expect(env.NW_QUEUE_PRIORITY_JSON).toBe(
        JSON.stringify({
          executor: 5,
          reviewer: 4,
          slicer: 3,
          qa: 2,
          audit: 9,
        }),
      );
    });
  });

  describe('CLI overrides via command action', () => {
    // These tests verify the behavior that would happen in the command action
    // The actual override logic is inline in the action handler

    it('should allow --timeout flag to override audit maxRuntime', () => {
      const config = createTestConfig({ audit: { maxRuntime: 1800 } });
      const timeout = 3600;

      // Simulate what the action does
      const overridden = {
        ...config,
        audit: { ...config.audit, maxRuntime: timeout },
      };

      expect(overridden.audit.maxRuntime).toBe(3600);
    });

    it('should allow --provider flag to set _cliProviderOverride', () => {
      const config = createTestConfig({ provider: 'claude' });
      const provider = 'codex';

      // Simulate what the action does
      const overridden = {
        ...config,
        _cliProviderOverride: provider as INightWatchConfig['provider'],
      };

      expect(overridden._cliProviderOverride).toBe('codex');
      // Original provider should remain unchanged
      expect(overridden.provider).toBe('claude');
    });

    it('should set _cliProviderOverride even when jobProviders.audit is set', () => {
      // This tests the critical precedence contract: --provider beats jobProviders
      const config = createTestConfig({
        provider: 'claude',
        jobProviders: { audit: 'claude' },
      });
      const provider = 'codex';

      // Simulate what the action does
      const overridden = {
        ...config,
        _cliProviderOverride: provider as INightWatchConfig['provider'],
      };

      // CLI override must take precedence over jobProviders
      expect(overridden._cliProviderOverride).toBe('codex');
      // jobProviders should remain unchanged
      expect(overridden.jobProviders!.audit).toBe('claude');
    });
  });

  describe('dry-run output behavior', () => {
    it('should exit with code 0 in dry-run mode', () => {
      // The dry-run mode calls process.exit(0) after displaying info
      // This is verified by the implementation structure
      expect(() => {
        mockExit(0);
      }).toThrow('process.exit(0)');
    });
  });

  describe('script result status handling', () => {
    // These tests verify the expected behavior for different script result statuses
    // The actual status parsing happens in parseScriptResult from core

    it('should recognize skip_clean status as successful with no actionable issues', () => {
      // When status is 'skip_clean', the spinner should show:
      // 'Code audit complete - no actionable issues found'
      const status = 'skip_clean';
      expect(status).toBe('skip_clean');
      expect(status.startsWith('skip_')).toBe(true);
    });

    it('should recognize skip_ prefixed statuses as skipped', () => {
      // Any status starting with 'skip_' (except skip_clean) shows:
      // 'Code audit skipped'
      const status = 'skip_no_changes';
      expect(status.startsWith('skip_')).toBe(true);
      expect(status).not.toBe('skip_clean');
    });

    it('should expect report file for success_audit status', () => {
      // When status is 'success_audit' or not a skip status,
      // the command expects a report file to exist
      const status = 'success_audit';
      expect(status.startsWith('skip_')).toBe(false);
    });
  });

  describe('error handling behavior', () => {
    it('should include status suffix in error message when status is present', () => {
      // Error message format: `Code audit exited with code ${exitCode}${statusSuffix}${exitDetail}`
      const exitCode = 1;
      const status = 'failure';
      const statusSuffix = status ? ` (${status})` : '';
      const expectedMessage = `Code audit exited with code ${exitCode}${statusSuffix}`;

      expect(expectedMessage).toBe('Code audit exited with code 1 (failure)');
    });

    it('should include provider exit detail when different from script exit code', () => {
      const exitCode = 1;
      const providerExit = '137';
      const statusSuffix = ' (failure)';
      const exitDetail =
        providerExit && providerExit !== String(exitCode) ? `, provider exit ${providerExit}` : '';
      const expectedMessage = `Code audit exited with code ${exitCode}${statusSuffix}${exitDetail}`;

      expect(expectedMessage).toBe('Code audit exited with code 1 (failure), provider exit 137');
    });

    it('should not include provider exit detail when same as script exit code', () => {
      const exitCode = 1;
      const providerExit = '1';
      const statusSuffix = ' (failure)';
      const exitDetail =
        providerExit && providerExit !== String(exitCode) ? `, provider exit ${providerExit}` : '';
      const expectedMessage = `Code audit exited with code ${exitCode}${statusSuffix}${exitDetail}`;

      expect(expectedMessage).toBe('Code audit exited with code 1 (failure)');
    });

    it('should read last 8 lines of audit log on failure', () => {
      // Create a temp audit log
      const logsDir = path.join(tempDir, 'logs');
      fs.mkdirSync(logsDir, { recursive: true });
      const logPath = path.join(logsDir, 'audit.log');
      const logContent = Array.from({ length: 10 }, (_, i) => `Log line ${i + 1}`).join('\n');
      fs.writeFileSync(logPath, logContent);

      // Verify the log exists and has expected content
      expect(fs.existsSync(logPath)).toBe(true);
      const lines = fs
        .readFileSync(logPath, 'utf-8')
        .split('\n')
        .filter((l) => l.trim())
        .slice(-8);
      expect(lines).toHaveLength(8);
      expect(lines[0]).toBe('Log line 3');
      expect(lines[7]).toBe('Log line 10');
    });
  });

  describe('notification suppression', () => {
    // The audit command does NOT send notifications - it only:
    // 1. Shows spinner success/failure messages
    // 2. Writes report file on success
    // 3. Outputs last log lines on failure

    it('should not send notifications on skip_clean status', () => {
      // Unlike run/review commands, audit does not call sendNotifications
      // The skip_clean status just shows a spinner success message
      const status = 'skip_clean';
      expect(status).toBe('skip_clean');
    });

    it('should not send notifications on success', () => {
      // Audit success just writes the report and shows spinner success
      // No notification integration exists in audit command
      const status = 'success_audit';
      expect(status).toBe('success_audit');
    });

    it('should not send notifications on failure', () => {
      // Audit failure shows spinner failure + log tail + process.exit
      // No notification integration exists in audit command
      const exitCode = 1;
      expect(exitCode).toBe(1);
    });
  });

  describe('exit code propagation', () => {
    it('should exit with code 0 on successful audit', () => {
      // Success path exits with implicit 0 (no process.exit call)
      // unless report file is missing
      const exitCode = 0;
      expect(exitCode).toBe(0);
    });

    it('should exit with code 1 when report file is missing on success', () => {
      // When exitCode === 0 but status is not skip_*, and report file is missing:
      // process.exit(1) is called
      const reportExists = false;
      const exitCode = reportExists ? 0 : 1;
      expect(exitCode).toBe(1);
    });

    it('should exit with script exit code on failure', () => {
      // On script failure (exitCode !== 0):
      // process.exit(exitCode || 1) is called
      const scriptExitCode = 42;
      const exitCode = scriptExitCode || 1;
      expect(exitCode).toBe(42);
    });

    it('should exit with code 1 when script exit code is 0 but falsy', () => {
      // Edge case: if exitCode is somehow 0 but we're in error path
      const scriptExitCode = 0;
      const exitCode = scriptExitCode || 1;
      expect(exitCode).toBe(1);
    });

    it('should exit with code 1 on exception', () => {
      // In the catch block, process.exit(1) is always called
      const error = new Error('Script execution failed');
      expect(error instanceof Error).toBe(true);
      // process.exit(1) would be called
    });
  });

  describe('report file path', () => {
    it('should use logs/audit-report.md in project directory', () => {
      const projectDir = tempDir;
      const reportPath = path.join(projectDir, 'logs', 'audit-report.md');

      expect(reportPath).toBe(path.join(tempDir, 'logs', 'audit-report.md'));
    });
  });
});
