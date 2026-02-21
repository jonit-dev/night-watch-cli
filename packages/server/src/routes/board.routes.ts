/**
 * Board routes: /api/board/*
 */

import { Request, Response, Router } from 'express';

import { BOARD_COLUMNS, BoardColumnName, INightWatchConfig } from '@night-watch/core';
import {
  getBoardProvider,
  getCachedBoardData,
  invalidateBoardCache,
  setCachedBoardData,
} from '../helpers.js';

export interface IBoardRoutesDeps {
  projectDir: string;
  getConfig: () => INightWatchConfig;
}

export function createBoardRoutes(deps: IBoardRoutesDeps): Router {
  const { projectDir, getConfig } = deps;
  const router = Router();

  router.get('/status', async (_req: Request, res: Response): Promise<void> => {
    try {
      const config = getConfig();
      const provider = getBoardProvider(config, projectDir);
      if (!provider) {
        res.status(404).json({ error: 'Board not configured' });
        return;
      }

      const cached = getCachedBoardData(projectDir);
      if (cached) {
        res.json(cached);
        return;
      }

      const issues = await provider.getAllIssues();
      const columns: Record<BoardColumnName, typeof issues> = {
        Draft: [],
        Ready: [],
        'In Progress': [],
        Review: [],
        Done: [],
      };
      for (const issue of issues) {
        const col = issue.column ?? 'Draft';
        columns[col].push(issue);
      }

      const result = { enabled: true, columns };
      setCachedBoardData(projectDir, result);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.get('/issues', async (_req: Request, res: Response): Promise<void> => {
    try {
      const config = getConfig();
      const provider = getBoardProvider(config, projectDir);
      if (!provider) {
        res.status(404).json({ error: 'Board not configured' });
        return;
      }
      const issues = await provider.getAllIssues();
      res.json(issues);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.post('/issues', async (req: Request, res: Response): Promise<void> => {
    try {
      const config = getConfig();
      const provider = getBoardProvider(config, projectDir);
      if (!provider) {
        res.status(404).json({ error: 'Board not configured' });
        return;
      }
      const { title, body, column } = req.body as {
        title?: string;
        body?: string;
        column?: BoardColumnName;
      };
      if (!title || typeof title !== 'string' || title.trim().length === 0) {
        res.status(400).json({ error: 'title is required' });
        return;
      }
      if (column && !BOARD_COLUMNS.includes(column)) {
        res.status(400).json({
          error: `Invalid column. Must be one of: ${BOARD_COLUMNS.join(', ')}`,
        });
        return;
      }
      const issue = await provider.createIssue({
        title: title.trim(),
        body: body ?? '',
        column,
      });
      invalidateBoardCache(projectDir);
      res.status(201).json(issue);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.patch('/issues/:number/move', async (req: Request, res: Response): Promise<void> => {
    try {
      const config = getConfig();
      const provider = getBoardProvider(config, projectDir);
      if (!provider) {
        res.status(404).json({ error: 'Board not configured' });
        return;
      }
      const issueNumber = parseInt(req.params.number as string, 10);
      if (isNaN(issueNumber)) {
        res.status(400).json({ error: 'Invalid issue number' });
        return;
      }
      const { column } = req.body as { column?: BoardColumnName };
      if (!column || !BOARD_COLUMNS.includes(column)) {
        res.status(400).json({
          error: `Invalid column. Must be one of: ${BOARD_COLUMNS.join(', ')}`,
        });
        return;
      }
      await provider.moveIssue(issueNumber, column);
      invalidateBoardCache(projectDir);
      res.json({ moved: true });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  router.post('/issues/:number/comment', async (req: Request, res: Response): Promise<void> => {
    try {
      const config = getConfig();
      const provider = getBoardProvider(config, projectDir);
      if (!provider) {
        res.status(404).json({ error: 'Board not configured' });
        return;
      }
      const issueNumber = parseInt(req.params.number as string, 10);
      if (isNaN(issueNumber)) {
        res.status(400).json({ error: 'Invalid issue number' });
        return;
      }
      const { body } = req.body as { body?: string };
      if (!body || typeof body !== 'string' || body.trim().length === 0) {
        res.status(400).json({ error: 'body is required' });
        return;
      }
      await provider.commentOnIssue(issueNumber, body);
      invalidateBoardCache(projectDir);
      res.json({ commented: true });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  router.delete('/issues/:number', async (req: Request, res: Response): Promise<void> => {
    try {
      const config = getConfig();
      const provider = getBoardProvider(config, projectDir);
      if (!provider) {
        res.status(404).json({ error: 'Board not configured' });
        return;
      }
      const issueNumber = parseInt(req.params.number as string, 10);
      if (isNaN(issueNumber)) {
        res.status(400).json({ error: 'Invalid issue number' });
        return;
      }
      await provider.closeIssue(issueNumber);
      invalidateBoardCache(projectDir);
      res.json({ closed: true });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  return router;
}

/**
 * Project-scoped board routes for global mode.
 */
export function createProjectBoardRoutes(): Router {
  const router = Router({ mergeParams: true });

  router.get('/board/status', async (req: Request, res: Response): Promise<void> => {
    try {
      const config = req.projectConfig!;
      const projectDir = req.projectDir!;
      const provider = getBoardProvider(config, projectDir);
      if (!provider) {
        res.status(404).json({ error: 'Board not configured' });
        return;
      }

      const cached = getCachedBoardData(projectDir);
      if (cached) {
        res.json(cached);
        return;
      }

      const issues = await provider.getAllIssues();
      const columns: Record<BoardColumnName, typeof issues> = {
        Draft: [],
        Ready: [],
        'In Progress': [],
        Review: [],
        Done: [],
      };
      for (const issue of issues) {
        const col = issue.column ?? 'Draft';
        columns[col].push(issue);
      }

      const result = { enabled: true, columns };
      setCachedBoardData(projectDir, result);
      res.json(result);
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  router.get('/board/issues', async (_req: Request, res: Response): Promise<void> => {
    try {
      const config = _req.projectConfig!;
      const projectDir = _req.projectDir!;
      const provider = getBoardProvider(config, projectDir);
      if (!provider) {
        res.status(404).json({ error: 'Board not configured' });
        return;
      }
      const issues = await provider.getAllIssues();
      res.json(issues);
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  router.post('/board/issues', async (req: Request, res: Response): Promise<void> => {
    try {
      const config = req.projectConfig!;
      const projectDir = req.projectDir!;
      const provider = getBoardProvider(config, projectDir);
      if (!provider) {
        res.status(404).json({ error: 'Board not configured' });
        return;
      }
      const { title, body, column } = req.body as {
        title?: string;
        body?: string;
        column?: BoardColumnName;
      };
      if (!title || typeof title !== 'string' || title.trim().length === 0) {
        res.status(400).json({ error: 'title is required' });
        return;
      }
      if (column && !BOARD_COLUMNS.includes(column)) {
        res.status(400).json({
          error: `Invalid column. Must be one of: ${BOARD_COLUMNS.join(', ')}`,
        });
        return;
      }
      const issue = await provider.createIssue({
        title: title.trim(),
        body: body ?? '',
        column,
      });
      invalidateBoardCache(projectDir);
      res.status(201).json(issue);
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  router.patch('/board/issues/:number/move', async (req: Request, res: Response): Promise<void> => {
    try {
      const config = req.projectConfig!;
      const projectDir = req.projectDir!;
      const provider = getBoardProvider(config, projectDir);
      if (!provider) {
        res.status(404).json({ error: 'Board not configured' });
        return;
      }
      const issueNumber = parseInt(req.params.number as string, 10);
      if (isNaN(issueNumber)) {
        res.status(400).json({ error: 'Invalid issue number' });
        return;
      }
      const { column } = req.body as { column?: BoardColumnName };
      if (!column || !BOARD_COLUMNS.includes(column)) {
        res.status(400).json({
          error: `Invalid column. Must be one of: ${BOARD_COLUMNS.join(', ')}`,
        });
        return;
      }
      await provider.moveIssue(issueNumber, column);
      invalidateBoardCache(projectDir);
      res.json({ moved: true });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  router.post(
    '/board/issues/:number/comment',
    async (req: Request, res: Response): Promise<void> => {
      try {
        const config = req.projectConfig!;
        const projectDir = req.projectDir!;
        const provider = getBoardProvider(config, projectDir);
        if (!provider) {
          res.status(404).json({ error: 'Board not configured' });
          return;
        }
        const issueNumber = parseInt(req.params.number as string, 10);
        if (isNaN(issueNumber)) {
          res.status(400).json({ error: 'Invalid issue number' });
          return;
        }
        const { body } = req.body as { body?: string };
        if (!body || typeof body !== 'string' || body.trim().length === 0) {
          res.status(400).json({ error: 'body is required' });
          return;
        }
        await provider.commentOnIssue(issueNumber, body);
        invalidateBoardCache(projectDir);
        res.json({ commented: true });
      } catch (error) {
        res.status(500).json({
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  );

  router.delete('/board/issues/:number', async (req: Request, res: Response): Promise<void> => {
    try {
      const config = req.projectConfig!;
      const projectDir = req.projectDir!;
      const provider = getBoardProvider(config, projectDir);
      if (!provider) {
        res.status(404).json({ error: 'Board not configured' });
        return;
      }
      const issueNumber = parseInt(req.params.number as string, 10);
      if (isNaN(issueNumber)) {
        res.status(400).json({ error: 'Invalid issue number' });
        return;
      }
      await provider.closeIssue(issueNumber);
      invalidateBoardCache(projectDir);
      res.json({ closed: true });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  return router;
}
