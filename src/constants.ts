/**
 * Default configuration values for Night Watch CLI
 */

// PRD Configuration
export const DEFAULT_PRD_DIR = "docs/PRDs/night-watch";

// Budget Configuration (in USD)
export const DEFAULT_MAX_BUDGET = 5.00;
export const DEFAULT_REVIEWER_MAX_BUDGET = 3.00;

// Runtime Configuration (in seconds)
export const DEFAULT_MAX_RUNTIME = 7200;
export const DEFAULT_REVIEWER_MAX_RUNTIME = 3600;

// Cron Schedule Configuration
export const DEFAULT_CRON_SCHEDULE = "0 0-15 * * *";
export const DEFAULT_REVIEWER_SCHEDULE = "0 0,3,6,9,12,15 * * *";

// Branch Configuration
export const DEFAULT_BRANCH_PREFIX = "night-watch";
export const DEFAULT_BRANCH_PATTERNS = ["feat/", "night-watch/"];

// Review Configuration
export const DEFAULT_MIN_REVIEW_SCORE = 80;

// Log Configuration
export const DEFAULT_MAX_LOG_SIZE = 524288; // 512 KB

// File Names and Paths
export const CONFIG_FILE_NAME = "night-watch.config.json";
export const LOCK_FILE_PREFIX = "/tmp/night-watch-";
export const LOG_DIR = "logs";
