/**
 * Tests for config normalization
 */

import { describe, it, expect } from 'vitest';
import { normalizeConfig, validateProvider } from '../config-normalize.js';
import { DayOfWeek, IProviderPreset } from '../types.js';

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

describe('normalizeConfig - registry-driven job configs', () => {
  it('normalizes qa config via registry', () => {
    const normalized = normalizeConfig({
      qa: {
        enabled: false,
        schedule: '0 12 * * *',
        maxRuntime: 1800,
        artifacts: 'screenshot',
        skipLabel: 'no-qa',
        autoInstallPlaywright: false,
        branchPatterns: ['feat/'],
      },
    });
    expect(normalized.qa?.enabled).toBe(false);
    expect(normalized.qa?.schedule).toBe('0 12 * * *');
    expect(normalized.qa?.maxRuntime).toBe(1800);
    expect((normalized.qa as Record<string, unknown>)?.artifacts).toBe('screenshot');
    expect((normalized.qa as Record<string, unknown>)?.skipLabel).toBe('no-qa');
    expect((normalized.qa as Record<string, unknown>)?.autoInstallPlaywright).toBe(false);
    expect((normalized.qa as Record<string, unknown>)?.branchPatterns).toEqual(['feat/']);
  });

  it('normalizes audit config via registry', () => {
    const normalized = normalizeConfig({
      audit: { enabled: false, schedule: '0 4 * * 0', maxRuntime: 900 },
    });
    expect(normalized.audit?.enabled).toBe(false);
    expect(normalized.audit?.schedule).toBe('0 4 * * 0');
    expect(normalized.audit?.maxRuntime).toBe(900);
  });

  it('normalizes analytics config via registry', () => {
    const normalized = normalizeConfig({
      analytics: {
        enabled: true,
        schedule: '0 8 * * 1',
        maxRuntime: 600,
        lookbackDays: 14,
        targetColumn: 'Ready',
      },
    });
    expect(normalized.analytics?.enabled).toBe(true);
    expect((normalized.analytics as Record<string, unknown>)?.lookbackDays).toBe(14);
    expect((normalized.analytics as Record<string, unknown>)?.targetColumn).toBe('Ready');
  });

  it('applies qa defaults for missing fields', () => {
    const normalized = normalizeConfig({ qa: {} });
    expect(normalized.qa?.enabled).toBe(true);
    expect((normalized.qa as Record<string, unknown>)?.artifacts).toBe('both');
    expect((normalized.qa as Record<string, unknown>)?.autoInstallPlaywright).toBe(true);
  });

  it('rejects invalid qa artifacts enum value', () => {
    const normalized = normalizeConfig({ qa: { artifacts: 'invalid' } });
    expect((normalized.qa as Record<string, unknown>)?.artifacts).toBe('both'); // falls back to default
  });
});

describe('normalizeConfig - provider schedule overrides', () => {
  it('should normalize valid schedule override with all fields', () => {
    const rawConfig = {
      providerScheduleOverrides: [
        {
          label: 'Night Surge',
          presetId: 'claude-opus-4-6',
          days: [0, 1, 2, 3, 4, 5, 6],
          startTime: '23:00',
          endTime: '04:00',
          jobTypes: ['executor', 'reviewer'],
          enabled: true,
        },
      ],
    };
    const normalized = normalizeConfig(rawConfig);
    expect(normalized.providerScheduleOverrides).toEqual([
      {
        label: 'Night Surge',
        presetId: 'claude-opus-4-6',
        days: [0, 1, 2, 3, 4, 5, 6] as DayOfWeek[],
        startTime: '23:00',
        endTime: '04:00',
        jobTypes: ['executor', 'reviewer'],
        enabled: true,
      },
    ]);
  });

  it('should normalize valid schedule override with minimal fields', () => {
    const rawConfig = {
      providerScheduleOverrides: [
        {
          label: 'Weekend Override',
          presetId: 'codex',
          days: [0, 6],
          startTime: '09:00',
          endTime: '17:00',
        },
      ],
    };
    const normalized = normalizeConfig(rawConfig);
    expect(normalized.providerScheduleOverrides).toEqual([
      {
        label: 'Weekend Override',
        presetId: 'codex',
        days: [0, 6] as DayOfWeek[],
        startTime: '09:00',
        endTime: '17:00',
        jobTypes: undefined,
        enabled: true,
      },
    ]);
  });

  it('should default enabled to true when not specified', () => {
    const rawConfig = {
      providerScheduleOverrides: [
        {
          label: 'Default Enabled',
          presetId: 'claude',
          days: [1, 2, 3, 4, 5],
          startTime: '00:00',
          endTime: '23:59',
        },
      ],
    };
    const normalized = normalizeConfig(rawConfig);
    expect(normalized.providerScheduleOverrides?.[0].enabled).toBe(true);
  });

  it('should trim whitespace from label and presetId', () => {
    const rawConfig = {
      providerScheduleOverrides: [
        {
          label: '  Whitespace Test  ',
          presetId: '  claude-sonnet-4-6  ',
          days: [0],
          startTime: '00:00',
          endTime: '01:00',
        },
      ],
    };
    const normalized = normalizeConfig(rawConfig);
    expect(normalized.providerScheduleOverrides?.[0].label).toBe('Whitespace Test');
    expect(normalized.providerScheduleOverrides?.[0].presetId).toBe('claude-sonnet-4-6');
  });

  it('should reject override with missing label', () => {
    const rawConfig = {
      providerScheduleOverrides: [
        {
          presetId: 'claude',
          days: [0],
          startTime: '00:00',
          endTime: '01:00',
        },
      ],
    };
    const normalized = normalizeConfig(rawConfig);
    expect(normalized.providerScheduleOverrides).toBeUndefined();
  });

  it('should reject override with missing presetId', () => {
    const rawConfig = {
      providerScheduleOverrides: [
        {
          label: 'Missing Preset',
          days: [0],
          startTime: '00:00',
          endTime: '01:00',
        },
      ],
    };
    const normalized = normalizeConfig(rawConfig);
    expect(normalized.providerScheduleOverrides).toBeUndefined();
  });

  it('should reject override with missing startTime', () => {
    const rawConfig = {
      providerScheduleOverrides: [
        {
          label: 'Missing Start',
          presetId: 'claude',
          days: [0],
          endTime: '01:00',
        },
      ],
    };
    const normalized = normalizeConfig(rawConfig);
    expect(normalized.providerScheduleOverrides).toBeUndefined();
  });

  it('should reject override with missing endTime', () => {
    const rawConfig = {
      providerScheduleOverrides: [
        {
          label: 'Missing End',
          presetId: 'claude',
          days: [0],
          startTime: '00:00',
        },
      ],
    };
    const normalized = normalizeConfig(rawConfig);
    expect(normalized.providerScheduleOverrides).toBeUndefined();
  });

  it('should reject override with invalid time format', () => {
    const invalidTimes = ['25:00', '12:60', '24:00', 'abc', '12:3', '1:23'];
    for (const invalidTime of invalidTimes) {
      const rawConfig = {
        providerScheduleOverrides: [
          {
            label: 'Invalid Time',
            presetId: 'claude',
            days: [0],
            startTime: invalidTime,
            endTime: '01:00',
          },
        ],
      };
      const normalized = normalizeConfig(rawConfig);
      expect(normalized.providerScheduleOverrides).toBeUndefined();
    }
  });

  it('should accept valid time formats', () => {
    const validTimes = ['00:00', '09:00', '23:59', '12:30', '01:05'];
    for (const validTime of validTimes) {
      const rawConfig = {
        providerScheduleOverrides: [
          {
            label: 'Valid Time',
            presetId: 'claude',
            days: [0],
            startTime: validTime,
            endTime: '01:00',
          },
        ],
      };
      const normalized = normalizeConfig(rawConfig);
      expect(normalized.providerScheduleOverrides).toBeDefined();
      expect(normalized.providerScheduleOverrides?.[0].startTime).toBe(validTime);
    }
  });

  it('should reject override with empty days array', () => {
    const rawConfig = {
      providerScheduleOverrides: [
        {
          label: 'Empty Days',
          presetId: 'claude',
          days: [],
          startTime: '00:00',
          endTime: '01:00',
        },
      ],
    };
    const normalized = normalizeConfig(rawConfig);
    expect(normalized.providerScheduleOverrides).toBeUndefined();
  });

  it('should reject override with invalid day values', () => {
    const rawConfig = {
      providerScheduleOverrides: [
        {
          label: 'Invalid Days',
          presetId: 'claude',
          days: [-1, 7, 8, '0' as unknown],
          startTime: '00:00',
          endTime: '01:00',
        },
      ],
    };
    const normalized = normalizeConfig(rawConfig);
    expect(normalized.providerScheduleOverrides).toBeUndefined();
  });

  it('should filter out invalid day values and accept valid ones', () => {
    const rawConfig = {
      providerScheduleOverrides: [
        {
          label: 'Mixed Days',
          presetId: 'claude',
          days: [0, 1, -1, 7, 3],
          startTime: '00:00',
          endTime: '01:00',
        },
      ],
    };
    const normalized = normalizeConfig(rawConfig);
    expect(normalized.providerScheduleOverrides?.[0].days).toEqual([0, 1, 3] as DayOfWeek[]);
  });

  it('should filter out invalid jobTypes', () => {
    const rawConfig = {
      providerScheduleOverrides: [
        {
          label: 'Mixed JobTypes',
          presetId: 'claude',
          days: [0],
          startTime: '00:00',
          endTime: '01:00',
          jobTypes: ['executor', 'invalid-job', 'reviewer'],
        },
      ],
    };
    const normalized = normalizeConfig(rawConfig);
    expect(normalized.providerScheduleOverrides?.[0].jobTypes).toEqual(['executor', 'reviewer']);
  });

  it('should treat empty jobTypes array as undefined (applies to all jobs)', () => {
    const rawConfig = {
      providerScheduleOverrides: [
        {
          label: 'Empty JobTypes',
          presetId: 'claude',
          days: [0],
          startTime: '00:00',
          endTime: '01:00',
          jobTypes: [],
        },
      ],
    };
    const normalized = normalizeConfig(rawConfig);
    expect(normalized.providerScheduleOverrides?.[0].jobTypes).toBeUndefined();
  });

  it('should skip non-object overrides', () => {
    const rawConfig = {
      providerScheduleOverrides: [
        'not-an-object',
        null,
        undefined,
        {
          label: 'Valid Override',
          presetId: 'claude',
          days: [0],
          startTime: '00:00',
          endTime: '01:00',
        },
      ],
    };
    const normalized = normalizeConfig(rawConfig);
    expect(normalized.providerScheduleOverrides).toEqual([
      {
        label: 'Valid Override',
        presetId: 'claude',
        days: [0] as DayOfWeek[],
        startTime: '00:00',
        endTime: '01:00',
        jobTypes: undefined,
        enabled: true,
      },
    ]);
  });

  it('should normalize multiple valid overrides', () => {
    const rawConfig = {
      providerScheduleOverrides: [
        {
          label: 'Night Surge',
          presetId: 'claude-opus-4-6',
          days: [0, 1, 2, 3, 4, 5, 6],
          startTime: '23:00',
          endTime: '04:00',
          enabled: true,
        },
        {
          label: 'Weekend Codex',
          presetId: 'codex',
          days: [0, 6],
          startTime: '09:00',
          endTime: '17:00',
          jobTypes: ['executor'],
        },
      ],
    };
    const normalized = normalizeConfig(rawConfig);
    expect(normalized.providerScheduleOverrides).toHaveLength(2);
    expect(normalized.providerScheduleOverrides?.[0].label).toBe('Night Surge');
    expect(normalized.providerScheduleOverrides?.[1].label).toBe('Weekend Codex');
  });

  it('should filter out invalid overrides and keep valid ones', () => {
    const rawConfig = {
      providerScheduleOverrides: [
        {
          label: 'Valid Override 1',
          presetId: 'claude',
          days: [0],
          startTime: '00:00',
          endTime: '01:00',
        },
        {
          label: 'Invalid Override - Missing Preset',
          days: [0],
          startTime: '00:00',
          endTime: '01:00',
        },
        {
          label: 'Valid Override 2',
          presetId: 'codex',
          days: [1],
          startTime: '10:00',
          endTime: '11:00',
        },
      ],
    };
    const normalized = normalizeConfig(rawConfig);
    expect(normalized.providerScheduleOverrides).toHaveLength(2);
    expect(normalized.providerScheduleOverrides?.[0].label).toBe('Valid Override 1');
    expect(normalized.providerScheduleOverrides?.[1].label).toBe('Valid Override 2');
  });

  it('should handle non-array providerScheduleOverrides', () => {
    const rawConfig = {
      providerScheduleOverrides: 'not-an-array',
    };
    const normalized = normalizeConfig(rawConfig);
    expect(normalized.providerScheduleOverrides).toBeUndefined();
  });
});
