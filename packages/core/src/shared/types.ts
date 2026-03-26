/**
 * Shared API contract types for Night Watch CLI.
 * These types represent the shape of data exchanged between the CLI server
 * and the web client over HTTP. Both sides must agree on these definitions.
 */

// ==================== Provider ====================

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

// ==================== Merge Method ====================

/** Git merge methods for auto-merge */
export type MergeMethod = 'squash' | 'merge' | 'rebase';

/** Days of the week (0 = Sunday, 6 = Saturday) */
export type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** Job types that can have per-job provider configuration */
export type JobType = 'executor' | 'reviewer' | 'qa' | 'audit' | 'slicer' | 'analytics' | 'planner' | 'merger';

/** Per-job provider configuration */
export interface IJobProviders {
  executor?: Provider;
  reviewer?: Provider;
  qa?: Provider;
  audit?: Provider;
  slicer?: Provider;
  analytics?: Provider;
  merger?: Provider;
}

/**
 * Time-based provider schedule override.
 * Allows temporarily switching providers based on day of week and time window.
 */
export interface IProviderScheduleOverride {
  /** Human-friendly label for this override */
  label: string;
  /** Provider preset ID to use when this override is active */
  presetId: string;
  /** Days of the week when this override applies (0 = Sunday, 6 = Saturday) */
  days: DayOfWeek[];
  /** Start time in 24-hour format (HH:mm) */
  startTime: string;
  /** End time in 24-hour format (HH:mm) */
  endTime: string;
  /** Optional job type filter. null/undefined = all jobs */
  jobTypes?: JobType[] | null;
  /** Whether this override is enabled */
  enabled: boolean;
}

// ==================== Provider Strategy ====================

/** Claude model to use for native (non-proxy) execution */
export type ClaudeModel = 'sonnet' | 'opus';

// ==================== Notification / Webhook ====================

export type WebhookType = 'slack' | 'discord' | 'telegram';
export type NotificationEvent =
  | 'run_started'
  | 'run_succeeded'
  | 'run_failed'
  | 'run_timeout'
  | 'run_no_work'
  | 'review_completed'
  | 'pr_auto_merged'
  | 'rate_limit_fallback'
  | 'qa_completed'
  | 'merge_completed'
  | 'merge_failed'
  | 'review_ready_for_human'
  | 'pr_resolver_completed'
  | 'pr_resolver_conflict_resolved'
  | 'pr_resolver_failed';

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

// ==================== Roadmap Scanner Config ====================

export interface IRoadmapScannerConfig {
  enabled: boolean;
  roadmapPath: string;
  autoScanInterval: number;
  slicerSchedule?: string;
  slicerMaxRuntime?: number;
  priorityMode?: 'roadmap-first' | 'audit-first';
  issueColumn?: 'Draft' | 'Ready';
}

// ==================== QA Config ====================

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
}

// ==================== Audit Config ====================

export interface IAuditConfig {
  /** Whether the audit process is enabled */
  enabled: boolean;
  /** Cron schedule for audit execution */
  schedule: string;
  /** Maximum runtime in seconds for the audit */
  maxRuntime: number;
}

// ==================== Merger Config ====================

export interface IMergerConfig {
  enabled: boolean;
  schedule: string;
  maxRuntime: number;
  mergeMethod: MergeMethod;
  minReviewScore: number;
  branchPatterns: string[];
  rebaseBeforeMerge: boolean;
  maxPrsPerRun: number;
}

// ==================== Analytics Config ====================

export type BoardColumnName = 'Draft' | 'Ready' | 'In Progress' | 'Review' | 'Done';

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

// ==================== Night Watch Config ====================

/**
 * The configuration object as returned by the /api/config endpoint.
 * This is the subset of INightWatchConfig that the web client consumes.
 */
export interface INightWatchConfig {
  defaultBranch: string;
  prdDir: string;
  maxRuntime: number;
  reviewerMaxRuntime: number;
  branchPrefix: string;
  branchPatterns: string[];
  minReviewScore: number;
  maxLogSize: number;
  cronSchedule: string;
  reviewerSchedule: string;
  scheduleBundleId?: string | null;
  cronScheduleOffset: number;
  schedulingPriority: number;
  maxRetries: number;
  reviewerMaxRetries: number;
  reviewerRetryDelay: number;
  reviewerMaxPrsPerRun: number;
  provider: Provider;
  providerLabel?: string;
  executorEnabled?: boolean;
  reviewerEnabled: boolean;
  providerEnv: Record<string, string>;
  /** Named provider presets that define how to invoke AI provider CLIs */
  providerPresets?: Record<string, IProviderPreset>;
  notifications: INotificationConfig;
  prdPriority: string[];
  roadmapScanner: IRoadmapScannerConfig;
  templatesDir: string;
  boardProvider: IBoardProviderConfig;
  jobProviders: IJobProviders;
  autoMerge?: boolean;
  autoMergeMethod?: MergeMethod;
  fallbackOnRateLimit: boolean;
  primaryFallbackModel?: ClaudeModel;
  secondaryFallbackModel?: ClaudeModel;
  primaryFallbackPreset?: string;
  secondaryFallbackPreset?: string;
  claudeModel: ClaudeModel;
  qa: IQaConfig;
  audit: IAuditConfig;
  analytics: IAnalyticsConfig;
  merger?: IMergerConfig;
  queue: IQueueConfig;
  /** Time-based provider schedule overrides */
  providerScheduleOverrides?: IProviderScheduleOverride[];
}

export type QueueMode = 'conservative' | 'provider-aware' | 'auto';

export interface IProviderBucketConfig {
  maxConcurrency: number;
}

export interface IQueueConfig {
  enabled: boolean;
  mode: QueueMode;
  maxConcurrency: number;
  maxWaitTime: number;
  priority: Record<string, number>;
  providerBuckets: Record<string, IProviderBucketConfig>;
}

// ==================== Board Provider Config ====================

export type BoardProviderType = 'github' | 'local';

export interface IBoardProviderConfig {
  enabled: boolean;
  provider: BoardProviderType;
  /** GitHub Projects V2 project number (set after `board setup`) */
  projectNumber?: number;
  /** Repository owner/name (auto-detected from git remote) */
  repo?: string;
}

// ==================== PRD Info ====================

export interface IPrdInfo {
  name: string;
  status: 'ready' | 'blocked' | 'in-progress' | 'pending-review' | 'done';
  dependencies: string[];
  unmetDependencies: string[];
}

// ==================== Process Info ====================

export interface IProcessInfo {
  name: string;
  running: boolean;
  pid: number | null;
}

// ==================== PR Info ====================

export interface IPrInfo {
  number: number;
  title: string;
  branch: string;
  url: string;
  ciStatus: 'pass' | 'fail' | 'pending' | 'unknown';
  reviewScore: number | null;
  labels: string[];
}

// ==================== Log Info ====================

export interface ILogInfo {
  name: string;
  path: string;
  exists: boolean;
  size: number;
  lastLines: string[];
}

// ==================== Status Snapshot ====================

export interface IStatusSnapshot {
  projectName: string;
  projectDir: string;
  config: INightWatchConfig;
  prds: IPrdInfo[];
  processes: IProcessInfo[];
  prs: IPrInfo[];
  logs: ILogInfo[];
  crontab: { installed: boolean; entries: string[] };
  activePrd: string | null;
  timestamp: string;
}

// ==================== Roadmap ====================

export interface IRoadmapItem {
  hash: string;
  title: string;
  description: string;
  checked: boolean;
  section: string;
  processed: boolean;
  prdFile?: string;
}

export interface IRoadmapStatus {
  found: boolean;
  enabled: boolean;
  totalItems: number;
  processedItems: number;
  pendingItems: number;
  status: 'idle' | 'scanning' | 'complete' | 'disabled' | 'no-roadmap';
  items: IRoadmapItem[];
  lastScan?: string;
  autoScanInterval?: number;
}

// ==================== Roadmap Context ====================

export interface IRoadmapContextOptions {
  mode: 'full' | 'summary';
  /** Character cap for the compiled output. Defaults: full=3000, summary=800 */
  maxChars?: number;
}
