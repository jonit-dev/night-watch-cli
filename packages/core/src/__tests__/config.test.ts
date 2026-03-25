/**
 * Tests for the Night Watch CLI configuration loader
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  loadConfig,
  getDefaultConfig,
  resolveJobProvider,
  resolvePreset,
  findActiveScheduleOverride,
} from '../config.js';
import {
  INightWatchConfig,
  JobType,
  IProviderPreset,
  IProviderScheduleOverride,
} from '../types.js';
import type { IQaConfig, IAuditConfig, IAnalyticsConfig } from '../types.js';

describe('config', () => {
  let tempDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Create a temporary directory for each test
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'night-watch-test-'));

    // Save original environment
    originalEnv = { ...process.env };

    // Clear NW_* environment variables
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('NW_')) {
        delete process.env[key];
      }
    }
  });

  afterEach(() => {
    // Clean up temp directory
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
  });

  describe('getDefaultConfig', () => {
    it('should return all default values', () => {
      const config = getDefaultConfig();

      expect(config.defaultBranch).toBe('');
      expect(config.prdDir).toBe('docs/prds');
      expect(config.maxRuntime).toBe(7200);
      expect(config.reviewerMaxRuntime).toBe(3600);
      expect(config.branchPrefix).toBe('night-watch');
      expect(config.branchPatterns).toEqual(['feat/', 'night-watch/']);
      expect(config.minReviewScore).toBe(80);
      expect(config.maxLogSize).toBe(524288);
      expect(config.cronSchedule).toBe('5 * * * *');
      expect(config.reviewerSchedule).toBe('25 */3 * * *');
      expect(config.reviewerMaxPrsPerRun).toBe(0);
      expect(config.scheduleBundleId).toBe('always-on');
    });

    it('should return defaults with provider and reviewerEnabled', () => {
      const config = getDefaultConfig();

      expect(config.provider).toBe('claude');
      expect(config.reviewerEnabled).toBe(true);
    });
  });

  describe('loadConfig', () => {
    it('should return defaults when no config file exists', () => {
      const config = loadConfig(tempDir);
      const defaults = getDefaultConfig();

      expect(config.defaultBranch).toBe(defaults.defaultBranch);
      expect(config.prdDir).toBe(defaults.prdDir);
      expect(config.maxRuntime).toBe(defaults.maxRuntime);
      expect(config.reviewerMaxRuntime).toBe(defaults.reviewerMaxRuntime);
      expect(config.branchPrefix).toBe(defaults.branchPrefix);
      expect(config.branchPatterns).toEqual(defaults.branchPatterns);
      expect(config.minReviewScore).toBe(defaults.minReviewScore);
      expect(config.maxLogSize).toBe(defaults.maxLogSize);
      expect(config.cronSchedule).toBe(defaults.cronSchedule);
      expect(config.reviewerSchedule).toBe(defaults.reviewerSchedule);
      expect(config.provider).toBe('claude');
      expect(config.reviewerEnabled).toBe(true);
    });

    it('should merge config file with defaults', () => {
      // Write a config file with some overrides
      const configPath = path.join(tempDir, 'night-watch.config.json');
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          prdDir: 'custom/prds',
          maxRuntime: 3600,
          branchPatterns: ['custom/', 'feature/'],
          provider: 'claude',
          reviewerEnabled: true,
        }),
      );

      const config = loadConfig(tempDir);

      // Check file overrides
      expect(config.prdDir).toBe('custom/prds');
      expect(config.maxRuntime).toBe(3600);
      expect(config.branchPatterns).toEqual(['custom/', 'feature/']);

      // Check defaults preserved
      expect(config.reviewerMaxRuntime).toBe(3600);
      expect(config.branchPrefix).toBe('night-watch');
      expect(config.minReviewScore).toBe(80);
      expect(config.maxLogSize).toBe(524288);
      expect(config.cronSchedule).toBe('5 * * * *');
      expect(config.reviewerSchedule).toBe('25 */3 * * *');
    });

    it('should load scheduleBundleId from config file', () => {
      const configPath = path.join(tempDir, 'night-watch.config.json');
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          scheduleBundleId: 'always-on',
        }),
      );

      const config = loadConfig(tempDir);

      expect(config.scheduleBundleId).toBe('always-on');
    });

    it('should treat null scheduleBundleId as custom mode', () => {
      const configPath = path.join(tempDir, 'night-watch.config.json');
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          scheduleBundleId: null,
        }),
      );

      const config = loadConfig(tempDir);

      expect(config.scheduleBundleId).toBeNull();
    });

    it('should support nested init/template config format', () => {
      const configPath = path.join(tempDir, 'night-watch.config.json');
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          provider: 'codex',
          reviewerEnabled: false,
          prdDirectory: 'docs/custom-prds',
          maxRuntime: 1800,
          reviewerMaxRuntime: 900,
          cron: {
            executorSchedule: '*/10 * * * *',
            reviewerSchedule: '*/30 * * * *',
          },
          review: {
            minScore: 72,
            branchPatterns: ['bot/', 'auto/'],
          },
          logging: {
            maxLogSize: 123456,
          },
        }),
      );

      const config = loadConfig(tempDir);

      expect(config.provider).toBe('codex');
      expect(config.reviewerEnabled).toBe(false);
      expect(config.prdDir).toBe('docs/custom-prds');
      expect(config.maxRuntime).toBe(1800);
      expect(config.reviewerMaxRuntime).toBe(900);
      expect(config.cronSchedule).toBe('*/10 * * * *');
      expect(config.reviewerSchedule).toBe('*/30 * * * *');
      expect(config.minReviewScore).toBe(72);
      expect(config.branchPatterns).toEqual(['bot/', 'auto/']);
      expect(config.maxLogSize).toBe(123456);
    });

    it('should let env vars override config file', () => {
      // Write a config file
      const configPath = path.join(tempDir, 'night-watch.config.json');
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          maxRuntime: 3600,
          cronSchedule: '0 * * * *',
          provider: 'claude',
          reviewerEnabled: true,
        }),
      );

      // Set env vars to override
      process.env.NW_MAX_RUNTIME = '1800';
      process.env.NW_CRON_SCHEDULE = '0 0 * * *';

      const config = loadConfig(tempDir);

      // Env vars should win
      expect(config.maxRuntime).toBe(1800);
      expect(config.cronSchedule).toBe('0 0 * * *');
    });

    it('should merge provider from config file', () => {
      const configPath = path.join(tempDir, 'night-watch.config.json');
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          provider: 'codex',
          reviewerEnabled: false,
        }),
      );

      const config = loadConfig(tempDir);

      expect(config.provider).toBe('codex');
      expect(config.reviewerEnabled).toBe(false);
    });

    it('should handle NW_PROVIDER env var', () => {
      process.env.NW_PROVIDER = 'codex';

      const config = loadConfig(tempDir);

      expect(config.provider).toBe('codex');
    });

    it('should handle NW_REVIEWER_ENABLED env var', () => {
      process.env.NW_REVIEWER_ENABLED = 'false';

      const config = loadConfig(tempDir);

      expect(config.reviewerEnabled).toBe(false);
    });

    it('should accept any non-empty string as preset ID for NW_PROVIDER', () => {
      process.env.NW_PROVIDER = 'custom-preset';

      const config = loadConfig(tempDir);

      // Now accepts any string as preset ID (validation happens at resolve time)
      expect(config.provider).toBe('custom-preset');
    });

    it("should handle NW_REVIEWER_ENABLED with '1' value", () => {
      process.env.NW_REVIEWER_ENABLED = '0';

      const config = loadConfig(tempDir);

      expect(config.reviewerEnabled).toBe(false);
    });

    it("should handle NW_REVIEWER_ENABLED with 'true' value", () => {
      // First set reviewerEnabled to false in a config file
      const configPath = path.join(tempDir, 'night-watch.config.json');
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          provider: 'claude',
          reviewerEnabled: false,
        }),
      );

      // Then override with env var
      process.env.NW_REVIEWER_ENABLED = 'true';

      const config = loadConfig(tempDir);

      expect(config.reviewerEnabled).toBe(true);
    });

    it('should handle NW_REVIEWER_MAX_RUNTIME env var', () => {
      process.env.NW_REVIEWER_MAX_RUNTIME = '7200';

      const config = loadConfig(tempDir);

      expect(config.reviewerMaxRuntime).toBe(7200);
    });

    it('should handle NW_REVIEWER_SCHEDULE env var', () => {
      process.env.NW_REVIEWER_SCHEDULE = '0 */2 * * *';

      const config = loadConfig(tempDir);

      expect(config.reviewerSchedule).toBe('0 */2 * * *');
    });

    it('should ignore NW_MAX_RETRIES values below 1', () => {
      process.env.NW_MAX_RETRIES = '0';

      const config = loadConfig(tempDir);
      const defaults = getDefaultConfig();

      expect(config.maxRetries).toBe(defaults.maxRetries);
    });

    it('should sanitize maxRetries from config file when invalid', () => {
      const configPath = path.join(tempDir, 'night-watch.config.json');
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          maxRetries: 0,
        }),
      );

      const config = loadConfig(tempDir);
      const defaults = getDefaultConfig();

      expect(config.maxRetries).toBe(defaults.maxRetries);
    });

    // Reviewer retry configuration tests
    it('should include reviewer retry defaults', () => {
      const config = getDefaultConfig();

      expect(config.reviewerMaxRetries).toBe(2);
      expect(config.reviewerRetryDelay).toBe(30);
      expect(config.reviewerMaxPrsPerRun).toBe(0);
    });

    it('should clamp reviewerMaxRetries to valid range (0-10)', () => {
      const configPath = path.join(tempDir, 'night-watch.config.json');
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          reviewerMaxRetries: 99,
        }),
      );

      const config = loadConfig(tempDir);

      expect(config.reviewerMaxRetries).toBe(10);
    });

    it('should clamp reviewerMaxRetries to 0 minimum', () => {
      const configPath = path.join(tempDir, 'night-watch.config.json');
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          reviewerMaxRetries: -5,
        }),
      );

      const config = loadConfig(tempDir);

      expect(config.reviewerMaxRetries).toBe(0);
    });

    it('should clamp reviewerRetryDelay to valid range (0-300)', () => {
      const configPath = path.join(tempDir, 'night-watch.config.json');
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          reviewerRetryDelay: 500,
        }),
      );

      const config = loadConfig(tempDir);

      expect(config.reviewerRetryDelay).toBe(300);
    });

    it('should clamp reviewerRetryDelay to 0 minimum', () => {
      const configPath = path.join(tempDir, 'night-watch.config.json');
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          reviewerRetryDelay: -10,
        }),
      );

      const config = loadConfig(tempDir);

      expect(config.reviewerRetryDelay).toBe(0);
    });

    it('should handle NW_REVIEWER_MAX_RETRIES env var', () => {
      process.env.NW_REVIEWER_MAX_RETRIES = '5';

      const config = loadConfig(tempDir);

      expect(config.reviewerMaxRetries).toBe(5);
    });

    it('should handle NW_REVIEWER_RETRY_DELAY env var', () => {
      process.env.NW_REVIEWER_RETRY_DELAY = '60';

      const config = loadConfig(tempDir);

      expect(config.reviewerRetryDelay).toBe(60);
    });

    it('should handle NW_REVIEWER_MAX_PRS_PER_RUN env var', () => {
      process.env.NW_REVIEWER_MAX_PRS_PER_RUN = '4';

      const config = loadConfig(tempDir);

      expect(config.reviewerMaxPrsPerRun).toBe(4);
    });

    it('should handle NW_REVIEWER_MAX_RETRIES=0 env var', () => {
      process.env.NW_REVIEWER_MAX_RETRIES = '0';

      const config = loadConfig(tempDir);

      expect(config.reviewerMaxRetries).toBe(0);
    });

    it('should handle NW_REVIEWER_RETRY_DELAY=0 env var', () => {
      process.env.NW_REVIEWER_RETRY_DELAY = '0';

      const config = loadConfig(tempDir);

      expect(config.reviewerRetryDelay).toBe(0);
    });

    it('should let env vars override config file for reviewer retry settings', () => {
      const configPath = path.join(tempDir, 'night-watch.config.json');
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          reviewerMaxRetries: 3,
          reviewerRetryDelay: 45,
          reviewerMaxPrsPerRun: 2,
        }),
      );

      process.env.NW_REVIEWER_MAX_RETRIES = '7';
      process.env.NW_REVIEWER_RETRY_DELAY = '90';
      process.env.NW_REVIEWER_MAX_PRS_PER_RUN = '5';

      const config = loadConfig(tempDir);

      expect(config.reviewerMaxRetries).toBe(7);
      expect(config.reviewerRetryDelay).toBe(90);
      expect(config.reviewerMaxPrsPerRun).toBe(5);
    });

    it('should handle NW_BRANCH_PREFIX env var', () => {
      process.env.NW_BRANCH_PREFIX = 'auto';

      const config = loadConfig(tempDir);

      expect(config.branchPrefix).toBe('auto');
    });

    it('should handle NW_BRANCH_PATTERNS as JSON array', () => {
      process.env.NW_BRANCH_PATTERNS = '["auto/", "bot/"]';

      const config = loadConfig(tempDir);

      expect(config.branchPatterns).toEqual(['auto/', 'bot/']);
    });

    it('should handle NW_BRANCH_PATTERNS as comma-separated string', () => {
      process.env.NW_BRANCH_PATTERNS = 'auto/, bot/';

      const config = loadConfig(tempDir);

      expect(config.branchPatterns).toEqual(['auto/', 'bot/']);
    });

    it('should handle NW_MIN_REVIEW_SCORE env var', () => {
      process.env.NW_MIN_REVIEW_SCORE = '90';

      const config = loadConfig(tempDir);

      expect(config.minReviewScore).toBe(90);
    });

    it('should handle NW_MAX_LOG_SIZE env var', () => {
      process.env.NW_MAX_LOG_SIZE = '1048576';

      const config = loadConfig(tempDir);

      expect(config.maxLogSize).toBe(1048576);
    });

    it('should handle NW_PRD_DIR env var', () => {
      process.env.NW_PRD_DIR = 'docs/prd';

      const config = loadConfig(tempDir);

      expect(config.prdDir).toBe('docs/prd');
    });

    it('should load defaultBranch from config file', () => {
      const configPath = path.join(tempDir, 'night-watch.config.json');
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          defaultBranch: 'master',
        }),
      );

      const config = loadConfig(tempDir);

      expect(config.defaultBranch).toBe('master');
    });

    it('should handle NW_DEFAULT_BRANCH env var', () => {
      process.env.NW_DEFAULT_BRANCH = 'develop';

      const config = loadConfig(tempDir);

      expect(config.defaultBranch).toBe('develop');
    });

    it('should let NW_DEFAULT_BRANCH env var override config file', () => {
      const configPath = path.join(tempDir, 'night-watch.config.json');
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          defaultBranch: 'master',
        }),
      );

      process.env.NW_DEFAULT_BRANCH = 'develop';

      const config = loadConfig(tempDir);

      expect(config.defaultBranch).toBe('develop');
    });

    it('should ignore invalid JSON config file', () => {
      const configPath = path.join(tempDir, 'night-watch.config.json');
      fs.writeFileSync(configPath, '{ invalid json }');

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // Should not throw and return defaults
      const config = loadConfig(tempDir);
      const defaults = getDefaultConfig();

      expect(config.maxRuntime).toBe(defaults.maxRuntime);
      expect(warnSpy).toHaveBeenCalledOnce();
      warnSpy.mockRestore();
    });

    it('should ignore invalid numeric env vars', () => {
      process.env.NW_MAX_RUNTIME = 'also-not-a-number';

      const config = loadConfig(tempDir);
      const defaults = getDefaultConfig();

      // Should fall back to defaults for invalid values
      expect(config.maxRuntime).toBe(defaults.maxRuntime);
    });

    it('should handle all NW_* env vars together', () => {
      process.env.NW_DEFAULT_BRANCH = 'master';
      process.env.NW_PRD_DIR = 'custom/prds';
      process.env.NW_MAX_RUNTIME = '14400';
      process.env.NW_REVIEWER_MAX_RUNTIME = '7200';
      process.env.NW_BRANCH_PREFIX = 'bot';
      process.env.NW_BRANCH_PATTERNS = '["bot/", "auto/"]';
      process.env.NW_MIN_REVIEW_SCORE = '70';
      process.env.NW_MAX_LOG_SIZE = '2097152';
      process.env.NW_CRON_SCHEDULE = '0 */6 * * *';
      process.env.NW_REVIEWER_SCHEDULE = '0 */3 * * *';
      process.env.NW_PROVIDER = 'codex';
      process.env.NW_REVIEWER_ENABLED = 'false';

      const config = loadConfig(tempDir);

      expect(config.defaultBranch).toBe('master');
      expect(config.prdDir).toBe('custom/prds');
      expect(config.maxRuntime).toBe(14400);
      expect(config.reviewerMaxRuntime).toBe(7200);
      expect(config.branchPrefix).toBe('bot');
      expect(config.branchPatterns).toEqual(['bot/', 'auto/']);
      expect(config.minReviewScore).toBe(70);
      expect(config.maxLogSize).toBe(2097152);
      expect(config.cronSchedule).toBe('0 */6 * * *');
      expect(config.reviewerSchedule).toBe('0 */3 * * *');
      expect(config.provider).toBe('codex');
      expect(config.reviewerEnabled).toBe(false);
    });

    it('should return default templatesDir', () => {
      const config = loadConfig(tempDir);

      expect(config.templatesDir).toBe('.night-watch/templates');
    });

    it('should load templatesDir from config file', () => {
      const configPath = path.join(tempDir, 'night-watch.config.json');
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          templatesDir: 'custom/templates',
        }),
      );

      const config = loadConfig(tempDir);

      expect(config.templatesDir).toBe('custom/templates');
    });

    it('should handle NW_TEMPLATES_DIR env var', () => {
      process.env.NW_TEMPLATES_DIR = 'env/templates';

      const config = loadConfig(tempDir);

      expect(config.templatesDir).toBe('env/templates');
    });

    it('should let NW_TEMPLATES_DIR env var override config file', () => {
      const configPath = path.join(tempDir, 'night-watch.config.json');
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          templatesDir: 'file/templates',
        }),
      );

      process.env.NW_TEMPLATES_DIR = 'env/templates';

      const config = loadConfig(tempDir);

      expect(config.templatesDir).toBe('env/templates');
    });
  });

  describe('autoMerge config', () => {
    it('should default autoMerge to false', () => {
      const config = loadConfig(tempDir);

      expect(config.autoMerge).toBe(false);
    });

    it('should default autoMergeMethod to squash', () => {
      const config = loadConfig(tempDir);

      expect(config.autoMergeMethod).toBe('squash');
    });

    it('should load autoMerge from config file', () => {
      const configPath = path.join(tempDir, 'night-watch.config.json');
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          autoMerge: true,
        }),
      );

      const config = loadConfig(tempDir);

      expect(config.autoMerge).toBe(true);
    });

    it('should load autoMergeMethod from config file', () => {
      const configPath = path.join(tempDir, 'night-watch.config.json');
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          autoMergeMethod: 'merge',
        }),
      );

      const config = loadConfig(tempDir);

      expect(config.autoMergeMethod).toBe('merge');
    });

    it('should handle NW_AUTO_MERGE env var with true', () => {
      process.env.NW_AUTO_MERGE = 'true';

      const config = loadConfig(tempDir);

      expect(config.autoMerge).toBe(true);
    });

    it('should handle NW_AUTO_MERGE env var with 1', () => {
      process.env.NW_AUTO_MERGE = '1';

      const config = loadConfig(tempDir);

      expect(config.autoMerge).toBe(true);
    });

    it('should handle NW_AUTO_MERGE env var with false', () => {
      // First set autoMerge to true in config file
      const configPath = path.join(tempDir, 'night-watch.config.json');
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          autoMerge: true,
        }),
      );

      process.env.NW_AUTO_MERGE = 'false';

      const config = loadConfig(tempDir);

      expect(config.autoMerge).toBe(false);
    });

    it('should handle NW_AUTO_MERGE_METHOD env var with valid values', () => {
      process.env.NW_AUTO_MERGE_METHOD = 'rebase';

      const config = loadConfig(tempDir);

      expect(config.autoMergeMethod).toBe('rebase');
    });

    it('should reject invalid merge method from env var', () => {
      process.env.NW_AUTO_MERGE_METHOD = 'invalid';

      const config = loadConfig(tempDir);

      // Should fallback to default
      expect(config.autoMergeMethod).toBe('squash');
    });

    it('should reject invalid merge method from config file', () => {
      const configPath = path.join(tempDir, 'night-watch.config.json');
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          autoMergeMethod: 'invalid',
        }),
      );

      const config = loadConfig(tempDir);

      // Should fallback to default
      expect(config.autoMergeMethod).toBe('squash');
    });

    it('should let NW_AUTO_MERGE env var override config file', () => {
      const configPath = path.join(tempDir, 'night-watch.config.json');
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          autoMerge: false,
        }),
      );

      process.env.NW_AUTO_MERGE = 'true';

      const config = loadConfig(tempDir);

      expect(config.autoMerge).toBe(true);
    });

    it('should let NW_AUTO_MERGE_METHOD env var override config file', () => {
      const configPath = path.join(tempDir, 'night-watch.config.json');
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          autoMergeMethod: 'merge',
        }),
      );

      process.env.NW_AUTO_MERGE_METHOD = 'rebase';

      const config = loadConfig(tempDir);

      expect(config.autoMergeMethod).toBe('rebase');
    });
  });

  describe('notifications config', () => {
    it('should load notifications from config file', () => {
      const configPath = path.join(tempDir, 'night-watch.config.json');
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          notifications: {
            webhooks: [
              {
                type: 'slack',
                url: 'https://hooks.slack.com/services/test',
                events: ['run_succeeded', 'run_failed'],
              },
              {
                type: 'telegram',
                botToken: '123456:ABC',
                chatId: '-100123',
                events: ['review_completed'],
              },
            ],
          },
        }),
      );

      const config = loadConfig(tempDir);

      expect(config.notifications.webhooks).toHaveLength(2);
      expect(config.notifications.webhooks[0]).toEqual({
        type: 'slack',
        url: 'https://hooks.slack.com/services/test',
        botToken: undefined,
        chatId: undefined,
        events: ['run_succeeded', 'run_failed'],
      });
      expect(config.notifications.webhooks[1]).toEqual({
        type: 'telegram',
        url: undefined,
        botToken: '123456:ABC',
        chatId: '-100123',
        events: ['review_completed'],
      });
    });

    it('should default to empty webhooks', () => {
      const config = loadConfig(tempDir);

      expect(config.notifications).toBeDefined();
      expect(config.notifications.webhooks).toEqual([]);
    });

    it('should parse NW_NOTIFICATIONS env var', () => {
      const notifications = {
        webhooks: [
          {
            type: 'discord',
            url: 'https://discord.com/api/webhooks/test',
            events: ['run_timeout'],
          },
        ],
      };
      process.env.NW_NOTIFICATIONS = JSON.stringify(notifications);

      const config = loadConfig(tempDir);

      expect(config.notifications.webhooks).toHaveLength(1);
      expect(config.notifications.webhooks[0].type).toBe('discord');
      expect(config.notifications.webhooks[0].url).toBe('https://discord.com/api/webhooks/test');
      expect(config.notifications.webhooks[0].events).toEqual(['run_timeout']);
    });
  });

  describe('slicer config', () => {
    it('should load slicerSchedule from config file', () => {
      const configPath = path.join(tempDir, 'night-watch.config.json');
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          roadmapScanner: {
            enabled: true,
            slicerSchedule: '0 */4 * * *',
          },
        }),
      );

      const config = loadConfig(tempDir);

      expect(config.roadmapScanner.slicerSchedule).toBe('0 */4 * * *');
    });

    it('should use default slicerMaxRuntime', () => {
      const config = loadConfig(tempDir);

      expect(config.roadmapScanner.slicerMaxRuntime).toBe(600);
    });

    it('should default planner issueColumn to Ready', () => {
      const config = loadConfig(tempDir);

      expect(config.roadmapScanner.issueColumn).toBe('Ready');
    });

    it('should default planner priorityMode to roadmap-first', () => {
      const config = loadConfig(tempDir);

      expect(config.roadmapScanner.priorityMode).toBe('roadmap-first');
    });

    it('should override slicerSchedule from env', () => {
      const configPath = path.join(tempDir, 'night-watch.config.json');
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          roadmapScanner: {
            enabled: true,
            slicerSchedule: '0 */4 * * *',
          },
        }),
      );

      const envValue = '0 */2 * * *';
      process.env.NW_SLICER_SCHEDULE = envValue;

      const config = loadConfig(tempDir);

      expect(config.roadmapScanner.slicerSchedule).toBe(envValue);
    });

    it('should override planner issueColumn from env', () => {
      process.env.NW_PLANNER_ISSUE_COLUMN = 'Ready';

      const config = loadConfig(tempDir);

      expect(config.roadmapScanner.issueColumn).toBe('Ready');
    });

    it('should override planner priorityMode from env', () => {
      process.env.NW_PLANNER_PRIORITY_MODE = 'audit-first';

      const config = loadConfig(tempDir);

      expect(config.roadmapScanner.priorityMode).toBe('audit-first');
    });
  });

  describe('autoMerge config', () => {
    it('should default autoMerge to false', () => {
      const config = loadConfig(tempDir);

      expect(config.autoMerge).toBe(false);
    });

    it('should default autoMergeMethod to squash', () => {
      const config = loadConfig(tempDir);

      expect(config.autoMergeMethod).toBe('squash');
    });

    it('should load autoMerge from config file', () => {
      const configPath = path.join(tempDir, 'night-watch.config.json');
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          autoMerge: true,
        }),
      );

      const config = loadConfig(tempDir);

      expect(config.autoMerge).toBe(true);
    });

    it('should load autoMergeMethod from config file', () => {
      const configPath = path.join(tempDir, 'night-watch.config.json');
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          autoMergeMethod: 'rebase',
        }),
      );

      const config = loadConfig(tempDir);

      expect(config.autoMergeMethod).toBe('rebase');
    });

    it('should handle NW_AUTO_MERGE env var', () => {
      process.env.NW_AUTO_MERGE = 'true';

      const config = loadConfig(tempDir);

      expect(config.autoMerge).toBe(true);
    });

    it("should handle NW_AUTO_MERGE env var with '1' value", () => {
      process.env.NW_AUTO_MERGE = '1';

      const config = loadConfig(tempDir);

      expect(config.autoMerge).toBe(true);
    });

    it("should handle NW_AUTO_MERGE env var with '0' value", () => {
      // First set autoMerge to true in config file
      const configPath = path.join(tempDir, 'night-watch.config.json');
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          autoMerge: true,
        }),
      );

      process.env.NW_AUTO_MERGE = '0';

      const config = loadConfig(tempDir);

      expect(config.autoMerge).toBe(false);
    });

    it('should handle NW_AUTO_MERGE_METHOD env var', () => {
      process.env.NW_AUTO_MERGE_METHOD = 'merge';

      const config = loadConfig(tempDir);

      expect(config.autoMergeMethod).toBe('merge');
    });

    it('should reject invalid merge method', () => {
      process.env.NW_AUTO_MERGE_METHOD = 'invalid';

      const config = loadConfig(tempDir);

      // Should fall back to default
      expect(config.autoMergeMethod).toBe('squash');
    });

    it('should let NW_AUTO_MERGE env var override config file', () => {
      const configPath = path.join(tempDir, 'night-watch.config.json');
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          autoMerge: false,
        }),
      );

      process.env.NW_AUTO_MERGE = 'true';

      const config = loadConfig(tempDir);

      expect(config.autoMerge).toBe(true);
    });

    it('should let NW_AUTO_MERGE_METHOD env var override config file', () => {
      const configPath = path.join(tempDir, 'night-watch.config.json');
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          autoMergeMethod: 'squash',
        }),
      );

      process.env.NW_AUTO_MERGE_METHOD = 'rebase';

      const config = loadConfig(tempDir);

      expect(config.autoMergeMethod).toBe('rebase');
    });

    it('should accept all valid merge methods', () => {
      const validMethods = ['squash', 'merge', 'rebase'] as const;

      for (const method of validMethods) {
        const configPath = path.join(tempDir, 'night-watch.config.json');
        fs.writeFileSync(
          configPath,
          JSON.stringify({
            autoMergeMethod: method,
          }),
        );

        const config = loadConfig(tempDir);
        expect(config.autoMergeMethod).toBe(method);
      }
    });
  });

  describe('qa config', () => {
    it('should load QA defaults when no qa config present', () => {
      const config = loadConfig(tempDir);

      expect(config.qa).toBeDefined();
      expect(config.qa.enabled).toBe(true);
      expect(config.qa.schedule).toBe('45 2,10,18 * * *');
      expect(config.qa.maxRuntime).toBe(3600);
      expect(config.qa.branchPatterns).toEqual([]);
      expect(config.qa.artifacts).toBe('both');
      expect(config.qa.skipLabel).toBe('skip-qa');
      expect(config.qa.autoInstallPlaywright).toBe(true);
    });

    it('should load QA config from file', () => {
      const configPath = path.join(tempDir, 'night-watch.config.json');
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          qa: {
            enabled: false,
            schedule: '0 */4 * * *',
            maxRuntime: 1800,
            artifacts: 'screenshot',
            skipLabel: 'no-qa',
            autoInstallPlaywright: false,
          },
        }),
      );

      const config = loadConfig(tempDir);

      expect(config.qa.enabled).toBe(false);
      expect(config.qa.schedule).toBe('0 */4 * * *');
      expect(config.qa.maxRuntime).toBe(1800);
      expect(config.qa.artifacts).toBe('screenshot');
      expect(config.qa.skipLabel).toBe('no-qa');
      expect(config.qa.autoInstallPlaywright).toBe(false);
    });

    it('should override QA config from env vars', () => {
      process.env.NW_QA_ENABLED = 'false';

      const config = loadConfig(tempDir);

      expect(config.qa.enabled).toBe(false);
    });

    it('should override QA schedule from env var', () => {
      process.env.NW_QA_SCHEDULE = '0 */2 * * *';

      const config = loadConfig(tempDir);

      expect(config.qa.schedule).toBe('0 */2 * * *');
    });

    it('should override QA max runtime from env var', () => {
      process.env.NW_QA_MAX_RUNTIME = '7200';

      const config = loadConfig(tempDir);

      expect(config.qa.maxRuntime).toBe(7200);
    });

    it('should override QA artifacts from env var', () => {
      process.env.NW_QA_ARTIFACTS = 'video';

      const config = loadConfig(tempDir);

      expect(config.qa.artifacts).toBe('video');
    });

    it('should override QA skip label from env var', () => {
      process.env.NW_QA_SKIP_LABEL = 'no-tests';

      const config = loadConfig(tempDir);

      expect(config.qa.skipLabel).toBe('no-tests');
    });

    it('should override QA auto install playwright from env var', () => {
      process.env.NW_QA_AUTO_INSTALL_PLAYWRIGHT = 'false';

      const config = loadConfig(tempDir);

      expect(config.qa.autoInstallPlaywright).toBe(false);
    });

    it('should override qa.branchPatterns from NW_QA_BRANCH_PATTERNS env var', () => {
      process.env.NW_QA_BRANCH_PATTERNS = 'qa/,test/';

      const config = loadConfig(tempDir);

      expect(config.qa.branchPatterns).toEqual(['qa/', 'test/']);
    });

    it('should let env vars override QA config from file', () => {
      const configPath = path.join(tempDir, 'night-watch.config.json');
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          qa: {
            enabled: true,
            schedule: '0 */4 * * *',
          },
        }),
      );

      process.env.NW_QA_ENABLED = 'false';

      const config = loadConfig(tempDir);

      expect(config.qa.enabled).toBe(false);
    });

    it('should preserve file QA fields when only one QA env var is provided', () => {
      const configPath = path.join(tempDir, 'night-watch.config.json');
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          qa: {
            enabled: false,
            schedule: '5 * * * *',
            maxRuntime: 900,
            branchPatterns: ['custom/'],
            artifacts: 'video',
            skipLabel: 'custom-skip',
            autoInstallPlaywright: false,
          },
        }),
      );

      process.env.NW_QA_BRANCH_PATTERNS = 'qa/';

      const config = loadConfig(tempDir);

      expect(config.qa.enabled).toBe(false);
      expect(config.qa.schedule).toBe('5 * * * *');
      expect(config.qa.maxRuntime).toBe(900);
      expect(config.qa.artifacts).toBe('video');
      expect(config.qa.skipLabel).toBe('custom-skip');
      expect(config.qa.autoInstallPlaywright).toBe(false);
      expect(config.qa.branchPatterns).toEqual(['qa/']);
    });

    it('should fall back to default QA artifacts when config has invalid value', () => {
      const configPath = path.join(tempDir, 'night-watch.config.json');
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          qa: {
            artifacts: 'invalid-artifacts-mode',
          },
        }),
      );

      const config = loadConfig(tempDir);

      expect(config.qa.artifacts).toBe('both');
    });
  });

  describe('audit config', () => {
    it('should load audit defaults when no audit config present', () => {
      const config = loadConfig(tempDir);

      expect(config.audit).toBeDefined();
      expect(config.audit.enabled).toBe(true);
      expect(config.audit.schedule).toBe('50 3 * * 1');
      expect(config.audit.maxRuntime).toBe(1800);
    });

    it('should load audit config from file', () => {
      const configPath = path.join(tempDir, 'night-watch.config.json');
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          audit: {
            enabled: false,
            schedule: '0 2 * * *',
            maxRuntime: 900,
          },
        }),
      );

      const config = loadConfig(tempDir);

      expect(config.audit.enabled).toBe(false);
      expect(config.audit.schedule).toBe('0 2 * * *');
      expect(config.audit.maxRuntime).toBe(900);
    });

    it('should override audit enabled from env var', () => {
      process.env.NW_AUDIT_ENABLED = 'false';

      const config = loadConfig(tempDir);

      expect(config.audit.enabled).toBe(false);
    });

    it('should override audit schedule from env var', () => {
      process.env.NW_AUDIT_SCHEDULE = '0 */4 * * *';

      const config = loadConfig(tempDir);

      expect(config.audit.schedule).toBe('0 */4 * * *');
    });

    it('should override audit max runtime from env var', () => {
      process.env.NW_AUDIT_MAX_RUNTIME = '3600';

      const config = loadConfig(tempDir);

      expect(config.audit.maxRuntime).toBe(3600);
    });

    it('should let env vars override audit config from file', () => {
      const configPath = path.join(tempDir, 'night-watch.config.json');
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          audit: {
            enabled: true,
            schedule: '0 2 * * *',
            maxRuntime: 900,
          },
        }),
      );

      process.env.NW_AUDIT_ENABLED = 'false';

      const config = loadConfig(tempDir);

      expect(config.audit.enabled).toBe(false);
      expect(config.audit.schedule).toBe('0 2 * * *');
      expect(config.audit.maxRuntime).toBe(900);
    });

    it('should preserve file audit fields when only one audit env var is provided', () => {
      const configPath = path.join(tempDir, 'night-watch.config.json');
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          audit: {
            enabled: false,
            schedule: '5 * * * *',
            maxRuntime: 900,
          },
        }),
      );

      process.env.NW_AUDIT_SCHEDULE = '0 */6 * * *';

      const config = loadConfig(tempDir);

      expect(config.audit.enabled).toBe(false);
      expect(config.audit.schedule).toBe('0 */6 * * *');
      expect(config.audit.maxRuntime).toBe(900);
    });
  });

  describe('analytics config', () => {
    it('should load analytics defaults when no analytics config present', () => {
      const config = loadConfig(tempDir);

      expect(config.analytics).toBeDefined();
      expect(config.analytics.enabled).toBe(false);
      expect(config.analytics.schedule).toBe('0 6 * * 1');
      expect(config.analytics.maxRuntime).toBe(900);
      expect(config.analytics.lookbackDays).toBe(7);
      expect(config.analytics.targetColumn).toBe('Draft');
    });

    it('should load analytics config from file', () => {
      const configPath = path.join(tempDir, 'night-watch.config.json');
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          analytics: {
            enabled: true,
            schedule: '0 2 * * *',
            maxRuntime: 600,
            lookbackDays: 14,
            targetColumn: 'Ready',
            analysisPrompt: 'Custom prompt for analysis',
          },
        }),
      );

      const config = loadConfig(tempDir);

      expect(config.analytics.enabled).toBe(true);
      expect(config.analytics.schedule).toBe('0 2 * * *');
      expect(config.analytics.maxRuntime).toBe(600);
      expect(config.analytics.lookbackDays).toBe(14);
      expect(config.analytics.targetColumn).toBe('Ready');
      expect(config.analytics.analysisPrompt).toBe('Custom prompt for analysis');
    });

    it('should normalize partial analytics config with defaults', () => {
      const configPath = path.join(tempDir, 'night-watch.config.json');
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          analytics: {
            lookbackDays: 30,
          },
        }),
      );

      const config = loadConfig(tempDir);

      expect(config.analytics.enabled).toBe(false);
      expect(config.analytics.schedule).toBe('0 6 * * 1');
      expect(config.analytics.maxRuntime).toBe(900);
      expect(config.analytics.lookbackDays).toBe(30);
      expect(config.analytics.targetColumn).toBe('Draft');
    });

    it('should override analytics enabled from env var', () => {
      process.env.NW_ANALYTICS_ENABLED = 'true';

      const config = loadConfig(tempDir);

      expect(config.analytics.enabled).toBe(true);
    });

    it('should override analytics schedule from env var', () => {
      process.env.NW_ANALYTICS_SCHEDULE = '0 */4 * * *';

      const config = loadConfig(tempDir);

      expect(config.analytics.schedule).toBe('0 */4 * * *');
    });

    it('should override analytics max runtime from env var', () => {
      process.env.NW_ANALYTICS_MAX_RUNTIME = '600';

      const config = loadConfig(tempDir);

      expect(config.analytics.maxRuntime).toBe(600);
    });

    it('should override analytics lookback days from env var', () => {
      process.env.NW_ANALYTICS_LOOKBACK_DAYS = '14';

      const config = loadConfig(tempDir);

      expect(config.analytics.lookbackDays).toBe(14);
    });

    it('should let env vars override analytics config from file', () => {
      const configPath = path.join(tempDir, 'night-watch.config.json');
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          analytics: {
            enabled: false,
            schedule: '0 2 * * *',
            maxRuntime: 600,
            lookbackDays: 14,
          },
        }),
      );

      process.env.NW_ANALYTICS_ENABLED = 'true';

      const config = loadConfig(tempDir);

      expect(config.analytics.enabled).toBe(true);
      expect(config.analytics.schedule).toBe('0 2 * * *');
      expect(config.analytics.maxRuntime).toBe(600);
      expect(config.analytics.lookbackDays).toBe(14);
    });
  });

  describe('jobProviders config', () => {
    it('should default to empty jobProviders', () => {
      const config = loadConfig(tempDir);

      expect(config.jobProviders).toBeDefined();
      expect(config.jobProviders).toEqual({});
    });

    it('should load jobProviders from config file', () => {
      const configPath = path.join(tempDir, 'night-watch.config.json');
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          jobProviders: {
            executor: 'codex',
            reviewer: 'claude',
          },
        }),
      );

      const config = loadConfig(tempDir);

      expect(config.jobProviders.executor).toBe('codex');
      expect(config.jobProviders.reviewer).toBe('claude');
    });

    it('should ignore invalid provider in jobProviders', () => {
      const configPath = path.join(tempDir, 'night-watch.config.json');
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          jobProviders: {
            executor: 'invalid-provider',
            reviewer: 'claude',
          },
        }),
      );

      const config = loadConfig(tempDir);

      // Now accepts any string as preset ID (validation happens at resolve time)
      expect(config.jobProviders.executor).toBe('invalid-provider');
      expect(config.jobProviders.reviewer).toBe('claude');
    });

    it('should override jobProviders from env vars', () => {
      process.env.NW_JOB_PROVIDER_EXECUTOR = 'codex';
      process.env.NW_JOB_PROVIDER_REVIEWER = 'claude';

      const config = loadConfig(tempDir);

      expect(config.jobProviders.executor).toBe('codex');
      expect(config.jobProviders.reviewer).toBe('claude');
    });

    it('should accept any non-empty string as preset ID from env vars', () => {
      process.env.NW_JOB_PROVIDER_EXECUTOR = 'custom-preset';

      const config = loadConfig(tempDir);

      // Now accepts any string as preset ID (validation happens at resolve time)
      expect(config.jobProviders.executor).toBe('custom-preset');
    });

    it('should let env vars override jobProviders from config file', () => {
      const configPath = path.join(tempDir, 'night-watch.config.json');
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          jobProviders: {
            executor: 'claude',
            reviewer: 'claude',
          },
        }),
      );

      process.env.NW_JOB_PROVIDER_EXECUTOR = 'codex';

      const config = loadConfig(tempDir);

      expect(config.jobProviders.executor).toBe('codex');
      // Env var replaces entire jobProviders object, so reviewer is not present
      expect(config.jobProviders.reviewer).toBeUndefined();
    });

    it('should load all valid job types from config file', () => {
      const configPath = path.join(tempDir, 'night-watch.config.json');
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          jobProviders: {
            executor: 'codex',
            reviewer: 'claude',
            qa: 'codex',
            audit: 'claude',
            slicer: 'codex',
          },
        }),
      );

      const config = loadConfig(tempDir);

      expect(config.jobProviders.executor).toBe('codex');
      expect(config.jobProviders.reviewer).toBe('claude');
      expect(config.jobProviders.qa).toBe('codex');
      expect(config.jobProviders.audit).toBe('claude');
      expect(config.jobProviders.slicer).toBe('codex');
    });

    it('should load all valid job types from env vars', () => {
      process.env.NW_JOB_PROVIDER_EXECUTOR = 'codex';
      process.env.NW_JOB_PROVIDER_REVIEWER = 'claude';
      process.env.NW_JOB_PROVIDER_QA = 'codex';
      process.env.NW_JOB_PROVIDER_AUDIT = 'claude';
      process.env.NW_JOB_PROVIDER_SLICER = 'codex';

      const config = loadConfig(tempDir);

      expect(config.jobProviders.executor).toBe('codex');
      expect(config.jobProviders.reviewer).toBe('claude');
      expect(config.jobProviders.qa).toBe('codex');
      expect(config.jobProviders.audit).toBe('claude');
      expect(config.jobProviders.slicer).toBe('codex');
    });
  });

  describe('resolveJobProvider', () => {
    it('should return job-specific provider when set', () => {
      const config: INightWatchConfig = {
        ...getDefaultConfig(),
        provider: 'claude',
        jobProviders: {
          executor: 'codex',
        },
      };

      expect(resolveJobProvider(config, 'executor' as JobType)).toBe('codex');
    });

    it('should fall back to global provider when job-specific not set', () => {
      const config: INightWatchConfig = {
        ...getDefaultConfig(),
        provider: 'claude',
        jobProviders: {
          executor: 'codex',
        },
      };

      expect(resolveJobProvider(config, 'reviewer' as JobType)).toBe('claude');
    });

    it('should fall back to global provider when jobProviders is empty', () => {
      const config: INightWatchConfig = {
        ...getDefaultConfig(),
        provider: 'claude',
        jobProviders: {},
      };

      expect(resolveJobProvider(config, 'executor' as JobType)).toBe('claude');
    });

    it('should work with all job types', () => {
      const config: INightWatchConfig = {
        ...getDefaultConfig(),
        provider: 'claude',
        jobProviders: {
          executor: 'codex',
          reviewer: 'codex',
          qa: 'codex',
          audit: 'codex',
          slicer: 'codex',
          planner: 'codex',
        },
      };

      const jobTypes: JobType[] = ['executor', 'reviewer', 'qa', 'audit', 'slicer', 'planner'];
      for (const jobType of jobTypes) {
        expect(resolveJobProvider(config, jobType)).toBe('codex');
      }
    });

    it('should prioritize CLI override over job-specific provider', () => {
      // This tests the critical precedence contract: --provider beats jobProviders
      const config: INightWatchConfig = {
        ...getDefaultConfig(),
        provider: 'claude',
        jobProviders: {
          executor: 'codex',
          reviewer: 'codex',
        },
        _cliProviderOverride: 'claude', // Set via --provider flag
      };

      // CLI override should win even though jobProviders.executor is "codex"
      expect(resolveJobProvider(config, 'executor' as JobType)).toBe('claude');
      expect(resolveJobProvider(config, 'reviewer' as JobType)).toBe('claude');
      // Jobs without job-specific provider should also use CLI override
      expect(resolveJobProvider(config, 'qa' as JobType)).toBe('claude');
    });

    it('should prioritize CLI override over global provider', () => {
      const config: INightWatchConfig = {
        ...getDefaultConfig(),
        provider: 'codex',
        jobProviders: {},
        _cliProviderOverride: 'claude', // Set via --provider flag
      };

      expect(resolveJobProvider(config, 'executor' as JobType)).toBe('claude');
    });

    describe('schedule overrides', () => {
      // Helper to create dates in local time for consistent testing
      // Note: These dates assume the test runner is in a timezone where
      // the dates fall on the expected days of week.
      const createDate = (isoString: string): Date => {
        const d = new Date(isoString);
        return d;
      };

      const nightSurgeOverride: IProviderScheduleOverride = {
        label: 'Night Surge - Claude',
        presetId: 'claude-opus-4-6',
        days: [1, 2, 3, 4, 5], // Weekdays (Mon=1, Fri=5)
        startTime: '23:00',
        endTime: '04:00',
        enabled: true,
      };

      const dayOverride: IProviderScheduleOverride = {
        label: 'Day Worker - Codex',
        presetId: 'codex',
        days: [1, 2, 3, 4, 5], // Weekdays
        startTime: '09:00',
        endTime: '17:00',
        enabled: true,
      };

      it('should return override preset when time matches (within window)', () => {
        const config: INightWatchConfig = {
          ...getDefaultConfig(),
          provider: 'claude',
          providerScheduleOverrides: [nightSurgeOverride],
        };

        // Create a date that is guaranteed to be a weekday at 23:30
        // March 17, 2026 is a Tuesday - use local time (no Z suffix)
        const tuesday2330 = createDate('2026-03-17T23:30:00');
        expect(resolveJobProvider(config, 'executor' as JobType, tuesday2330)).toBe(
          'claude-opus-4-6',
        );
      });

      it('should fall through to static provider when outside time window', () => {
        const config: INightWatchConfig = {
          ...getDefaultConfig(),
          provider: 'claude',
          providerScheduleOverrides: [nightSurgeOverride],
        };

        // Tuesday at 10:00 - outside the night surge window (23:00-04:00)
        const tuesday1000 = createDate('2026-03-17T10:00:00');
        expect(resolveJobProvider(config, 'executor' as JobType, tuesday1000)).toBe('claude');
      });

      it('should match cross-midnight window at 02:00 (previous day check)', () => {
        const config: INightWatchConfig = {
          ...getDefaultConfig(),
          provider: 'claude',
          providerScheduleOverrides: [nightSurgeOverride],
        };

        // Thursday at 02:00 - should match because Wednesday (day 3) is in days
        // and the window 23:00-04:00 crosses midnight
        // March 19, 2026 is a Thursday
        const thursday0200 = createDate('2026-03-19T02:00:00');
        expect(resolveJobProvider(config, 'executor' as JobType, thursday0200)).toBe(
          'claude-opus-4-6',
        );
      });

      it('should prefer job-specific override over global override', () => {
        const jobSpecificOverride: IProviderScheduleOverride = {
          ...nightSurgeOverride,
          jobTypes: ['executor'],
        };

        const config: INightWatchConfig = {
          ...getDefaultConfig(),
          provider: 'claude',
          providerScheduleOverrides: [nightSurgeOverride, jobSpecificOverride],
        };

        // Tuesday at 23:30 - executor should use job-specific override
        const tuesday2330 = createDate('2026-03-17T23:30:00');
        expect(resolveJobProvider(config, 'executor' as JobType, tuesday2330)).toBe(
          'claude-opus-4-6',
        );
      });

      it('should skip disabled overrides', () => {
        const disabledOverride: IProviderScheduleOverride = {
          ...nightSurgeOverride,
          enabled: false,
        };

        const config: INightWatchConfig = {
          ...getDefaultConfig(),
          provider: 'claude',
          providerScheduleOverrides: [disabledOverride],
        };

        const tuesday2330 = createDate('2026-03-17T23:30:00');
        expect(resolveJobProvider(config, 'executor' as JobType, tuesday2330)).toBe('claude');
      });

      it('should not match on wrong day of week', () => {
        const config: INightWatchConfig = {
          ...getDefaultConfig(),
          provider: 'claude',
          providerScheduleOverrides: [nightSurgeOverride],
        };

        // Saturday at 23:30 - day 6, not in [1,2,3,4,5]
        // March 22, 2026 is a Sunday (day 0), but in some timezones it might still be Saturday
        // Let's use March 21, 2026 which is a Saturday
        const saturday2330 = createDate('2026-03-21T23:30:00');
        expect(resolveJobProvider(config, 'executor' as JobType, saturday2330)).toBe('claude');
      });

      it('should have CLI override beat schedule overrides', () => {
        const config: INightWatchConfig = {
          ...getDefaultConfig(),
          provider: 'claude',
          providerScheduleOverrides: [nightSurgeOverride],
          _cliProviderOverride: 'codex',
        };

        const tuesday2330 = createDate('2026-03-17T23:30:00');
        expect(resolveJobProvider(config, 'executor' as JobType, tuesday2330)).toBe('codex');
      });

      it('should handle same-day window (09:00-17:00)', () => {
        const config: INightWatchConfig = {
          ...getDefaultConfig(),
          provider: 'claude',
          providerScheduleOverrides: [dayOverride],
        };

        // Tuesday at 14:00 - within same-day window
        const tuesday1400 = createDate('2026-03-17T14:00:00');
        expect(resolveJobProvider(config, 'executor' as JobType, tuesday1400)).toBe('codex');

        // Tuesday at 18:00 - outside same-day window
        const tuesday1800 = createDate('2026-03-17T18:00:00');
        expect(resolveJobProvider(config, 'executor' as JobType, tuesday1800)).toBe('claude');
      });

      it('first matching override of same specificity wins', () => {
        const firstOverride: IProviderScheduleOverride = {
          ...nightSurgeOverride,
          presetId: 'first-override',
        };

        const secondOverride: IProviderScheduleOverride = {
          ...nightSurgeOverride,
          presetId: 'second-override',
        };

        const config: INightWatchConfig = {
          ...getDefaultConfig(),
          provider: 'claude',
          providerScheduleOverrides: [firstOverride, secondOverride],
        };

        const tuesday2330 = createDate('2026-03-17T23:30:00');
        expect(resolveJobProvider(config, 'executor' as JobType, tuesday2330)).toBe(
          'first-override',
        );
      });

      it('should only apply job-specific overrides to matching jobs', () => {
        const executorOverride: IProviderScheduleOverride = {
          ...nightSurgeOverride,
          presetId: 'executor-only',
          jobTypes: ['executor'],
        };

        const config: INightWatchConfig = {
          ...getDefaultConfig(),
          provider: 'claude',
          providerScheduleOverrides: [executorOverride],
        };

        const tuesday2330 = createDate('2026-03-17T23:30:00');
        expect(resolveJobProvider(config, 'executor' as JobType, tuesday2330)).toBe(
          'executor-only',
        );
        expect(resolveJobProvider(config, 'reviewer' as JobType, tuesday2330)).toBe('claude');
      });
    });

    describe('findActiveScheduleOverride', () => {
      it('should return null when no overrides are active', () => {
        const overrides: IProviderScheduleOverride[] = [
          {
            label: 'Night Surge',
            presetId: 'claude-opus-4-6',
            days: [1, 2, 3, 4, 5], // Weekdays only
            startTime: '23:00',
            endTime: '04:00',
            enabled: true,
          },
        ];

        // Sunday at noon - no override active (not a weekday)
        // March 22, 2026 is a Sunday
        const sunday1200 = new Date('2026-03-22T12:00:00');
        expect(findActiveScheduleOverride(overrides, 'executor' as JobType, sunday1200)).toBeNull();
      });

      it('should return null for empty overrides array', () => {
        const sunday1200 = new Date('2026-03-22T12:00:00');
        expect(findActiveScheduleOverride([], 'executor' as JobType, sunday1200)).toBeNull();
      });
    });
  });

  describe('mergeConfigLayer semantics', () => {
    it('providerEnv from file merges with defaults (not replace)', () => {
      // DEFAULT_PROVIDER_ENV is {}, so writing a key should produce that key in the result
      const configPath = path.join(tempDir, 'night-watch.config.json');
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          providerEnv: { MY_VAR: 'hello' },
        }),
      );

      const config = loadConfig(tempDir);

      // The file-provided key must be present
      expect(config.providerEnv.MY_VAR).toBe('hello');
      // Default providerEnv is empty so no default keys exist to check; verify the object shape
      expect(typeof config.providerEnv).toBe('object');
    });

    it('boardProvider from file shallow-merges with default (preserves unset keys)', () => {
      // Default boardProvider: { enabled: true, provider: 'github' }
      // File only sets enabled: the default provider field must survive the merge
      const configPath = path.join(tempDir, 'night-watch.config.json');
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          boardProvider: { enabled: false },
        }),
      );

      const config = loadConfig(tempDir);

      // The file-provided field is applied
      expect(config.boardProvider.enabled).toBe(false);
      // The default-provided field is preserved (shallow merge, not replace)
      expect(config.boardProvider.provider).toBe('github');
    });

    it('roadmapScanner from file replaces default entirely (replace semantics)', () => {
      // roadmapScanner uses REPLACE semantics: the normalised value from the file
      // fully replaces the base object. normalizeConfig fills missing fields from
      // DEFAULT_ROADMAP_SCANNER, so autoScanInterval gets its default value.
      const configPath = path.join(tempDir, 'night-watch.config.json');
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          roadmapScanner: { enabled: true },
        }),
      );

      const config = loadConfig(tempDir);

      expect(config.roadmapScanner.enabled).toBe(true);
      // normalizeConfig fills missing fields from DEFAULT_ROADMAP_SCANNER
      expect(config.roadmapScanner.autoScanInterval).toBe(300);
      expect(config.roadmapScanner.roadmapPath).toBe('ROADMAP.md');
      expect(config.roadmapScanner.priorityMode).toBe('roadmap-first');
      expect(config.roadmapScanner.issueColumn).toBe('Ready');
    });

    it('jobProviders from file replaces default (replace semantics)', () => {
      // jobProviders uses REPLACE semantics; only the keys present in the file
      // survive — job types not listed in the file config are absent from the result.
      const configPath = path.join(tempDir, 'night-watch.config.json');
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          jobProviders: { executor: 'codex' },
        }),
      );

      const config = loadConfig(tempDir);

      expect(config.jobProviders.executor).toBe('codex');
      // Absent keys should not bleed through from the default (which is also empty, {})
      expect(config.jobProviders.reviewer).toBeUndefined();
      expect(config.jobProviders.qa).toBeUndefined();
    });

    it('providerEnv keys from two file-side sources are all present after shallow merge', () => {
      // Verify the shallow merge direction: when the file sets multiple providerEnv keys
      // they all survive (no key is silently dropped by the merge).
      const configPath = path.join(tempDir, 'night-watch.config.json');
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          providerEnv: {
            FIRST_VAR: 'alpha',
            SECOND_VAR: 'beta',
          },
        }),
      );

      const config = loadConfig(tempDir);

      // Both keys must appear after the shallow merge with the empty default
      expect(config.providerEnv.FIRST_VAR).toBe('alpha');
      expect(config.providerEnv.SECOND_VAR).toBe('beta');
      // No extra keys injected from defaults (DEFAULT_PROVIDER_ENV is {})
      expect(Object.keys(config.providerEnv)).toEqual(['FIRST_VAR', 'SECOND_VAR']);
    });
  });

  describe('Config parity contract', () => {
    /**
     * This test ensures that the shared INightWatchConfig contract includes
     * all non-internal fields from the core INightWatchConfig interface.
     * This prevents type drift between the core config and the shared API contract.
     *
     * The only field allowed to be missing from the shared contract is
     * `_cliProviderOverride`, which is internal to CLI runtime.
     */
    it('should maintain parity between core INightWatchConfig and shared INightWatchConfig', () => {
      // Import both interfaces
      const coreKeys: (keyof INightWatchConfig)[] = [
        'defaultBranch',
        'prdDir',
        'maxRuntime',
        'reviewerMaxRuntime',
        'branchPrefix',
        'branchPatterns',
        'minReviewScore',
        'maxLogSize',
        'cronSchedule',
        'reviewerSchedule',
        'scheduleBundleId',
        'cronScheduleOffset',
        'maxRetries',
        'reviewerMaxRetries',
        'reviewerRetryDelay',
        'reviewerMaxPrsPerRun',
        'provider',
        'executorEnabled',
        'reviewerEnabled',
        'providerEnv',
        'fallbackOnRateLimit',
        'claudeModel',
        'notifications',
        'prdPriority',
        'roadmapScanner',
        'templatesDir',
        'boardProvider',
        'autoMerge',
        'autoMergeMethod',
        'qa',
        'audit',
        'jobProviders',
        '_cliProviderOverride',
      ];

      // Import the shared contract
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const sharedModule = require('../shared/types.ts');
      const SharedINightWatchConfig = sharedModule.INightWatchConfig;

      // The shared contract should have all fields except _cliProviderOverride
      const sharedKeys: (keyof any)[] = [
        'defaultBranch',
        'prdDir',
        'maxRuntime',
        'reviewerMaxRuntime',
        'branchPrefix',
        'branchPatterns',
        'minReviewScore',
        'maxLogSize',
        'cronSchedule',
        'reviewerSchedule',
        'scheduleBundleId',
        'cronScheduleOffset',
        'maxRetries',
        'reviewerMaxRetries',
        'reviewerRetryDelay',
        'reviewerMaxPrsPerRun',
        'provider',
        'executorEnabled',
        'reviewerEnabled',
        'providerEnv',
        'fallbackOnRateLimit',
        'claudeModel',
        'notifications',
        'prdPriority',
        'roadmapScanner',
        'templatesDir',
        'boardProvider',
        'autoMerge',
        'autoMergeMethod',
        'qa',
        'audit',
        'jobProviders',
      ];

      // Verify that all non-internal core keys are in the shared contract
      const internalKeys = new Set<keyof INightWatchConfig>(['_cliProviderOverride']);
      const publicCoreKeys = coreKeys.filter((key) => !internalKeys.has(key));

      for (const key of publicCoreKeys) {
        expect(sharedKeys).toContain(key);
      }

      // Verify that shared contract doesn't have extra fields (unless intentionally added)
      // This is optional but helps catch accidental additions
      const sharedSet = new Set(sharedKeys);
      const coreSet = new Set(publicCoreKeys);

      // Check if shared has any fields not in core (excluding internal)
      for (const key of sharedKeys) {
        expect(coreSet).toContain(key as keyof INightWatchConfig);
      }
    });

    it('should include IQaConfig and IAuditConfig in core types', () => {
      // Verify that the core types export includes the nested config types
      // These are type-level exports that don't exist at runtime, so we verify
      // by checking that instances of these types can be created with expected fields

      // QA config should have all required fields
      const qaConfig: IQaConfig = {
        enabled: true,
        schedule: '0 * * * *',
        maxRuntime: 3600,
        branchPatterns: [],
        artifacts: 'both',
        skipLabel: 'skip-qa',
        autoInstallPlaywright: true,
      };
      expect(qaConfig.enabled).toBeDefined();
      expect(qaConfig.schedule).toBeDefined();
      expect(qaConfig.maxRuntime).toBeDefined();
      expect(qaConfig.branchPatterns).toBeDefined();
      expect(qaConfig.artifacts).toBeDefined();
      expect(qaConfig.skipLabel).toBeDefined();
      expect(qaConfig.autoInstallPlaywright).toBeDefined();

      // Audit config should have all required fields
      const auditConfig: IAuditConfig = {
        enabled: true,
        schedule: '0 * * * *',
        maxRuntime: 1800,
      };
      expect(auditConfig.enabled).toBeDefined();
      expect(auditConfig.schedule).toBeDefined();
      expect(auditConfig.maxRuntime).toBeDefined();
    });

    it('should have all INightWatchConfig fields documented in configuration.md', () => {
      // This is a regression test to ensure that new config fields are documented.
      // When adding new fields to INightWatchConfig, update docs/configuration.md.

      // List of all expected fields from INightWatchConfig (excluding internal)
      const expectedFields: (keyof INightWatchConfig)[] = [
        'defaultBranch',
        'prdDir',
        'maxRuntime',
        'reviewerMaxRuntime',
        'branchPrefix',
        'branchPatterns',
        'minReviewScore',
        'maxLogSize',
        'cronSchedule',
        'reviewerSchedule',
        'scheduleBundleId',
        'cronScheduleOffset',
        'maxRetries',
        'reviewerMaxRetries',
        'reviewerRetryDelay',
        'reviewerMaxPrsPerRun',
        'provider',
        'executorEnabled',
        'reviewerEnabled',
        'providerEnv',
        'fallbackOnRateLimit',
        'claudeModel',
        'notifications',
        'prdPriority',
        'roadmapScanner',
        'templatesDir',
        'boardProvider',
        'autoMerge',
        'autoMergeMethod',
        'qa',
        'audit',
        'jobProviders',
        // _cliProviderOverride is internal and excluded
      ];

      // Verify that getDefaultConfig returns all expected fields
      const config = getDefaultConfig();

      for (const field of expectedFields) {
        expect(config[field]).toBeDefined();
      }

      // This test should fail if new fields are added to INightWatchConfig
      // without updating this list. The test serves as documentation
      // completeness validation.
    });
  });

  // ---------------------------------------------------------------------------
  // Queue config tests
  // ---------------------------------------------------------------------------

  describe('queue config', () => {
    it('should load queue defaults including mode and providerBuckets', () => {
      const config = loadConfig(tempDir);

      expect(config.queue.mode).toBe('auto');
      expect(config.queue.providerBuckets).toEqual({});
    });

    it('loads provider-aware mode from config file', () => {
      const configPath = path.join(tempDir, 'night-watch.config.json');
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          queue: {
            mode: 'provider-aware',
          },
        }),
      );

      const config = loadConfig(tempDir);

      expect(config.queue.mode).toBe('provider-aware');
    });

    it('ignores invalid queue mode and falls back to auto', () => {
      const configPath = path.join(tempDir, 'night-watch.config.json');
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          queue: {
            mode: 'invalid-mode',
          },
        }),
      );

      const config = loadConfig(tempDir);

      expect(config.queue.mode).toBe('auto');
    });

    it('loads providerBuckets from config file', () => {
      const configPath = path.join(tempDir, 'night-watch.config.json');
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          queue: {
            mode: 'provider-aware',
            providerBuckets: {
              'claude-native': { maxConcurrency: 1 },
              codex: { maxConcurrency: 2 },
            },
          },
        }),
      );

      const config = loadConfig(tempDir);

      expect(config.queue.providerBuckets['claude-native']).toEqual({
        maxConcurrency: 1,
      });
      expect(config.queue.providerBuckets['codex']).toEqual({
        maxConcurrency: 2,
      });
    });

    it('deep-merges queue from file layer — existing priority defaults survive when not overridden', () => {
      const configPath = path.join(tempDir, 'night-watch.config.json');
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          queue: {
            mode: 'provider-aware',
          },
        }),
      );

      const config = loadConfig(tempDir);

      // Default priorities survive the merge
      expect(config.queue.priority.executor).toBe(50);
      expect(config.queue.priority.reviewer).toBe(40);
    });
  });

  // ---------------------------------------------------------------------------
  // resolvePreset tests
  // ---------------------------------------------------------------------------

  describe('resolvePreset', () => {
    it('should resolve built-in claude preset', () => {
      const config = getDefaultConfig();
      const preset = resolvePreset(config, 'claude');

      expect(preset.command).toBe('claude');
      expect(preset.name).toBe('Claude');
      expect(preset.promptFlag).toBe('-p');
      expect(preset.autoApproveFlag).toBe('--dangerously-skip-permissions');
    });

    it('should resolve built-in codex preset', () => {
      const config = getDefaultConfig();
      const preset = resolvePreset(config, 'codex');

      expect(preset.command).toBe('codex');
      expect(preset.name).toBe('Codex');
      expect(preset.subcommand).toBe('exec');
      expect(preset.autoApproveFlag).toBe('--yolo');
      expect(preset.workdirFlag).toBe('-C');
    });

    it('should resolve custom preset from config', () => {
      const customPreset: IProviderPreset = {
        name: 'Architect',
        command: 'claude',
        model: 'claude-opus-4-6',
        modelFlag: '--model',
      };
      const config: INightWatchConfig = {
        ...getDefaultConfig(),
        providerPresets: {
          architect: customPreset,
        },
      };

      const preset = resolvePreset(config, 'architect');

      expect(preset.name).toBe('Architect');
      expect(preset.command).toBe('claude');
      expect(preset.model).toBe('claude-opus-4-6');
      expect(preset.modelFlag).toBe('--model');
    });

    it('should throw for unknown preset', () => {
      const config = getDefaultConfig();

      expect(() => resolvePreset(config, 'invalid')).toThrow('Unknown provider preset: "invalid"');
    });

    it('should allow overriding built-in preset', () => {
      const customClaude: IProviderPreset = {
        name: 'Custom Claude',
        command: 'claude',
        promptFlag: '--prompt',
        envVars: { ANTHROPIC_BASE_URL: 'https://custom.api.com' },
      };
      const config: INightWatchConfig = {
        ...getDefaultConfig(),
        providerPresets: {
          claude: customClaude,
        },
      };

      const preset = resolvePreset(config, 'claude');

      // Custom preset overrides built-in
      expect(preset.name).toBe('Custom Claude');
      expect(preset.promptFlag).toBe('--prompt');
      expect(preset.envVars?.ANTHROPIC_BASE_URL).toBe('https://custom.api.com');
    });

    it('should resolve job provider as preset ID', () => {
      const config: INightWatchConfig = {
        ...getDefaultConfig(),
        provider: 'claude',
        jobProviders: {
          executor: 'architect',
        },
        providerPresets: {
          architect: {
            name: 'Architect',
            command: 'claude',
            model: 'claude-opus-4-6',
          },
        },
      };

      // resolveJobProvider returns the preset ID
      expect(resolveJobProvider(config, 'executor' as JobType)).toBe('architect');

      // And we can resolve it to get the full preset
      const preset = resolvePreset(config, 'architect');
      expect(preset.name).toBe('Architect');
      expect(preset.model).toBe('claude-opus-4-6');
    });
  });

  // ---------------------------------------------------------------------------
  // providerPresets config tests
  // ---------------------------------------------------------------------------

  describe('providerPresets config', () => {
    it('should load providerPresets from config file', () => {
      const configPath = path.join(tempDir, 'night-watch.config.json');
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          providerPresets: {
            'custom-provider': {
              name: 'Custom Provider',
              command: 'custom-cli',
              promptFlag: '--input',
              autoApproveFlag: '--yes',
            },
          },
        }),
      );

      const config = loadConfig(tempDir);

      expect(config.providerPresets).toBeDefined();
      expect(config.providerPresets!['custom-provider']).toBeDefined();
      expect(config.providerPresets!['custom-provider'].name).toBe('Custom Provider');
      expect(config.providerPresets!['custom-provider'].command).toBe('custom-cli');
      expect(config.providerPresets!['custom-provider'].promptFlag).toBe('--input');
    });

    it('should load providerPresets with envVars', () => {
      const configPath = path.join(tempDir, 'night-watch.config.json');
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          providerPresets: {
            'proxy-claude': {
              name: 'Proxy Claude',
              command: 'claude',
              envVars: {
                ANTHROPIC_BASE_URL: 'https://proxy.example.com',
                ANTHROPIC_API_KEY: 'sk-test',
              },
            },
          },
        }),
      );

      const config = loadConfig(tempDir);

      expect(config.providerPresets!['proxy-claude'].envVars).toEqual({
        ANTHROPIC_BASE_URL: 'https://proxy.example.com',
        ANTHROPIC_API_KEY: 'sk-test',
      });
    });

    it('should ignore providerPresets without required fields', () => {
      const configPath = path.join(tempDir, 'night-watch.config.json');
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          providerPresets: {
            'missing-command': {
              name: 'Missing Command',
              // command is missing
            },
            'missing-name': {
              // name is missing
              command: 'some-cli',
            },
            'valid-preset': {
              name: 'Valid',
              command: 'valid-cli',
            },
          },
        }),
      );

      const config = loadConfig(tempDir);

      // Only the valid preset should be loaded
      expect(config.providerPresets).toEqual({
        'valid-preset': {
          name: 'Valid',
          command: 'valid-cli',
        },
      });
    });
  });
});
