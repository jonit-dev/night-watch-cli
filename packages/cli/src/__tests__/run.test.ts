/**
 * Tests for run command buildEnvVars with job-specific provider resolution
 */

import { describe, it, expect } from 'vitest';
import { buildEnvVars } from '../commands/run.js';
import { INightWatchConfig, getDefaultConfig } from '@night-watch/core';

describe('run command', () => {
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

    it('should use job-specific provider for executor when set', () => {
      const config: INightWatchConfig = {
        ...getDefaultConfig(),
        provider: 'claude',
        jobProviders: {
          executor: 'codex',
        },
      };

      const envVars = buildEnvVars(config, { dryRun: false });

      expect(envVars.NW_PROVIDER_CMD).toBe('codex');
    });

    it('should use codex provider when job-specific executor is codex', () => {
      const config: INightWatchConfig = {
        ...getDefaultConfig(),
        provider: 'claude',
        jobProviders: {
          executor: 'codex',
        },
      };

      const envVars = buildEnvVars(config, { dryRun: false });

      // With jobProviders.executor = 'codex', env NW_PROVIDER_CMD === 'codex'
      expect(envVars.NW_PROVIDER_CMD).toBe('codex');
    });

    it('should fall back to global provider for executor when jobProviders is empty', () => {
      const config: INightWatchConfig = {
        ...getDefaultConfig(),
        provider: 'claude',
        jobProviders: {},
      };

      const envVars = buildEnvVars(config, { dryRun: false });

      expect(envVars.NW_PROVIDER_CMD).toBe('claude');
    });

    it('should ignore other job-specific providers and only use executor', () => {
      const config: INightWatchConfig = {
        ...getDefaultConfig(),
        provider: 'claude',
        jobProviders: {
          reviewer: 'codex',
          qa: 'codex',
          audit: 'codex',
          slicer: 'codex',
        },
      };

      const envVars = buildEnvVars(config, { dryRun: false });

      // Should still use global provider since executor is not set
      expect(envVars.NW_PROVIDER_CMD).toBe('claude');
    });

    it('should use executor job provider when multiple job providers are set', () => {
      const config: INightWatchConfig = {
        ...getDefaultConfig(),
        provider: 'claude',
        jobProviders: {
          executor: 'codex',
          reviewer: 'claude',
          qa: 'codex',
        },
      };

      const envVars = buildEnvVars(config, { dryRun: false });

      expect(envVars.NW_PROVIDER_CMD).toBe('codex');
    });
  });
});
