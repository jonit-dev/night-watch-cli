/**
 * TypeScript interfaces for Night Watch CLI configuration
 */

import { BoardColumnName, IBoardProviderConfig } from './board/types.js';

/**
 * Supported AI providers (string to allow custom presets)
 * Backward compatible: 'claude' | 'codex' are still valid string values
 */
// eslint-disable-next-line sonarjs/redundant-type-aliases
export type Provider = string;

/**
 * A fully-configured provider preset that defines how to invoke an AI provider CLI.
 * Presets can be built-in (claude, codex) or user-defined in night-watch.config.json.
 */
export interface IProviderPreset {
  /** Human-friendly display name (e.g., "Claude", "GLM-5", "Codex") */
  name: string;
  /** Base command to execute (e.g., "claude", "codex", "npx") */
  command: string;
  /** Optional subcommand after the base command (e.g., "exec" for "codex exec") */
  subcommand?: string;
  /** Flag to pass the prompt (e.g., "-p" for claude) */
  promptFlag?: string;
  /** Flag to enable auto-approve/yolo mode (e.g., "--dangerously-skip-permissions") */
  autoApproveFlag?: string;
  /** Flag to set working directory (e.g., "-C" for codex) */
  workdirFlag?: string;
  /** Flag to specify the model (e.g., "--model") */
  modelFlag?: string;
  /** Default model to use if modelFlag is set (e.g., "claude-sonnet-4-6") */
  model?: string;
  /** Additional environment variables to set when invoking the provider */
  envVars?: Record<string, string>;
}

/**
 * Days of the week (0 = Sunday, 6 = Saturday)
 */
export type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/**
 * Job types that can have per-job provider configuration
 */
export type JobType =
  | 'executor'
  | 'reviewer'
  | 'qa'
  | 'audit'
  | 'slicer'
  | 'analytics'
  | 'planner'
  | 'pr-resolver';

/**
 * Time-based provider schedule override.
 * Allows temporarily switching providers based on day of week and time window.
 * The days array refers to the START day of the window; for cross-midnight windows,
 * the after-midnight portion activates on the previous day.
 */
export interface IProviderScheduleOverride {
  /** Human-friendly label for this override (e.g., "Night Surge - Claude") */
  label: string;
  /** Provider preset ID to use when this override is active */
  presetId: string;
  /**
   * Days of the week when this override applies.
   * For cross-midnight windows (e.g., 23:00-04:00), this refers to the START day.
   * At 02:00 on Thursday, the window 23:00-04:00 checks if Wednesday (day 3) is in days.
   */
  days: DayOfWeek[];
  /**
   * Start time in 24-hour format (HH:mm).
   * Example: "23:00" for 11 PM
   */
  startTime: string;
  /**
   * End time in 24-hour format (HH:mm).
   * Example: "04:00" for 4 AM
   * If endTime < startTime, the window crosses midnight.
   */
  endTime: string;
  /**
   * Optional job type filter. When null or undefined, applies to all jobs.
   * When specified, only applies to the listed job types.
   * Job-specific overrides take precedence over global overrides.
   */
  jobTypes?: JobType[] | null;
  /** Whether this override is enabled */
  enabled: boolean;
}

/**
 * Per-job provider configuration
 * Allows assigning different AI providers to different job types
 */
export interface IJobProviders {
  executor?: Provider;
  reviewer?: Provider;
  qa?: Provider;
  audit?: Provider;
  slicer?: Provider;
  analytics?: Provider;
  planner?: Provider;
  'pr-resolver'?: Provider;
}

/**
 * Claude model to use for native (non-proxy) execution
 */
export type ClaudeModel = 'sonnet' | 'opus';

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

  /**
   * Maximum runtime per executor session in seconds.
   * When a session hits this limit it checkpoints and re-queues the issue for the next run.
   * Defaults to maxRuntime when not set.
   */
  sessionMaxRuntime?: number;

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

  /**
   * Optional persisted schedule bundle/template identifier selected in Settings UI
   * (e.g. "always-on", "night-surge"). Null/undefined means custom schedules.
   */
  scheduleBundleId?: string | null;

  /**
   * Additional delay in minutes applied before cron-triggered jobs start.
   * Stacks on top of automatic cross-project balancing.
   */
  cronScheduleOffset: number;

  /**
   * Cross-project scheduling priority.
   * Higher values get earlier balanced start slots and win tie-breakers under queue contention.
   */
  schedulingPriority: number;

  /** Maximum retry attempts for rate-limited API calls (default: 3) */
  maxRetries: number;

  /** Maximum retry attempts for reviewer fix iterations within a single cron run (default: 2) */
  reviewerMaxRetries: number;

  /** Delay in seconds between reviewer retry attempts (default: 30) */
  reviewerRetryDelay: number;

  /** Maximum number of PRs the reviewer should process in a single run (0 = unlimited) */
  reviewerMaxPrsPerRun: number;

  // Provider configuration

  /** AI provider to use for execution */
  provider: Provider;

  /** Whether the executor is enabled */
  executorEnabled?: boolean;

  /** Whether the reviewer is enabled */
  reviewerEnabled: boolean;

  /** Extra environment variables to pass to the provider CLI (e.g. API keys, base URLs) */
  providerEnv: Record<string, string>;

  /**
   * Named provider presets that define how to invoke AI provider CLIs.
   * Built-in presets (claude, codex) can be overridden here.
   * Custom presets allow defining new providers with full CLI configuration.
   */
  providerPresets?: Record<string, IProviderPreset>;

  /**
   * Optional human-friendly label for the AI provider shown in PR bodies, review comments,
   * board comments, and commit co-authors. Auto-derived if not set.
   * e.g. "GLM-5", "Codex", "Claude" — useful when using a proxy (ANTHROPIC_BASE_URL).
   * @deprecated Use providerPresets[id].name instead for custom presets.
   */
  providerLabel?: string;

  /**
   * When true, automatically fall back to native Claude (OAuth / direct Anthropic API)
   * after the first rate-limit (429) on a proxy provider (e.g. GLM-5 via api.z.ai).
   * A Telegram warning is sent immediately when the fallback is triggered.
   * Default: false
   */
  fallbackOnRateLimit: boolean;

  /**
   * First native Claude model to try after a proxy rate-limit.
   * Also used as the default native Claude model for direct execution paths.
   * "sonnet" → claude-sonnet-4-6 (default)
   * "opus"   → claude-opus-4-6
   */
  primaryFallbackModel?: ClaudeModel;

  /**
   * Second native Claude model to try if the primary fallback model is also rate-limited.
   * Defaults to the same model as primaryFallbackModel to preserve existing behavior
   * until explicitly configured otherwise.
   */
  secondaryFallbackModel?: ClaudeModel;

  /**
   * Preset ID to use as the primary fallback when rate-limited.
   * Takes precedence over primaryFallbackModel when set.
   * Example: 'glm-47' to fall back from glm-5 to glm-47 on rate limit.
   */
  primaryFallbackPreset?: string;

  /**
   * Preset ID to use as the secondary fallback if the primary fallback preset is also rate-limited.
   */
  secondaryFallbackPreset?: string;

  /**
   * Legacy alias for primaryFallbackModel kept for backward compatibility with
   * older config files and tests.
   * @deprecated Use primaryFallbackModel instead.
   */
  claudeModel: ClaudeModel;

  /** Notification webhook configuration */
  notifications: INotificationConfig;

  /** PRD execution priority order (filenames without .md extension) */
  prdPriority: string[];

  /** Roadmap scanner configuration */
  roadmapScanner: IRoadmapScannerConfig;

  /** Directory containing custom template overrides (relative to project root) */
  templatesDir: string;

  /** Board provider configuration for PRD tracking */
  boardProvider: IBoardProviderConfig;

  /** Enable automatic merging of PRs that pass CI and review score threshold */
  autoMerge: boolean;

  /** Git merge method for auto-merge */
  autoMergeMethod: MergeMethod;

  /** QA process configuration */
  qa: IQaConfig;

  /** Code audit configuration */
  audit: IAuditConfig;

  /** Analytics job configuration (Amplitude integration) */
  analytics: IAnalyticsConfig;

  /** PR conflict resolver configuration */
  prResolver: IPrResolverConfig;

  /** Per-job provider configuration */
  jobProviders: IJobProviders;

  /**
   * Time-based provider schedule overrides.
   * When an override is active at job dispatch time, it takes precedence over
   * static per-job and global provider settings.
   * Resolution precedence: CLI override > schedule override > per-job provider > global provider.
   */
  providerScheduleOverrides?: IProviderScheduleOverride[];

  /** Global job queue configuration */
  queue: IQueueConfig;

  /**
   * Internal: CLI override for provider (--provider flag).
   * Takes precedence over all other provider settings.
   * @internal
   */
  _cliProviderOverride?: Provider;
}

export type QaArtifacts = 'screenshot' | 'video' | 'both';

export interface IQaConfig {
  /** Whether the QA process is enabled */
  enabled: boolean;
  /** Cron schedule for QA execution */
  schedule: string;
  /** Maximum runtime in seconds for QA */
  maxRuntime: number;
  /** Branch patterns to match for QA (defaults to top-level branchPatterns if empty) */
  branchPatterns: string[];
  /** What artifacts to capture for UI tests */
  artifacts: QaArtifacts;
  /** GitHub label to skip QA (PRs with this label are excluded) */
  skipLabel: string;
  /** Auto-install Playwright if missing during QA run */
  autoInstallPlaywright: boolean;
  /** GitHub label to apply when e2e tests pass (proves acceptance requirements met) */
  validatedLabel: string;
}

export interface IAuditConfig {
  /** Whether the audit process is enabled */
  enabled: boolean;
  /** Cron schedule for audit execution */
  schedule: string;
  /** Maximum runtime in seconds for the audit */
  maxRuntime: number;
}

export interface IAnalyticsConfig {
  /** Whether the analytics job is enabled */
  enabled: boolean;
  /** Cron schedule for analytics execution */
  schedule: string;
  /** Maximum runtime in seconds for the analytics job */
  maxRuntime: number;
  /** Number of days to look back when fetching Amplitude data */
  lookbackDays: number;
  /** Board column to place created issues in */
  targetColumn: BoardColumnName;
  /** Custom prompt for the AI analysis (optional override) */
  analysisPrompt: string;
}

export interface IPrResolverConfig {
  /** Whether the PR resolver is enabled */
  enabled: boolean;
  /** Cron schedule for PR resolver execution */
  schedule: string;
  /** Maximum runtime in seconds for the PR resolver */
  maxRuntime: number;
  /** Branch patterns to filter which PRs to process (empty = all) */
  branchPatterns: string[];
  /** Maximum number of PRs to process per run (0 = unlimited) */
  maxPrsPerRun: number;
  /** Per-PR timeout in seconds */
  perPrTimeout: number;
  /** Whether to use AI to resolve merge conflicts */
  aiConflictResolution: boolean;
  /** Whether to use AI to address review comments */
  aiReviewResolution: boolean;
  /** GitHub label to apply to conflict-free PRs */
  readyLabel: string;
}

export type WebhookType = 'slack' | 'discord' | 'telegram';
export type NotificationEvent =
  | 'run_started'
  | 'run_succeeded'
  | 'run_failed'
  | 'run_timeout'
  | 'run_no_work'
  | 'review_completed'
  | 'review_ready_for_human'
  | 'pr_auto_merged'
  | 'rate_limit_fallback'
  | 'qa_completed'
  | 'pr_resolver_completed'
  | 'pr_resolver_conflict_resolved'
  | 'pr_resolver_failed';

/**
 * Git merge methods for auto-merge
 */
export type MergeMethod = 'squash' | 'merge' | 'rebase';

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

  /** Cron schedule for the slicer (AI-powered PRD generation from roadmap items) */
  slicerSchedule: string;

  /** Maximum runtime in seconds for the slicer */
  slicerMaxRuntime: number;

  /** Source prioritization strategy when both roadmap and audit findings are available */
  priorityMode?: 'roadmap-first' | 'audit-first';

  /** Board column used when planner auto-creates an issue after PRD generation */
  issueColumn?: 'Draft' | 'Ready';
}

/**
 * Queue entry status
 */
export type QueueEntryStatus = 'pending' | 'running' | 'expired' | 'dispatched';

/**
 * Queue dispatch mode
 */
export type QueueMode = 'conservative' | 'provider-aware' | 'auto';

/**
 * Per-provider-bucket capacity limits for provider-aware scheduling.
 */
export interface IProviderBucketConfig {
  /** Maximum number of concurrent in-flight jobs for this bucket */
  maxConcurrency: number;
}

/**
 * Queue entry for job_queue table
 */
export interface IQueueEntry {
  id: number;
  projectPath: string;
  projectName: string;
  jobType: JobType;
  priority: number;
  status: QueueEntryStatus;
  envJson: Record<string, string>;
  enqueuedAt: number;
  dispatchedAt: number | null;
  expiredAt: number | null;
  /** Provider bucket key (e.g. 'claude-native', 'codex', 'claude-proxy:api.z.ai') */
  providerKey?: string;
}

/**
 * Queue status response
 */
export interface IQueueStatus {
  enabled: boolean;
  running: IQueueEntry | null;
  pending: {
    total: number;
    byType: Record<string, number>;
    byProviderBucket: Record<string, number>;
  };
  items: IQueueEntry[];
  averageWaitSeconds: number | null;
  oldestPendingAge: number | null;
}

/**
 * Status values for a completed or in-flight job run record
 */
export type JobRunStatus =
  | 'queued'
  | 'running'
  | 'success'
  | 'failure'
  | 'timeout'
  | 'rate_limited'
  | 'skipped';

/**
 * A record of a single job execution stored in the job_runs table
 */
export interface IJobRunRecord {
  projectPath: string;
  jobType: JobType;
  providerKey: string;
  queueEntryId?: number;
  status: JobRunStatus;
  queuedAt?: number;
  startedAt: number;
  finishedAt?: number;
  waitSeconds?: number;
  durationSeconds?: number;
  throttledCount?: number;
  metadataJson?: string;
}

/**
 * Analytics payload returned by getJobRunsAnalytics / GET /api/queue/analytics
 */
export interface IJobRunAnalytics {
  recentRuns: Array<{
    id: number;
    projectPath: string;
    jobType: string;
    providerKey: string;
    status: string;
    startedAt: number;
    finishedAt: number | null;
    waitSeconds: number | null;
    durationSeconds: number | null;
    throttledCount: number;
  }>;
  byProviderBucket: Record<
    string,
    {
      running: number;
      pending: number;
    }
  >;
  averageWaitSeconds: number | null;
  oldestPendingAge: number | null;
}

/**
 * Global Job Queue configuration
 */
export interface IQueueConfig {
  /** Whether the global queue is enabled */
  enabled: boolean;

  /**
   * Dispatch mode.
   * - 'conservative' (default): strict serial dispatch, one job at a time regardless of provider.
   * - 'provider-aware': allows cross-provider parallelism subject to per-bucket capacity checks.
   */
  mode: QueueMode;

  /** Maximum concurrent jobs across all providers. */
  maxConcurrency: number;

  /** Maximum wait time in seconds before a queued job expires (default: 7200 = 2 hours) */
  maxWaitTime: number;

  /** Priority mapping: job_type → priority (higher = first). Default has executor highest. */
  priority: Record<string, number>;

  /**
   * Per-provider-bucket capacity configuration for provider-aware mode.
   * Key format: 'claude-native' | 'codex' | 'claude-proxy:<hostname>'
   * Buckets not listed here fall back to the global maxConcurrency check only.
   */
  providerBuckets: Record<string, IProviderBucketConfig>;
}
