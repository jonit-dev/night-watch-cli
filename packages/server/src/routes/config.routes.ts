/**
 * Config routes: GET/PUT /api/config
 */

import { Request, Response, Router } from 'express';
import { CronExpressionParser } from 'cron-parser';

import {
  BUILT_IN_PRESET_IDS,
  INightWatchConfig,
  IProviderPreset,
  JobType,
  VALID_CLAUDE_MODELS,
  VALID_JOB_TYPES,
  loadConfig,
  saveConfig,
  validateWebhook,
} from '@night-watch/core';

function isValidCronExpression(value: string): boolean {
  try {
    CronExpressionParser.parse(value.trim());
    return true;
  } catch {
    return false;
  }
}

function validateCronField(fieldName: string, value: unknown): string | null {
  if (value === undefined) {
    return null;
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    return `${fieldName} must be a non-empty string`;
  }
  if (!isValidCronExpression(value)) {
    return `${fieldName} must be a valid cron expression`;
  }
  return null;
}

/**
 * Validates config changes and returns an error string if invalid, null if valid.
 * @param changes The config changes to validate
 * @param currentConfig Optional current config for delete protection checks
 */
function validateConfigChanges(
  changes: Partial<INightWatchConfig>,
  currentConfig?: INightWatchConfig | null,
): string | null {
  if (typeof changes !== 'object' || changes === null) {
    return 'Invalid request body';
  }

  // Provider validation: accept any non-empty string as preset ID
  // Actual existence check happens at resolution time via resolvePreset()
  if (changes.provider !== undefined) {
    if (typeof changes.provider !== 'string' || changes.provider.trim().length === 0) {
      return 'provider must be a non-empty string (preset ID)';
    }
  }

  if (changes.providerLabel !== undefined && typeof changes.providerLabel !== 'string') {
    return 'providerLabel must be a string';
  }

  if (changes.defaultBranch !== undefined && typeof changes.defaultBranch !== 'string') {
    return 'defaultBranch must be a string';
  }

  if (
    changes.branchPrefix !== undefined &&
    (typeof changes.branchPrefix !== 'string' || changes.branchPrefix.trim().length === 0)
  ) {
    return 'branchPrefix must be a non-empty string';
  }

  if (changes.reviewerEnabled !== undefined && typeof changes.reviewerEnabled !== 'boolean') {
    return 'reviewerEnabled must be a boolean';
  }

  if (changes.executorEnabled !== undefined && typeof changes.executorEnabled !== 'boolean') {
    return 'executorEnabled must be a boolean';
  }

  if (
    changes.maxRuntime !== undefined &&
    (typeof changes.maxRuntime !== 'number' || changes.maxRuntime < 60)
  ) {
    return 'maxRuntime must be a number >= 60';
  }

  if (
    changes.reviewerMaxRuntime !== undefined &&
    (typeof changes.reviewerMaxRuntime !== 'number' || changes.reviewerMaxRuntime < 60)
  ) {
    return 'reviewerMaxRuntime must be a number >= 60';
  }

  if (
    changes.minReviewScore !== undefined &&
    (typeof changes.minReviewScore !== 'number' ||
      changes.minReviewScore < 0 ||
      changes.minReviewScore > 100)
  ) {
    return 'minReviewScore must be a number between 0 and 100';
  }

  if (
    changes.maxLogSize !== undefined &&
    (typeof changes.maxLogSize !== 'number' || changes.maxLogSize < 0)
  ) {
    return 'maxLogSize must be a positive number';
  }

  if (
    changes.maxRetries !== undefined &&
    (typeof changes.maxRetries !== 'number' ||
      !Number.isInteger(changes.maxRetries) ||
      changes.maxRetries < 1)
  ) {
    return 'maxRetries must be an integer >= 1';
  }

  if (
    changes.reviewerMaxRetries !== undefined &&
    (typeof changes.reviewerMaxRetries !== 'number' ||
      !Number.isInteger(changes.reviewerMaxRetries) ||
      changes.reviewerMaxRetries < 0 ||
      changes.reviewerMaxRetries > 10)
  ) {
    return 'reviewerMaxRetries must be an integer between 0 and 10';
  }

  if (
    changes.reviewerRetryDelay !== undefined &&
    (typeof changes.reviewerRetryDelay !== 'number' ||
      !Number.isInteger(changes.reviewerRetryDelay) ||
      changes.reviewerRetryDelay < 0 ||
      changes.reviewerRetryDelay > 300)
  ) {
    return 'reviewerRetryDelay must be an integer between 0 and 300';
  }

  if (
    changes.branchPatterns !== undefined &&
    (!Array.isArray(changes.branchPatterns) ||
      !changes.branchPatterns.every((p) => typeof p === 'string'))
  ) {
    return 'branchPatterns must be an array of strings';
  }

  if (
    changes.prdPriority !== undefined &&
    (!Array.isArray(changes.prdPriority) ||
      !changes.prdPriority.every((p) => typeof p === 'string'))
  ) {
    return 'prdPriority must be an array of strings';
  }

  const rootCronFields: Array<[string, unknown]> = [
    ['cronSchedule', changes.cronSchedule],
    ['reviewerSchedule', changes.reviewerSchedule],
  ];
  for (const [fieldName, value] of rootCronFields) {
    const cronError = validateCronField(fieldName, value);
    if (cronError) {
      return cronError;
    }
  }

  if (
    changes.scheduleBundleId !== undefined &&
    changes.scheduleBundleId !== null &&
    (typeof changes.scheduleBundleId !== 'string' || changes.scheduleBundleId.trim().length === 0)
  ) {
    return 'scheduleBundleId must be a non-empty string or null';
  }

  if (changes.notifications?.webhooks !== undefined) {
    if (!Array.isArray(changes.notifications.webhooks)) {
      return 'notifications.webhooks must be an array';
    }

    for (const webhook of changes.notifications.webhooks) {
      const issues = validateWebhook(webhook);
      if (issues.length > 0) {
        return `Invalid webhook: ${issues.join(', ')}`;
      }
    }
  }

  if (changes.roadmapScanner !== undefined) {
    const rs = changes.roadmapScanner;
    if (typeof rs !== 'object' || rs === null) {
      return 'roadmapScanner must be an object';
    }

    if (rs.enabled !== undefined && typeof rs.enabled !== 'boolean') {
      return 'roadmapScanner.enabled must be a boolean';
    }

    if (
      rs.roadmapPath !== undefined &&
      (typeof rs.roadmapPath !== 'string' || rs.roadmapPath.trim().length === 0)
    ) {
      return 'roadmapScanner.roadmapPath must be a non-empty string';
    }

    if (
      rs.autoScanInterval !== undefined &&
      (typeof rs.autoScanInterval !== 'number' || rs.autoScanInterval < 30)
    ) {
      return 'roadmapScanner.autoScanInterval must be a number >= 30';
    }
    const slicerScheduleError = validateCronField(
      'roadmapScanner.slicerSchedule',
      rs.slicerSchedule,
    );
    if (slicerScheduleError) {
      return slicerScheduleError;
    }

    if (
      rs.slicerMaxRuntime !== undefined &&
      (typeof rs.slicerMaxRuntime !== 'number' || rs.slicerMaxRuntime < 60)
    ) {
      return 'roadmapScanner.slicerMaxRuntime must be a number >= 60';
    }

    if (
      rs.priorityMode !== undefined &&
      rs.priorityMode !== 'roadmap-first' &&
      rs.priorityMode !== 'audit-first'
    ) {
      return 'roadmapScanner.priorityMode must be one of: roadmap-first, audit-first';
    }

    if (rs.issueColumn !== undefined && rs.issueColumn !== 'Draft' && rs.issueColumn !== 'Ready') {
      return 'roadmapScanner.issueColumn must be one of: Draft, Ready';
    }
  }

  if (changes.providerEnv !== undefined) {
    if (typeof changes.providerEnv !== 'object' || changes.providerEnv === null) {
      return 'providerEnv must be an object';
    }

    for (const [key, value] of Object.entries(changes.providerEnv)) {
      if (key.trim().length === 0) {
        return 'providerEnv keys must be non-empty strings';
      }
      if (typeof value !== 'string') {
        return 'providerEnv values must be strings';
      }
    }
  }

  if (changes.autoMerge !== undefined && typeof changes.autoMerge !== 'boolean') {
    return 'autoMerge must be a boolean';
  }

  if (changes.autoMergeMethod !== undefined) {
    const validMethods = ['squash', 'merge', 'rebase'];
    if (!validMethods.includes(changes.autoMergeMethod)) {
      return `Invalid autoMergeMethod. Must be one of: ${validMethods.join(', ')}`;
    }
  }

  if (changes.jobProviders !== undefined) {
    if (typeof changes.jobProviders !== 'object' || changes.jobProviders === null) {
      return 'jobProviders must be an object';
    }

    for (const [jobType, provider] of Object.entries(changes.jobProviders)) {
      if (!VALID_JOB_TYPES.includes(jobType as JobType)) {
        return `Invalid job type in jobProviders: ${jobType}. Must be one of: ${VALID_JOB_TYPES.join(', ')}`;
      }

      if (
        provider !== null &&
        provider !== undefined &&
        (typeof provider !== 'string' || provider.trim().length === 0)
      ) {
        return `Invalid provider in jobProviders.${jobType}: ${provider}. Must be a non-empty string (preset ID)`;
      }
    }
  }

  // providerPresets validation
  if (changes.providerPresets !== undefined) {
    if (typeof changes.providerPresets !== 'object' || changes.providerPresets === null) {
      return 'providerPresets must be an object';
    }

    for (const [presetId, presetVal] of Object.entries(changes.providerPresets)) {
      // Validate preset ID
      if (typeof presetId !== 'string' || presetId.trim().length === 0) {
        return 'providerPresets keys must be non-empty strings';
      }

      // presetVal can be null/undefined to delete a preset (checked later for delete protection)
      if (presetVal === null || presetVal === undefined) {
        continue;
      }

      if (typeof presetVal !== 'object') {
        return `providerPresets.${presetId} must be an object`;
      }

      const preset = presetVal as Partial<IProviderPreset>;

      // name is required
      if (typeof preset.name !== 'string' || preset.name.trim().length === 0) {
        return `providerPresets.${presetId}.name must be a non-empty string`;
      }

      // command is required
      if (typeof preset.command !== 'string' || preset.command.trim().length === 0) {
        return `providerPresets.${presetId}.command must be a non-empty string`;
      }

      // envVars must be string-valued if present
      if (preset.envVars !== undefined) {
        if (typeof preset.envVars !== 'object' || preset.envVars === null) {
          return `providerPresets.${presetId}.envVars must be an object`;
        }
        for (const [envKey, envVal] of Object.entries(preset.envVars)) {
          if (typeof envVal !== 'string') {
            return `providerPresets.${presetId}.envVars.${envKey} must be a string`;
          }
        }
      }
    }
  }

  // prdDir validation
  if (
    changes.prdDir !== undefined &&
    (typeof changes.prdDir !== 'string' || changes.prdDir.trim().length === 0)
  ) {
    return 'prdDir must be a non-empty string';
  }

  // templatesDir validation
  if (
    changes.templatesDir !== undefined &&
    (typeof changes.templatesDir !== 'string' || changes.templatesDir.trim().length === 0)
  ) {
    return 'templatesDir must be a non-empty string';
  }

  // cronScheduleOffset validation
  if (
    changes.cronScheduleOffset !== undefined &&
    (typeof changes.cronScheduleOffset !== 'number' ||
      changes.cronScheduleOffset < 0 ||
      changes.cronScheduleOffset > 59)
  ) {
    return 'cronScheduleOffset must be a number between 0 and 59';
  }

  if (
    changes.schedulingPriority !== undefined &&
    (typeof changes.schedulingPriority !== 'number' ||
      !Number.isInteger(changes.schedulingPriority) ||
      changes.schedulingPriority < 1 ||
      changes.schedulingPriority > 5)
  ) {
    return 'schedulingPriority must be an integer between 1 and 5';
  }

  // fallbackOnRateLimit validation
  if (
    changes.fallbackOnRateLimit !== undefined &&
    typeof changes.fallbackOnRateLimit !== 'boolean'
  ) {
    return 'fallbackOnRateLimit must be a boolean';
  }

  if (changes.primaryFallbackPreset !== undefined && changes.primaryFallbackPreset !== null) {
    if (typeof changes.primaryFallbackPreset !== 'string' || changes.primaryFallbackPreset.trim().length === 0) {
      return 'primaryFallbackPreset must be a non-empty string (preset ID)';
    }
  }

  if (changes.secondaryFallbackPreset !== undefined && changes.secondaryFallbackPreset !== null) {
    if (typeof changes.secondaryFallbackPreset !== 'string' || changes.secondaryFallbackPreset.trim().length === 0) {
      return 'secondaryFallbackPreset must be a non-empty string (preset ID)';
    }
  }

  // claudeModel validation
  if (changes.claudeModel !== undefined && !VALID_CLAUDE_MODELS.includes(changes.claudeModel)) {
    return `Invalid claudeModel. Must be one of: ${VALID_CLAUDE_MODELS.join(', ')}`;
  }
  if (
    changes.primaryFallbackModel !== undefined &&
    !VALID_CLAUDE_MODELS.includes(changes.primaryFallbackModel)
  ) {
    return `Invalid primaryFallbackModel. Must be one of: ${VALID_CLAUDE_MODELS.join(', ')}`;
  }
  if (
    changes.secondaryFallbackModel !== undefined &&
    !VALID_CLAUDE_MODELS.includes(changes.secondaryFallbackModel)
  ) {
    return `Invalid secondaryFallbackModel. Must be one of: ${VALID_CLAUDE_MODELS.join(', ')}`;
  }

  // QA configuration validation
  if (changes.qa !== undefined) {
    if (typeof changes.qa !== 'object' || changes.qa === null) {
      return 'qa must be an object';
    }

    const qa = changes.qa;

    if (qa.enabled !== undefined && typeof qa.enabled !== 'boolean') {
      return 'qa.enabled must be a boolean';
    }

    const qaScheduleError = validateCronField('qa.schedule', qa.schedule);
    if (qaScheduleError) {
      return qaScheduleError;
    }

    if (qa.maxRuntime !== undefined && (typeof qa.maxRuntime !== 'number' || qa.maxRuntime < 60)) {
      return 'qa.maxRuntime must be a number >= 60';
    }

    if (qa.branchPatterns !== undefined) {
      if (
        !Array.isArray(qa.branchPatterns) ||
        !qa.branchPatterns.every((p) => typeof p === 'string')
      ) {
        return 'qa.branchPatterns must be an array of strings';
      }
    }

    if (qa.artifacts !== undefined) {
      const validArtifacts = ['screenshot', 'video', 'both'];
      if (!validArtifacts.includes(qa.artifacts)) {
        return `Invalid qa.artifacts. Must be one of: ${validArtifacts.join(', ')}`;
      }
    }

    if (qa.skipLabel !== undefined && typeof qa.skipLabel !== 'string') {
      return 'qa.skipLabel must be a string';
    }

    if (qa.autoInstallPlaywright !== undefined && typeof qa.autoInstallPlaywright !== 'boolean') {
      return 'qa.autoInstallPlaywright must be a boolean';
    }
  }

  // Audit configuration validation
  if (changes.audit !== undefined) {
    if (typeof changes.audit !== 'object' || changes.audit === null) {
      return 'audit must be an object';
    }

    const audit = changes.audit;

    if (audit.enabled !== undefined && typeof audit.enabled !== 'boolean') {
      return 'audit.enabled must be a boolean';
    }

    const auditScheduleError = validateCronField('audit.schedule', audit.schedule);
    if (auditScheduleError) {
      return auditScheduleError;
    }

    if (
      audit.maxRuntime !== undefined &&
      (typeof audit.maxRuntime !== 'number' || audit.maxRuntime < 60)
    ) {
      return 'audit.maxRuntime must be a number >= 60';
    }
  }

  if (changes.queue !== undefined) {
    if (typeof changes.queue !== 'object' || changes.queue === null) {
      return 'queue must be an object';
    }

    const queue = changes.queue;

    if (queue.enabled !== undefined && typeof queue.enabled !== 'boolean') {
      return 'queue.enabled must be a boolean';
    }

    if (
      queue.maxWaitTime !== undefined &&
      (typeof queue.maxWaitTime !== 'number' || queue.maxWaitTime < 300 || queue.maxWaitTime > 14400)
    ) {
      return 'queue.maxWaitTime must be a number between 300 and 14400';
    }

    if (queue.maxConcurrency !== undefined && queue.maxConcurrency !== 1) {
      return 'queue.maxConcurrency is currently fixed at 1';
    }

    if (queue.priority !== undefined) {
      if (typeof queue.priority !== 'object' || queue.priority === null) {
        return 'queue.priority must be an object';
      }

      const validQueueJobs: JobType[] = ['executor', 'reviewer', 'qa', 'audit', 'slicer'];
      for (const [jobType, value] of Object.entries(queue.priority)) {
        if (!validQueueJobs.includes(jobType as JobType)) {
          return `queue.priority contains invalid job type: ${jobType}`;
        }
        if (typeof value !== 'number' || Number.isNaN(value)) {
          return `queue.priority.${jobType} must be a number`;
        }
      }
    }
  }

  // boardProvider.enabled validation
  if (changes.boardProvider !== undefined) {
    if (typeof changes.boardProvider !== 'object' || changes.boardProvider === null) {
      return 'boardProvider must be an object';
    }

    if (
      changes.boardProvider.provider !== undefined &&
      !['github', 'jira', 'linear', 'local'].includes(changes.boardProvider.provider)
    ) {
      return 'boardProvider.provider must be one of: github, jira, linear, local';
    }

    if (
      changes.boardProvider.projectNumber !== undefined &&
      (typeof changes.boardProvider.projectNumber !== 'number' ||
        !Number.isInteger(changes.boardProvider.projectNumber) ||
        changes.boardProvider.projectNumber <= 0)
    ) {
      return 'boardProvider.projectNumber must be an integer > 0';
    }

    if (
      changes.boardProvider.repo !== undefined &&
      (typeof changes.boardProvider.repo !== 'string' ||
        changes.boardProvider.repo.trim().length === 0)
    ) {
      return 'boardProvider.repo must be a non-empty string';
    }

    if (
      changes.boardProvider.enabled !== undefined &&
      typeof changes.boardProvider.enabled !== 'boolean'
    ) {
      return 'boardProvider.enabled must be a boolean';
    }
  }

  // Delete protection: prevent deleting presets that are still in use
  if (changes.providerPresets !== undefined && currentConfig) {
    // Determine which preset IDs are being removed (explicitly set to null/undefined or missing from new set)
    const currentPresetIds = new Set(Object.keys(currentConfig.providerPresets || {}));
    const newPresetIds = new Set<string>();

    for (const [presetId, presetVal] of Object.entries(changes.providerPresets)) {
      if (presetVal !== null && presetVal !== undefined) {
        newPresetIds.add(presetId);
      }
    }

    // Also keep track of preset IDs from the current config that are NOT in changes.providerPresets
    // (those are being preserved, not deleted)
    for (const presetId of currentPresetIds) {
      if (!(presetId in changes.providerPresets)) {
        newPresetIds.add(presetId);
      }
    }

    // Find deleted preset IDs (were in current, not in new)
    const deletedPresetIds = [...currentPresetIds].filter((id) => !newPresetIds.has(id));

    if (deletedPresetIds.length > 0) {
      // Check if any deleted preset is still referenced
      const presetReferences: Array<{ presetId: string; references: string[] }> = [];

      for (const deletedId of deletedPresetIds) {
        const references: string[] = [];

        // Check global provider
        const effectiveProvider = changes.provider ?? currentConfig.provider;
        if (effectiveProvider === deletedId) {
          references.push('provider (global)');
        }

        // Check jobProviders
        const effectiveJobProviders = {
          ...currentConfig.jobProviders,
          ...(changes.jobProviders || {}),
        };
        for (const [jobType, provider] of Object.entries(effectiveJobProviders)) {
          if (provider === deletedId) {
            references.push(`jobProviders.${jobType}`);
          }
        }

        if (references.length > 0) {
          presetReferences.push({ presetId: deletedId, references });
        }
      }

      if (presetReferences.length > 0) {
        const details = presetReferences
          .map(({ presetId, references }) => `"${presetId}" is used by: ${references.join(', ')}`)
          .join('; ');
        return `Cannot delete preset(s) that are still in use. ${details}`;
      }
    }
  }

  return null;
}

export interface IConfigRoutesDeps {
  projectDir: string;
  getConfig: () => INightWatchConfig;
  reloadConfig: () => void;
}

export function createConfigRoutes(deps: IConfigRoutesDeps): Router {
  const { projectDir, getConfig, reloadConfig } = deps;
  const router = Router();

  router.get('/', (_req: Request, res: Response): void => {
    try {
      reloadConfig();
      res.json(getConfig());
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.put('/', (req: Request, res: Response): void => {
    try {
      const changes = req.body as Partial<INightWatchConfig>;
      const validationError = validateConfigChanges(changes, getConfig());
      if (validationError) {
        res.status(400).json({ error: validationError });
        return;
      }

      const result = saveConfig(projectDir, changes);
      if (!result.success) {
        res.status(500).json({ error: result.error });
        return;
      }

      reloadConfig();
      res.json(getConfig());
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  return router;
}

/**
 * Project-scoped config routes for global mode.
 */
export function createProjectConfigRoutes(): Router {
  const router = Router({ mergeParams: true });

  router.get('/config', (req: Request, res: Response): void => {
    try {
      res.json(req.projectConfig!);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.put('/config', (req: Request, res: Response): void => {
    const projectDir = req.projectDir!;

    try {
      const changes = req.body as Partial<INightWatchConfig>;
      const validationError = validateConfigChanges(changes, req.projectConfig);
      if (validationError) {
        res.status(400).json({ error: validationError });
        return;
      }

      const result = saveConfig(projectDir, changes);
      if (!result.success) {
        res.status(500).json({ error: result.error });
        return;
      }

      res.json(loadConfig(projectDir));
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  return router;
}
