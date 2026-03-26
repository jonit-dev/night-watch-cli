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
  },
  {
    id: 'pr-resolver',
    name: 'PR Conflict Solver',
    description:
      'Resolves merge conflicts via AI rebase; optionally addresses review comments and labels PRs ready-to-merge',
    cliCommand: 'resolve',
    logName: 'pr-resolver',
    lockSuffix: '-pr-resolver.lock',
    queuePriority: 35,
    envPrefix: 'NW_PR_RESOLVER',
    extraFields: [
      { name: 'branchPatterns', type: 'string[]', defaultValue: [] },
      { name: 'maxPrsPerRun', type: 'number', defaultValue: 0 },
      { name: 'perPrTimeout', type: 'number', defaultValue: 600 },
      { name: 'aiConflictResolution', type: 'boolean', defaultValue: true },
      { name: 'aiReviewResolution', type: 'boolean', defaultValue: false },
      { name: 'readyLabel', type: 'string', defaultValue: 'ready-to-merge' },
    ],
    defaultConfig: {
      enabled: true,
      schedule: '15 6,14,22 * * *',
      maxRuntime: 3600,
      branchPatterns: [],
      maxPrsPerRun: 0,
      perPrTimeout: 600,
      aiConflictResolution: true,
      aiReviewResolution: false,
      readyLabel: 'ready-to-merge',
    } as IBaseJobConfig & {
      branchPatterns: string[];
      maxPrsPerRun: number;
      perPrTimeout: number;
      aiConflictResolution: boolean;
      aiReviewResolution: boolean;
      readyLabel: string;
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
      { name: 'validatedLabel', type: 'string', defaultValue: 'e2e-validated' },
    ],
    defaultConfig: {
      enabled: true,
      schedule: '45 2,10,18 * * *',
      maxRuntime: 3600,
      branchPatterns: [],
      artifacts: 'both',
      skipLabel: 'skip-qa',
      autoInstallPlaywright: true,
      validatedLabel: 'e2e-validated',
    } as IBaseJobConfig & {
      branchPatterns: string[];
      artifacts: string;
      skipLabel: string;
      autoInstallPlaywright: boolean;
      validatedLabel: string;
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
  },
  {
    id: 'merger',
    name: 'Merge Orchestrator',
    description:
      'Repo-wide PR merge coordinator — scans, rebases, and merges in FIFO order',
    cliCommand: 'merge',
    logName: 'merger',
    lockSuffix: '-merger.lock',
    queuePriority: 45,
    envPrefix: 'NW_MERGER',
    extraFields: [
      {
        name: 'mergeMethod',
        type: 'enum',
        enumValues: ['squash', 'merge', 'rebase'],
        defaultValue: 'squash',
      },
      { name: 'minReviewScore', type: 'number', defaultValue: 80 },
      { name: 'branchPatterns', type: 'string[]', defaultValue: [] },
      { name: 'rebaseBeforeMerge', type: 'boolean', defaultValue: true },
      { name: 'maxPrsPerRun', type: 'number', defaultValue: 0 },
    ],
    defaultConfig: {
      enabled: false,
      schedule: '55 */4 * * *',
      maxRuntime: 1800,
      mergeMethod: 'squash',
      minReviewScore: 80,
      branchPatterns: [],
      rebaseBeforeMerge: true,
      maxPrsPerRun: 0,
    } as IBaseJobConfig & {
      mergeMethod: string;
      minReviewScore: number;
      branchPatterns: string[];
      rebaseBeforeMerge: boolean;
      maxPrsPerRun: number;
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
