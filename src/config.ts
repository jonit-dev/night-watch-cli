/**
 * Configuration loader for Night Watch CLI
 * Loads config from: defaults -> config file -> environment variables
 */

import * as fs from "fs";
import * as path from "path";
import { INightWatchConfig, IClaudeConfig } from "./types.js";
import {
  DEFAULT_PRD_DIR,
  DEFAULT_MAX_BUDGET,
  DEFAULT_REVIEWER_MAX_BUDGET,
  DEFAULT_MAX_RUNTIME,
  DEFAULT_REVIEWER_MAX_RUNTIME,
  DEFAULT_CRON_SCHEDULE,
  DEFAULT_REVIEWER_SCHEDULE,
  DEFAULT_BRANCH_PREFIX,
  DEFAULT_BRANCH_PATTERNS,
  DEFAULT_MIN_REVIEW_SCORE,
  DEFAULT_MAX_LOG_SIZE,
  CONFIG_FILE_NAME,
} from "./constants.js";

/**
 * Get the default configuration values
 */
export function getDefaultConfig(): INightWatchConfig {
  return {
    // PRD execution
    prdDir: DEFAULT_PRD_DIR,
    maxBudget: DEFAULT_MAX_BUDGET,
    reviewerMaxBudget: DEFAULT_REVIEWER_MAX_BUDGET,
    maxRuntime: DEFAULT_MAX_RUNTIME,
    reviewerMaxRuntime: DEFAULT_REVIEWER_MAX_RUNTIME,
    branchPrefix: DEFAULT_BRANCH_PREFIX,
    branchPatterns: [...DEFAULT_BRANCH_PATTERNS],
    minReviewScore: DEFAULT_MIN_REVIEW_SCORE,
    maxLogSize: DEFAULT_MAX_LOG_SIZE,

    // Cron scheduling
    cronSchedule: DEFAULT_CRON_SCHEDULE,
    reviewerSchedule: DEFAULT_REVIEWER_SCHEDULE,

    // Claude provider configuration
    claude: {},
  };
}

/**
 * Load Claude configuration from environment variables
 */
function loadClaudeConfigFromEnv(): IClaudeConfig {
  const claudeConfig: IClaudeConfig = {};

  if (process.env.ANTHROPIC_AUTH_TOKEN) {
    claudeConfig.apiKey = process.env.ANTHROPIC_AUTH_TOKEN;
  }

  if (process.env.ANTHROPIC_BASE_URL) {
    claudeConfig.baseUrl = process.env.ANTHROPIC_BASE_URL;
  }

  if (process.env.API_TIMEOUT_MS) {
    const timeout = parseInt(process.env.API_TIMEOUT_MS, 10);
    if (!isNaN(timeout)) {
      claudeConfig.timeout = timeout;
    }
  }

  if (process.env.ANTHROPIC_DEFAULT_OPUS_MODEL) {
    claudeConfig.opusModel = process.env.ANTHROPIC_DEFAULT_OPUS_MODEL;
  }

  if (process.env.ANTHROPIC_DEFAULT_SONNET_MODEL) {
    claudeConfig.sonnetModel = process.env.ANTHROPIC_DEFAULT_SONNET_MODEL;
  }

  return claudeConfig;
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
    const config = JSON.parse(content);

    return config;
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
    if (fileConfig.prdDir !== undefined) merged.prdDir = fileConfig.prdDir;
    if (fileConfig.maxBudget !== undefined) merged.maxBudget = fileConfig.maxBudget;
    if (fileConfig.reviewerMaxBudget !== undefined)
      merged.reviewerMaxBudget = fileConfig.reviewerMaxBudget;
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

    // Merge Claude config from file
    if (fileConfig.claude) {
      merged.claude = { ...merged.claude, ...fileConfig.claude };
    }
  }

  // Merge env config (takes precedence)
  if (envConfig.prdDir !== undefined) merged.prdDir = envConfig.prdDir;
  if (envConfig.maxBudget !== undefined) merged.maxBudget = envConfig.maxBudget;
  if (envConfig.reviewerMaxBudget !== undefined)
    merged.reviewerMaxBudget = envConfig.reviewerMaxBudget;
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

  // Merge Claude config from env (takes precedence over file)
  if (envConfig.claude) {
    merged.claude = { ...merged.claude, ...envConfig.claude };
  }

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
  if (process.env.NW_PRD_DIR) {
    envConfig.prdDir = process.env.NW_PRD_DIR;
  }

  if (process.env.NW_MAX_BUDGET) {
    const budget = parseFloat(process.env.NW_MAX_BUDGET);
    if (!isNaN(budget)) {
      envConfig.maxBudget = budget;
    }
  }

  if (process.env.NW_REVIEWER_MAX_BUDGET) {
    const budget = parseFloat(process.env.NW_REVIEWER_MAX_BUDGET);
    if (!isNaN(budget)) {
      envConfig.reviewerMaxBudget = budget;
    }
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

  // Load Claude config from environment
  const claudeEnvConfig = loadClaudeConfigFromEnv();
  if (Object.keys(claudeEnvConfig).length > 0) {
    envConfig.claude = claudeEnvConfig;
  }

  // Merge all configs
  return mergeConfigs(defaults, fileConfig, envConfig);
}

/**
 * Get the path to a bundled script
 * This returns the path to a script in the package's scripts/ directory
 */
export function getScriptPath(scriptName: string): string {
  // In development, scripts are in scripts/ relative to package root
  // In production (after npm pack), they're still in scripts/
  return path.join(path.dirname(new URL(import.meta.url).pathname), "..", "scripts", scriptName);
}
