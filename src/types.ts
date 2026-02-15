/**
 * TypeScript interfaces for Night Watch CLI configuration
 */

/**
 * Claude provider configuration options
 * These map to environment variables used by Claude CLI
 */
export interface IClaudeConfig {
  /** API key for Claude - maps to ANTHROPIC_AUTH_TOKEN */
  apiKey?: string;

  /** Base URL for Claude API - maps to ANTHROPIC_BASE_URL */
  baseUrl?: string;

  /** API timeout in milliseconds - maps to API_TIMEOUT_MS */
  timeout?: number;

  /** Default Opus model - maps to ANTHROPIC_DEFAULT_OPUS_MODEL */
  opusModel?: string;

  /** Default Sonnet model - maps to ANTHROPIC_DEFAULT_SONNET_MODEL */
  sonnetModel?: string;
}

/**
 * Complete Night Watch configuration
 */
export interface INightWatchConfig {
  // PRD execution configuration

  /** Directory containing PRD files (relative to project root) */
  prdDir: string;

  /** Maximum budget in USD for PRD execution */
  maxBudget: number;

  /** Maximum budget in USD for PR reviewer */
  reviewerMaxBudget: number;

  /** Maximum runtime in seconds for PRD execution */
  maxRuntime: number;

  /** Maximum runtime in seconds for PR reviewer */
  reviewerMaxRuntime: number;

  /** Prefix for night-watch branches */
  branchPrefix: string;

  /** Branch patterns to match for PR reviewer */
  branchPatterns: string[];

  /** Minimum review score (out of 100) to consider PR complete */
  minReviewScore: number;

  /** Maximum log file size in bytes before rotation */
  maxLogSize: number;

  // Cron scheduling configuration

  /** Cron schedule for PRD execution */
  cronSchedule: string;

  /** Cron schedule for PR reviewer */
  reviewerSchedule: string;

  // Claude provider configuration
  claude: IClaudeConfig;
}
