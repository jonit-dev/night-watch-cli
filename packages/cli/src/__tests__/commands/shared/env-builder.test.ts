/**
 * Tests for shared env-builder utilities
 */

import { describe, it, expect } from 'vitest';
import { buildBaseEnvVars, getTelegramStatusWebhooks } from '@/cli/commands/shared/env-builder.js';
import { INightWatchConfig } from '@night-watch/core/types.js';

// Helper to create a valid config for testing
function createTestConfig(overrides: Partial<INightWatchConfig> = {}): INightWatchConfig {
  return {
    defaultBranch: '',
    prdDir: 'docs/prds',
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
    reviewerMaxRetries: 2,
    reviewerRetryDelay: 30,
    provider: 'claude',
    reviewerEnabled: true,
    providerEnv: {},
    fallbackOnRateLimit: false,
    claudeModel: 'sonnet',
    notifications: { webhooks: [] },
    prdPriority: [],
    roadmapScanner: {
      enabled: true,
      roadmapPath: 'ROADMAP.md',
      autoScanInterval: 300,
      slicerSchedule: '0 */6 * * *',
      slicerMaxRuntime: 600,
    },
    templatesDir: '.night-watch/templates',
    boardProvider: { enabled: true, provider: 'github' },
    autoMerge: false,
    autoMergeMethod: 'squash',
    qa: {
      enabled: true,
      schedule: '30 1,7,13,19 * * *',
      maxRuntime: 3600,
      branchPatterns: [],
      artifacts: 'both',
      skipLabel: 'skip-qa',
      autoInstallPlaywright: true,
    },
    audit: {
      enabled: true,
      schedule: '0 3 * * *',
      maxRuntime: 1800,
    },
    jobProviders: {},
    ...overrides,
  };
}

describe('buildBaseEnvVars', () => {
  it('should set NW_PROVIDER_CMD from config', () => {
    const config = createTestConfig({ provider: 'claude' });
    const env = buildBaseEnvVars(config, 'executor', false);

    expect(env.NW_PROVIDER_CMD).toBe('claude');
  });

  it('should set NW_PROVIDER_CMD for codex provider', () => {
    const config = createTestConfig({ provider: 'codex' });
    const env = buildBaseEnvVars(config, 'executor', false);

    expect(env.NW_PROVIDER_CMD).toBe('codex');
  });

  it('should set NW_DRY_RUN when isDryRun is true', () => {
    const config = createTestConfig();
    const env = buildBaseEnvVars(config, 'executor', true);

    expect(env.NW_DRY_RUN).toBe('1');
  });

  it('should not set NW_DRY_RUN when isDryRun is false', () => {
    const config = createTestConfig();
    const env = buildBaseEnvVars(config, 'executor', false);

    expect(env.NW_DRY_RUN).toBeUndefined();
  });

  it('should always set NW_EXECUTION_CONTEXT to agent', () => {
    const config = createTestConfig();
    const env = buildBaseEnvVars(config, 'executor', false);

    expect(env.NW_EXECUTION_CONTEXT).toBe('agent');
  });

  it('should inject providerEnv into result', () => {
    const config = createTestConfig({
      providerEnv: { MY_API_KEY: 'test-key', OTHER_VAR: 'other-value' },
    });
    const env = buildBaseEnvVars(config, 'executor', false);

    expect(env.MY_API_KEY).toBe('test-key');
    expect(env.OTHER_VAR).toBe('other-value');
  });

  it('should skip NW_DEFAULT_BRANCH when not set', () => {
    const config = createTestConfig({ defaultBranch: '' });
    const env = buildBaseEnvVars(config, 'executor', false);

    expect(env.NW_DEFAULT_BRANCH).toBeUndefined();
  });

  it('should set NW_DEFAULT_BRANCH when configured', () => {
    const config = createTestConfig({ defaultBranch: 'main' });
    const env = buildBaseEnvVars(config, 'executor', false);

    expect(env.NW_DEFAULT_BRANCH).toBe('main');
  });

  it('should use job-specific provider when configured', () => {
    const config = createTestConfig({
      provider: 'claude',
      jobProviders: { executor: 'codex' },
    });
    const env = buildBaseEnvVars(config, 'executor', false);

    expect(env.NW_PROVIDER_CMD).toBe('codex');
  });

  it('should work with different job types', () => {
    const config = createTestConfig({
      jobProviders: {
        executor: 'claude',
        reviewer: 'codex',
        qa: 'claude',
        slicer: 'codex',
      },
    });

    expect(buildBaseEnvVars(config, 'executor', false).NW_PROVIDER_CMD).toBe('claude');
    expect(buildBaseEnvVars(config, 'reviewer', false).NW_PROVIDER_CMD).toBe('codex');
    expect(buildBaseEnvVars(config, 'qa', false).NW_PROVIDER_CMD).toBe('claude');
    expect(buildBaseEnvVars(config, 'slicer', false).NW_PROVIDER_CMD).toBe('codex');
  });
});

describe('getTelegramStatusWebhooks', () => {
  it('should return only telegram webhooks with botToken and chatId', () => {
    const config = createTestConfig({
      notifications: {
        webhooks: [
          {
            type: 'telegram',
            botToken: 'token-1',
            chatId: 'chat-1',
            events: ['run_succeeded'],
          },
          {
            type: 'telegram',
            botToken: 'token-2',
            chatId: 'chat-2',
            events: ['run_failed'],
          },
          {
            type: 'slack',
            url: 'https://hooks.slack.com/services/AAA/BBB/CCC',
            events: ['run_succeeded'],
          },
        ],
      },
    });

    const webhooks = getTelegramStatusWebhooks(config);

    expect(webhooks).toHaveLength(2);
    expect(webhooks).toEqual([
      { botToken: 'token-1', chatId: 'chat-1' },
      { botToken: 'token-2', chatId: 'chat-2' },
    ]);
  });

  it('should return empty array when no telegram webhooks configured', () => {
    const config = createTestConfig({
      notifications: {
        webhooks: [
          {
            type: 'slack',
            url: 'https://hooks.slack.com/services/AAA/BBB/CCC',
            events: ['run_succeeded'],
          },
        ],
      },
    });

    const webhooks = getTelegramStatusWebhooks(config);

    expect(webhooks).toHaveLength(0);
  });

  it('should filter out telegram webhooks with missing botToken', () => {
    const config = createTestConfig({
      notifications: {
        webhooks: [
          {
            type: 'telegram',
            chatId: 'chat-1',
            events: ['run_succeeded'],
          },
        ],
      },
    });

    const webhooks = getTelegramStatusWebhooks(config);

    expect(webhooks).toHaveLength(0);
  });

  it('should filter out telegram webhooks with missing chatId', () => {
    const config = createTestConfig({
      notifications: {
        webhooks: [
          {
            type: 'telegram',
            botToken: 'token-1',
            events: ['run_succeeded'],
          },
        ],
      },
    });

    const webhooks = getTelegramStatusWebhooks(config);

    expect(webhooks).toHaveLength(0);
  });

  it('should filter out telegram webhooks with empty botToken', () => {
    const config = createTestConfig({
      notifications: {
        webhooks: [
          {
            type: 'telegram',
            botToken: '',
            chatId: 'chat-1',
            events: ['run_succeeded'],
          },
        ],
      },
    });

    const webhooks = getTelegramStatusWebhooks(config);

    expect(webhooks).toHaveLength(0);
  });

  it('should filter out telegram webhooks with empty chatId', () => {
    const config = createTestConfig({
      notifications: {
        webhooks: [
          {
            type: 'telegram',
            botToken: 'token-1',
            chatId: '   ',
            events: ['run_succeeded'],
          },
        ],
      },
    });

    const webhooks = getTelegramStatusWebhooks(config);

    expect(webhooks).toHaveLength(0);
  });

  it('should return empty array when no webhooks configured', () => {
    const config = createTestConfig({
      notifications: { webhooks: [] },
    });

    const webhooks = getTelegramStatusWebhooks(config);

    expect(webhooks).toHaveLength(0);
  });
});
