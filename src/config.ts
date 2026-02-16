/**
 * Configuration loader for Night Watch CLI
 * Loads config from: defaults -> config file -> environment variables
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { INightWatchConfig, Provider } from "./types.js";
import {
  DEFAULT_DEFAULT_BRANCH,
  DEFAULT_PRD_DIR,
  DEFAULT_MAX_RUNTIME,
  DEFAULT_REVIEWER_MAX_RUNTIME,
  DEFAULT_CRON_SCHEDULE,
  DEFAULT_REVIEWER_SCHEDULE,
  DEFAULT_BRANCH_PREFIX,
  DEFAULT_BRANCH_PATTERNS,
  DEFAULT_MIN_REVIEW_SCORE,
  DEFAULT_MAX_LOG_SIZE,
  DEFAULT_PROVIDER,
  DEFAULT_REVIEWER_ENABLED,
  VALID_PROVIDERS,
  CONFIG_FILE_NAME,
} from "./constants.js";

/**
 * Get the default configuration values
 */
export function getDefaultConfig(): INightWatchConfig {
  return {
    // PRD execution
    defaultBranch: DEFAULT_DEFAULT_BRANCH,
    prdDir: DEFAULT_PRD_DIR,
    maxRuntime: DEFAULT_MAX_RUNTIME,
    reviewerMaxRuntime: DEFAULT_REVIEWER_MAX_RUNTIME,
    branchPrefix: DEFAULT_BRANCH_PREFIX,
    branchPatterns: [...DEFAULT_BRANCH_PATTERNS],
    minReviewScore: DEFAULT_MIN_REVIEW_SCORE,
    maxLogSize: DEFAULT_MAX_LOG_SIZE,

    // Cron scheduling
    cronSchedule: DEFAULT_CRON_SCHEDULE,
    reviewerSchedule: DEFAULT_REVIEWER_SCHEDULE,

    // Provider configuration
    provider: DEFAULT_PROVIDER,
    reviewerEnabled: DEFAULT_REVIEWER_ENABLED,
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

    const content = fs.readFileSync(configPath, "utf-8");
    const rawConfig = JSON.parse(content) as Record<string, unknown>;

    return normalizeConfig(rawConfig);
  } catch (error) {
    // If file exists but can't be parsed, warn but don't fail
    console.warn(
      `Warning: Could not parse config file at ${configPath}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return null;
  }
}

/**
 * Convert legacy/nested config formats to the flat INightWatchConfig shape.
 * Flat keys take precedence over nested aliases when both are present.
 */
function normalizeConfig(rawConfig: Record<string, unknown>): Partial<INightWatchConfig> {
  const normalized: Partial<INightWatchConfig> = {};

  const readString = (value: unknown): string | undefined =>
    typeof value === "string" ? value : undefined;
  const readNumber = (value: unknown): number | undefined =>
    typeof value === "number" && !Number.isNaN(value) ? value : undefined;
  const readBoolean = (value: unknown): boolean | undefined =>
    typeof value === "boolean" ? value : undefined;
  const readStringArray = (value: unknown): string[] | undefined =>
    Array.isArray(value) && value.every((v) => typeof v === "string")
      ? (value as string[])
      : undefined;
  const readObject = (value: unknown): Record<string, unknown> | undefined =>
    value !== null && typeof value === "object" ? (value as Record<string, unknown>) : undefined;

  const cron = readObject(rawConfig.cron);
  const review = readObject(rawConfig.review);
  const logging = readObject(rawConfig.logging);

  normalized.defaultBranch = readString(rawConfig.defaultBranch);
  normalized.prdDir =
    readString(rawConfig.prdDir) ??
    readString(rawConfig.prdDirectory);
  normalized.maxRuntime = readNumber(rawConfig.maxRuntime);
  normalized.reviewerMaxRuntime = readNumber(rawConfig.reviewerMaxRuntime);
  normalized.branchPrefix = readString(rawConfig.branchPrefix);
  normalized.branchPatterns =
    readStringArray(rawConfig.branchPatterns) ??
    readStringArray(review?.branchPatterns);
  normalized.minReviewScore =
    readNumber(rawConfig.minReviewScore) ??
    readNumber(review?.minScore);
  normalized.maxLogSize =
    readNumber(rawConfig.maxLogSize) ??
    readNumber(logging?.maxLogSize);
  normalized.cronSchedule =
    readString(rawConfig.cronSchedule) ??
    readString(cron?.executorSchedule);
  normalized.reviewerSchedule =
    readString(rawConfig.reviewerSchedule) ??
    readString(cron?.reviewerSchedule);
  normalized.provider = validateProvider(String(rawConfig.provider ?? "")) ?? undefined;
  normalized.reviewerEnabled = readBoolean(rawConfig.reviewerEnabled);

  return normalized;
}

/**
 * Parse a boolean string value
 */
function parseBoolean(value: string): boolean | null {
  const normalized = value.toLowerCase().trim();
  if (normalized === "true" || normalized === "1") {
    return true;
  }
  if (normalized === "false" || normalized === "0") {
    return false;
  }
  return null;
}

/**
 * Validate and return a provider value
 */
function validateProvider(value: string): Provider | null {
  if (VALID_PROVIDERS.includes(value as Provider)) {
    return value as Provider;
  }
  return null;
}

/**
 * Deep merge configuration objects
 * Environment values take precedence over file values
 */
function mergeConfigs(
  base: INightWatchConfig,
  fileConfig: Partial<INightWatchConfig> | null,
  envConfig: Partial<INightWatchConfig>
): INightWatchConfig {
  const merged: INightWatchConfig = { ...base };

  // Merge file config
  if (fileConfig) {
    if (fileConfig.defaultBranch !== undefined) merged.defaultBranch = fileConfig.defaultBranch;
    if (fileConfig.prdDir !== undefined) merged.prdDir = fileConfig.prdDir;
    if (fileConfig.maxRuntime !== undefined) merged.maxRuntime = fileConfig.maxRuntime;
    if (fileConfig.reviewerMaxRuntime !== undefined)
      merged.reviewerMaxRuntime = fileConfig.reviewerMaxRuntime;
    if (fileConfig.branchPrefix !== undefined) merged.branchPrefix = fileConfig.branchPrefix;
    if (fileConfig.branchPatterns !== undefined)
      merged.branchPatterns = [...fileConfig.branchPatterns];
    if (fileConfig.minReviewScore !== undefined) merged.minReviewScore = fileConfig.minReviewScore;
    if (fileConfig.maxLogSize !== undefined) merged.maxLogSize = fileConfig.maxLogSize;
    if (fileConfig.cronSchedule !== undefined) merged.cronSchedule = fileConfig.cronSchedule;
    if (fileConfig.reviewerSchedule !== undefined)
      merged.reviewerSchedule = fileConfig.reviewerSchedule;
    if (fileConfig.provider !== undefined) merged.provider = fileConfig.provider;
    if (fileConfig.reviewerEnabled !== undefined)
      merged.reviewerEnabled = fileConfig.reviewerEnabled;
  }

  // Merge env config (takes precedence)
  if (envConfig.defaultBranch !== undefined) merged.defaultBranch = envConfig.defaultBranch;
  if (envConfig.prdDir !== undefined) merged.prdDir = envConfig.prdDir;
  if (envConfig.maxRuntime !== undefined) merged.maxRuntime = envConfig.maxRuntime;
  if (envConfig.reviewerMaxRuntime !== undefined)
    merged.reviewerMaxRuntime = envConfig.reviewerMaxRuntime;
  if (envConfig.branchPrefix !== undefined) merged.branchPrefix = envConfig.branchPrefix;
  if (envConfig.branchPatterns !== undefined) merged.branchPatterns = [...envConfig.branchPatterns];
  if (envConfig.minReviewScore !== undefined) merged.minReviewScore = envConfig.minReviewScore;
  if (envConfig.maxLogSize !== undefined) merged.maxLogSize = envConfig.maxLogSize;
  if (envConfig.cronSchedule !== undefined) merged.cronSchedule = envConfig.cronSchedule;
  if (envConfig.reviewerSchedule !== undefined)
    merged.reviewerSchedule = envConfig.reviewerSchedule;
  if (envConfig.provider !== undefined) merged.provider = envConfig.provider;
  if (envConfig.reviewerEnabled !== undefined)
    merged.reviewerEnabled = envConfig.reviewerEnabled;

  return merged;
}

/**
 * Load Night Watch configuration
 * Priority: defaults < config file < environment variables
 *
 * @param projectDir - The project directory to load config from
 * @returns Merged configuration object
 */
export function loadConfig(projectDir: string): INightWatchConfig {
  // Start with defaults
  const defaults = getDefaultConfig();

  // Load config file
  const configPath = path.join(projectDir, CONFIG_FILE_NAME);
  const fileConfig = loadConfigFile(configPath);

  // Load environment overrides
  const envConfig: Partial<INightWatchConfig> = {};

  // NW_* environment variables
  if (process.env.NW_DEFAULT_BRANCH) {
    envConfig.defaultBranch = process.env.NW_DEFAULT_BRANCH;
  }

  if (process.env.NW_PRD_DIR) {
    envConfig.prdDir = process.env.NW_PRD_DIR;
  }

  if (process.env.NW_MAX_RUNTIME) {
    const runtime = parseInt(process.env.NW_MAX_RUNTIME, 10);
    if (!isNaN(runtime)) {
      envConfig.maxRuntime = runtime;
    }
  }

  if (process.env.NW_REVIEWER_MAX_RUNTIME) {
    const runtime = parseInt(process.env.NW_REVIEWER_MAX_RUNTIME, 10);
    if (!isNaN(runtime)) {
      envConfig.reviewerMaxRuntime = runtime;
    }
  }

  if (process.env.NW_BRANCH_PREFIX) {
    envConfig.branchPrefix = process.env.NW_BRANCH_PREFIX;
  }

  if (process.env.NW_BRANCH_PATTERNS) {
    try {
      envConfig.branchPatterns = JSON.parse(process.env.NW_BRANCH_PATTERNS);
    } catch {
      // If not valid JSON, treat as comma-separated
      envConfig.branchPatterns = process.env.NW_BRANCH_PATTERNS.split(",").map((s) => s.trim());
    }
  }

  if (process.env.NW_MIN_REVIEW_SCORE) {
    const score = parseInt(process.env.NW_MIN_REVIEW_SCORE, 10);
    if (!isNaN(score)) {
      envConfig.minReviewScore = score;
    }
  }

  if (process.env.NW_MAX_LOG_SIZE) {
    const size = parseInt(process.env.NW_MAX_LOG_SIZE, 10);
    if (!isNaN(size)) {
      envConfig.maxLogSize = size;
    }
  }

  if (process.env.NW_CRON_SCHEDULE) {
    envConfig.cronSchedule = process.env.NW_CRON_SCHEDULE;
  }

  if (process.env.NW_REVIEWER_SCHEDULE) {
    envConfig.reviewerSchedule = process.env.NW_REVIEWER_SCHEDULE;
  }

  // NW_PROVIDER environment variable
  if (process.env.NW_PROVIDER) {
    const provider = validateProvider(process.env.NW_PROVIDER);
    if (provider !== null) {
      envConfig.provider = provider;
    }
    // If invalid, fallback to default (don't set envConfig.provider)
  }

  // NW_REVIEWER_ENABLED environment variable
  if (process.env.NW_REVIEWER_ENABLED) {
    const reviewerEnabled = parseBoolean(process.env.NW_REVIEWER_ENABLED);
    if (reviewerEnabled !== null) {
      envConfig.reviewerEnabled = reviewerEnabled;
    }
  }

  // Merge all configs
  return mergeConfigs(defaults, fileConfig, envConfig);
}

/**
 * Get the path to a bundled script
 * This returns the path to a script in the package's scripts/ directory
 */
export function getScriptPath(scriptName: string): string {
  const configFilePath = fileURLToPath(import.meta.url);
  // In development, scripts are in scripts/ relative to package root
  // In production (after npm pack), they're still in scripts/
  return path.join(path.dirname(configFilePath), "..", "scripts", scriptName);
}
