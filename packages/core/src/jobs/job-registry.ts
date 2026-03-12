/**
 * Job Registry — Single source of truth for job metadata, defaults, and config patterns.
 * Adding a new job type only requires adding an entry to JOB_REGISTRY.
 */

import { JobType } from '../types.js';

/**
 * Base configuration interface that all job configs extend.
 * Provides uniform access patterns for enabled/schedule/maxRuntime.
 */
export interface IBaseJobConfig {
  /** Whether the job is enabled */
  enabled: boolean;
  /** Cron schedule for the job */
  schedule: string;
  /** Maximum runtime in seconds */
  maxRuntime: number;
}

/**
 * Definition for extra fields beyond the base { enabled, schedule, maxRuntime }
 */
export interface IExtraFieldDef {
  /** Field name in the config object */
  name: string;
  /** Type of the field for validation */
  type: 'string' | 'number' | 'boolean' | 'string[]' | 'enum';
  /** Valid values for enum type */
  enumValues?: string[];
  /** Default value if not specified */
  defaultValue: unknown;
}

/**
 * Complete definition for a job type in the registry.
 */
export interface IJobDefinition<TConfig extends IBaseJobConfig = IBaseJobConfig> {
  /** Job type identifier (matches JobType union) */
  id: JobType;
  /** Human-readable name (e.g., "Executor", "QA", "Auditor") */
  name: string;
  /** Short description of what the job does */
  description: string;
  /** CLI command to invoke this job (e.g., "run", "review", "qa") */
  cliCommand: string;
  /** Log file name without extension (e.g., "executor", "night-watch-qa") */
  logName: string;
  /** Lock file suffix (e.g., ".lock", "-r.lock", "-qa.lock") */
  lockSuffix: string;
  /** Queue priority (higher = runs first) */
  queuePriority: number;
  /** Env var prefix for NW_* overrides (e.g., "NW_EXECUTOR", "NW_QA") */
  envPrefix: string;
  /** Extra config fields beyond base (e.g., QA's branchPatterns, artifacts) */
  extraFields?: IExtraFieldDef[];
  /** Default configuration values */
  defaultConfig: TConfig;
  /**
   * Legacy config migration: reads old flat/nested config shapes and extracts job config.
   * Returns undefined if no legacy fields are present.
   */
  migrateLegacy?: (raw: Record<string, unknown>) => Partial<TConfig> | undefined;
}

/**
 * Job registry containing all job type definitions.
 * This is the single source of truth for job metadata.
 */
export const JOB_REGISTRY: IJobDefinition[] = [
  {
    id: 'executor',
    name: 'Executor',
    description: 'Creates implementation PRs from PRDs',
    cliCommand: 'run',
    logName: 'executor',
    lockSuffix: '.lock',
    queuePriority: 50,
    envPrefix: 'NW_EXECUTOR',
    defaultConfig: {
      enabled: true,
      schedule: '5 */2 * * *',
      maxRuntime: 7200,
    },
    migrateLegacy: (raw): Partial<IBaseJobConfig> | undefined => {
      const result: Partial<IBaseJobConfig> = {};
      let hasLegacy = false;

      if (typeof raw.executorEnabled === 'boolean') {
        result.enabled = raw.executorEnabled;
        hasLegacy = true;
      }
      if (typeof raw.cronSchedule === 'string') {
        result.schedule = raw.cronSchedule;
        hasLegacy = true;
      }
      if (typeof raw.maxRuntime === 'number') {
        result.maxRuntime = raw.maxRuntime;
        hasLegacy = true;
      }

      return hasLegacy ? result : undefined;
    },
  },
  {
    id: 'reviewer',
    name: 'Reviewer',
    description: 'Reviews and improves PRs on night-watch branches',
    cliCommand: 'review',
    logName: 'reviewer',
    lockSuffix: '-r.lock',
    queuePriority: 40,
    envPrefix: 'NW_REVIEWER',
    defaultConfig: {
      enabled: true,
      schedule: '25 */3 * * *',
      maxRuntime: 3600,
    },
    migrateLegacy: (raw): Partial<IBaseJobConfig> | undefined => {
      const result: Partial<IBaseJobConfig> = {};
      let hasLegacy = false;

      if (typeof raw.reviewerEnabled === 'boolean') {
        result.enabled = raw.reviewerEnabled;
        hasLegacy = true;
      }
      if (typeof raw.reviewerSchedule === 'string') {
        result.schedule = raw.reviewerSchedule;
        hasLegacy = true;
      }
      if (typeof raw.reviewerMaxRuntime === 'number') {
        result.maxRuntime = raw.reviewerMaxRuntime;
        hasLegacy = true;
      }

      return hasLegacy ? result : undefined;
    },
  },
  {
    id: 'slicer',
    name: 'Slicer',
    description: 'Generates PRDs from roadmap items',
    cliCommand: 'planner',
    logName: 'slicer',
    lockSuffix: '-slicer.lock',
    queuePriority: 30,
    envPrefix: 'NW_SLICER',
    defaultConfig: {
      enabled: true,
      schedule: '35 */6 * * *',
      maxRuntime: 600,
    },
    migrateLegacy: (raw): Partial<IBaseJobConfig> | undefined => {
      const roadmapScanner = raw.roadmapScanner as Record<string, unknown> | undefined;
      if (!roadmapScanner) return undefined;

      const result: Partial<IBaseJobConfig> = {};
      let hasLegacy = false;

      if (typeof roadmapScanner.enabled === 'boolean') {
        result.enabled = roadmapScanner.enabled;
        hasLegacy = true;
      }
      if (typeof roadmapScanner.slicerSchedule === 'string') {
        result.schedule = roadmapScanner.slicerSchedule;
        hasLegacy = true;
      }
      if (typeof roadmapScanner.slicerMaxRuntime === 'number') {
        result.maxRuntime = roadmapScanner.slicerMaxRuntime;
        hasLegacy = true;
      }

      return hasLegacy ? result : undefined;
    },
  },
  {
    id: 'qa',
    name: 'QA',
    description: 'Runs end-to-end tests on PRs',
    cliCommand: 'qa',
    logName: 'night-watch-qa',
    lockSuffix: '-qa.lock',
    queuePriority: 20,
    envPrefix: 'NW_QA',
    extraFields: [
      { name: 'branchPatterns', type: 'string[]', defaultValue: [] },
      {
        name: 'artifacts',
        type: 'enum',
        enumValues: ['screenshot', 'video', 'both'],
        defaultValue: 'both',
      },
      { name: 'skipLabel', type: 'string', defaultValue: 'skip-qa' },
      { name: 'autoInstallPlaywright', type: 'boolean', defaultValue: true },
    ],
    defaultConfig: {
      enabled: true,
      schedule: '45 2,10,18 * * *',
      maxRuntime: 3600,
      branchPatterns: [],
      artifacts: 'both',
      skipLabel: 'skip-qa',
      autoInstallPlaywright: true,
    } as IBaseJobConfig & {
      branchPatterns: string[];
      artifacts: string;
      skipLabel: string;
      autoInstallPlaywright: boolean;
    },
    migrateLegacy: (raw): Partial<IBaseJobConfig> | undefined => {
      const qa = raw.qa as Record<string, unknown> | undefined;
      if (!qa) return undefined;

      // If qa object exists with base fields, it's already in new format
      if (
        typeof qa.enabled === 'boolean' ||
        typeof qa.schedule === 'string' ||
        typeof qa.maxRuntime === 'number'
      ) {
        return {
          enabled: typeof qa.enabled === 'boolean' ? qa.enabled : undefined,
          schedule: typeof qa.schedule === 'string' ? qa.schedule : undefined,
          maxRuntime: typeof qa.maxRuntime === 'number' ? qa.maxRuntime : undefined,
        } as Partial<IBaseJobConfig>;
      }
      return undefined;
    },
  },
  {
    id: 'audit',
    name: 'Auditor',
    description: 'Performs code audits and creates issues for findings',
    cliCommand: 'audit',
    logName: 'audit',
    lockSuffix: '-audit.lock',
    queuePriority: 10,
    envPrefix: 'NW_AUDIT',
    defaultConfig: {
      enabled: true,
      schedule: '50 3 * * 1',
      maxRuntime: 1800,
    },
    migrateLegacy: (raw): Partial<IBaseJobConfig> | undefined => {
      const audit = raw.audit as Record<string, unknown> | undefined;
      if (!audit) return undefined;

      if (
        typeof audit.enabled === 'boolean' ||
        typeof audit.schedule === 'string' ||
        typeof audit.maxRuntime === 'number'
      ) {
        return {
          enabled: typeof audit.enabled === 'boolean' ? audit.enabled : undefined,
          schedule: typeof audit.schedule === 'string' ? audit.schedule : undefined,
          maxRuntime: typeof audit.maxRuntime === 'number' ? audit.maxRuntime : undefined,
        } as Partial<IBaseJobConfig>;
      }
      return undefined;
    },
  },
  {
    id: 'analytics',
    name: 'Analytics',
    description: 'Analyzes product analytics and creates issues for trends',
    cliCommand: 'analytics',
    logName: 'analytics',
    lockSuffix: '-analytics.lock',
    queuePriority: 10,
    envPrefix: 'NW_ANALYTICS',
    extraFields: [
      { name: 'lookbackDays', type: 'number', defaultValue: 7 },
      {
        name: 'targetColumn',
        type: 'enum',
        enumValues: ['Draft', 'Ready', 'In Progress', 'Done', 'Closed'],
        defaultValue: 'Draft',
      },
      { name: 'analysisPrompt', type: 'string', defaultValue: '' },
    ],
    defaultConfig: {
      enabled: false,
      schedule: '0 6 * * 1',
      maxRuntime: 900,
      lookbackDays: 7,
      targetColumn: 'Draft',
      analysisPrompt: '',
    } as IBaseJobConfig & { lookbackDays: number; targetColumn: string; analysisPrompt: string },
    migrateLegacy: (raw): Partial<IBaseJobConfig> | undefined => {
      const analytics = raw.analytics as Record<string, unknown> | undefined;
      if (!analytics) return undefined;

      if (
        typeof analytics.enabled === 'boolean' ||
        typeof analytics.schedule === 'string' ||
        typeof analytics.maxRuntime === 'number'
      ) {
        return {
          enabled: typeof analytics.enabled === 'boolean' ? analytics.enabled : undefined,
          schedule: typeof analytics.schedule === 'string' ? analytics.schedule : undefined,
          maxRuntime: typeof analytics.maxRuntime === 'number' ? analytics.maxRuntime : undefined,
        } as Partial<IBaseJobConfig>;
      }
      return undefined;
    },
  },
];

/**
 * Map of job ID to job definition for O(1) lookup.
 */
const JOB_MAP: Map<JobType, IJobDefinition> = new Map(JOB_REGISTRY.map((job) => [job.id, job]));

/**
 * Get a job definition by its ID.
 */
export function getJobDef(id: JobType): IJobDefinition | undefined {
  return JOB_MAP.get(id);
}

/**
 * Get all job definitions.
 */
export function getAllJobDefs(): IJobDefinition[] {
  return [...JOB_REGISTRY];
}

/**
 * Get a job definition by its CLI command.
 */
export function getJobDefByCommand(command: string): IJobDefinition | undefined {
  return JOB_REGISTRY.find((job) => job.cliCommand === command);
}

/**
 * Get a job definition by its log name.
 */
export function getJobDefByLogName(logName: string): IJobDefinition | undefined {
  return JOB_REGISTRY.find((job) => job.logName === logName);
}

/**
 * Get all valid job types (derived from registry).
 */
export function getValidJobTypes(): JobType[] {
  return JOB_REGISTRY.map((job) => job.id);
}

/**
 * Get the default queue priority mapping (derived from registry).
 */
export function getDefaultQueuePriority(): Record<string, number> {
  const result: Record<string, number> = {};
  for (const job of JOB_REGISTRY) {
    result[job.id] = job.queuePriority;
  }
  return result;
}

/**
 * Get the log file names mapping (derived from registry).
 * Maps from CLI command / API name to actual log file name.
 */
export function getLogFileNames(): Record<string, string> {
  const result: Record<string, string> = {};
  for (const job of JOB_REGISTRY) {
    // Map both id and cliCommand to logName for backward compat
    result[job.id] = job.logName;
    if (job.cliCommand !== job.id) {
      result[job.cliCommand] = job.logName;
    }
  }
  return result;
}

/**
 * Get the lock file suffix for a job.
 */
export function getLockSuffix(jobId: JobType): string {
  return getJobDef(jobId)?.lockSuffix ?? '.lock';
}

/**
 * Normalize a raw job config object using the job definition's schema.
 * Applies base fields (enabled, schedule, maxRuntime) + extra fields with type validation.
 */
export function normalizeJobConfig(
  raw: Record<string, unknown>,
  jobDef: IJobDefinition,
): Record<string, unknown> {
  const readBoolean = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined);
  const readString = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
  const readNumber = (v: unknown): number | undefined =>
    typeof v === 'number' && !Number.isNaN(v) ? v : undefined;
  const readStringArray = (v: unknown): string[] | undefined =>
    Array.isArray(v) && v.every((s) => typeof s === 'string') ? (v as string[]) : undefined;

  const defaults = jobDef.defaultConfig as unknown as Record<string, unknown>;
  const result: Record<string, unknown> = {
    enabled: readBoolean(raw.enabled) ?? defaults.enabled,
    schedule: readString(raw.schedule) ?? defaults.schedule,
    maxRuntime: readNumber(raw.maxRuntime) ?? defaults.maxRuntime,
  };

  for (const field of jobDef.extraFields ?? []) {
    switch (field.type) {
      case 'boolean':
        result[field.name] = readBoolean(raw[field.name]) ?? field.defaultValue;
        break;
      case 'string':
        result[field.name] = readString(raw[field.name]) ?? field.defaultValue;
        break;
      case 'number':
        result[field.name] = readNumber(raw[field.name]) ?? field.defaultValue;
        break;
      case 'string[]':
        result[field.name] = readStringArray(raw[field.name]) ?? field.defaultValue;
        break;
      case 'enum': {
        const val = readString(raw[field.name]);
        result[field.name] = val && field.enumValues?.includes(val) ? val : field.defaultValue;
        break;
      }
    }
  }

  return result;
}

/**
 * Convert a camelCase field name to UPPER_SNAKE_CASE for env var lookup.
 * e.g., "lookbackDays" → "LOOKBACK_DAYS"
 */
export function camelToUpperSnake(name: string): string {
  return name.replace(/([A-Z])/g, '_$1').toUpperCase();
}

/**
 * Build env variable overrides for a job from NW_* environment variables.
 * Returns null if no env vars were set for this job.
 *
 * Naming convention: {envPrefix}_{FIELD_UPPER_SNAKE}
 * e.g., envPrefix='NW_QA', field='branchPatterns' → 'NW_QA_BRANCH_PATTERNS'
 */
export function buildJobEnvOverrides(
  envPrefix: string,
  currentBase: Record<string, unknown>,
  extraFields?: IExtraFieldDef[],
): Record<string, unknown> | null {
  const parseBoolean = (value: string): boolean | null => {
    const v = value.toLowerCase().trim();
    if (v === 'true' || v === '1') return true;
    if (v === 'false' || v === '0') return false;
    return null;
  };

  const result = { ...currentBase };
  let changed = false;

  // Base fields
  const enabledVal = process.env[`${envPrefix}_ENABLED`];
  if (enabledVal) {
    const v = parseBoolean(enabledVal);
    if (v !== null) {
      result.enabled = v;
      changed = true;
    }
  }
  const scheduleVal = process.env[`${envPrefix}_SCHEDULE`];
  if (scheduleVal) {
    result.schedule = scheduleVal;
    changed = true;
  }
  const maxRuntimeVal = process.env[`${envPrefix}_MAX_RUNTIME`];
  if (maxRuntimeVal) {
    const v = parseInt(maxRuntimeVal, 10);
    if (!isNaN(v) && v > 0) {
      result.maxRuntime = v;
      changed = true;
    }
  }

  // Extra fields
  for (const field of extraFields ?? []) {
    const envKey = `${envPrefix}_${camelToUpperSnake(field.name)}`;
    const envVal = process.env[envKey];
    if (!envVal) continue;

    switch (field.type) {
      case 'boolean': {
        const v = parseBoolean(envVal);
        if (v !== null) {
          result[field.name] = v;
          changed = true;
        }
        break;
      }
      case 'string':
        result[field.name] = envVal;
        changed = true;
        break;
      case 'number': {
        const v = parseInt(envVal, 10);
        if (!isNaN(v) && v > 0) {
          result[field.name] = v;
          changed = true;
        }
        break;
      }
      case 'string[]': {
        const patterns = envVal
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        if (patterns.length > 0) {
          result[field.name] = patterns;
          changed = true;
        }
        break;
      }
      case 'enum':
        if (field.enumValues?.includes(envVal)) {
          result[field.name] = envVal;
          changed = true;
        }
        break;
    }
  }

  return changed ? result : null;
}
