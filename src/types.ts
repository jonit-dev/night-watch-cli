/**
 * TypeScript interfaces for Night Watch CLI configuration
 */

/**
 * Supported AI providers
 */
export type Provider = "claude" | "codex";

/**
 * Complete Night Watch configuration
 */
export interface INightWatchConfig {
  // PRD execution configuration

  /** Default branch name (e.g. "main" or "master"). Empty string means auto-detect. */
  defaultBranch: string;

  /** Directory containing PRD files (relative to project root) */
  prdDir: string;

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

  /** Minute offset (0-59) applied to cron schedules during install. Helps stagger multiple projects. */
  cronScheduleOffset: number;

  /** Maximum retry attempts for rate-limited API calls (default: 3) */
  maxRetries: number;

  // Provider configuration

  /** AI provider to use for execution */
  provider: Provider;

  /** Whether the reviewer is enabled */
  reviewerEnabled: boolean;

  /** Extra environment variables to pass to the provider CLI (e.g. API keys, base URLs) */
  providerEnv: Record<string, string>;

  /** Notification webhook configuration */
  notifications: INotificationConfig;

  /** PRD execution priority order (filenames without .md extension) */
  prdPriority: string[];

  /** Roadmap scanner configuration */
  roadmapScanner: IRoadmapScannerConfig;
}

export type WebhookType = "slack" | "discord" | "telegram";
export type NotificationEvent = "run_succeeded" | "run_failed" | "run_timeout" | "review_completed";

export interface IWebhookConfig {
  type: WebhookType;
  url?: string;
  botToken?: string;
  chatId?: string;
  events: NotificationEvent[];
}

export interface INotificationConfig {
  webhooks: IWebhookConfig[];
}

/**
 * Roadmap Scanner configuration
 */
export interface IRoadmapScannerConfig {
  /** Whether the roadmap scanner is enabled */
  enabled: boolean;

  /** Path to the ROADMAP.md file (relative to project root) */
  roadmapPath: string;

  /** Interval in seconds between automatic scans */
  autoScanInterval: number;
}
