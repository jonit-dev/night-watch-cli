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

export interface IRoadmapRoutesDeps {
  projectDir: string;
  getConfig: () => INightWatchConfig;
  reloadConfig: () => void;
}

export function createRoadmapRoutes(deps: IRoadmapRoutesDeps): Router {
  const { projectDir, getConfig, reloadConfig } = deps;
  const router = Router();

  router.get('/', (_req: Request, res: Response): void => {
    try {
      const config = getConfig();
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

  router.post('/scan', async (_req: Request, res: Response): Promise<void> => {
    try {
      const config = getConfig();
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

  router.put('/toggle', (req: Request, res: Response): void => {
    try {
      const { enabled } = req.body as { enabled: unknown };

      if (typeof enabled !== 'boolean') {
        res.status(400).json({ error: 'enabled must be a boolean' });
        return;
      }

      const currentConfig = getConfig();
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

      reloadConfig();
      res.json(getConfig());
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  return router;
}

/**
 * Project-scoped roadmap routes for global mode.
 */
export function createProjectRoadmapRoutes(): Router {
  const router = Router({ mergeParams: true });

  router.get('/roadmap', (req: Request, res: Response): void => {
    try {
      const config = req.projectConfig!;
      const projectDir = req.projectDir!;
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

  router.post('/roadmap/scan', async (req: Request, res: Response): Promise<void> => {
    try {
      const config = req.projectConfig!;
      const projectDir = req.projectDir!;
      if (!config.roadmapScanner.enabled) {
        res.status(409).json({ error: 'Roadmap scanner is disabled' });
        return;
      }

      const result = await scanRoadmap(projectDir, config);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.put('/roadmap/toggle', (req: Request, res: Response): void => {
    const projectDir = req.projectDir!;

    try {
      const { enabled } = req.body as { enabled: unknown };

      if (typeof enabled !== 'boolean') {
        res.status(400).json({ error: 'enabled must be a boolean' });
        return;
      }

      const currentConfig = req.projectConfig!;
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

      res.json(loadConfig(projectDir));
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  return router;
}
