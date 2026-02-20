/**
 * PRD routes: /api/prds, /api/prds/:name
 * @deprecated - endpoints removed; use GitHub Board instead (returns 410 Gone)
 */

import { Request, Response, Router } from 'express';

import { INightWatchConfig } from '@night-watch/core/types.js';

export interface IPrdRoutesDeps {
  projectDir: string;
  getConfig: () => INightWatchConfig;
}

export function createPrdRoutes(_deps: IPrdRoutesDeps): Router {
  const router = Router();

  // PRDs endpoint deprecated - use GitHub Board instead
  router.get('/', (_req: Request, res: Response): void => {
    res.status(410).json({ error: 'PRDs endpoint deprecated - use GitHub Board instead' });
  });

  router.get('/:name', (_req: Request, res: Response): void => {
    res.status(410).json({ error: 'PRDs endpoint deprecated - use GitHub Board instead' });
  });

  return router;
}

/**
 * Project-scoped PRD routes for global mode.
 * @deprecated - endpoints removed; use GitHub Board instead (returns 410 Gone)
 */
export function createProjectPrdRoutes(): Router {
  const router = Router({ mergeParams: true });

  // PRDs endpoint deprecated - use GitHub Board instead
  router.get('/prds', (_req: Request, res: Response): void => {
    res.status(410).json({ error: 'PRDs endpoint deprecated - use GitHub Board instead' });
  });

  router.get('/prds/:name', (_req: Request, res: Response): void => {
    res.status(410).json({ error: 'PRDs endpoint deprecated - use GitHub Board instead' });
  });

  return router;
}
