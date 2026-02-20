/**
 * Status routes: /api/status, /api/status/events, /api/schedule-info
 */

import { Request, Response, Router } from 'express';

import { CronExpressionParser } from 'cron-parser';

import { INightWatchConfig } from '@night-watch/core/types.js';
import { fetchStatusSnapshot } from '@night-watch/core/utils/status-data.js';
import {
  SseClientSet,
  broadcastSSE,
  startSseStatusWatcher,
} from '../middleware/sse.middleware.js';

export interface IStatusRoutesDeps {
  projectDir: string;
  getConfig: () => INightWatchConfig;
  sseClients: SseClientSet;
}

export function createStatusRoutes(deps: IStatusRoutesDeps): Router {
  const { projectDir, getConfig, sseClients } = deps;
  const router = Router();

  // SSE endpoint for real-time status updates
  router.get('/events', (req: Request, res: Response): void => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    sseClients.add(res);

    // Send current snapshot immediately on connect
    try {
      const snapshot = fetchStatusSnapshot(projectDir, getConfig());
      res.write(`event: status_changed\ndata: ${JSON.stringify(snapshot)}\n\n`);
    } catch {
      // Ignore errors during initial snapshot
    }

    req.on('close', () => {
      sseClients.delete(res);
    });
  });

  router.get('/', (_req: Request, res: Response): void => {
    try {
      const snapshot = fetchStatusSnapshot(projectDir, getConfig());
      res.json(snapshot);
    } catch (error) {
      res
        .status(500)
        .json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  return router;
}

export interface IScheduleInfoRoutesDeps {
  projectDir: string;
  getConfig: () => INightWatchConfig;
}

export function createScheduleInfoRoutes(
  deps: IScheduleInfoRoutesDeps,
): Router {
  const { projectDir, getConfig } = deps;
  const router = Router();

  router.get('/', (_req: Request, res: Response): void => {
    try {
      const config = getConfig();
      const snapshot = fetchStatusSnapshot(projectDir, config);
      const installed = snapshot.crontab.installed;
      const entries = snapshot.crontab.entries;

      const computeNextRun = (cronExpr: string): string | null => {
        try {
          const interval = CronExpressionParser.parse(cronExpr);
          return interval.next().toISOString();
        } catch {
          return null;
        }
      };

      res.json({
        executor: {
          schedule: config.cronSchedule,
          installed,
          nextRun: installed ? computeNextRun(config.cronSchedule) : null,
        },
        reviewer: {
          schedule: config.reviewerSchedule,
          installed: installed && config.reviewerEnabled,
          nextRun:
            installed && config.reviewerEnabled
              ? computeNextRun(config.reviewerSchedule)
              : null,
        },
        qa: {
          schedule: config.qa.schedule,
          installed: installed && config.qa.enabled,
          nextRun:
            installed && config.qa.enabled
              ? computeNextRun(config.qa.schedule)
              : null,
        },
        paused: !installed,
        entries,
      });
    } catch (error) {
      res
        .status(500)
        .json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  return router;
}

/**
 * Create a project-scoped SSE router for the global/multi-project mode.
 * Each project gets its own SSE client set and watcher.
 */
export function createProjectSseRoutes(deps: {
  projectSseClients: Map<string, SseClientSet>;
  projectSseWatchers: Map<string, ReturnType<typeof setInterval>>;
}): Router {
  const { projectSseClients, projectSseWatchers } = deps;
  const router = Router({ mergeParams: true });

  router.get('/status/events', (req: Request, res: Response): void => {
    const projectDir = req.projectDir!;
    const config = req.projectConfig!;

    // Initialize client set for this project if not exists
    if (!projectSseClients.has(projectDir)) {
      projectSseClients.set(projectDir, new Set());
    }
    const clients = projectSseClients.get(projectDir)!;

    // Start watcher for this project if not already running
    if (!projectSseWatchers.has(projectDir)) {
      const watcher = startSseStatusWatcher(clients, projectDir, () =>
        req.projectConfig!,
      );
      projectSseWatchers.set(projectDir, watcher);
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    clients.add(res);

    // Send current snapshot immediately on connect
    try {
      const snapshot = fetchStatusSnapshot(projectDir, config);
      res.write(`event: status_changed\ndata: ${JSON.stringify(snapshot)}\n\n`);
    } catch {
      // Ignore errors during initial snapshot
    }

    req.on('close', () => {
      clients.delete(res);
    });
  });

  // /status (non-event) for project-scoped global mode
  router.get('/status', (req: Request, res: Response): void => {
    try {
      const snapshot = fetchStatusSnapshot(req.projectDir!, req.projectConfig!);
      res.json(snapshot);
    } catch (error) {
      res
        .status(500)
        .json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.get('/schedule-info', (req: Request, res: Response): void => {
    try {
      const config = req.projectConfig!;
      const projectDir = req.projectDir!;
      const snapshot = fetchStatusSnapshot(projectDir, config);
      const installed = snapshot.crontab.installed;
      const entries = snapshot.crontab.entries;

      const computeNextRun = (cronExpr: string): string | null => {
        try {
          const interval = CronExpressionParser.parse(cronExpr);
          return interval.next().toISOString();
        } catch {
          return null;
        }
      };

      res.json({
        executor: {
          schedule: config.cronSchedule,
          installed,
          nextRun: installed ? computeNextRun(config.cronSchedule) : null,
        },
        reviewer: {
          schedule: config.reviewerSchedule,
          installed: installed && config.reviewerEnabled,
          nextRun:
            installed && config.reviewerEnabled
              ? computeNextRun(config.reviewerSchedule)
              : null,
        },
        qa: {
          schedule: config.qa.schedule,
          installed: installed && config.qa.enabled,
          nextRun:
            installed && config.qa.enabled
              ? computeNextRun(config.qa.schedule)
              : null,
        },
        paused: !installed,
        entries,
      });
    } catch (error) {
      res
        .status(500)
        .json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  return router;
}

export { broadcastSSE };
