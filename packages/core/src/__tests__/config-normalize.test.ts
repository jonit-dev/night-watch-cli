/**
 * Tests for config normalization
 */

import { describe, it, expect } from 'vitest';
import { normalizeConfig, validateProvider } from '../config-normalize.js';
import { IProviderPreset } from '../types.js';

describe('config-normalize', () => {
  describe('validateProvider', () => {
    it('should accept claude as a valid provider', () => {
      expect(validateProvider('claude')).toBe('claude');
    });

    it('should accept codex as a valid provider', () => {
      expect(validateProvider('codex')).toBe('codex');
    });

    it('should accept any non-empty string as a preset ID', () => {
      expect(validateProvider('custom-preset')).toBe('custom-preset');
    });

    it('should reject empty string', () => {
      expect(validateProvider('')).toBeNull();
    });

    it('should reject whitespace-only string', () => {
      expect(validateProvider('   ')).toBeNull();
    });
  });

  describe('normalizeConfig', () => {
    it('should normalize providerPresets', () => {
      const rawConfig = {
        providerPresets: {
          'custom-provider': {
            name: 'Custom Provider',
            command: 'custom-cli',
            envVars: { CUSTOM_ENV: 'value' },
          },
        },
      };
      const normalized = normalizeConfig(rawConfig);
      // Verify presets are preserved
      expect(normalized.providerPresets).toEqual({
        'custom-provider': {
          name: 'Custom Provider',
          command: 'custom-cli',
          envVars: { CUSTOM_ENV: 'value' },
        },
      });
    });

    it('should reject preset without command', () => {
      const rawConfig = {
        providerPresets: {
          'missing-command': {
            name: 'Missing Command',
            // command is missing
          },
        },
      };
      const normalized = normalizeConfig(rawConfig);
      // Missing command preset should be skipped
      expect(normalized.providerPresets).toBeUndefined();
    });

    it('should reject preset without name', () => {
      const rawConfig = {
        providerPresets: {
          'missing-name': {
            // name is missing
            command: 'some-cli',
          },
        },
      };
      const normalized = normalizeConfig(rawConfig);
      // Missing name preset should be skipped
      expect(normalized.providerPresets).toBeUndefined();
    });

    it('should accept preset with only required fields', () => {
      const rawConfig = {
        providerPresets: {
          'minimal-preset': {
            name: 'Minimal',
            command: 'minimal-cli',
          },
        },
      };
      const normalized = normalizeConfig(rawConfig);
      expect(normalized.providerPresets).toEqual({
        'minimal-preset': {
          name: 'Minimal',
          command: 'minimal-cli',
        },
      });
    });

    it('should preserve optional fields when present', () => {
      const rawConfig = {
        providerPresets: {
          'full-preset': {
            name: 'Full',
            command: 'full-cli',
            subcommand: 'exec',
            promptFlag: '--prompt',
            autoApproveFlag: '--yes',
            workdirFlag: '-C',
            modelFlag: '--model',
            model: 'custom-model',
            envVars: { API_KEY: 'key' },
          },
        },
      };
      const normalized = normalizeConfig(rawConfig);
      expect(normalized.providerPresets).toEqual({
        'full-preset': {
          name: 'Full',
          command: 'full-cli',
          subcommand: 'exec',
          promptFlag: '--prompt',
          autoApproveFlag: '--yes',
          workdirFlag: '-C',
          modelFlag: '--model',
          model: 'custom-model',
          envVars: { API_KEY: 'key' },
        },
      });
    });

    it('should filter out non-string envVars values', () => {
      const rawConfig = {
        providerPresets: {
          'mixed-envvars': {
            name: 'Mixed EnvVars',
            command: 'some-cli',
            envVars: {
              STRING_VAR: 'value',
              NUM_VAR: 123,
              BOOL_VAR: true,
            },
          },
        },
      };
      const normalized = normalizeConfig(rawConfig);
      // Only string values should be preserved
      expect(normalized.providerPresets).toEqual({
        'mixed-envvars': {
          name: 'Mixed EnvVars',
          command: 'some-cli',
          envVars: {
            STRING_VAR: 'value',
          },
        },
      });
    });

    it('should accept preset with non-object envVars (ignores invalid envVars)', () => {
      const rawConfig = {
        providerPresets: {
          'bad-envvars-type': {
            name: 'Bad EnvVars Type',
            command: 'some-cli',
            envVars: 'not-an-object',
          },
        },
      };
      const normalized = normalizeConfig(rawConfig);
      // envVars is ignored when not an object, but preset is still valid
      expect(normalized.providerPresets).toBeDefined();
      expect(normalized.providerPresets!['bad-envvars-type']).toEqual({
        name: 'Bad EnvVars Type',
        command: 'some-cli',
      });
    });

    it('should skip presets with invalid structure', () => {
      const rawConfig = {
        providerPresets: {
          'not-an-object': 'string-value',
          'null-value': null,
        },
      };
      const normalized = normalizeConfig(rawConfig);
      // Both should be skipped
      expect(normalized.providerPresets).toBeUndefined();
    });

  });
});
