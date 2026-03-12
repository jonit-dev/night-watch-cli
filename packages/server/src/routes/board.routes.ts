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

// ==================== Constants ====================

const ERROR_BOARD_NOT_CONFIGURED = 'Board not configured';

// ==================== Context interface ====================

interface IBoardRouteContext {
  getConfig: (req: Request) => INightWatchConfig;
  getProjectDir: (req: Request) => string;
  pathPrefix: string; // '' for single-project, 'board/' for global (routes prefixed)
}

// ==================== Shared handler factory ====================

function createBoardRouteHandlers(ctx: IBoardRouteContext): Router {
  const router = Router({ mergeParams: true });
  const p = ctx.pathPrefix;

  router.get(`/${p}status`, async (req: Request, res: Response): Promise<void> => {
    try {
      const config = ctx.getConfig(req);
      const projectDir = ctx.getProjectDir(req);
      const provider = getBoardProvider(config, projectDir);
      if (!provider) {
        res.status(404).json({ error: ERROR_BOARD_NOT_CONFIGURED });
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

  router.get(`/${p}issues`, async (req: Request, res: Response): Promise<void> => {
    try {
      const config = ctx.getConfig(req);
      const projectDir = ctx.getProjectDir(req);
      const provider = getBoardProvider(config, projectDir);
      if (!provider) {
        res.status(404).json({ error: ERROR_BOARD_NOT_CONFIGURED });
        return;
      }
      const issues = await provider.getAllIssues();
      res.json(issues);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.post(`/${p}issues`, async (req: Request, res: Response): Promise<void> => {
    try {
      const config = ctx.getConfig(req);
      const projectDir = ctx.getProjectDir(req);
      const provider = getBoardProvider(config, projectDir);
      if (!provider) {
        res.status(404).json({ error: ERROR_BOARD_NOT_CONFIGURED });
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

  router.patch(`/${p}issues/:number/move`, async (req: Request, res: Response): Promise<void> => {
    try {
      const config = ctx.getConfig(req);
      const projectDir = ctx.getProjectDir(req);
      const provider = getBoardProvider(config, projectDir);
      if (!provider) {
        res.status(404).json({ error: ERROR_BOARD_NOT_CONFIGURED });
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

  router.post(`/${p}issues/:number/comment`, async (req: Request, res: Response): Promise<void> => {
    try {
      const config = ctx.getConfig(req);
      const projectDir = ctx.getProjectDir(req);
      const provider = getBoardProvider(config, projectDir);
      if (!provider) {
        res.status(404).json({ error: ERROR_BOARD_NOT_CONFIGURED });
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

  router.delete(`/${p}issues/:number`, async (req: Request, res: Response): Promise<void> => {
    try {
      const config = ctx.getConfig(req);
      const projectDir = ctx.getProjectDir(req);
      const provider = getBoardProvider(config, projectDir);
      if (!provider) {
        res.status(404).json({ error: ERROR_BOARD_NOT_CONFIGURED });
        return;
      }
      const issueNumber = parseInt(req.params.number as string, 10);
      if (isNaN(issueNumber)) {
        res.status(400).json({ error: 'Invalid issue number' });
        return;
      }
      await provider.closeIssue(issueNumber);
      await provider.moveIssue(issueNumber, 'Done');
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

// ==================== Public exports ====================

export interface IBoardRoutesDeps {
  projectDir: string;
  getConfig: () => INightWatchConfig;
}

/**
 * Single-project board routes (mounted at /api/board).
 */
export function createBoardRoutes(deps: IBoardRoutesDeps): Router {
  return createBoardRouteHandlers({
    getConfig: () => deps.getConfig(),
    getProjectDir: () => deps.projectDir,
    pathPrefix: '',
  });
}

/**
 * Project-scoped board routes for global mode (mounted at /api/projects/:id).
 * Reads config and projectDir from req set by project-resolver middleware.
 */
export function createProjectBoardRoutes(): Router {
  return createBoardRouteHandlers({
    getConfig: (req) => req.projectConfig!,
    getProjectDir: (req) => req.projectDir!,
    pathPrefix: 'board/',
  });
}
