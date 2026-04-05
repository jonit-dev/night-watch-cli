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
    reviewerMaxPrsPerRun: 0,
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
      targetColumn: 'Draft',
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

  it('should inject queue configuration into result', () => {
    const config = createTestConfig({
      queue: {
        enabled: true,
        maxConcurrency: 3,
        maxWaitTime: 1800,
        priority: {
          executor: 100,
          reviewer: 90,
          slicer: 80,
          qa: 70,
          audit: 60,
        },
      },
    });
    const env = buildBaseEnvVars(config, 'executor', false);

    expect(env.NW_QUEUE_ENABLED).toBe('1');
    expect(env.NW_QUEUE_MAX_CONCURRENCY).toBe('3');
    expect(env.NW_QUEUE_MAX_WAIT_TIME).toBe('1800');
    expect(env.NW_QUEUE_PRIORITY_JSON).toBe(
      JSON.stringify({
        executor: 100,
        reviewer: 90,
        slicer: 80,
        qa: 70,
        audit: 60,
      }),
    );
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

  it('should export NW_GIT_PUSH_NO_VERIFY when configured', () => {
    const config = createTestConfig({ gitPushNoVerify: true });
    const env = buildBaseEnvVars(config, 'executor', false);

    expect(env.NW_GIT_PUSH_NO_VERIFY).toBe('1');
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

  it('should emit NW_PROVIDER_PROMPT_FLAG for claude preset', () => {
    const config = createTestConfig({ provider: 'claude' });
    const env = buildBaseEnvVars(config, 'executor', false);

    expect(env.NW_PROVIDER_PROMPT_FLAG).toBe('-p');
  });

  it('should emit NW_PROVIDER_MODEL for preset with model', () => {
    const config = createTestConfig({
      provider: 'architect',
      providerPresets: {
        architect: {
          name: 'Architect',
          command: 'claude',
          promptFlag: '-p',
          autoApproveFlag: '--dangerously-skip-permissions',
          modelFlag: '--model',
          model: 'claude-opus-4-6',
        },
      },
    });
    const env = buildBaseEnvVars(config, 'executor', false);

    expect(env.NW_PROVIDER_MODEL).toBe('claude-opus-4-6');
  });

  it('should merge preset envVars into output', () => {
    const config = createTestConfig({
      provider: 'architect',
      providerPresets: {
        architect: {
          name: 'Architect',
          command: 'claude',
          promptFlag: '-p',
          autoApproveFlag: '--dangerously-skip-permissions',
          envVars: { ANTHROPIC_BASE_URL: 'https://api.example.com', CUSTOM_KEY: 'custom-value' },
        },
      },
    });
    const env = buildBaseEnvVars(config, 'executor', false);

    expect(env.ANTHROPIC_BASE_URL).toBe('https://api.example.com');
    expect(env.CUSTOM_KEY).toBe('custom-value');
  });

  it('should use preset name as provider label', () => {
    const config = createTestConfig({
      provider: 'architect',
      providerPresets: {
        architect: {
          name: 'Architect',
          command: 'claude',
          promptFlag: '-p',
          autoApproveFlag: '--dangerously-skip-permissions',
        },
      },
    });
    const env = buildBaseEnvVars(config, 'executor', false);

    expect(env.NW_PROVIDER_LABEL).toBe('Architect');
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
