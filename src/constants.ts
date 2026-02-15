/**
 * Default configuration values for Night Watch CLI
 */

import { Provider } from "./types.js";

// PRD Configuration
export const DEFAULT_PRD_DIR = "docs/PRDs/night-watch";

// Runtime Configuration (in seconds)
export const DEFAULT_MAX_RUNTIME = 7200;
export const DEFAULT_REVIEWER_MAX_RUNTIME = 3600;

// Cron Schedule Configuration
export const DEFAULT_CRON_SCHEDULE = "0 0-21 * * *";
export const DEFAULT_REVIEWER_SCHEDULE = "0 0,3,6,9,12,15,18,21 * * *";

// Branch Configuration
export const DEFAULT_BRANCH_PREFIX = "night-watch";
export const DEFAULT_BRANCH_PATTERNS = ["feat/", "night-watch/"];

// Review Configuration
export const DEFAULT_MIN_REVIEW_SCORE = 80;

// Log Configuration
export const DEFAULT_MAX_LOG_SIZE = 524288; // 512 KB

// Provider Configuration
export const DEFAULT_PROVIDER: Provider = "claude";
export const DEFAULT_REVIEWER_ENABLED = true;

// Valid providers
export const VALID_PROVIDERS: Provider[] = ["claude", "codex"];

// Provider commands configuration
export const PROVIDER_COMMANDS: Record<Provider, string> = {
  claude: "claude",
  codex: "codex",
};

// File Names and Paths
export const CONFIG_FILE_NAME = "night-watch.config.json";
export const LOCK_FILE_PREFIX = "/tmp/night-watch-";
export const LOG_DIR = "logs";
