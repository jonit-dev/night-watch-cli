/**
 * Configuration loader for Night Watch CLI
 * Loads config from: defaults -> config file -> environment variables
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { BoardProviderType, IBoardProviderConfig } from './board/types.js';
import {
  ClaudeModel,
  IAuditConfig,
  IJobProviders,
  INightWatchConfig,
  INotificationConfig,
  IQaConfig,
  IQueueConfig,
  IRoadmapScannerConfig,
  IWebhookConfig,
  JobType,
  MergeMethod,
  NotificationEvent,
  Provider,
  QaArtifacts,
  WebhookType,
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
  DEFAULT_TEMPLATES_DIR,
  VALID_CLAUDE_MODELS,
  VALID_JOB_TYPES,
  VALID_MERGE_METHODS,
  VALID_PROVIDERS,
} from './constants.js';

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
    scheduleBundleId: null,
    cronScheduleOffset: DEFAULT_CRON_SCHEDULE_OFFSET,
    maxRetries: DEFAULT_MAX_RETRIES,

    // Reviewer retry configuration
    reviewerMaxRetries: DEFAULT_REVIEWER_MAX_RETRIES,
    reviewerRetryDelay: DEFAULT_REVIEWER_RETRY_DELAY,

    // Provider configuration
    provider: DEFAULT_PROVIDER,
    executorEnabled: DEFAULT_EXECUTOR_ENABLED,
    reviewerEnabled: DEFAULT_REVIEWER_ENABLED,
    providerEnv: { ...DEFAULT_PROVIDER_ENV },

    // Notification configuration
    notifications: { ...DEFAULT_NOTIFICATIONS, webhooks: [] },

    // PRD priority
    prdPriority: [...DEFAULT_PRD_PRIORITY],

    // Roadmap scanner
    roadmapScanner: { ...DEFAULT_ROADMAP_SCANNER },

    // Templates
    templatesDir: DEFAULT_TEMPLATES_DIR,

    // Board provider
    boardProvider: { ...DEFAULT_BOARD_PROVIDER },

    // Auto-merge
    autoMerge: DEFAULT_AUTO_MERGE,
    autoMergeMethod: DEFAULT_AUTO_MERGE_METHOD,

    // Rate-limit fallback
    fallbackOnRateLimit: DEFAULT_FALLBACK_ON_RATE_LIMIT,
    claudeModel: DEFAULT_CLAUDE_MODEL,

    // QA process
    qa: { ...DEFAULT_QA },

    // Code audit
    audit: { ...DEFAULT_AUDIT },

    // Job providers
    jobProviders: { ...DEFAULT_JOB_PROVIDERS },

    // Global job queue
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
    // If file exists but can't be parsed, warn but don't fail
    console.warn(
      `Warning: Could not parse config file at ${configPath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
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
    typeof value === 'string' ? value : undefined;
  const readNumber = (value: unknown): number | undefined =>
    typeof value === 'number' && !Number.isNaN(value) ? value : undefined;
  const readBoolean = (value: unknown): boolean | undefined =>
    typeof value === 'boolean' ? value : undefined;
  const readStringArray = (value: unknown): string[] | undefined =>
    Array.isArray(value) && value.every((v) => typeof v === 'string')
      ? (value as string[])
      : undefined;
  const readObject = (value: unknown): Record<string, unknown> | undefined =>
    value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;

  const cron = readObject(rawConfig.cron);
  const review = readObject(rawConfig.review);
  const logging = readObject(rawConfig.logging);

  normalized.defaultBranch = readString(rawConfig.defaultBranch);
  normalized.prdDir = readString(rawConfig.prdDir) ?? readString(rawConfig.prdDirectory);
  normalized.maxRuntime = readNumber(rawConfig.maxRuntime);
  normalized.reviewerMaxRuntime = readNumber(rawConfig.reviewerMaxRuntime);
  normalized.branchPrefix = readString(rawConfig.branchPrefix);
  normalized.branchPatterns =
    readStringArray(rawConfig.branchPatterns) ?? readStringArray(review?.branchPatterns);
  normalized.minReviewScore = readNumber(rawConfig.minReviewScore) ?? readNumber(review?.minScore);
  normalized.maxLogSize = readNumber(rawConfig.maxLogSize) ?? readNumber(logging?.maxLogSize);
  normalized.cronSchedule =
    readString(rawConfig.cronSchedule) ?? readString(cron?.executorSchedule);
  normalized.reviewerSchedule =
    readString(rawConfig.reviewerSchedule) ?? readString(cron?.reviewerSchedule);
  const rawScheduleBundleId = rawConfig.scheduleBundleId;
  if (typeof rawScheduleBundleId === 'string') {
    const trimmed = rawScheduleBundleId.trim();
    normalized.scheduleBundleId = trimmed.length > 0 ? trimmed : null;
  } else if (rawScheduleBundleId === null) {
    normalized.scheduleBundleId = null;
  }
  normalized.cronScheduleOffset = readNumber(rawConfig.cronScheduleOffset);
  normalized.maxRetries = readNumber(rawConfig.maxRetries);
  normalized.reviewerMaxRetries = readNumber(rawConfig.reviewerMaxRetries);
  normalized.reviewerRetryDelay = readNumber(rawConfig.reviewerRetryDelay);
  normalized.provider = validateProvider(String(rawConfig.provider ?? '')) ?? undefined;
  normalized.executorEnabled = readBoolean(rawConfig.executorEnabled);
  normalized.reviewerEnabled = readBoolean(rawConfig.reviewerEnabled);

  // providerLabel: optional human-friendly display name for the provider
  const providerLabelVal = readString(rawConfig.providerLabel);
  if (providerLabelVal) {
    normalized.providerLabel = providerLabelVal;
  }

  // providerEnv: Record<string, string> of extra env vars for the provider CLI
  const rawProviderEnv = readObject(rawConfig.providerEnv);
  if (rawProviderEnv) {
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(rawProviderEnv)) {
      if (typeof value === 'string') {
        env[key] = value;
      }
    }
    if (Object.keys(env).length > 0) {
      normalized.providerEnv = env;
    }
  }

  // Notifications
  const rawNotifications = readObject(rawConfig.notifications);
  if (rawNotifications) {
    const rawWebhooks = Array.isArray(rawNotifications.webhooks) ? rawNotifications.webhooks : [];
    const webhooks: IWebhookConfig[] = [];
    for (const wh of rawWebhooks) {
      if (wh && typeof wh === 'object' && 'type' in wh && 'events' in wh) {
        const whObj = wh as Record<string, unknown>;
        webhooks.push({
          type: String(whObj.type) as WebhookType,
          url: typeof whObj.url === 'string' ? whObj.url : undefined,
          botToken: typeof whObj.botToken === 'string' ? whObj.botToken : undefined,
          chatId: typeof whObj.chatId === 'string' ? whObj.chatId : undefined,
          events: Array.isArray(whObj.events)
            ? (whObj.events.filter((e: unknown) => typeof e === 'string') as NotificationEvent[])
            : [],
        });
      }
    }
    normalized.notifications = { webhooks };
  }

  // PRD priority
  normalized.prdPriority = readStringArray(rawConfig.prdPriority);

  // Roadmap Scanner
  const rawRoadmapScanner = readObject(rawConfig.roadmapScanner);
  if (rawRoadmapScanner) {
    const priorityModeRaw = readString(rawRoadmapScanner.priorityMode);
    const priorityMode =
      priorityModeRaw === 'roadmap-first' || priorityModeRaw === 'audit-first'
        ? priorityModeRaw
        : DEFAULT_ROADMAP_SCANNER.priorityMode;

    const issueColumnRaw = readString(rawRoadmapScanner.issueColumn);
    const issueColumn =
      issueColumnRaw === 'Draft' || issueColumnRaw === 'Ready'
        ? issueColumnRaw
        : DEFAULT_ROADMAP_SCANNER.issueColumn;

    const roadmapScanner: IRoadmapScannerConfig = {
      enabled: readBoolean(rawRoadmapScanner.enabled) ?? DEFAULT_ROADMAP_SCANNER.enabled,
      roadmapPath: readString(rawRoadmapScanner.roadmapPath) ?? DEFAULT_ROADMAP_SCANNER.roadmapPath,
      autoScanInterval:
        readNumber(rawRoadmapScanner.autoScanInterval) ?? DEFAULT_ROADMAP_SCANNER.autoScanInterval,
      slicerSchedule:
        readString(rawRoadmapScanner.slicerSchedule) ?? DEFAULT_ROADMAP_SCANNER.slicerSchedule,
      slicerMaxRuntime:
        readNumber(rawRoadmapScanner.slicerMaxRuntime) ?? DEFAULT_ROADMAP_SCANNER.slicerMaxRuntime,
      priorityMode,
      issueColumn,
    };
    // Validate autoScanInterval has minimum of 30 seconds
    if (roadmapScanner.autoScanInterval < 30) {
      roadmapScanner.autoScanInterval = 30;
    }
    normalized.roadmapScanner = roadmapScanner;
  }

  // Templates Directory
  normalized.templatesDir = readString(rawConfig.templatesDir);

  // Board Provider
  const rawBoardProvider = readObject(rawConfig.boardProvider);
  if (rawBoardProvider) {
    const bp: IBoardProviderConfig = {
      enabled: readBoolean(rawBoardProvider.enabled) ?? DEFAULT_BOARD_PROVIDER.enabled,
      provider:
        (readString(rawBoardProvider.provider) as BoardProviderType) ??
        DEFAULT_BOARD_PROVIDER.provider,
    };
    if (typeof rawBoardProvider.projectNumber === 'number') {
      bp.projectNumber = rawBoardProvider.projectNumber;
    }
    if (typeof rawBoardProvider.repo === 'string') {
      bp.repo = rawBoardProvider.repo;
    }
    normalized.boardProvider = bp;
  }

  // Rate-limit fallback
  normalized.fallbackOnRateLimit = readBoolean(rawConfig.fallbackOnRateLimit);
  const claudeModelRaw = readString(rawConfig.claudeModel);
  if (claudeModelRaw && VALID_CLAUDE_MODELS.includes(claudeModelRaw as ClaudeModel)) {
    normalized.claudeModel = claudeModelRaw as ClaudeModel;
  }

  // Auto-Merge
  normalized.autoMerge = readBoolean(rawConfig.autoMerge);
  const mergeMethod = readString(rawConfig.autoMergeMethod);
  if (mergeMethod && VALID_MERGE_METHODS.includes(mergeMethod as MergeMethod)) {
    normalized.autoMergeMethod = mergeMethod as MergeMethod;
  }

  // QA Configuration
  const rawQa = readObject(rawConfig.qa);
  if (rawQa) {
    const artifactsValue = readString(rawQa.artifacts);
    const artifacts =
      artifactsValue && ['screenshot', 'video', 'both'].includes(artifactsValue)
        ? (artifactsValue as QaArtifacts)
        : DEFAULT_QA.artifacts;

    const qa: IQaConfig = {
      enabled: readBoolean(rawQa.enabled) ?? DEFAULT_QA.enabled,
      schedule: readString(rawQa.schedule) ?? DEFAULT_QA.schedule,
      maxRuntime: readNumber(rawQa.maxRuntime) ?? DEFAULT_QA.maxRuntime,
      branchPatterns: readStringArray(rawQa.branchPatterns) ?? DEFAULT_QA.branchPatterns,
      artifacts,
      skipLabel: readString(rawQa.skipLabel) ?? DEFAULT_QA.skipLabel,
      autoInstallPlaywright:
        readBoolean(rawQa.autoInstallPlaywright) ?? DEFAULT_QA.autoInstallPlaywright,
    };
    normalized.qa = qa;
  }

  // Audit Configuration
  const rawAudit = readObject(rawConfig.audit);
  if (rawAudit) {
    const audit: IAuditConfig = {
      enabled: readBoolean(rawAudit.enabled) ?? DEFAULT_AUDIT.enabled,
      schedule: readString(rawAudit.schedule) ?? DEFAULT_AUDIT.schedule,
      maxRuntime: readNumber(rawAudit.maxRuntime) ?? DEFAULT_AUDIT.maxRuntime,
    };
    normalized.audit = audit;
  }

  // Job Providers Configuration
  const rawJobProviders = readObject(rawConfig.jobProviders);
  if (rawJobProviders) {
    const jobProviders: IJobProviders = {};
    for (const jobType of VALID_JOB_TYPES) {
      const providerValue = readString(rawJobProviders[jobType]);
      if (providerValue && VALID_PROVIDERS.includes(providerValue as Provider)) {
        (jobProviders as Record<JobType, Provider | undefined>)[jobType as JobType] =
          providerValue as Provider;
      }
    }
    if (Object.keys(jobProviders).length > 0) {
      normalized.jobProviders = jobProviders;
    }
  }

  // Queue Configuration
  const rawQueue = readObject(rawConfig.queue);
  if (rawQueue) {
    const queue: IQueueConfig = {
      enabled: readBoolean(rawQueue.enabled) ?? DEFAULT_QUEUE.enabled,
      maxConcurrency: readNumber(rawQueue.maxConcurrency) ?? DEFAULT_QUEUE.maxConcurrency,
      maxWaitTime: readNumber(rawQueue.maxWaitTime) ?? DEFAULT_QUEUE.maxWaitTime,
      priority: { ...DEFAULT_QUEUE.priority },
    };

    // Load custom priorities if provided
    const rawPriority = readObject(rawQueue.priority);
    if (rawPriority) {
      for (const jobType of VALID_JOB_TYPES) {
        const prio = readNumber(rawPriority[jobType]);
        if (prio !== undefined) {
          queue.priority[jobType] = prio;
        }
      }
    }

    // Clamp values to valid ranges
    queue.maxConcurrency = Math.max(1, Math.min(10, queue.maxConcurrency));
    queue.maxWaitTime = Math.max(300, Math.min(14400, queue.maxWaitTime));

    normalized.queue = queue;
  }

  return normalized;
}

/**
 * Parse a boolean string value
 */
function parseBoolean(value: string): boolean | null {
  const normalized = value.toLowerCase().trim();
  if (normalized === 'true' || normalized === '1') {
    return true;
  }
  if (normalized === 'false' || normalized === '0') {
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
 * Validate and return a merge method value
 */
function validateMergeMethod(value: string): MergeMethod | null {
  if (VALID_MERGE_METHODS.includes(value as MergeMethod)) {
    return value as MergeMethod;
  }
  return null;
}

/**
 * Normalize retry count to a safe positive integer.
 */
function sanitizeMaxRetries(value: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  const normalized = Math.floor(value);
  return normalized >= 1 ? normalized : fallback;
}

/**
 * Clamp reviewerMaxRetries to valid range (0-10).
 */
function sanitizeReviewerMaxRetries(value: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  const normalized = Math.floor(value);
  if (normalized < 0) return 0;
  if (normalized > 10) return 10;
  return normalized;
}

/**
 * Clamp reviewerRetryDelay to valid range (0-300 seconds).
 */
function sanitizeReviewerRetryDelay(value: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  const normalized = Math.floor(value);
  if (normalized < 0) return 0;
  if (normalized > 300) return 300;
  return normalized;
}

/**
 * Apply a partial config layer onto a base, skipping undefined values.
 * Nested objects are shallow-merged; arrays are spread (not concatenated).
 */
function mergeConfigLayer(base: INightWatchConfig, layer: Partial<INightWatchConfig>): void {
  for (const _key of Object.keys(layer) as Array<keyof INightWatchConfig>) {
    const value = layer[_key];
    if (value === undefined) continue;

    // Keys needing special (shallow) merge semantics with base
    if (
      _key === 'providerEnv' ||
      _key === 'boardProvider' ||
      _key === 'qa' ||
      _key === 'audit' ||
      _key === 'queue'
    ) {
      (base as unknown as Record<string, unknown>)[_key] = {
        ...(base[_key] as object),
        ...(value as object),
      };
    } else if (_key === 'roadmapScanner' || _key === 'jobProviders') {
      // These replace entirely (no base merge)
      (base as unknown as Record<string, unknown>)[_key] = { ...(value as object) };
    } else if (_key === 'branchPatterns' || _key === 'prdPriority') {
      (base as unknown as Record<string, unknown>)[_key] = [...(value as string[])];
    } else {
      (base as unknown as Record<string, unknown>)[_key] = value;
    }
  }
}

/**
 * Deep merge configuration objects
 * Environment values take precedence over file values
 */
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
      envConfig.branchPatterns = process.env.NW_BRANCH_PATTERNS.split(',').map((s) => s.trim());
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

  if (process.env.NW_CRON_SCHEDULE_OFFSET) {
    const offset = parseInt(process.env.NW_CRON_SCHEDULE_OFFSET, 10);
    if (!isNaN(offset) && offset >= 0 && offset <= 59) {
      envConfig.cronScheduleOffset = offset;
    }
  }

  if (process.env.NW_MAX_RETRIES) {
    const retries = parseInt(process.env.NW_MAX_RETRIES, 10);
    if (!isNaN(retries) && retries >= 1) {
      envConfig.maxRetries = retries;
    }
  }

  // NW_REVIEWER_MAX_RETRIES environment variable
  if (process.env.NW_REVIEWER_MAX_RETRIES !== undefined) {
    const reviewerMaxRetries = parseInt(process.env.NW_REVIEWER_MAX_RETRIES, 10);
    if (!isNaN(reviewerMaxRetries) && reviewerMaxRetries >= 0) {
      envConfig.reviewerMaxRetries = reviewerMaxRetries;
    }
  }

  // NW_REVIEWER_RETRY_DELAY environment variable
  if (process.env.NW_REVIEWER_RETRY_DELAY !== undefined) {
    const reviewerRetryDelay = parseInt(process.env.NW_REVIEWER_RETRY_DELAY, 10);
    if (!isNaN(reviewerRetryDelay) && reviewerRetryDelay >= 0) {
      envConfig.reviewerRetryDelay = reviewerRetryDelay;
    }
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

  // NW_EXECUTOR_ENABLED environment variable
  if (process.env.NW_EXECUTOR_ENABLED) {
    const executorEnabled = parseBoolean(process.env.NW_EXECUTOR_ENABLED);
    if (executorEnabled !== null) {
      envConfig.executorEnabled = executorEnabled;
    }
  }

  // NW_NOTIFICATIONS environment variable (JSON)
  if (process.env.NW_NOTIFICATIONS) {
    try {
      const parsed = JSON.parse(process.env.NW_NOTIFICATIONS);
      if (parsed && typeof parsed === 'object') {
        envConfig.notifications = parsed as INotificationConfig;
      }
    } catch {
      // Invalid JSON, ignore
    }
  }

  // NW_ROADMAP_SCANNER_ENABLED environment variable
  if (process.env.NW_ROADMAP_SCANNER_ENABLED) {
    const roadmapScannerEnabled = parseBoolean(process.env.NW_ROADMAP_SCANNER_ENABLED);
    if (roadmapScannerEnabled !== null) {
      envConfig.roadmapScanner = {
        ...DEFAULT_ROADMAP_SCANNER,
        enabled: roadmapScannerEnabled,
      };
    }
  }

  // NW_TEMPLATES_DIR environment variable
  if (process.env.NW_TEMPLATES_DIR) {
    envConfig.templatesDir = process.env.NW_TEMPLATES_DIR;
  }

  // NW_SLICER_SCHEDULE environment variable
  if (process.env.NW_SLICER_SCHEDULE) {
    envConfig.roadmapScanner = {
      ...(envConfig.roadmapScanner ?? DEFAULT_ROADMAP_SCANNER),
      slicerSchedule: process.env.NW_SLICER_SCHEDULE,
    };
  }

  // NW_SLICER_MAX_RUNTIME environment variable
  if (process.env.NW_SLICER_MAX_RUNTIME) {
    const slicerMaxRuntime = parseInt(process.env.NW_SLICER_MAX_RUNTIME, 10);
    if (!isNaN(slicerMaxRuntime) && slicerMaxRuntime > 0) {
      envConfig.roadmapScanner = {
        ...(envConfig.roadmapScanner ?? DEFAULT_ROADMAP_SCANNER),
        slicerMaxRuntime,
      };
    }
  }

  // NW_PLANNER_ISSUE_COLUMN environment variable
  if (process.env.NW_PLANNER_ISSUE_COLUMN) {
    const issueColumn = process.env.NW_PLANNER_ISSUE_COLUMN;
    if (issueColumn === 'Draft' || issueColumn === 'Ready') {
      envConfig.roadmapScanner = {
        ...(envConfig.roadmapScanner ?? DEFAULT_ROADMAP_SCANNER),
        issueColumn,
      };
    }
  }

  // NW_PLANNER_PRIORITY_MODE environment variable
  if (process.env.NW_PLANNER_PRIORITY_MODE) {
    const priorityMode = process.env.NW_PLANNER_PRIORITY_MODE;
    if (priorityMode === 'roadmap-first' || priorityMode === 'audit-first') {
      envConfig.roadmapScanner = {
        ...(envConfig.roadmapScanner ?? DEFAULT_ROADMAP_SCANNER),
        priorityMode,
      };
    }
  }

  // NW_AUTO_MERGE environment variable
  if (process.env.NW_AUTO_MERGE) {
    const autoMerge = parseBoolean(process.env.NW_AUTO_MERGE);
    if (autoMerge !== null) {
      envConfig.autoMerge = autoMerge;
    }
  }

  // NW_AUTO_MERGE_METHOD environment variable
  if (process.env.NW_AUTO_MERGE_METHOD) {
    const mergeMethod = validateMergeMethod(process.env.NW_AUTO_MERGE_METHOD);
    if (mergeMethod !== null) {
      envConfig.autoMergeMethod = mergeMethod;
    }
  }

  // NW_FALLBACK_ON_RATE_LIMIT environment variable
  if (process.env.NW_FALLBACK_ON_RATE_LIMIT) {
    const fallback = parseBoolean(process.env.NW_FALLBACK_ON_RATE_LIMIT);
    if (fallback !== null) {
      envConfig.fallbackOnRateLimit = fallback;
    }
  }

  // NW_CLAUDE_MODEL environment variable
  if (process.env.NW_CLAUDE_MODEL) {
    const model = process.env.NW_CLAUDE_MODEL;
    if (VALID_CLAUDE_MODELS.includes(model as ClaudeModel)) {
      envConfig.claudeModel = model as ClaudeModel;
    }
  }

  const qaBaseConfig = (): IQaConfig => envConfig.qa ?? fileConfig?.qa ?? DEFAULT_QA;

  // QA configuration from env vars
  if (process.env.NW_QA_ENABLED) {
    const qaEnabled = parseBoolean(process.env.NW_QA_ENABLED);
    if (qaEnabled !== null) {
      envConfig.qa = {
        ...qaBaseConfig(),
        enabled: qaEnabled,
      };
    }
  }

  if (process.env.NW_QA_SCHEDULE) {
    envConfig.qa = {
      ...qaBaseConfig(),
      schedule: process.env.NW_QA_SCHEDULE,
    };
  }

  if (process.env.NW_QA_MAX_RUNTIME) {
    const qaMaxRuntime = parseInt(process.env.NW_QA_MAX_RUNTIME, 10);
    if (!isNaN(qaMaxRuntime) && qaMaxRuntime > 0) {
      envConfig.qa = {
        ...qaBaseConfig(),
        maxRuntime: qaMaxRuntime,
      };
    }
  }

  if (process.env.NW_QA_ARTIFACTS) {
    const artifacts = process.env.NW_QA_ARTIFACTS;
    if (['screenshot', 'video', 'both'].includes(artifacts)) {
      envConfig.qa = {
        ...qaBaseConfig(),
        artifacts: artifacts as QaArtifacts,
      };
    }
  }

  if (process.env.NW_QA_SKIP_LABEL) {
    envConfig.qa = {
      ...qaBaseConfig(),
      skipLabel: process.env.NW_QA_SKIP_LABEL,
    };
  }

  if (process.env.NW_QA_AUTO_INSTALL_PLAYWRIGHT) {
    const autoInstall = parseBoolean(process.env.NW_QA_AUTO_INSTALL_PLAYWRIGHT);
    if (autoInstall !== null) {
      envConfig.qa = {
        ...qaBaseConfig(),
        autoInstallPlaywright: autoInstall,
      };
    }
  }

  if (process.env.NW_QA_BRANCH_PATTERNS) {
    const patterns = process.env.NW_QA_BRANCH_PATTERNS.split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (patterns.length > 0) {
      envConfig.qa = {
        ...qaBaseConfig(),
        branchPatterns: patterns,
      };
    }
  }

  // Audit configuration from env vars
  const auditBaseConfig = (): IAuditConfig => envConfig.audit ?? fileConfig?.audit ?? DEFAULT_AUDIT;

  if (process.env.NW_AUDIT_ENABLED) {
    const auditEnabled = parseBoolean(process.env.NW_AUDIT_ENABLED);
    if (auditEnabled !== null) {
      envConfig.audit = { ...auditBaseConfig(), enabled: auditEnabled };
    }
  }

  if (process.env.NW_AUDIT_SCHEDULE) {
    envConfig.audit = { ...auditBaseConfig(), schedule: process.env.NW_AUDIT_SCHEDULE };
  }

  if (process.env.NW_AUDIT_MAX_RUNTIME) {
    const auditMaxRuntime = parseInt(process.env.NW_AUDIT_MAX_RUNTIME, 10);
    if (!isNaN(auditMaxRuntime) && auditMaxRuntime > 0) {
      envConfig.audit = { ...auditBaseConfig(), maxRuntime: auditMaxRuntime };
    }
  }

  // Job Providers configuration from env vars (NW_JOB_PROVIDER_<JOB_TYPE>)
  const jobProvidersEnv: IJobProviders = {};
  for (const jobType of VALID_JOB_TYPES) {
    const envKey = `NW_JOB_PROVIDER_${jobType.toUpperCase()}`;
    const envValue = process.env[envKey];
    if (envValue) {
      const provider = validateProvider(envValue);
      if (provider !== null) {
        (jobProvidersEnv as Record<JobType, Provider | undefined>)[jobType as JobType] = provider;
      }
    }
  }
  if (Object.keys(jobProvidersEnv).length > 0) {
    envConfig.jobProviders = jobProvidersEnv;
  }

  // Queue configuration from env vars
  const queueBaseConfig = (): IQueueConfig => envConfig.queue ?? fileConfig?.queue ?? DEFAULT_QUEUE;

  if (process.env.NW_QUEUE_ENABLED) {
    const queueEnabled = parseBoolean(process.env.NW_QUEUE_ENABLED);
    if (queueEnabled !== null) {
      envConfig.queue = { ...queueBaseConfig(), enabled: queueEnabled };
    }
  }

  if (process.env.NW_QUEUE_MAX_CONCURRENCY) {
    const maxConcurrency = parseInt(process.env.NW_QUEUE_MAX_CONCURRENCY, 10);
    if (!isNaN(maxConcurrency) && maxConcurrency >= 1) {
      envConfig.queue = { ...queueBaseConfig(), maxConcurrency: Math.min(10, maxConcurrency) };
    }
  }

  if (process.env.NW_QUEUE_MAX_WAIT_TIME) {
    const maxWaitTime = parseInt(process.env.NW_QUEUE_MAX_WAIT_TIME, 10);
    if (!isNaN(maxWaitTime) && maxWaitTime >= 300) {
      envConfig.queue = { ...queueBaseConfig(), maxWaitTime: Math.min(14400, maxWaitTime) };
    }
  }

  // NW_QUEUE_PRIORITY_JSON for custom priorities
  if (process.env.NW_QUEUE_PRIORITY_JSON) {
    try {
      const parsed = JSON.parse(process.env.NW_QUEUE_PRIORITY_JSON);
      if (parsed && typeof parsed === 'object') {
        const priority: Record<string, number> = { ...queueBaseConfig().priority };
        for (const jobType of VALID_JOB_TYPES) {
          if (typeof parsed[jobType] === 'number') {
            priority[jobType] = parsed[jobType];
          }
        }
        envConfig.queue = { ...queueBaseConfig(), priority };
      }
    } catch {
      // Invalid JSON, ignore
    }
  }

  // Merge all configs
  return mergeConfigs(defaults, fileConfig, envConfig);
}

/**
 * Resolve the provider for a specific job type.
 * Precedence: CLI override (--provider flag) > job-specific provider > global provider.
 *
 * @param config - The Night Watch configuration
 * @param jobType - The job type to resolve the provider for
 * @returns The provider to use for the specified job type
 */
export function resolveJobProvider(config: INightWatchConfig, jobType: JobType): Provider {
  // CLI override takes highest precedence (set via --provider flag)
  if (config._cliProviderOverride) {
    return config._cliProviderOverride;
  }
  // Job-specific provider takes second precedence
  if (config.jobProviders[jobType]) {
    return config.jobProviders[jobType]!;
  }
  // Fall back to global provider
  return config.provider;
}

/**
 * Get the path to a bundled script
 * This returns the path to a script in the package's scripts/ directory
 */
export function getScriptPath(scriptName: string): string {
  const configFilePath = fileURLToPath(import.meta.url);
  const baseDir = path.dirname(configFilePath);

  const candidates = [
    // Bundled package: import.meta.url = dist/cli.js → scripts are co-located in dist/scripts/.
    // This is the canonical location for npm-installed packages (global, npx, volta, etc.).
    path.resolve(baseDir, 'scripts', scriptName),
    // CLI binary (process.argv[1] = packages/cli/bin/night-watch.mjs) -> ../scripts
    // Resolve symlinks so that a global install (bin symlink in ~/.nvm/…/bin/) correctly
    // maps back to the package directory instead of the nvm bin directory.
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
    // Dev (tsx): src/config.ts -> ../scripts
    path.resolve(baseDir, '..', 'scripts', scriptName),
    // Built package (dist/src/config.js): ../../scripts
    path.resolve(baseDir, '..', '..', 'scripts', scriptName),
    // Fallback for unusual launch contexts
    path.resolve(process.cwd(), 'scripts', scriptName),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  // Return primary candidate for backward compatibility even if missing.
  return candidates[0];
}
