/**
 * Config normalization: converts raw JSON config to the INightWatchConfig shape.
 * Handles legacy nested keys and validates field values.
 */

import { BoardProviderType, IBoardProviderConfig } from './board/types.js';
import {
  ClaudeModel,
  IJobProviders,
  INightWatchConfig,
  IProviderBucketConfig,
  IProviderPreset,
  IQueueConfig,
  IRoadmapScannerConfig,
  IWebhookConfig,
  JobType,
  MergeMethod,
  NotificationEvent,
  Provider,
  QueueMode,
  WebhookType,
} from './types.js';
import {
  DEFAULT_BOARD_PROVIDER,
  DEFAULT_QUEUE,
  DEFAULT_ROADMAP_SCANNER,
  VALID_CLAUDE_MODELS,
  VALID_JOB_TYPES,
  VALID_MERGE_METHODS,
} from './constants.js';
import { getJobDef, normalizeJobConfig } from './jobs/job-registry.js';

export function validateProvider(value: string): Provider | null {
  // Accept any non-empty string as a preset ID (backward compat with 'claude'/'codex')
  const trimmed = value.trim();
  if (trimmed.length > 0) {
    return trimmed;
  }
  return null;
}

/**
 * Convert legacy/nested config formats to the flat INightWatchConfig shape.
 * Flat keys take precedence over nested aliases when both are present.
 */
export function normalizeConfig(rawConfig: Record<string, unknown>): Partial<INightWatchConfig> {
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
  normalized.sessionMaxRuntime = readNumber(rawConfig.sessionMaxRuntime);
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
  normalized.schedulingPriority = readNumber(rawConfig.schedulingPriority);
  normalized.maxRetries = readNumber(rawConfig.maxRetries);
  normalized.reviewerMaxRetries = readNumber(rawConfig.reviewerMaxRetries);
  normalized.reviewerRetryDelay = readNumber(rawConfig.reviewerRetryDelay);
  normalized.reviewerMaxPrsPerRun = readNumber(rawConfig.reviewerMaxPrsPerRun);
  normalized.provider = validateProvider(String(rawConfig.provider ?? '')) ?? undefined;
  normalized.executorEnabled = readBoolean(rawConfig.executorEnabled);
  normalized.reviewerEnabled = readBoolean(rawConfig.reviewerEnabled);

  const providerLabelVal = readString(rawConfig.providerLabel);
  if (providerLabelVal) {
    normalized.providerLabel = providerLabelVal;
  }

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

  // Parse provider presets
  const rawProviderPresets = readObject(rawConfig.providerPresets);
  if (rawProviderPresets) {
    const presets: Record<string, IProviderPreset> = {};
    for (const [presetId, presetVal] of Object.entries(rawProviderPresets)) {
      const rawPreset = readObject(presetVal);
      if (rawPreset) {
        const name = readString(rawPreset.name);
        const command = readString(rawPreset.command);
        // name and command are required
        if (name && command) {
          const preset: IProviderPreset = {
            name,
            command,
            subcommand: readString(rawPreset.subcommand),
            promptFlag: readString(rawPreset.promptFlag),
            autoApproveFlag: readString(rawPreset.autoApproveFlag),
            workdirFlag: readString(rawPreset.workdirFlag),
            modelFlag: readString(rawPreset.modelFlag),
            model: readString(rawPreset.model),
          };
          // Parse envVars if present
          const rawEnvVars = readObject(rawPreset.envVars);
          if (rawEnvVars) {
            const envVars: Record<string, string> = {};
            for (const [envKey, envVal] of Object.entries(rawEnvVars)) {
              if (typeof envVal === 'string') {
                envVars[envKey] = envVal;
              }
            }
            if (Object.keys(envVars).length > 0) {
              preset.envVars = envVars;
            }
          }
          presets[presetId] = preset;
        }
      }
    }
    if (Object.keys(presets).length > 0) {
      normalized.providerPresets = presets;
    }
  }

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

  normalized.prdPriority = readStringArray(rawConfig.prdPriority);

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
    if (roadmapScanner.autoScanInterval < 30) {
      roadmapScanner.autoScanInterval = 30;
    }
    normalized.roadmapScanner = roadmapScanner;
  }

  normalized.templatesDir = readString(rawConfig.templatesDir);

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

  normalized.fallbackOnRateLimit = readBoolean(rawConfig.fallbackOnRateLimit);
  const primaryFallbackModelRaw =
    readString(rawConfig.primaryFallbackModel) ?? readString(rawConfig.claudeModel);
  if (
    primaryFallbackModelRaw &&
    VALID_CLAUDE_MODELS.includes(primaryFallbackModelRaw as ClaudeModel)
  ) {
    normalized.primaryFallbackModel = primaryFallbackModelRaw as ClaudeModel;
    normalized.claudeModel = primaryFallbackModelRaw as ClaudeModel;
  }
  const secondaryFallbackModelRaw = readString(rawConfig.secondaryFallbackModel);
  if (
    secondaryFallbackModelRaw &&
    VALID_CLAUDE_MODELS.includes(secondaryFallbackModelRaw as ClaudeModel)
  ) {
    normalized.secondaryFallbackModel = secondaryFallbackModelRaw as ClaudeModel;
  }
  normalized.primaryFallbackPreset = readString(rawConfig.primaryFallbackPreset);
  normalized.secondaryFallbackPreset = readString(rawConfig.secondaryFallbackPreset);

  normalized.autoMerge = readBoolean(rawConfig.autoMerge);
  const mergeMethod = readString(rawConfig.autoMergeMethod);
  if (mergeMethod && VALID_MERGE_METHODS.includes(mergeMethod as MergeMethod)) {
    normalized.autoMergeMethod = mergeMethod as MergeMethod;
  }

  // Registry-driven normalization for nested job configs (qa, audit, analytics)
  // Executor/reviewer use flat top-level fields; slicer lives in roadmapScanner block above
  for (const jobId of ['qa', 'audit', 'analytics'] as const) {
    const jobDef = getJobDef(jobId);
    if (!jobDef) continue;
    const rawJob = readObject(rawConfig[jobId]);
    if (rawJob) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (normalized as any)[jobId] = normalizeJobConfig(rawJob, jobDef);
    }
  }

  const rawJobProviders = readObject(rawConfig.jobProviders);
  if (rawJobProviders) {
    const jobProviders: IJobProviders = {};
    for (const jobType of VALID_JOB_TYPES) {
      const providerValue = readString(rawJobProviders[jobType]);
      // Accept any non-empty string as a preset ID
      if (providerValue && providerValue.trim().length > 0) {
        (jobProviders as Record<JobType, string | undefined>)[jobType as JobType] =
          providerValue.trim();
      }
    }
    if (Object.keys(jobProviders).length > 0) {
      normalized.jobProviders = jobProviders;
    }
  }

  const rawQueue = readObject(rawConfig.queue);
  if (rawQueue) {
    const rawMode = readString(rawQueue.mode);
    const mode: QueueMode =
      rawMode === 'conservative' || rawMode === 'provider-aware' ? rawMode : DEFAULT_QUEUE.mode;

    const queue: IQueueConfig = {
      enabled: readBoolean(rawQueue.enabled) ?? DEFAULT_QUEUE.enabled,
      mode,
      maxConcurrency: DEFAULT_QUEUE.maxConcurrency,
      maxWaitTime: readNumber(rawQueue.maxWaitTime) ?? DEFAULT_QUEUE.maxWaitTime,
      priority: { ...DEFAULT_QUEUE.priority },
      providerBuckets: {},
    };

    const rawPriority = readObject(rawQueue.priority);
    if (rawPriority) {
      for (const jobType of VALID_JOB_TYPES) {
        const prio = readNumber(rawPriority[jobType]);
        if (prio !== undefined) {
          queue.priority[jobType] = prio;
        }
      }
    }

    const rawProviderBuckets = readObject(rawQueue.providerBuckets);
    if (rawProviderBuckets) {
      for (const [bucketKey, bucketVal] of Object.entries(rawProviderBuckets)) {
        const rawBucket = readObject(bucketVal);
        if (rawBucket) {
          const maxConcurrency = readNumber(rawBucket.maxConcurrency);
          if (maxConcurrency !== undefined) {
            const bucketConfig: IProviderBucketConfig = { maxConcurrency };
            queue.providerBuckets[bucketKey] = bucketConfig;
          }
        }
      }
    }

    queue.maxConcurrency = DEFAULT_QUEUE.maxConcurrency;
    queue.maxWaitTime = Math.max(300, Math.min(14400, queue.maxWaitTime));
    normalized.queue = queue;
  }

  if (normalized.schedulingPriority !== undefined) {
    normalized.schedulingPriority = Math.max(1, Math.min(5, normalized.schedulingPriority));
  }

  return normalized;
}
