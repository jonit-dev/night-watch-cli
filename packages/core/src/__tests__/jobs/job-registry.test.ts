/**
 * Tests for the Job Registry
 */

import { afterEach, describe, it, expect } from 'vitest';
import {
  JOB_REGISTRY,
  getJobDef,
  getJobDefByCommand,
  getJobDefByLogName,
  getValidJobTypes,
  getDefaultQueuePriority,
  getLogFileNames,
  getLockSuffix,
  getAllJobDefs,
  normalizeJobConfig,
  buildJobEnvOverrides,
  camelToUpperSnake,
} from '../../jobs/job-registry.js';
import { VALID_JOB_TYPES, DEFAULT_QUEUE_PRIORITY, LOG_FILE_NAMES } from '../../constants.js';

describe('JOB_REGISTRY', () => {
  it('should define all 6 job types', () => {
    expect(JOB_REGISTRY).toHaveLength(6);
  });

  it('should include executor, reviewer, qa, audit, slicer, analytics', () => {
    const ids = JOB_REGISTRY.map((j) => j.id);
    expect(ids).toContain('executor');
    expect(ids).toContain('reviewer');
    expect(ids).toContain('qa');
    expect(ids).toContain('audit');
    expect(ids).toContain('slicer');
    expect(ids).toContain('analytics');
  });

  it('each job definition has required fields', () => {
    for (const job of JOB_REGISTRY) {
      expect(typeof job.id).toBe('string');
      expect(typeof job.name).toBe('string');
      expect(typeof job.description).toBe('string');
      expect(typeof job.cliCommand).toBe('string');
      expect(typeof job.logName).toBe('string');
      expect(typeof job.lockSuffix).toBe('string');
      expect(typeof job.queuePriority).toBe('number');
      expect(typeof job.envPrefix).toBe('string');
      expect(job.defaultConfig).toBeDefined();
      expect(typeof job.defaultConfig.enabled).toBe('boolean');
      expect(typeof job.defaultConfig.schedule).toBe('string');
      expect(typeof job.defaultConfig.maxRuntime).toBe('number');
    }
  });
});

describe('getJobDef', () => {
  it('returns correct definition for executor', () => {
    const def = getJobDef('executor');
    expect(def).toBeDefined();
    expect(def!.name).toBe('Executor');
    expect(def!.cliCommand).toBe('run');
  });

  it('returns correct definition for qa', () => {
    const def = getJobDef('qa');
    expect(def).toBeDefined();
    expect(def!.name).toBe('QA');
  });

  it('returns correct definition for slicer', () => {
    const def = getJobDef('slicer');
    expect(def).toBeDefined();
    expect(def!.cliCommand).toBe('planner');
  });

  it('returns undefined for unknown job type', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(getJobDef('unknown' as any)).toBeUndefined();
  });
});

describe('getJobDefByCommand', () => {
  it('finds executor by "run" command', () => {
    const def = getJobDefByCommand('run');
    expect(def?.id).toBe('executor');
  });

  it('finds slicer by "planner" command', () => {
    const def = getJobDefByCommand('planner');
    expect(def?.id).toBe('slicer');
  });

  it('returns undefined for unknown command', () => {
    expect(getJobDefByCommand('unknown')).toBeUndefined();
  });
});

describe('getJobDefByLogName', () => {
  it('finds qa by log name "night-watch-qa"', () => {
    const def = getJobDefByLogName('night-watch-qa');
    expect(def?.id).toBe('qa');
  });

  it('finds executor by log name "executor"', () => {
    const def = getJobDefByLogName('executor');
    expect(def?.id).toBe('executor');
  });
});

describe('getValidJobTypes', () => {
  it('returns all 6 job types', () => {
    const types = getValidJobTypes();
    expect(types).toHaveLength(6);
    expect(types).toContain('executor');
    expect(types).toContain('reviewer');
    expect(types).toContain('qa');
    expect(types).toContain('audit');
    expect(types).toContain('slicer');
    expect(types).toContain('analytics');
  });
});

describe('getDefaultQueuePriority', () => {
  it('returns priority for all job types', () => {
    const priority = getDefaultQueuePriority();
    expect(typeof priority.executor).toBe('number');
    expect(typeof priority.reviewer).toBe('number');
    expect(typeof priority.qa).toBe('number');
    expect(typeof priority.audit).toBe('number');
    expect(typeof priority.slicer).toBe('number');
    expect(typeof priority.analytics).toBe('number');
  });

  it('executor has highest priority', () => {
    const priority = getDefaultQueuePriority();
    expect(priority.executor).toBeGreaterThan(priority.reviewer);
    expect(priority.reviewer).toBeGreaterThan(priority.qa);
  });
});

describe('getLogFileNames', () => {
  it('maps executor id and cliCommand to logName', () => {
    const logFiles = getLogFileNames();
    expect(logFiles.executor).toBe('executor');
  });

  it('maps slicer id to "slicer" logName', () => {
    const logFiles = getLogFileNames();
    expect(logFiles.slicer).toBe('slicer');
  });

  it('maps planner (slicer cliCommand) to "slicer" logName', () => {
    const logFiles = getLogFileNames();
    expect(logFiles.planner).toBe('slicer');
  });

  it('maps qa to "night-watch-qa"', () => {
    const logFiles = getLogFileNames();
    expect(logFiles.qa).toBe('night-watch-qa');
  });
});

describe('getLockSuffix', () => {
  it('returns correct lock suffix for executor', () => {
    expect(getLockSuffix('executor')).toBe('.lock');
  });

  it('returns correct lock suffix for reviewer', () => {
    expect(getLockSuffix('reviewer')).toBe('-r.lock');
  });

  it('returns correct lock suffix for qa', () => {
    expect(getLockSuffix('qa')).toBe('-qa.lock');
  });
});

describe('getAllJobDefs', () => {
  it('returns a copy of the registry array', () => {
    const defs = getAllJobDefs();
    expect(defs).toHaveLength(JOB_REGISTRY.length);
    // Should be a copy, not the same reference
    expect(defs).not.toBe(JOB_REGISTRY);
  });
});

describe('migrateLegacy', () => {
  it('executor migrates cronSchedule from flat format', () => {
    const def = getJobDef('executor')!;
    const raw = { cronSchedule: '*/5 * * * *', executorEnabled: false, maxRuntime: 3600 };
    const migrated = def.migrateLegacy?.(raw);
    expect(migrated?.schedule).toBe('*/5 * * * *');
    expect(migrated?.enabled).toBe(false);
    expect(migrated?.maxRuntime).toBe(3600);
  });

  it('executor returns undefined when no legacy fields present', () => {
    const def = getJobDef('executor')!;
    const migrated = def.migrateLegacy?.({});
    expect(migrated).toBeUndefined();
  });

  it('reviewer migrates from reviewerSchedule/reviewerEnabled', () => {
    const def = getJobDef('reviewer')!;
    const raw = { reviewerSchedule: '*/10 * * * *', reviewerEnabled: false };
    const migrated = def.migrateLegacy?.(raw);
    expect(migrated?.schedule).toBe('*/10 * * * *');
    expect(migrated?.enabled).toBe(false);
  });

  it('slicer migrates from roadmapScanner.slicerSchedule', () => {
    const def = getJobDef('slicer')!;
    const raw = {
      roadmapScanner: { slicerSchedule: '0 */6 * * *', slicerMaxRuntime: 300, enabled: true },
    };
    const migrated = def.migrateLegacy?.(raw);
    expect(migrated?.schedule).toBe('0 */6 * * *');
    expect(migrated?.maxRuntime).toBe(300);
    expect(migrated?.enabled).toBe(true);
  });
});

describe('derived constants match expected values', () => {
  it('VALID_JOB_TYPES from constants matches getValidJobTypes()', () => {
    const fromRegistry = getValidJobTypes();
    expect(VALID_JOB_TYPES).toEqual(fromRegistry);
  });

  it('DEFAULT_QUEUE_PRIORITY from constants matches getDefaultQueuePriority()', () => {
    const fromRegistry = getDefaultQueuePriority();
    expect(DEFAULT_QUEUE_PRIORITY).toEqual(fromRegistry);
  });

  it('LOG_FILE_NAMES from constants matches getLogFileNames()', () => {
    const fromRegistry = getLogFileNames();
    expect(LOG_FILE_NAMES).toEqual(fromRegistry);
  });
});

describe('camelToUpperSnake', () => {
  it('converts camelCase to UPPER_SNAKE_CASE', () => {
    expect(camelToUpperSnake('lookbackDays')).toBe('LOOKBACK_DAYS');
    expect(camelToUpperSnake('branchPatterns')).toBe('BRANCH_PATTERNS');
    expect(camelToUpperSnake('autoInstallPlaywright')).toBe('AUTO_INSTALL_PLAYWRIGHT');
    expect(camelToUpperSnake('skipLabel')).toBe('SKIP_LABEL');
    expect(camelToUpperSnake('targetColumn')).toBe('TARGET_COLUMN');
  });

  it('handles single-word names', () => {
    expect(camelToUpperSnake('enabled')).toBe('ENABLED');
    expect(camelToUpperSnake('schedule')).toBe('SCHEDULE');
    expect(camelToUpperSnake('artifacts')).toBe('ARTIFACTS');
  });
});

describe('normalizeJobConfig', () => {
  it('normalizes qa config with all base fields', () => {
    const qaDef = getJobDef('qa')!;
    const result = normalizeJobConfig(
      { enabled: false, schedule: '0 12 * * *', maxRuntime: 1800 },
      qaDef,
    );
    expect(result.enabled).toBe(false);
    expect(result.schedule).toBe('0 12 * * *');
    expect(result.maxRuntime).toBe(1800);
  });

  it('applies qa defaults for missing fields', () => {
    const qaDef = getJobDef('qa')!;
    const result = normalizeJobConfig({}, qaDef);
    expect(result.enabled).toBe(true);
    expect(result.artifacts).toBe('both');
    expect(result.skipLabel).toBe('skip-qa');
    expect(result.autoInstallPlaywright).toBe(true);
    expect(result.branchPatterns).toEqual([]);
  });

  it('normalizes qa extra fields', () => {
    const qaDef = getJobDef('qa')!;
    const result = normalizeJobConfig(
      {
        enabled: true,
        artifacts: 'screenshot',
        skipLabel: 'no-qa',
        autoInstallPlaywright: false,
        branchPatterns: ['feat/', 'fix/'],
      },
      qaDef,
    );
    expect(result.artifacts).toBe('screenshot');
    expect(result.skipLabel).toBe('no-qa');
    expect(result.autoInstallPlaywright).toBe(false);
    expect(result.branchPatterns).toEqual(['feat/', 'fix/']);
  });

  it('rejects invalid enum value and falls back to default', () => {
    const qaDef = getJobDef('qa')!;
    const result = normalizeJobConfig({ artifacts: 'invalid-value' }, qaDef);
    expect(result.artifacts).toBe('both');
  });

  it('normalizes audit config with no extra fields', () => {
    const auditDef = getJobDef('audit')!;
    const result = normalizeJobConfig(
      { enabled: false, schedule: '0 4 * * 0', maxRuntime: 900 },
      auditDef,
    );
    expect(result.enabled).toBe(false);
    expect(result.schedule).toBe('0 4 * * 0');
    expect(result.maxRuntime).toBe(900);
  });

  it('normalizes analytics extra fields', () => {
    const analyticsDef = getJobDef('analytics')!;
    const result = normalizeJobConfig(
      { enabled: true, lookbackDays: 14, targetColumn: 'Ready', analysisPrompt: 'test prompt' },
      analyticsDef,
    );
    expect(result.lookbackDays).toBe(14);
    expect(result.targetColumn).toBe('Ready');
    expect(result.analysisPrompt).toBe('test prompt');
  });

  it('rejects invalid analytics targetColumn and falls back to default', () => {
    const analyticsDef = getJobDef('analytics')!;
    const result = normalizeJobConfig({ targetColumn: 'NotAColumn' }, analyticsDef);
    expect(result.targetColumn).toBe('Draft');
  });
});

describe('buildJobEnvOverrides', () => {
  afterEach(() => {
    // Clean up env vars set in tests
    delete process.env.NW_QA_ENABLED;
    delete process.env.NW_QA_SCHEDULE;
    delete process.env.NW_QA_MAX_RUNTIME;
    delete process.env.NW_QA_ARTIFACTS;
    delete process.env.NW_QA_SKIP_LABEL;
    delete process.env.NW_QA_AUTO_INSTALL_PLAYWRIGHT;
    delete process.env.NW_QA_BRANCH_PATTERNS;
    delete process.env.NW_AUDIT_ENABLED;
    delete process.env.NW_AUDIT_SCHEDULE;
    delete process.env.NW_AUDIT_MAX_RUNTIME;
    delete process.env.NW_ANALYTICS_ENABLED;
    delete process.env.NW_ANALYTICS_LOOKBACK_DAYS;
    delete process.env.NW_ANALYTICS_TARGET_COLUMN;
  });

  it('returns null when no env vars are set', () => {
    const qaDef = getJobDef('qa')!;
    const result = buildJobEnvOverrides(
      qaDef.envPrefix,
      qaDef.defaultConfig as Record<string, unknown>,
      qaDef.extraFields,
    );
    expect(result).toBeNull();
  });

  it('overrides enabled via NW_QA_ENABLED', () => {
    process.env.NW_QA_ENABLED = 'false';
    const qaDef = getJobDef('qa')!;
    const result = buildJobEnvOverrides(
      qaDef.envPrefix,
      qaDef.defaultConfig as Record<string, unknown>,
      qaDef.extraFields,
    );
    expect(result).not.toBeNull();
    expect(result!.enabled).toBe(false);
  });

  it('overrides schedule via NW_QA_SCHEDULE', () => {
    process.env.NW_QA_SCHEDULE = '0 6 * * *';
    const qaDef = getJobDef('qa')!;
    const result = buildJobEnvOverrides(
      qaDef.envPrefix,
      qaDef.defaultConfig as Record<string, unknown>,
      qaDef.extraFields,
    );
    expect(result).not.toBeNull();
    expect(result!.schedule).toBe('0 6 * * *');
  });

  it('overrides maxRuntime via NW_QA_MAX_RUNTIME', () => {
    process.env.NW_QA_MAX_RUNTIME = '1200';
    const qaDef = getJobDef('qa')!;
    const result = buildJobEnvOverrides(
      qaDef.envPrefix,
      qaDef.defaultConfig as Record<string, unknown>,
      qaDef.extraFields,
    );
    expect(result).not.toBeNull();
    expect(result!.maxRuntime).toBe(1200);
  });

  it('overrides artifacts via NW_QA_ARTIFACTS', () => {
    process.env.NW_QA_ARTIFACTS = 'video';
    const qaDef = getJobDef('qa')!;
    const result = buildJobEnvOverrides(
      qaDef.envPrefix,
      qaDef.defaultConfig as Record<string, unknown>,
      qaDef.extraFields,
    );
    expect(result).not.toBeNull();
    expect(result!.artifacts).toBe('video');
  });

  it('ignores invalid enum value for NW_QA_ARTIFACTS', () => {
    process.env.NW_QA_ARTIFACTS = 'invalid';
    const qaDef = getJobDef('qa')!;
    const result = buildJobEnvOverrides(
      qaDef.envPrefix,
      qaDef.defaultConfig as Record<string, unknown>,
      qaDef.extraFields,
    );
    expect(result).toBeNull();
  });

  it('overrides branchPatterns via NW_QA_BRANCH_PATTERNS (comma-separated)', () => {
    process.env.NW_QA_BRANCH_PATTERNS = 'feat/,fix/,hotfix/';
    const qaDef = getJobDef('qa')!;
    const result = buildJobEnvOverrides(
      qaDef.envPrefix,
      qaDef.defaultConfig as Record<string, unknown>,
      qaDef.extraFields,
    );
    expect(result).not.toBeNull();
    expect(result!.branchPatterns).toEqual(['feat/', 'fix/', 'hotfix/']);
  });

  it('overrides analytics lookbackDays via NW_ANALYTICS_LOOKBACK_DAYS', () => {
    process.env.NW_ANALYTICS_LOOKBACK_DAYS = '30';
    const analyticsDef = getJobDef('analytics')!;
    const result = buildJobEnvOverrides(
      analyticsDef.envPrefix,
      analyticsDef.defaultConfig as Record<string, unknown>,
      analyticsDef.extraFields,
    );
    expect(result).not.toBeNull();
    expect(result!.lookbackDays).toBe(30);
  });

  it('overrides audit enabled via NW_AUDIT_ENABLED', () => {
    process.env.NW_AUDIT_ENABLED = '1';
    const auditDef = getJobDef('audit')!;
    const result = buildJobEnvOverrides(
      auditDef.envPrefix,
      auditDef.defaultConfig as Record<string, unknown>,
      auditDef.extraFields,
    );
    expect(result).not.toBeNull();
    expect(result!.enabled).toBe(true);
  });
});
