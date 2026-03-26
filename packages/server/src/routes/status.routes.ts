/**
 * Status routes: /api/status, /api/status/events, /api/schedule-info
 */

import { Request, Response, Router } from 'express';

import { CronExpressionParser } from 'cron-parser';

import {
  INightWatchConfig,
  addDelayToIsoString,
  fetchStatusSnapshot,
  getSchedulingPlan,
  loadConfig,
} from '@night-watch/core';
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

function buildScheduleInfoResponse(
  projectDir: string,
  config: INightWatchConfig,
  entries: string[],
  installed: boolean,
) {
  const executorPlan = getSchedulingPlan(projectDir, config, 'executor');
  const reviewerPlan = getSchedulingPlan(projectDir, config, 'reviewer');
  const qaPlan = getSchedulingPlan(projectDir, config, 'qa');
  const auditPlan = getSchedulingPlan(projectDir, config, 'audit');
  const plannerPlan = getSchedulingPlan(projectDir, config, 'slicer');
  const analyticsPlan = getSchedulingPlan(projectDir, config, 'analytics');
  const mergerPlan = getSchedulingPlan(projectDir, config, 'merger');

  const executorInstalled =
    installed && config.executorEnabled !== false && hasScheduledCommand(entries, 'run');
  const reviewerInstalled =
    installed && config.reviewerEnabled && hasScheduledCommand(entries, 'review');
  const qaInstalled = installed && config.qa.enabled && hasScheduledCommand(entries, 'qa');
  const auditInstalled = installed && config.audit.enabled && hasScheduledCommand(entries, 'audit');
  const plannerInstalled =
    installed &&
    config.roadmapScanner.enabled &&
    (hasScheduledCommand(entries, 'planner') || hasScheduledCommand(entries, 'slice'));
  const analyticsInstalled =
    installed && config.analytics.enabled && hasScheduledCommand(entries, 'analytics');
  const mergerInstalled =
    installed && (config.merger?.enabled ?? false) && hasScheduledCommand(entries, 'merge');

  return {
    executor: {
      schedule: config.cronSchedule,
      installed: executorInstalled,
      nextRun: executorInstalled
        ? addDelayToIsoString(computeNextRun(config.cronSchedule), executorPlan.totalDelayMinutes)
        : null,
      delayMinutes: executorPlan.totalDelayMinutes,
      manualDelayMinutes: executorPlan.manualDelayMinutes,
      balancedDelayMinutes: executorPlan.balancedDelayMinutes,
    },
    reviewer: {
      schedule: config.reviewerSchedule,
      installed: reviewerInstalled,
      nextRun: reviewerInstalled
        ? addDelayToIsoString(
            computeNextRun(config.reviewerSchedule),
            reviewerPlan.totalDelayMinutes,
          )
        : null,
      delayMinutes: reviewerPlan.totalDelayMinutes,
      manualDelayMinutes: reviewerPlan.manualDelayMinutes,
      balancedDelayMinutes: reviewerPlan.balancedDelayMinutes,
    },
    qa: {
      schedule: config.qa.schedule,
      installed: qaInstalled,
      nextRun: qaInstalled
        ? addDelayToIsoString(computeNextRun(config.qa.schedule), qaPlan.totalDelayMinutes)
        : null,
      delayMinutes: qaPlan.totalDelayMinutes,
      manualDelayMinutes: qaPlan.manualDelayMinutes,
      balancedDelayMinutes: qaPlan.balancedDelayMinutes,
    },
    audit: {
      schedule: config.audit.schedule,
      installed: auditInstalled,
      nextRun: auditInstalled
        ? addDelayToIsoString(computeNextRun(config.audit.schedule), auditPlan.totalDelayMinutes)
        : null,
      delayMinutes: auditPlan.totalDelayMinutes,
      manualDelayMinutes: auditPlan.manualDelayMinutes,
      balancedDelayMinutes: auditPlan.balancedDelayMinutes,
    },
    planner: {
      schedule: config.roadmapScanner.slicerSchedule,
      installed: plannerInstalled,
      nextRun: plannerInstalled
        ? addDelayToIsoString(
            computeNextRun(config.roadmapScanner.slicerSchedule),
            plannerPlan.totalDelayMinutes,
          )
        : null,
      delayMinutes: plannerPlan.totalDelayMinutes,
      manualDelayMinutes: plannerPlan.manualDelayMinutes,
      balancedDelayMinutes: plannerPlan.balancedDelayMinutes,
    },
    analytics: {
      schedule: config.analytics.schedule,
      installed: analyticsInstalled,
      nextRun: analyticsInstalled
        ? addDelayToIsoString(
            computeNextRun(config.analytics.schedule),
            analyticsPlan.totalDelayMinutes,
          )
        : null,
      delayMinutes: analyticsPlan.totalDelayMinutes,
      manualDelayMinutes: analyticsPlan.manualDelayMinutes,
      balancedDelayMinutes: analyticsPlan.balancedDelayMinutes,
    },
    merger: {
      schedule: config.merger?.schedule ?? '55 */4 * * *',
      installed: mergerInstalled,
      nextRun: mergerInstalled
        ? addDelayToIsoString(
            computeNextRun(config.merger?.schedule ?? '55 */4 * * *'),
            mergerPlan.totalDelayMinutes,
          )
        : null,
      delayMinutes: mergerPlan.totalDelayMinutes,
      manualDelayMinutes: mergerPlan.manualDelayMinutes,
      balancedDelayMinutes: mergerPlan.balancedDelayMinutes,
    },
    paused: !installed,
    schedulingPriority: config.schedulingPriority,
    entries,
  };
}

export function createScheduleInfoRoutes(deps: IScheduleInfoRoutesDeps): Router {
  const { projectDir, getConfig } = deps;
  const router = Router();

  router.get('/', async (_req: Request, res: Response): Promise<void> => {
    try {
      const config = getConfig();
      const snapshot = await fetchStatusSnapshot(projectDir, config);
      res.json(
        buildScheduleInfoResponse(
          projectDir,
          config,
          snapshot.crontab.entries,
          snapshot.crontab.installed,
        ),
      );
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
      res.json(
        buildScheduleInfoResponse(
          projectDir,
          config,
          snapshot.crontab.entries,
          snapshot.crontab.installed,
        ),
      );
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  return router;
}

export { broadcastSSE };
