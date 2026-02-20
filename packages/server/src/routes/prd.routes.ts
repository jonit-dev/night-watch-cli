/**
 * PRD routes: /api/prds, /api/prds/:name
 */

import * as fs from 'fs';
import * as path from 'path';

import { Request, Response, Router } from 'express';

import { INightWatchConfig } from '@night-watch/core/types.js';
import { collectPrdInfo } from '@night-watch/core/utils/status-data.js';
import { validatePrdName } from '../helpers.js';

export interface IPrdRoutesDeps {
  projectDir: string;
  getConfig: () => INightWatchConfig;
}

export function createPrdRoutes(deps: IPrdRoutesDeps): Router {
  const { projectDir, getConfig } = deps;
  const router = Router();

  router.get('/', (_req: Request, res: Response): void => {
    try {
      const config = getConfig();
      const prds = collectPrdInfo(projectDir, config.prdDir, config.maxRuntime);

      const prdsWithContent = prds.map((prd) => {
        const prdPath = path.join(
          projectDir,
          config.prdDir,
          `${prd.name}.md`,
        );
        let content = '';
        if (fs.existsSync(prdPath)) {
          try {
            content = fs.readFileSync(prdPath, 'utf-8');
          } catch {
            content = '';
          }
        }
        return { ...prd, content };
      });

      res.json(prdsWithContent);
    } catch (error) {
      res
        .status(500)
        .json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.get('/:name', (req: Request, res: Response): void => {
    try {
      const config = getConfig();
      const { name } = req.params;

      if (!validatePrdName(name as string)) {
        res.status(400).json({ error: 'Invalid PRD name' });
        return;
      }

      const nameStr = name as string;
      const filename = nameStr.endsWith('.md') ? nameStr : `${nameStr}.md`;
      const prdPath = path.join(projectDir, config.prdDir, filename);

      if (!fs.existsSync(prdPath)) {
        res.status(404).json({ error: 'PRD not found' });
        return;
      }

      const content = fs.readFileSync(prdPath, 'utf-8');
      res.json({ name: filename.replace(/\.md$/, ''), content });
    } catch (error) {
      res
        .status(500)
        .json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  return router;
}

/**
 * Project-scoped PRD routes for global mode (reads from req.projectDir/req.projectConfig).
 */
export function createProjectPrdRoutes(): Router {
  const router = Router({ mergeParams: true });

  router.get('/prds', (req: Request, res: Response): void => {
    try {
      const config = req.projectConfig!;
      const projectDir = req.projectDir!;
      const prds = collectPrdInfo(projectDir, config.prdDir, config.maxRuntime);

      const prdsWithContent = prds.map((prd) => {
        const prdPath = path.join(
          projectDir,
          config.prdDir,
          `${prd.name}.md`,
        );
        let content = '';
        if (fs.existsSync(prdPath)) {
          try {
            content = fs.readFileSync(prdPath, 'utf-8');
          } catch {
            content = '';
          }
        }
        return { ...prd, content };
      });

      res.json(prdsWithContent);
    } catch (error) {
      res
        .status(500)
        .json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.get('/prds/:name', (req: Request, res: Response): void => {
    try {
      const config = req.projectConfig!;
      const projectDir = req.projectDir!;
      const { name } = req.params;

      if (!validatePrdName(name as string)) {
        res.status(400).json({ error: 'Invalid PRD name' });
        return;
      }

      const nameStr = name as string;
      const filename = nameStr.endsWith('.md') ? nameStr : `${nameStr}.md`;
      const prdPath = path.join(projectDir, config.prdDir, filename);

      if (!fs.existsSync(prdPath)) {
        res.status(404).json({ error: 'PRD not found' });
        return;
      }

      const content = fs.readFileSync(prdPath, 'utf-8');
      res.json({ name: filename.replace(/\.md$/, ''), content });
    } catch (error) {
      res
        .status(500)
        .json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  return router;
}
