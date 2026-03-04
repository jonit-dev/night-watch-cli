/**
 * Status routes: /api/status, /api/status/events, /api/schedule-info
 */

import { Request, Response, Router } from 'express';

import { CronExpressionParser } from 'cron-parser';

import { INightWatchConfig, fetchStatusSnapshot, loadConfig } from '@night-watch/core';
import { SseClientSet, broadcastSSE, startSseStatusWatcher } from '../middleware/sse.middleware.js';

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
    fetchStatusSnapshot(projectDir, getConfig())
      .then((snapshot) => {
        res.write(`event: status_changed\ndata: ${JSON.stringify(snapshot)}\n\n`);
      })
      .catch(() => {
        // Ignore errors during initial snapshot
      });

    req.on('close', () => {
      sseClients.delete(res);
    });
  });

  router.get('/', async (_req: Request, res: Response): Promise<void> => {
    try {
      const snapshot = await fetchStatusSnapshot(projectDir, getConfig());
      res.json(snapshot);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  return router;
}

export interface IScheduleInfoRoutesDeps {
  projectDir: string;
  getConfig: () => INightWatchConfig;
}

function computeNextRun(cronExpr: string): string | null {
  try {
    const interval = CronExpressionParser.parse(cronExpr);
    return interval.next().toISOString();
  } catch {
    return null;
  }
}

function hasScheduledCommand(entries: string[], command: string): boolean {
  const commandPattern = new RegExp(`\\s${command}\\s+>>`);
  return entries.some((entry) => commandPattern.test(entry));
}

export function createScheduleInfoRoutes(deps: IScheduleInfoRoutesDeps): Router {
  const { projectDir, getConfig } = deps;
  const router = Router();

  router.get('/', async (_req: Request, res: Response): Promise<void> => {
    try {
      const config = getConfig();
      const snapshot = await fetchStatusSnapshot(projectDir, config);
      const installed = snapshot.crontab.installed;
      const entries = snapshot.crontab.entries;
      const executorInstalled =
        installed && config.executorEnabled !== false && hasScheduledCommand(entries, 'run');
      const reviewerInstalled =
        installed && config.reviewerEnabled && hasScheduledCommand(entries, 'review');
      const qaInstalled = installed && config.qa.enabled && hasScheduledCommand(entries, 'qa');
      const auditInstalled =
        installed && config.audit.enabled && hasScheduledCommand(entries, 'audit');
      const plannerInstalled =
        installed &&
        config.roadmapScanner.enabled &&
        (hasScheduledCommand(entries, 'planner') || hasScheduledCommand(entries, 'slice'));

      res.json({
        executor: {
          schedule: config.cronSchedule,
          installed: executorInstalled,
          nextRun: executorInstalled ? computeNextRun(config.cronSchedule) : null,
        },
        reviewer: {
          schedule: config.reviewerSchedule,
          installed: reviewerInstalled,
          nextRun: reviewerInstalled ? computeNextRun(config.reviewerSchedule) : null,
        },
        qa: {
          schedule: config.qa.schedule,
          installed: qaInstalled,
          nextRun: qaInstalled ? computeNextRun(config.qa.schedule) : null,
        },
        audit: {
          schedule: config.audit.schedule,
          installed: auditInstalled,
          nextRun: auditInstalled ? computeNextRun(config.audit.schedule) : null,
        },
        planner: {
          schedule: config.roadmapScanner.slicerSchedule,
          installed: plannerInstalled,
          nextRun: plannerInstalled ? computeNextRun(config.roadmapScanner.slicerSchedule) : null,
        },
        paused: !installed,
        entries,
      });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  return router;
}

/**
 * Create a project-scoped SSE router for the global/multi-project mode.
 * Each project gets its own SSE client set and watcher.
 *
 * Bug fixes applied:
 * - Stale config: watcher re-reads config from disk on each tick via loadConfig()
 *   rather than closing over the initial request's req.projectConfig reference.
 * - Interval leak: watcher interval is cleared when the last client for a project
 *   disconnects, preventing unbounded accumulation of idle intervals.
 */
export function createProjectSseRoutes(deps: {
  projectSseClients: Map<string, SseClientSet>;
  projectSseWatchers: Map<string, ReturnType<typeof setInterval>>;
}): Router {
  const { projectSseClients, projectSseWatchers } = deps;
  const router = Router({ mergeParams: true });

  router.get('/status/events', (req: Request, res: Response): void => {
    const projectDir = req.projectDir!;

    // Initialize client set for this project if not exists
    if (!projectSseClients.has(projectDir)) {
      projectSseClients.set(projectDir, new Set());
    }
    const clients = projectSseClients.get(projectDir)!;

    // Start watcher for this project if not already running.
    // Bug fix: pass loadConfig(projectDir) as the getConfig function so the
    // watcher re-reads config from disk on every tick instead of closing over
    // the stale req.projectConfig reference from a single HTTP request.
    if (!projectSseWatchers.has(projectDir)) {
      const watcher = startSseStatusWatcher(clients, projectDir, () => loadConfig(projectDir));
      projectSseWatchers.set(projectDir, watcher);
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    clients.add(res);

    // Send current snapshot immediately on connect using the current config
    // (re-read from disk so we always have a fresh value).
    fetchStatusSnapshot(projectDir, loadConfig(projectDir))
      .then((snapshot) => {
        res.write(`event: status_changed\ndata: ${JSON.stringify(snapshot)}\n\n`);
      })
      .catch(() => {
        // Ignore errors during initial snapshot
      });

    req.on('close', () => {
      clients.delete(res);

      // Bug fix: stop the watcher interval when the last client disconnects to
      // prevent unbounded accumulation of idle intervals.
      if (clients.size === 0) {
        const watcher = projectSseWatchers.get(projectDir);
        if (watcher !== undefined) {
          clearInterval(watcher);
          projectSseWatchers.delete(projectDir);
        }
      }
    });
  });

  // /status (non-event) for project-scoped global mode
  router.get('/status', async (req: Request, res: Response): Promise<void> => {
    try {
      const snapshot = await fetchStatusSnapshot(req.projectDir!, req.projectConfig!);
      res.json(snapshot);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.get('/schedule-info', async (req: Request, res: Response): Promise<void> => {
    try {
      const config = req.projectConfig!;
      const projectDir = req.projectDir!;
      const snapshot = await fetchStatusSnapshot(projectDir, config);
      const installed = snapshot.crontab.installed;
      const entries = snapshot.crontab.entries;
      const executorInstalled =
        installed && config.executorEnabled !== false && hasScheduledCommand(entries, 'run');
      const reviewerInstalled =
        installed && config.reviewerEnabled && hasScheduledCommand(entries, 'review');
      const qaInstalled = installed && config.qa.enabled && hasScheduledCommand(entries, 'qa');
      const auditInstalled =
        installed && config.audit.enabled && hasScheduledCommand(entries, 'audit');
      const plannerInstalled =
        installed &&
        config.roadmapScanner.enabled &&
        (hasScheduledCommand(entries, 'planner') || hasScheduledCommand(entries, 'slice'));

      res.json({
        executor: {
          schedule: config.cronSchedule,
          installed: executorInstalled,
          nextRun: executorInstalled ? computeNextRun(config.cronSchedule) : null,
        },
        reviewer: {
          schedule: config.reviewerSchedule,
          installed: reviewerInstalled,
          nextRun: reviewerInstalled ? computeNextRun(config.reviewerSchedule) : null,
        },
        qa: {
          schedule: config.qa.schedule,
          installed: qaInstalled,
          nextRun: qaInstalled ? computeNextRun(config.qa.schedule) : null,
        },
        audit: {
          schedule: config.audit.schedule,
          installed: auditInstalled,
          nextRun: auditInstalled ? computeNextRun(config.audit.schedule) : null,
        },
        planner: {
          schedule: config.roadmapScanner.slicerSchedule,
          installed: plannerInstalled,
          nextRun: plannerInstalled ? computeNextRun(config.roadmapScanner.slicerSchedule) : null,
        },
        paused: !installed,
        entries,
      });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  return router;
}

export { broadcastSSE };
