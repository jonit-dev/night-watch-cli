/**
 * Configuration loader for Night Watch CLI
 * Loads config from: defaults -> config file -> environment variables
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  INightWatchConfig,
  IQueueConfig,
  JobType,
  Provider,
} from './types.js';
import {
  CONFIG_FILE_NAME,
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
  DEFAULT_PROVIDER,
  DEFAULT_PROVIDER_ENV,
  DEFAULT_QA,
  DEFAULT_QUEUE,
  DEFAULT_REVIEWER_ENABLED,
  DEFAULT_REVIEWER_MAX_RETRIES,
  DEFAULT_REVIEWER_MAX_RUNTIME,
  DEFAULT_REVIEWER_RETRY_DELAY,
  DEFAULT_REVIEWER_SCHEDULE,
  DEFAULT_ROADMAP_SCANNER,
  DEFAULT_SCHEDULING_PRIORITY,
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
    scheduleBundleId: null,
    cronScheduleOffset: DEFAULT_CRON_SCHEDULE_OFFSET,
    schedulingPriority: DEFAULT_SCHEDULING_PRIORITY,
    maxRetries: DEFAULT_MAX_RETRIES,
    reviewerMaxRetries: DEFAULT_REVIEWER_MAX_RETRIES,
    reviewerRetryDelay: DEFAULT_REVIEWER_RETRY_DELAY,
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
    claudeModel: DEFAULT_CLAUDE_MODEL,
    qa: { ...DEFAULT_QA },
    audit: { ...DEFAULT_AUDIT },
    jobProviders: { ...DEFAULT_JOB_PROVIDERS },
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
      _key === 'audit'
    ) {
      (base as unknown as Record<string, unknown>)[_key] = {
        ...(base[_key] as object),
        ...(value as object),
      };
    } else if (_key === 'roadmapScanner' || _key === 'jobProviders') {
      (base as unknown as Record<string, unknown>)[_key] = { ...(value as object) };
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
 * Resolve the provider for a specific job type.
 * Precedence: CLI override > job-specific provider > global provider.
 */
export function resolveJobProvider(config: INightWatchConfig, jobType: JobType): Provider {
  if (config._cliProviderOverride) return config._cliProviderOverride;
  if (config.jobProviders[jobType]) return config.jobProviders[jobType]!;
  return config.provider;
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
