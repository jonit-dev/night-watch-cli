/**
 * Slack discussion routes: /api/discussions/*
 */

import { Request, Response, Router } from 'express';

import { getRepositories } from '@night-watch/core';

export interface IDiscussionRoutesDeps {
  projectDir: string;
}

export function createDiscussionRoutes(deps: IDiscussionRoutesDeps): Router {
  const { projectDir } = deps;
  const router = Router();

  router.get('/', (_req: Request, res: Response): void => {
    try {
      const repos = getRepositories();
      const discussions = repos.slackDiscussion.getActive(projectDir);
      res.json(discussions);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.get('/:id', (req: Request, res: Response): ReturnType<typeof res.json> => {
    try {
      const repos = getRepositories();
      const discussion = repos.slackDiscussion.getById(req.params.id as string);
      if (!discussion) return res.status(404).json({ error: 'Discussion not found' });
      return res.json(discussion);
    } catch (err) {
      return res.status(500).json({ error: (err as Error).message });
    }
  });

  return router;
}

/**
 * Project-scoped discussion routes for global mode.
 */
export function createProjectDiscussionRoutes(): Router {
  const router = Router({ mergeParams: true });

  router.get('/discussions', (req: Request, res: Response): void => {
    try {
      const repos = getRepositories();
      const discussions = repos.slackDiscussion.getActive(req.projectDir!);
      res.json(discussions);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.get('/discussions/:id', (req: Request, res: Response): ReturnType<typeof res.json> => {
    try {
      const repos = getRepositories();
      const discussion = repos.slackDiscussion.getById(req.params.id as string);
      if (!discussion) return res.status(404).json({ error: 'Discussion not found' });
      return res.json(discussion);
    } catch (err) {
      return res.status(500).json({ error: (err as Error).message });
    }
  });

  return router;
}
