/**
 * Action routes: /api/actions/* (run, review, cancel, retry, clear-lock, install-cron, uninstall-cron)
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';

import { Request, Response, Router } from 'express';

import { performCancel } from '@/commands/cancel.js';
import { CLAIM_FILE_EXTENSION } from '@/constants.js';
import { loadConfig } from '@/config.js';
import { INightWatchConfig } from '@/types.js';
import { sendNotifications } from '@/utils/notify.js';
import {
  checkLockFile,
  executorLockPath,
  fetchStatusSnapshot,
  reviewerLockPath,
} from '@/utils/status-data.js';
import { SseClientSet, broadcastSSE } from '../middleware/sse.middleware.js';
import { validatePrdName } from '../helpers.js';

// Track spawned processes module-level
const spawnedProcesses = new Map<number, ReturnType<typeof spawn>>();

/**
 * Recursively clean up orphaned claim files in the PRD directory.
 * A claim is orphaned if the executor is not running.
 */
function cleanOrphanedClaims(dir: string): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory() && entry.name !== 'done') {
      cleanOrphanedClaims(fullPath);
    } else if (entry.name.endsWith(CLAIM_FILE_EXTENSION)) {
      try {
        fs.unlinkSync(fullPath);
      } catch {
        // Ignore errors during cleanup
      }
    }
  }
}

/**
 * Internal helper to spawn a night-watch subcommand and respond.
 */
function spawnAction(
  projectDir: string,
  command: string[],
  req: Request,
  res: Response,
  onSpawned?: (pid: number) => void,
): void {
  try {
    const lockPath =
      command[0] === 'run'
        ? executorLockPath(projectDir)
        : command[0] === 'review'
          ? reviewerLockPath(projectDir)
          : null;

    if (lockPath) {
      const lock = checkLockFile(lockPath);
      if (lock.running) {
        const processType = command[0] === 'run' ? 'Executor' : 'Reviewer';
        res.status(409).json({
          error: `${processType} is already running (PID ${lock.pid})`,
          pid: lock.pid,
        });
        return;
      }
    }

    const prdName =
      command[0] === 'run'
        ? (req.body?.prdName as string | undefined)
        : undefined;

    const extraEnv: NodeJS.ProcessEnv = {};
    if (prdName) {
      extraEnv.NW_PRD_PRIORITY = prdName;
    }

    const child = spawn('night-watch', command, {
      detached: true,
      stdio: 'ignore',
      cwd: projectDir,
      env: { ...process.env, ...extraEnv },
    });

    child.unref();

    if (child.pid !== undefined) {
      spawnedProcesses.set(child.pid, child);

      if (command[0] === 'run') {
        const config = loadConfig(projectDir);
        sendNotifications(config, {
          event: 'run_started',
          projectName: path.basename(projectDir),
          exitCode: 0,
          provider: config.provider,
        }).catch(() => {
          /* silently ignore notification errors */
        });
      }

      if (onSpawned) {
        onSpawned(child.pid);
      }

      res.json({ started: true, pid: child.pid });
    } else {
      res
        .status(500)
        .json({ error: 'Failed to spawn process: no PID assigned' });
    }
  } catch (error) {
    res
      .status(500)
      .json({
        error: error instanceof Error ? error.message : String(error),
      });
  }
}

export interface IActionRoutesDeps {
  projectDir: string;
  getConfig: () => INightWatchConfig;
  sseClients: SseClientSet;
}

export function createActionRoutes(deps: IActionRoutesDeps): Router {
  const { projectDir, getConfig, sseClients } = deps;
  const router = Router();

  router.post('/run', (req: Request, res: Response): void => {
    spawnAction(projectDir, ['run'], req, res, (pid) => {
      broadcastSSE(sseClients, 'executor_started', { pid });
    });
  });

  router.post('/review', (req: Request, res: Response): void => {
    spawnAction(projectDir, ['review'], req, res);
  });

  router.post('/install-cron', (req: Request, res: Response): void => {
    spawnAction(projectDir, ['install'], req, res);
  });

  router.post('/uninstall-cron', (req: Request, res: Response): void => {
    spawnAction(projectDir, ['uninstall'], req, res);
  });

  router.post('/cancel', async (req: Request, res: Response): Promise<void> => {
    try {
      const { type = 'all' } = req.body as { type?: string };
      const validTypes = ['run', 'review', 'all'];
      if (!validTypes.includes(type)) {
        res.status(400).json({
          error: `Invalid type. Must be one of: ${validTypes.join(', ')}`,
        });
        return;
      }

      const results = await performCancel(projectDir, {
        type: type as 'run' | 'review' | 'all',
        force: true,
      });
      const hasFailure = results.some((r) => !r.success);
      res.status(hasFailure ? 500 : 200).json({ results });
    } catch (error) {
      res
        .status(500)
        .json({
          error: error instanceof Error ? error.message : String(error),
        });
    }
  });

  router.post('/retry', (req: Request, res: Response): void => {
    try {
      const config = getConfig();
      const { prdName } = req.body as { prdName?: string };

      if (!prdName || typeof prdName !== 'string') {
        res.status(400).json({ error: 'prdName is required' });
        return;
      }

      if (!validatePrdName(prdName)) {
        res.status(400).json({ error: 'Invalid PRD name' });
        return;
      }

      const prdDir = path.join(projectDir, config.prdDir);
      const normalized = prdName.endsWith('.md') ? prdName : `${prdName}.md`;
      const pendingPath = path.join(prdDir, normalized);
      const donePath = path.join(prdDir, 'done', normalized);

      if (fs.existsSync(pendingPath)) {
        res.json({ message: `"${normalized}" is already pending` });
        return;
      }

      if (!fs.existsSync(donePath)) {
        res
          .status(404)
          .json({ error: `PRD "${normalized}" not found in done/` });
        return;
      }

      fs.renameSync(donePath, pendingPath);
      res.json({ message: `Moved "${normalized}" back to pending` });
    } catch (error) {
      res
        .status(500)
        .json({
          error: error instanceof Error ? error.message : String(error),
        });
    }
  });

  router.post('/clear-lock', (req: Request, res: Response): void => {
    try {
      const config = getConfig();
      const lockPath = executorLockPath(projectDir);
      const lock = checkLockFile(lockPath);

      if (lock.running) {
        res
          .status(409)
          .json({ error: 'Executor is actively running — use Stop instead' });
        return;
      }

      if (fs.existsSync(lockPath)) {
        fs.unlinkSync(lockPath);
      }

      const prdDir = path.join(projectDir, config.prdDir);
      if (fs.existsSync(prdDir)) {
        cleanOrphanedClaims(prdDir);
      }

      broadcastSSE(
        sseClients,
        'status_changed',
        fetchStatusSnapshot(projectDir, config),
      );

      res.json({ cleared: true });
    } catch (error) {
      res
        .status(500)
        .json({
          error: error instanceof Error ? error.message : String(error),
        });
    }
  });

  return router;
}

/**
 * Project-scoped action routes for global mode.
 */
export function createProjectActionRoutes(deps: {
  projectSseClients: Map<string, SseClientSet>;
}): Router {
  const { projectSseClients } = deps;
  const router = Router({ mergeParams: true });

  router.post('/actions/run', (req: Request, res: Response): void => {
    const projectDir = req.projectDir!;
    spawnAction(projectDir, ['run'], req, res, (pid) => {
      const clients = projectSseClients.get(projectDir);
      if (clients) {
        broadcastSSE(clients, 'executor_started', { pid });
      }
    });
  });

  router.post('/actions/review', (req: Request, res: Response): void => {
    spawnAction(req.projectDir!, ['review'], req, res);
  });

  router.post('/actions/install-cron', (req: Request, res: Response): void => {
    spawnAction(req.projectDir!, ['install'], req, res);
  });

  router.post(
    '/actions/uninstall-cron',
    (req: Request, res: Response): void => {
      spawnAction(req.projectDir!, ['uninstall'], req, res);
    },
  );

  router.post(
    '/actions/cancel',
    async (req: Request, res: Response): Promise<void> => {
      try {
        const projectDir = req.projectDir!;
        const { type = 'all' } = req.body as { type?: string };
        const validTypes = ['run', 'review', 'all'];
        if (!validTypes.includes(type)) {
          res.status(400).json({
            error: `Invalid type. Must be one of: ${validTypes.join(', ')}`,
          });
          return;
        }

        const results = await performCancel(projectDir, {
          type: type as 'run' | 'review' | 'all',
          force: true,
        });
        const hasFailure = results.some((r) => !r.success);
        res.status(hasFailure ? 500 : 200).json({ results });
      } catch (error) {
        res
          .status(500)
          .json({
            error: error instanceof Error ? error.message : String(error),
          });
      }
    },
  );

  router.post('/actions/retry', (req: Request, res: Response): void => {
    try {
      const projectDir = req.projectDir!;
      const config = req.projectConfig!;
      const { prdName } = req.body as { prdName?: string };

      if (!prdName || typeof prdName !== 'string') {
        res.status(400).json({ error: 'prdName is required' });
        return;
      }

      if (!validatePrdName(prdName)) {
        res.status(400).json({ error: 'Invalid PRD name' });
        return;
      }

      const prdDir = path.join(projectDir, config.prdDir);
      const normalized = prdName.endsWith('.md') ? prdName : `${prdName}.md`;
      const pendingPath = path.join(prdDir, normalized);
      const donePath = path.join(prdDir, 'done', normalized);

      if (fs.existsSync(pendingPath)) {
        res.json({ message: `"${normalized}" is already pending` });
        return;
      }

      if (!fs.existsSync(donePath)) {
        res
          .status(404)
          .json({ error: `PRD "${normalized}" not found in done/` });
        return;
      }

      fs.renameSync(donePath, pendingPath);
      res.json({ message: `Moved "${normalized}" back to pending` });
    } catch (error) {
      res
        .status(500)
        .json({
          error: error instanceof Error ? error.message : String(error),
        });
    }
  });

  router.post('/actions/clear-lock', (req: Request, res: Response): void => {
    try {
      const projectDir = req.projectDir!;
      const config = req.projectConfig!;
      const lockPath = executorLockPath(projectDir);
      const lock = checkLockFile(lockPath);

      if (lock.running) {
        res
          .status(409)
          .json({ error: 'Executor is actively running — use Stop instead' });
        return;
      }

      if (fs.existsSync(lockPath)) {
        fs.unlinkSync(lockPath);
      }

      const prdDir = path.join(projectDir, config.prdDir);
      if (fs.existsSync(prdDir)) {
        cleanOrphanedClaims(prdDir);
      }

      const clients = projectSseClients.get(projectDir) ?? new Set();
      broadcastSSE(
        clients,
        'status_changed',
        fetchStatusSnapshot(projectDir, config),
      );

      res.json({ cleared: true });
    } catch (error) {
      res
        .status(500)
        .json({
          error: error instanceof Error ? error.message : String(error),
        });
    }
  });

  return router;
}
