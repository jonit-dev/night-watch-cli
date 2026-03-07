/**
 * Environment variable overrides for Night Watch config.
 * Reads NW_* env vars and builds a partial config overlay.
 */

import {
  ClaudeModel,
  IAnalyticsConfig,
  IAuditConfig,
  IJobProviders,
  INightWatchConfig,
  INotificationConfig,
  IQaConfig,
  IQueueConfig,
  IRoadmapScannerConfig,
  JobType,
  Provider,
  QaArtifacts,
} from './types.js';
import {
  DEFAULT_ANALYTICS,
  DEFAULT_AUDIT,
  DEFAULT_QA,
  DEFAULT_QUEUE,
  DEFAULT_ROADMAP_SCANNER,
  VALID_CLAUDE_MODELS,
  VALID_JOB_TYPES,
  VALID_MERGE_METHODS,
} from './constants.js';
import { validateProvider } from './config-normalize.js';

function parseBoolean(value: string): boolean | null {
  const v = value.toLowerCase().trim();
  if (v === 'true' || v === '1') return true;
  if (v === 'false' || v === '0') return false;
  return null;
}

function validateMergeMethod(value: string) {
  return VALID_MERGE_METHODS.includes(value as never) ? value : null;
}

function applyRoadmapEnv(base: IRoadmapScannerConfig): IRoadmapScannerConfig {
  return { ...base };
}

/**
 * Build a partial config overlay from NW_* environment variables.
 * Called by loadConfig; layered on top of file config.
 */
export function buildEnvOverrideConfig(
  fileConfig: Partial<INightWatchConfig> | null,
): Partial<INightWatchConfig> {
  const env: Partial<INightWatchConfig> = {};

  if (process.env.NW_DEFAULT_BRANCH) env.defaultBranch = process.env.NW_DEFAULT_BRANCH;
  if (process.env.NW_PRD_DIR) env.prdDir = process.env.NW_PRD_DIR;

  if (process.env.NW_MAX_RUNTIME) {
    const v = parseInt(process.env.NW_MAX_RUNTIME, 10);
    if (!isNaN(v)) env.maxRuntime = v;
  }
  if (process.env.NW_REVIEWER_MAX_RUNTIME) {
    const v = parseInt(process.env.NW_REVIEWER_MAX_RUNTIME, 10);
    if (!isNaN(v)) env.reviewerMaxRuntime = v;
  }
  if (process.env.NW_BRANCH_PREFIX) env.branchPrefix = process.env.NW_BRANCH_PREFIX;

  if (process.env.NW_BRANCH_PATTERNS) {
    try {
      env.branchPatterns = JSON.parse(process.env.NW_BRANCH_PATTERNS);
    } catch {
      env.branchPatterns = process.env.NW_BRANCH_PATTERNS.split(',').map((s) => s.trim());
    }
  }

  if (process.env.NW_MIN_REVIEW_SCORE) {
    const v = parseInt(process.env.NW_MIN_REVIEW_SCORE, 10);
    if (!isNaN(v)) env.minReviewScore = v;
  }
  if (process.env.NW_MAX_LOG_SIZE) {
    const v = parseInt(process.env.NW_MAX_LOG_SIZE, 10);
    if (!isNaN(v)) env.maxLogSize = v;
  }
  if (process.env.NW_CRON_SCHEDULE) env.cronSchedule = process.env.NW_CRON_SCHEDULE;
  if (process.env.NW_REVIEWER_SCHEDULE) env.reviewerSchedule = process.env.NW_REVIEWER_SCHEDULE;

  if (process.env.NW_CRON_SCHEDULE_OFFSET) {
    const v = parseInt(process.env.NW_CRON_SCHEDULE_OFFSET, 10);
    if (!isNaN(v) && v >= 0 && v <= 59) env.cronScheduleOffset = v;
  }
  if (process.env.NW_SCHEDULING_PRIORITY) {
    const v = parseInt(process.env.NW_SCHEDULING_PRIORITY, 10);
    if (!isNaN(v)) env.schedulingPriority = Math.max(1, Math.min(5, v));
  }
  if (process.env.NW_MAX_RETRIES) {
    const v = parseInt(process.env.NW_MAX_RETRIES, 10);
    if (!isNaN(v) && v >= 1) env.maxRetries = v;
  }
  if (process.env.NW_REVIEWER_MAX_RETRIES !== undefined) {
    const v = parseInt(process.env.NW_REVIEWER_MAX_RETRIES, 10);
    if (!isNaN(v) && v >= 0) env.reviewerMaxRetries = v;
  }
  if (process.env.NW_REVIEWER_RETRY_DELAY !== undefined) {
    const v = parseInt(process.env.NW_REVIEWER_RETRY_DELAY, 10);
    if (!isNaN(v) && v >= 0) env.reviewerRetryDelay = v;
  }
  if (process.env.NW_REVIEWER_MAX_PRS_PER_RUN !== undefined) {
    const v = parseInt(process.env.NW_REVIEWER_MAX_PRS_PER_RUN, 10);
    if (!isNaN(v) && v >= 0) env.reviewerMaxPrsPerRun = v;
  }

  if (process.env.NW_PROVIDER) {
    const p = validateProvider(process.env.NW_PROVIDER);
    if (p !== null) env.provider = p;
  }
  if (process.env.NW_REVIEWER_ENABLED) {
    const v = parseBoolean(process.env.NW_REVIEWER_ENABLED);
    if (v !== null) env.reviewerEnabled = v;
  }
  if (process.env.NW_EXECUTOR_ENABLED) {
    const v = parseBoolean(process.env.NW_EXECUTOR_ENABLED);
    if (v !== null) env.executorEnabled = v;
  }
  if (process.env.NW_NOTIFICATIONS) {
    try {
      const parsed = JSON.parse(process.env.NW_NOTIFICATIONS);
      if (parsed && typeof parsed === 'object') {
        env.notifications = parsed as INotificationConfig;
      }
    } catch {
      /* ignore */
    }
  }

  // Roadmap scanner env vars (mutated incrementally)
  const roadmapBase = (): IRoadmapScannerConfig =>
    applyRoadmapEnv(env.roadmapScanner ?? fileConfig?.roadmapScanner ?? DEFAULT_ROADMAP_SCANNER);

  if (process.env.NW_ROADMAP_SCANNER_ENABLED) {
    const v = parseBoolean(process.env.NW_ROADMAP_SCANNER_ENABLED);
    if (v !== null) env.roadmapScanner = { ...roadmapBase(), enabled: v };
  }
  if (process.env.NW_TEMPLATES_DIR) env.templatesDir = process.env.NW_TEMPLATES_DIR;
  if (process.env.NW_SLICER_SCHEDULE) {
    env.roadmapScanner = { ...roadmapBase(), slicerSchedule: process.env.NW_SLICER_SCHEDULE };
  }
  if (process.env.NW_SLICER_MAX_RUNTIME) {
    const v = parseInt(process.env.NW_SLICER_MAX_RUNTIME, 10);
    if (!isNaN(v) && v > 0) {
      env.roadmapScanner = { ...roadmapBase(), slicerMaxRuntime: v };
    }
  }
  if (process.env.NW_PLANNER_ISSUE_COLUMN) {
    const col = process.env.NW_PLANNER_ISSUE_COLUMN;
    if (col === 'Draft' || col === 'Ready') {
      env.roadmapScanner = { ...roadmapBase(), issueColumn: col };
    }
  }
  if (process.env.NW_PLANNER_PRIORITY_MODE) {
    const mode = process.env.NW_PLANNER_PRIORITY_MODE;
    if (mode === 'roadmap-first' || mode === 'audit-first') {
      env.roadmapScanner = { ...roadmapBase(), priorityMode: mode };
    }
  }

  if (process.env.NW_AUTO_MERGE) {
    const v = parseBoolean(process.env.NW_AUTO_MERGE);
    if (v !== null) env.autoMerge = v;
  }
  if (process.env.NW_AUTO_MERGE_METHOD) {
    const m = validateMergeMethod(process.env.NW_AUTO_MERGE_METHOD);
    if (m !== null) env.autoMergeMethod = m as never;
  }
  if (process.env.NW_FALLBACK_ON_RATE_LIMIT) {
    const v = parseBoolean(process.env.NW_FALLBACK_ON_RATE_LIMIT);
    if (v !== null) env.fallbackOnRateLimit = v;
  }
  if (process.env.NW_CLAUDE_PRIMARY_MODEL) {
    const model = process.env.NW_CLAUDE_PRIMARY_MODEL;
    if (VALID_CLAUDE_MODELS.includes(model as ClaudeModel)) {
      env.primaryFallbackModel = model as ClaudeModel;
      env.claudeModel = model as ClaudeModel;
    }
  }
  if (process.env.NW_CLAUDE_SECONDARY_MODEL) {
    const model = process.env.NW_CLAUDE_SECONDARY_MODEL;
    if (VALID_CLAUDE_MODELS.includes(model as ClaudeModel)) {
      env.secondaryFallbackModel = model as ClaudeModel;
    }
  }
  if (process.env.NW_CLAUDE_MODEL) {
    const model = process.env.NW_CLAUDE_MODEL;
    if (VALID_CLAUDE_MODELS.includes(model as ClaudeModel)) {
      env.primaryFallbackModel = model as ClaudeModel;
      env.claudeModel = model as ClaudeModel;
    }
  }

  // QA env vars
  const qaBase = (): IQaConfig => env.qa ?? fileConfig?.qa ?? DEFAULT_QA;

  if (process.env.NW_QA_ENABLED) {
    const v = parseBoolean(process.env.NW_QA_ENABLED);
    if (v !== null) env.qa = { ...qaBase(), enabled: v };
  }
  if (process.env.NW_QA_SCHEDULE) {
    env.qa = { ...qaBase(), schedule: process.env.NW_QA_SCHEDULE };
  }
  if (process.env.NW_QA_MAX_RUNTIME) {
    const v = parseInt(process.env.NW_QA_MAX_RUNTIME, 10);
    if (!isNaN(v) && v > 0) env.qa = { ...qaBase(), maxRuntime: v };
  }
  if (process.env.NW_QA_ARTIFACTS) {
    const a = process.env.NW_QA_ARTIFACTS;
    if (['screenshot', 'video', 'both'].includes(a)) {
      env.qa = { ...qaBase(), artifacts: a as QaArtifacts };
    }
  }
  if (process.env.NW_QA_SKIP_LABEL) {
    env.qa = { ...qaBase(), skipLabel: process.env.NW_QA_SKIP_LABEL };
  }
  if (process.env.NW_QA_AUTO_INSTALL_PLAYWRIGHT) {
    const v = parseBoolean(process.env.NW_QA_AUTO_INSTALL_PLAYWRIGHT);
    if (v !== null) env.qa = { ...qaBase(), autoInstallPlaywright: v };
  }
  if (process.env.NW_QA_BRANCH_PATTERNS) {
    const patterns = process.env.NW_QA_BRANCH_PATTERNS.split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (patterns.length > 0) env.qa = { ...qaBase(), branchPatterns: patterns };
  }

  // Audit env vars
  const auditBase = (): IAuditConfig => env.audit ?? fileConfig?.audit ?? DEFAULT_AUDIT;

  if (process.env.NW_AUDIT_ENABLED) {
    const v = parseBoolean(process.env.NW_AUDIT_ENABLED);
    if (v !== null) env.audit = { ...auditBase(), enabled: v };
  }
  if (process.env.NW_AUDIT_SCHEDULE) {
    env.audit = { ...auditBase(), schedule: process.env.NW_AUDIT_SCHEDULE };
  }
  if (process.env.NW_AUDIT_MAX_RUNTIME) {
    const v = parseInt(process.env.NW_AUDIT_MAX_RUNTIME, 10);
    if (!isNaN(v) && v > 0) env.audit = { ...auditBase(), maxRuntime: v };
  }

  // Analytics env vars
  const analyticsBase = (): IAnalyticsConfig =>
    env.analytics ?? fileConfig?.analytics ?? DEFAULT_ANALYTICS;

  if (process.env.NW_ANALYTICS_ENABLED) {
    const v = parseBoolean(process.env.NW_ANALYTICS_ENABLED);
    if (v !== null) env.analytics = { ...analyticsBase(), enabled: v };
  }
  if (process.env.NW_ANALYTICS_SCHEDULE) {
    env.analytics = { ...analyticsBase(), schedule: process.env.NW_ANALYTICS_SCHEDULE };
  }
  if (process.env.NW_ANALYTICS_MAX_RUNTIME) {
    const v = parseInt(process.env.NW_ANALYTICS_MAX_RUNTIME, 10);
    if (!isNaN(v) && v > 0) env.analytics = { ...analyticsBase(), maxRuntime: v };
  }
  if (process.env.NW_ANALYTICS_LOOKBACK_DAYS) {
    const v = parseInt(process.env.NW_ANALYTICS_LOOKBACK_DAYS, 10);
    if (!isNaN(v) && v > 0) env.analytics = { ...analyticsBase(), lookbackDays: v };
  }

  // Per-job provider overrides (NW_JOB_PROVIDER_<JOBTYPE>)
  const jobProvidersEnv: IJobProviders = {};
  for (const jobType of VALID_JOB_TYPES) {
    const val = process.env[`NW_JOB_PROVIDER_${jobType.toUpperCase()}`];
    if (val) {
      const p = validateProvider(val);
      if (p !== null) {
        (jobProvidersEnv as Record<JobType, Provider | undefined>)[jobType as JobType] = p;
      }
    }
  }
  if (Object.keys(jobProvidersEnv).length > 0) env.jobProviders = jobProvidersEnv;

  // Queue env vars
  const queueBase = (): IQueueConfig => env.queue ?? fileConfig?.queue ?? DEFAULT_QUEUE;

  if (process.env.NW_QUEUE_ENABLED) {
    const v = parseBoolean(process.env.NW_QUEUE_ENABLED);
    if (v !== null) env.queue = { ...queueBase(), enabled: v };
  }
  if (process.env.NW_QUEUE_MAX_CONCURRENCY) {
    env.queue = { ...queueBase(), maxConcurrency: DEFAULT_QUEUE.maxConcurrency };
  }
  if (process.env.NW_QUEUE_MAX_WAIT_TIME) {
    const v = parseInt(process.env.NW_QUEUE_MAX_WAIT_TIME, 10);
    if (!isNaN(v) && v >= 300) {
      env.queue = { ...queueBase(), maxWaitTime: Math.min(14400, v) };
    }
  }
  if (process.env.NW_QUEUE_PRIORITY_JSON) {
    try {
      const parsed = JSON.parse(process.env.NW_QUEUE_PRIORITY_JSON);
      if (parsed && typeof parsed === 'object') {
        const base = queueBase();
        const priority: Record<string, number> = { ...base.priority };
        for (const jobType of VALID_JOB_TYPES) {
          if (typeof parsed[jobType] === 'number') priority[jobType] = parsed[jobType];
        }
        env.queue = { ...base, priority };
      }
    } catch {
      /* ignore */
    }
  }

  return env;
}
