/**
 * Queue routes: /api/queue/status, /api/queue/clear
 */

import { Request, Response, Router } from 'express';

import {
  clearQueue,
  getQueueStatus,
} from '@night-watch/core';
import type { JobType } from '@night-watch/core';

export interface IQueueRoutesDeps {
  getConfig: () => import('@night-watch/core').INightWatchConfig;
}

export function createQueueRoutes(deps: IQueueRoutesDeps): Router {
  const { getConfig } = deps;
  const router = Router();

  // GET /api/queue/status - Get queue status
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

  return router;
}
