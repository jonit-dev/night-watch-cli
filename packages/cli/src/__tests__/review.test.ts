/**
 * Tests for review command buildEnvVars with job-specific provider resolution
 */

import { describe, it, expect } from 'vitest';
import { buildEnvVars } from '../commands/review.js';
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
  });
});
