/**
 * Roadmap routes: /api/roadmap/*
 */

import * as path from 'path';

import { Request, Response, Router } from 'express';

import {
  INightWatchConfig,
  getRoadmapStatus,
  loadConfig,
  loadRoadmapState,
  saveConfig,
  scanRoadmap,
} from '@night-watch/core';

// ==================== Context interface ====================

interface IRoadmapRouteContext {
  getConfig: (req: Request) => INightWatchConfig;
  getProjectDir: (req: Request) => string;
  /**
   * Called after a successful toggle so callers can update their cached config
   * reference. In global mode this is a no-op because there is no in-memory
   * config cache — the config is reloaded from disk on each request.
   */
  afterToggle: (req: Request) => void;
  pathPrefix: string; // '' for single-project, 'roadmap/' for global
}

// ==================== Shared handler factory ====================

function createRoadmapRouteHandlers(ctx: IRoadmapRouteContext): Router {
  const router = Router({ mergeParams: true });
  const p = ctx.pathPrefix;

  router.get(`/${p}`, (req: Request, res: Response): void => {
    try {
      const config = ctx.getConfig(req);
      const projectDir = ctx.getProjectDir(req);
      const status = getRoadmapStatus(projectDir, config);
      const prdDir = path.join(projectDir, config.prdDir);
      const state = loadRoadmapState(prdDir);
      res.json({
        ...status,
        lastScan: state.lastScan || null,
        autoScanInterval: config.roadmapScanner.autoScanInterval,
      });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.post(`/${p}scan`, async (req: Request, res: Response): Promise<void> => {
    try {
      const config = ctx.getConfig(req);
      const projectDir = ctx.getProjectDir(req);
      if (!config.roadmapScanner.enabled) {
        res.status(409).json({ error: 'Roadmap scanner is disabled' });
        return;
      }

      const result = await scanRoadmap(projectDir, config);
      res.json(result);
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  router.put(`/${p}toggle`, (req: Request, res: Response): void => {
    try {
      const { enabled } = req.body as { enabled: unknown };

      if (typeof enabled !== 'boolean') {
        res.status(400).json({ error: 'enabled must be a boolean' });
        return;
      }

      const projectDir = ctx.getProjectDir(req);
      const currentConfig = ctx.getConfig(req);
      const result = saveConfig(projectDir, {
        roadmapScanner: {
          ...currentConfig.roadmapScanner,
          enabled,
        },
      });

      if (!result.success) {
        res.status(500).json({ error: result.error });
        return;
      }

      ctx.afterToggle(req);
      res.json(loadConfig(projectDir));
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  return router;
}

// ==================== Public exports ====================

export interface IRoadmapRoutesDeps {
  projectDir: string;
  getConfig: () => INightWatchConfig;
  reloadConfig: () => void;
}

/**
 * Single-project roadmap routes (mounted at /api/roadmap).
 */
export function createRoadmapRoutes(deps: IRoadmapRoutesDeps): Router {
  return createRoadmapRouteHandlers({
    getConfig: () => deps.getConfig(),
    getProjectDir: () => deps.projectDir,
    afterToggle: () => deps.reloadConfig(),
    pathPrefix: '',
  });
}

/**
 * Project-scoped roadmap routes for global mode (mounted at /api/projects/:id).
 * Reads config and projectDir from req set by project-resolver middleware.
 * No in-memory config cache — afterToggle is a no-op.
 */
export function createProjectRoadmapRoutes(): Router {
  return createRoadmapRouteHandlers({
    getConfig: (req) => req.projectConfig!,
    getProjectDir: (req) => req.projectDir!,
    afterToggle: () => {
      /* no-op: global mode has no in-memory config cache */
    },
    pathPrefix: 'roadmap/',
  });
}
