/**
 * Log routes: /api/logs/:name
 */

import * as path from 'path';

import { Request, Response, Router } from 'express';

import { LOG_DIR, LOG_FILE_NAMES } from '@night-watch/core/constants.js';
import { getLastLogLines } from '@night-watch/core/utils/status-data.js';

export interface ILogRoutesDeps {
  projectDir: string;
}

export function createLogRoutes(deps: ILogRoutesDeps): Router {
  const { projectDir } = deps;
  const router = Router();

  router.get('/:name', (req: Request, res: Response): void => {
    try {
      const { name } = req.params;

      const validNames = ['executor', 'reviewer', 'qa'];
      if (!validNames.includes(name as string)) {
        res.status(400).json({
          error: `Invalid log name. Must be one of: ${validNames.join(', ')}`,
        });
        return;
      }

      const linesParam = req.query.lines;
      const lines =
        typeof linesParam === 'string' ? parseInt(linesParam, 10) : 200;
      const linesToRead =
        isNaN(lines) || lines < 1 ? 200 : Math.min(lines, 10000);

      // Map logical name to actual file name
      const fileName = LOG_FILE_NAMES[name as string] || name;
      const logPath = path.join(projectDir, LOG_DIR, `${fileName}.log`);
      const logLines = getLastLogLines(logPath, linesToRead);

      res.json({ name, lines: logLines });
    } catch (error) {
      res
        .status(500)
        .json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  return router;
}

/**
 * Project-scoped log routes for global mode.
 */
export function createProjectLogRoutes(): Router {
  const router = Router({ mergeParams: true });

  router.get('/logs/:name', (req: Request, res: Response): void => {
    try {
      const projectDir = req.projectDir!;
      const { name } = req.params;

      const validNames = ['executor', 'reviewer', 'qa'];
      if (!validNames.includes(name as string)) {
        res.status(400).json({
          error: `Invalid log name. Must be one of: ${validNames.join(', ')}`,
        });
        return;
      }

      const linesParam = req.query.lines;
      const lines =
        typeof linesParam === 'string' ? parseInt(linesParam, 10) : 200;
      const linesToRead =
        isNaN(lines) || lines < 1 ? 200 : Math.min(lines, 10000);

      const fileName = LOG_FILE_NAMES[name as string] || name;
      const logPath = path.join(projectDir, LOG_DIR, `${fileName}.log`);
      const logLines = getLastLogLines(logPath, linesToRead);

      res.json({ name, lines: logLines });
    } catch (error) {
      res
        .status(500)
        .json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  return router;
}
