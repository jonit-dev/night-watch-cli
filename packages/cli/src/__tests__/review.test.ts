/**
 * Tests for review command buildEnvVars with job-specific provider resolution
 */

import { describe, it, expect } from 'vitest';
import { buildEnvVars, parseRetryAttempts, parseFinalReviewScore } from '../commands/review.js';
import { INightWatchConfig, getDefaultConfig } from '@night-watch/core';

describe('review command', () => {
  describe('buildEnvVars', () => {
    it('should use global provider when no job-specific provider is set', () => {
      const config: INightWatchConfig = {
        ...getDefaultConfig(),
        provider: 'claude',
        jobProviders: {},
      };

      const envVars = buildEnvVars(config, { dryRun: false });

      expect(envVars.NW_PROVIDER_CMD).toBe('claude');
    });

    it('should use job-specific provider for reviewer when set', () => {
      const config: INightWatchConfig = {
        ...getDefaultConfig(),
        provider: 'claude',
        jobProviders: {
          reviewer: 'codex',
        },
      };

      const envVars = buildEnvVars(config, { dryRun: false });

      expect(envVars.NW_PROVIDER_CMD).toBe('codex');
    });

    it('should use codex provider when job-specific reviewer is codex', () => {
      const config: INightWatchConfig = {
        ...getDefaultConfig(),
        provider: 'claude',
        jobProviders: {
          reviewer: 'codex',
        },
      };

      const envVars = buildEnvVars(config, { dryRun: false });

      // With jobProviders.reviewer = 'codex', env NW_PROVIDER_CMD === 'codex'
      expect(envVars.NW_PROVIDER_CMD).toBe('codex');
    });

    it('should fall back to global provider for reviewer when jobProviders is empty', () => {
      const config: INightWatchConfig = {
        ...getDefaultConfig(),
        provider: 'claude',
        jobProviders: {},
      };

      const envVars = buildEnvVars(config, { dryRun: false });

      expect(envVars.NW_PROVIDER_CMD).toBe('claude');
    });

    it('should ignore other job-specific providers and only use reviewer', () => {
      const config: INightWatchConfig = {
        ...getDefaultConfig(),
        provider: 'claude',
        jobProviders: {
          executor: 'codex',
          qa: 'codex',
          audit: 'codex',
          slicer: 'codex',
        },
      };

      const envVars = buildEnvVars(config, { dryRun: false });

      // Should still use global provider since reviewer is not set
      expect(envVars.NW_PROVIDER_CMD).toBe('claude');
    });

    it('should use reviewer job provider when multiple job providers are set', () => {
      const config: INightWatchConfig = {
        ...getDefaultConfig(),
        provider: 'codex',
        jobProviders: {
          executor: 'codex',
          reviewer: 'claude',
          qa: 'codex',
        },
      };

      const envVars = buildEnvVars(config, { dryRun: false });

      expect(envVars.NW_PROVIDER_CMD).toBe('claude');
    });

    it('buildEnvVars should not set NW_AUTO_MERGE', () => {
      const config: INightWatchConfig = {
        ...getDefaultConfig(),
        provider: 'claude',
      };

      const env = buildEnvVars(config, { dryRun: false });

      expect(env.NW_AUTO_MERGE).toBeUndefined();
    });

    it('should include retry env vars', () => {
      const config: INightWatchConfig = {
        ...getDefaultConfig(),
        provider: 'claude',
      };

      const envVars = buildEnvVars(config, { dryRun: false });

      expect(envVars.NW_REVIEWER_MAX_RETRIES).toBe('2');
      expect(envVars.NW_REVIEWER_RETRY_DELAY).toBe('30');
      expect(envVars.NW_PRD_DIR).toBe(config.prdDir);
    });

    it('should include custom retry values when configured', () => {
      const config: INightWatchConfig = {
        ...getDefaultConfig(),
        provider: 'claude',
        reviewerMaxRetries: 5,
        reviewerRetryDelay: 60,
      };

      const envVars = buildEnvVars(config, { dryRun: false });

      expect(envVars.NW_REVIEWER_MAX_RETRIES).toBe('5');
      expect(envVars.NW_REVIEWER_RETRY_DELAY).toBe('60');
    });
  });

  describe('parseRetryAttempts', () => {
    it('should parse retry attempts from result', () => {
      expect(parseRetryAttempts('3')).toBe(3);
    });

    it('should return 1 when value is undefined', () => {
      expect(parseRetryAttempts(undefined)).toBe(1);
    });

    it('should return 1 when value is empty string', () => {
      expect(parseRetryAttempts('')).toBe(1);
    });

    it('should return 1 when value is NaN', () => {
      expect(parseRetryAttempts('abc')).toBe(1);
    });

    it('should return 1 when value is zero', () => {
      expect(parseRetryAttempts('0')).toBe(1);
    });

    it('should return 1 when value is negative', () => {
      expect(parseRetryAttempts('-5')).toBe(1);
    });

    it('should parse valid numeric strings', () => {
      expect(parseRetryAttempts('1')).toBe(1);
      expect(parseRetryAttempts('2')).toBe(2);
      expect(parseRetryAttempts('10')).toBe(10);
    });
  });

  describe('parseFinalReviewScore', () => {
    it('should parse final review score from result', () => {
      expect(parseFinalReviewScore('85')).toBe(85);
    });

    it('should return undefined when value is undefined', () => {
      expect(parseFinalReviewScore(undefined)).toBeUndefined();
    });

    it('should return undefined when value is empty string', () => {
      expect(parseFinalReviewScore('')).toBeUndefined();
    });

    it('should return undefined when value is NaN', () => {
      expect(parseFinalReviewScore('abc')).toBeUndefined();
    });

    it('should parse valid numeric strings', () => {
      expect(parseFinalReviewScore('0')).toBe(0);
      expect(parseFinalReviewScore('50')).toBe(50);
      expect(parseFinalReviewScore('100')).toBe(100);
    });
  });
});
