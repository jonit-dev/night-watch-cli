/**
 * Config routes: GET/PUT /api/config
 */

import { Request, Response, Router } from 'express';

import { validateWebhook } from '@night-watch/core/utils/webhook-validator.js';
import { loadConfig } from '@night-watch/core/config.js';
import { INightWatchConfig } from '@night-watch/core/types.js';
import { saveConfig } from '@night-watch/core/utils/config-writer.js';

/**
 * Validates config changes and returns an error string if invalid, null if valid.
 */
function validateConfigChanges(
  changes: Partial<INightWatchConfig>,
): string | null {
  if (typeof changes !== 'object' || changes === null) {
    return 'Invalid request body';
  }

  if (changes.provider !== undefined) {
    const validProviders = ['claude', 'codex'];
    if (!validProviders.includes(changes.provider)) {
      return `Invalid provider. Must be one of: ${validProviders.join(', ')}`;
    }
  }

  if (
    changes.reviewerEnabled !== undefined &&
    typeof changes.reviewerEnabled !== 'boolean'
  ) {
    return 'reviewerEnabled must be a boolean';
  }

  if (
    changes.maxRuntime !== undefined &&
    (typeof changes.maxRuntime !== 'number' || changes.maxRuntime < 60)
  ) {
    return 'maxRuntime must be a number >= 60';
  }

  if (
    changes.reviewerMaxRuntime !== undefined &&
    (typeof changes.reviewerMaxRuntime !== 'number' ||
      changes.reviewerMaxRuntime < 60)
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

  if (
    changes.cronSchedule !== undefined &&
    (typeof changes.cronSchedule !== 'string' ||
      changes.cronSchedule.trim().length === 0)
  ) {
    return 'cronSchedule must be a non-empty string';
  }

  if (
    changes.reviewerSchedule !== undefined &&
    (typeof changes.reviewerSchedule !== 'string' ||
      changes.reviewerSchedule.trim().length === 0)
  ) {
    return 'reviewerSchedule must be a non-empty string';
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
      res.json(getConfig());
    } catch (error) {
      res
        .status(500)
        .json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.put('/', (req: Request, res: Response): void => {
    try {
      const changes = req.body as Partial<INightWatchConfig>;
      const validationError = validateConfigChanges(changes);
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
      res
        .status(500)
        .json({ error: error instanceof Error ? error.message : String(error) });
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
      res
        .status(500)
        .json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.put('/config', (req: Request, res: Response): void => {
    const projectDir = req.projectDir!;

    try {
      const changes = req.body as Partial<INightWatchConfig>;
      const validationError = validateConfigChanges(changes);
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
      res
        .status(500)
        .json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  return router;
}
