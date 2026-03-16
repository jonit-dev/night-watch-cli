/**
 * Configuration loader for Night Watch CLI
 * Loads config from: defaults -> config file -> environment variables
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  DayOfWeek,
  INightWatchConfig,
  IProviderPreset,
  IProviderScheduleOverride,
  IQueueConfig,
  JobType,
} from './types.js';
import {
  BUILT_IN_PRESETS,
  CONFIG_FILE_NAME,
  DEFAULT_ANALYTICS,
  DEFAULT_AUDIT,
  DEFAULT_AUTO_MERGE,
  DEFAULT_AUTO_MERGE_METHOD,
  DEFAULT_BOARD_PROVIDER,
  DEFAULT_BRANCH_PATTERNS,
  DEFAULT_BRANCH_PREFIX,
  DEFAULT_CLAUDE_MODEL,
  DEFAULT_CRON_SCHEDULE,
  DEFAULT_CRON_SCHEDULE_OFFSET,
  DEFAULT_DEFAULT_BRANCH,
  DEFAULT_EXECUTOR_ENABLED,
  DEFAULT_FALLBACK_ON_RATE_LIMIT,
  DEFAULT_JOB_PROVIDERS,
  DEFAULT_MAX_LOG_SIZE,
  DEFAULT_MAX_RETRIES,
  DEFAULT_MAX_RUNTIME,
  DEFAULT_MIN_REVIEW_SCORE,
  DEFAULT_NOTIFICATIONS,
  DEFAULT_PRD_DIR,
  DEFAULT_PRD_PRIORITY,
  DEFAULT_PRIMARY_FALLBACK_MODEL,
  DEFAULT_PROVIDER,
  DEFAULT_PROVIDER_ENV,
  DEFAULT_PROVIDER_SCHEDULE_OVERRIDES,
  DEFAULT_QA,
  DEFAULT_QUEUE,
  DEFAULT_REVIEWER_ENABLED,
  DEFAULT_REVIEWER_MAX_PRS_PER_RUN,
  DEFAULT_REVIEWER_MAX_RETRIES,
  DEFAULT_REVIEWER_MAX_RUNTIME,
  DEFAULT_REVIEWER_RETRY_DELAY,
  DEFAULT_REVIEWER_SCHEDULE,
  DEFAULT_ROADMAP_SCANNER,
  DEFAULT_SCHEDULING_PRIORITY,
  DEFAULT_SECONDARY_FALLBACK_MODEL,
  DEFAULT_TEMPLATES_DIR,
} from './constants.js';
import { normalizeConfig } from './config-normalize.js';
import { buildEnvOverrideConfig } from './config-env.js';

export { validateProvider } from './config-normalize.js';

/**
 * Get the default configuration values
 */
export function getDefaultConfig(): INightWatchConfig {
  return {
    defaultBranch: DEFAULT_DEFAULT_BRANCH,
    prdDir: DEFAULT_PRD_DIR,
    maxRuntime: DEFAULT_MAX_RUNTIME,
    reviewerMaxRuntime: DEFAULT_REVIEWER_MAX_RUNTIME,
    branchPrefix: DEFAULT_BRANCH_PREFIX,
    branchPatterns: [...DEFAULT_BRANCH_PATTERNS],
    minReviewScore: DEFAULT_MIN_REVIEW_SCORE,
    maxLogSize: DEFAULT_MAX_LOG_SIZE,
    cronSchedule: DEFAULT_CRON_SCHEDULE,
    reviewerSchedule: DEFAULT_REVIEWER_SCHEDULE,
    scheduleBundleId: 'always-on',
    cronScheduleOffset: DEFAULT_CRON_SCHEDULE_OFFSET,
    schedulingPriority: DEFAULT_SCHEDULING_PRIORITY,
    maxRetries: DEFAULT_MAX_RETRIES,
    reviewerMaxRetries: DEFAULT_REVIEWER_MAX_RETRIES,
    reviewerRetryDelay: DEFAULT_REVIEWER_RETRY_DELAY,
    reviewerMaxPrsPerRun: DEFAULT_REVIEWER_MAX_PRS_PER_RUN,
    provider: DEFAULT_PROVIDER,
    executorEnabled: DEFAULT_EXECUTOR_ENABLED,
    reviewerEnabled: DEFAULT_REVIEWER_ENABLED,
    providerEnv: { ...DEFAULT_PROVIDER_ENV },
    notifications: { ...DEFAULT_NOTIFICATIONS, webhooks: [] },
    prdPriority: [...DEFAULT_PRD_PRIORITY],
    roadmapScanner: { ...DEFAULT_ROADMAP_SCANNER },
    templatesDir: DEFAULT_TEMPLATES_DIR,
    boardProvider: { ...DEFAULT_BOARD_PROVIDER },
    autoMerge: DEFAULT_AUTO_MERGE,
    autoMergeMethod: DEFAULT_AUTO_MERGE_METHOD,
    fallbackOnRateLimit: DEFAULT_FALLBACK_ON_RATE_LIMIT,
    primaryFallbackModel: DEFAULT_PRIMARY_FALLBACK_MODEL,
    secondaryFallbackModel: DEFAULT_SECONDARY_FALLBACK_MODEL,
    claudeModel: DEFAULT_CLAUDE_MODEL,
    qa: { ...DEFAULT_QA },
    audit: { ...DEFAULT_AUDIT },
    analytics: { ...DEFAULT_ANALYTICS },
    jobProviders: { ...DEFAULT_JOB_PROVIDERS },
    providerScheduleOverrides: [...DEFAULT_PROVIDER_SCHEDULE_OVERRIDES],
    queue: { ...DEFAULT_QUEUE },
  };
}

/**
 * Load configuration from a JSON file
 */
function loadConfigFile(configPath: string): Partial<INightWatchConfig> | null {
  try {
    if (!fs.existsSync(configPath)) {
      return null;
    }
    const content = fs.readFileSync(configPath, 'utf-8');
    const rawConfig = JSON.parse(content) as Record<string, unknown>;
    return normalizeConfig(rawConfig);
  } catch (error) {
    console.warn(
      `Warning: Could not parse config file at ${configPath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return null;
  }
}

function sanitizeMaxRetries(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  const n = Math.floor(value);
  return n >= 1 ? n : fallback;
}

function sanitizeReviewerMaxRetries(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  const n = Math.floor(value);
  if (n < 0) return 0;
  if (n > 10) return 10;
  return n;
}

function sanitizeReviewerRetryDelay(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  const n = Math.floor(value);
  if (n < 0) return 0;
  if (n > 300) return 300;
  return n;
}

function sanitizeReviewerMaxPrsPerRun(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  const n = Math.floor(value);
  if (n < 0) return 0;
  if (n > 100) return 100;
  return n;
}

/**
 * Apply a partial config layer onto a base, skipping undefined values.
 */
function mergeConfigLayer(base: INightWatchConfig, layer: Partial<INightWatchConfig>): void {
  for (const _key of Object.keys(layer) as Array<keyof INightWatchConfig>) {
    const value = layer[_key];
    if (value === undefined) continue;

    if (_key === 'queue') {
      const baseQueue = base[_key] as IQueueConfig;
      const layerQueue = value as IQueueConfig;
      (base as unknown as Record<string, unknown>)[_key] = {
        ...baseQueue,
        ...layerQueue,
        providerBuckets: { ...baseQueue.providerBuckets, ...layerQueue.providerBuckets },
      };
    } else if (
      _key === 'providerEnv' ||
      _key === 'boardProvider' ||
      _key === 'qa' ||
      _key === 'audit' ||
      _key === 'analytics'
    ) {
      (base as unknown as Record<string, unknown>)[_key] = {
        ...(base[_key] as object),
        ...(value as object),
      };
    } else if (_key === 'roadmapScanner' || _key === 'jobProviders') {
      (base as unknown as Record<string, unknown>)[_key] = { ...(value as object) };
    } else if (_key === 'providerScheduleOverrides') {
      (base as unknown as Record<string, unknown>)[_key] = [
        ...(value as IProviderScheduleOverride[]),
      ];
    } else if (_key === 'branchPatterns' || _key === 'prdPriority') {
      (base as unknown as Record<string, unknown>)[_key] = [...(value as string[])];
    } else {
      (base as unknown as Record<string, unknown>)[_key] = value;
    }
  }
}

function mergeConfigs(
  base: INightWatchConfig,
  fileConfig: Partial<INightWatchConfig> | null,
  envConfig: Partial<INightWatchConfig>,
): INightWatchConfig {
  const merged: INightWatchConfig = { ...base };
  if (fileConfig) mergeConfigLayer(merged, fileConfig);
  mergeConfigLayer(merged, envConfig);

  merged.maxRetries = sanitizeMaxRetries(merged.maxRetries, DEFAULT_MAX_RETRIES);
  merged.reviewerMaxRetries = sanitizeReviewerMaxRetries(
    merged.reviewerMaxRetries,
    DEFAULT_REVIEWER_MAX_RETRIES,
  );
  merged.reviewerRetryDelay = sanitizeReviewerRetryDelay(
    merged.reviewerRetryDelay,
    DEFAULT_REVIEWER_RETRY_DELAY,
  );
  merged.reviewerMaxPrsPerRun = sanitizeReviewerMaxPrsPerRun(
    merged.reviewerMaxPrsPerRun,
    DEFAULT_REVIEWER_MAX_PRS_PER_RUN,
  );
  merged.primaryFallbackModel =
    merged.primaryFallbackModel ?? merged.claudeModel ?? DEFAULT_PRIMARY_FALLBACK_MODEL;
  merged.secondaryFallbackModel =
    merged.secondaryFallbackModel ??
    merged.primaryFallbackModel ??
    DEFAULT_SECONDARY_FALLBACK_MODEL;
  merged.claudeModel = merged.primaryFallbackModel;

  return merged;
}

/**
 * Load Night Watch configuration.
 * Priority: defaults < config file < environment variables
 */
export function loadConfig(projectDir: string): INightWatchConfig {
  const defaults = getDefaultConfig();
  const configPath = path.join(projectDir, CONFIG_FILE_NAME);
  const fileConfig = loadConfigFile(configPath);
  const envConfig = buildEnvOverrideConfig(fileConfig);
  return mergeConfigs(defaults, fileConfig, envConfig);
}

/**
 * Parse a time string in "HH:mm" format to minutes since midnight.
 * @param time - Time string in 24-hour format (e.g., "23:00", "04:00")
 * @returns Minutes since midnight (0-1439)
 * @throws Error if the time string is invalid
 */
export function parseTimeToMinutes(time: string): number {
  const match = time.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    throw new Error(`Invalid time format: "${time}". Expected "HH:mm" in 24-hour format.`);
  }
  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);

  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    throw new Error(`Invalid time value: "${time}". Hours must be 0-23, minutes must be 0-59.`);
  }

  return hours * 60 + minutes;
}

/**
 * Check if the current time falls within a schedule override's time window.
 * Handles both same-day and cross-midnight windows.
 * For cross-midnight windows (e.g., 23:00-04:00), the days array refers to the START day.
 * At 02:00 on Thursday, we check if Wednesday is in the days array.
 *
 * @param now - Current date/time
 * @param override - Schedule override to check
 * @returns true if the current time is within the override's window
 */
function isTimeInWindow(now: Date, override: IProviderScheduleOverride): boolean {
  const currentDay = now.getDay(); // 0 = Sunday, 6 = Saturday
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  const startMinutes = parseTimeToMinutes(override.startTime);
  const endMinutes = parseTimeToMinutes(override.endTime);

  // Check if current day is in the override's days array
  if (!override.days.includes(currentDay as DayOfWeek)) {
    // For cross-midnight windows, also check the previous day
    // If window is 23:00-04:00 and it's currently 02:00 on Thursday (day 4),
    // we should match if Wednesday (day 3) is in the days array
    if (endMinutes < startMinutes && currentMinutes < endMinutes) {
      const prevDay = currentDay === 0 ? 6 : currentDay - 1;
      if (!override.days.includes(prevDay as DayOfWeek)) {
        return false;
      }
    } else {
      return false;
    }
  }

  // Check if current time is within the window
  if (startMinutes <= endMinutes) {
    // Same-day window (e.g., 09:00-17:00)
    return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
  } else {
    // Cross-midnight window (e.g., 23:00-04:00)
    // Matches if current time is after start OR before end
    if (currentMinutes >= startMinutes) {
      // After midnight on start day - match if today is in days
      return override.days.includes(currentDay as DayOfWeek);
    } else if (currentMinutes < endMinutes) {
      // Before end time on next day - match if yesterday is in days
      const prevDay = currentDay === 0 ? 6 : currentDay - 1;
      return override.days.includes(prevDay as DayOfWeek);
    }
    return false;
  }
}

/**
 * Find an active schedule override for a specific job type.
 * Job-specific overrides take precedence over global overrides.
 * First matching override wins (by specificity then array order).
 *
 * @param overrides - Array of schedule overrides to check
 * @param jobType - Job type to resolve provider for
 * @param now - Current date/time (defaults to now for testing support)
 * @returns The preset ID of the active override, or null if none active
 */
export function findActiveScheduleOverride(
  overrides: IProviderScheduleOverride[],
  jobType: JobType,
  now?: Date,
): string | null {
  const currentTime = now ?? new Date();

  // Separate overrides into job-specific and global
  const jobSpecificOverrides = overrides.filter(
    (o) => o.enabled && o.jobTypes && o.jobTypes.includes(jobType),
  );
  const globalOverrides = overrides.filter(
    (o) => o.enabled && (!o.jobTypes || o.jobTypes.length === 0),
  );

  // Check job-specific overrides first
  for (const override of jobSpecificOverrides) {
    if (isTimeInWindow(currentTime, override)) {
      return override.presetId;
    }
  }

  // Fall back to global overrides
  for (const override of globalOverrides) {
    if (isTimeInWindow(currentTime, override)) {
      return override.presetId;
    }
  }

  return null;
}

/**
 * Resolve the provider for a specific job type.
 * Precedence: CLI override > schedule override > job-specific provider > global provider.
 * Returns the preset ID (string) that should be used.
 *
 * @param config - Night Watch configuration
 * @param jobType - Job type to resolve provider for
 * @param now - Current date/time (defaults to now, for testing support)
 * @returns The preset ID to use for this job
 */
export function resolveJobProvider(
  config: INightWatchConfig,
  jobType: JobType,
  now?: Date,
): string {
  // CLI override takes highest precedence
  if (config._cliProviderOverride) return config._cliProviderOverride;

  // Check for active schedule override
  const scheduleOverride = findActiveScheduleOverride(
    config.providerScheduleOverrides ?? [],
    jobType,
    now,
  );
  if (scheduleOverride) return scheduleOverride;

  // Job-specific provider
  if (config.jobProviders[jobType]) return config.jobProviders[jobType]!;

  // Global provider
  return config.provider;
}

/**
 * Resolve a provider preset by ID.
 * Looks up custom presets from config first, then falls back to built-in presets.
 * Throws if the preset ID is not found.
 */
export function resolvePreset(config: INightWatchConfig, presetId: string): IProviderPreset {
  // Check custom presets first (allows overriding built-ins)
  if (config.providerPresets?.[presetId]) {
    return config.providerPresets[presetId];
  }

  // Fall back to built-in presets
  if (BUILT_IN_PRESETS[presetId]) {
    return BUILT_IN_PRESETS[presetId];
  }

  throw new Error(`Unknown provider preset: "${presetId}"`);
}

/**
 * Get the path to a bundled script
 */
export function getScriptPath(scriptName: string): string {
  const configFilePath = fileURLToPath(import.meta.url);
  const baseDir = path.dirname(configFilePath);

  const candidates = [
    path.resolve(baseDir, 'scripts', scriptName),
    ...(process.argv[1]
      ? (() => {
          let argv1 = process.argv[1];
          try {
            argv1 = fs.realpathSync(argv1);
          } catch {
            /* keep original on failure */
          }
          return [path.resolve(path.dirname(argv1), '..', 'scripts', scriptName)];
        })()
      : []),
    path.resolve(baseDir, '..', 'scripts', scriptName),
    path.resolve(baseDir, '..', '..', 'scripts', scriptName),
    path.resolve(process.cwd(), 'scripts', scriptName),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return candidates[0];
}
