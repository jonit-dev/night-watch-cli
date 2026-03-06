/**
 * Queue routes: /api/queue/status, /api/queue/clear, /api/queue/analytics
 */

import { Request, Response, Router } from 'express';

import {
  clearQueue,
  getJobRunsAnalytics,
  getQueueStatus,
} from '@night-watch/core';
import type { JobType } from '@night-watch/core';

export interface IQueueRoutesDeps {
  getConfig: () => import('@night-watch/core').INightWatchConfig;
}

/**
 * Global (non-project-scoped) queue routes for use in global server mode.
 * Mounts status and analytics endpoints that read from the shared state DB.
 * Clear is not exposed globally to avoid accidental cross-project damage.
 */
export function createGlobalQueueRoutes(): Router {
  const router = Router();

  // GET /api/queue/status - global queue status (enabled always true in global mode)
  router.get('/status', async (_req: Request, res: Response): Promise<void> => {
    try {
      const status = getQueueStatus();
      res.json({ ...status, enabled: true });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  // GET /api/queue/analytics?window=24
  router.get('/analytics', async (req: Request, res: Response): Promise<void> => {
    try {
      const windowParam = req.query.window;
      const windowHours =
        windowParam !== undefined ? parseInt(String(windowParam), 10) : 24;
      const safeWindow = Number.isFinite(windowHours) && windowHours > 0 ? windowHours : 24;
      const analytics = getJobRunsAnalytics(safeWindow);
      res.json(analytics);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  return router;
}

export function createQueueRoutes(deps: IQueueRoutesDeps): Router {
  const { getConfig } = deps;
  const router = Router();

  // GET /api/queue/status - Get queue status (enriched with provider bucket and pressure data)
  router.get('/status', async (_req: Request, res: Response): Promise<void> => {
    try {
      const config = getConfig();
      const status = getQueueStatus();
      res.json({ ...status, enabled: config.queue.enabled });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  // POST /api/queue/clear - Clear pending jobs from queue
  router.post('/clear', async (req: Request, res: Response): Promise<void> => {
    try {
      const body = req.body as { type?: string } | undefined;
      const type = body?.type;
      const count = clearQueue(type as JobType | undefined);
      res.json({ cleared: count });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  // GET /api/queue/analytics?window=24 - Get job run telemetry analytics
  router.get('/analytics', async (req: Request, res: Response): Promise<void> => {
    try {
      const windowParam = req.query.window;
      const windowHours =
        windowParam !== undefined ? parseInt(String(windowParam), 10) : 24;
      const safeWindow = Number.isFinite(windowHours) && windowHours > 0 ? windowHours : 24;
      const analytics = getJobRunsAnalytics(safeWindow);
      res.json(analytics);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  return router;
}
