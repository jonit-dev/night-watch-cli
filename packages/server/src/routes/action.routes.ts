/**
 * Action routes: /api/actions/* (run, review, qa, audit, planner, cancel, retry, clear-lock, install-cron, uninstall-cron)
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync, spawn } from 'child_process';

import { Request, Response, Router } from 'express';

import {
  CLAIM_FILE_EXTENSION,
  INightWatchConfig,
  checkLockFile,
  executorLockPath,
  fetchStatusSnapshot,
  performCancel,
  plannerLockPath,
  reviewerLockPath,
} from '@night-watch/core';
import { SseClientSet, broadcastSSE } from '../middleware/sse.middleware.js';
import { validatePrdName } from '../helpers.js';

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
    let lockPath: string | null = null;
    if (command[0] === 'run') {
      lockPath = executorLockPath(projectDir);
    } else if (command[0] === 'review') {
      lockPath = reviewerLockPath(projectDir);
    } else if (command[0] === 'planner') {
      lockPath = plannerLockPath(projectDir);
    }

    if (lockPath) {
      const lock = checkLockFile(lockPath);
      if (lock.running) {
        let processType = 'Planner';
        if (command[0] === 'run') processType = 'Executor';
        else if (command[0] === 'review') processType = 'Reviewer';
        res.status(409).json({
          error: `${processType} is already running (PID ${lock.pid})`,
          pid: lock.pid,
        });
        return;
      }
    }

    const prdName = command[0] === 'run' ? (req.body?.prdName as string | undefined) : undefined;

    const extraEnv: NodeJS.ProcessEnv = {
      // Manual UI triggers bypass the global queue gate — per-project lock file
      // already prevents duplicate runs for the same project.
      NW_QUEUE_ENABLED: '0',
    };
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
      if (onSpawned) {
        onSpawned(child.pid);
      }

      res.json({ started: true, pid: child.pid });
    } else {
      res.status(500).json({ error: 'Failed to spawn process: no PID assigned' });
    }
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Build a concise, user-facing message from a failed execSync invocation.
 */
function formatCommandError(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }

  const withStreams = error as Error & {
    stderr?: Buffer | string;
    stdout?: Buffer | string;
  };

  const stderr =
    typeof withStreams.stderr === 'string'
      ? withStreams.stderr
      : (withStreams.stderr?.toString('utf-8') ?? '');
  const stdout =
    typeof withStreams.stdout === 'string'
      ? withStreams.stdout
      : (withStreams.stdout?.toString('utf-8') ?? '');

  const output = stderr.trim() || stdout.trim();
  return output || error.message;
}

/**
 * Execute a short-lived night-watch CLI command and throw on failure.
 */
function runCliCommand(projectDir: string, args: string[]): void {
  execSync(`night-watch ${args.join(' ')}`, {
    cwd: projectDir,
    encoding: 'utf-8',
    stdio: 'pipe',
    env: process.env,
  });
}

// ==================== Context interface ====================

interface IActionRouteContext {
  getConfig: (req: Request) => INightWatchConfig;
  getProjectDir: (req: Request) => string;
  getSseClients: (req: Request) => SseClientSet;
  pathPrefix: string; // '' for single-project, 'actions/' for global
}

// ==================== Shared handler factory ====================

function createActionRouteHandlers(ctx: IActionRouteContext): Router {
  const router = Router({ mergeParams: true });
  const p = ctx.pathPrefix;

  router.post(`/${p}run`, (req: Request, res: Response): void => {
    const projectDir = ctx.getProjectDir(req);
    spawnAction(projectDir, ['run'], req, res, (pid) => {
      broadcastSSE(ctx.getSseClients(req), 'executor_started', { pid });
    });
  });

  router.post(`/${p}review`, (req: Request, res: Response): void => {
    spawnAction(ctx.getProjectDir(req), ['review'], req, res);
  });

  router.post(`/${p}qa`, (req: Request, res: Response): void => {
    spawnAction(ctx.getProjectDir(req), ['qa'], req, res);
  });

  router.post(`/${p}audit`, (req: Request, res: Response): void => {
    spawnAction(ctx.getProjectDir(req), ['audit'], req, res);
  });

  router.post(`/${p}analytics`, (req: Request, res: Response): void => {
    spawnAction(ctx.getProjectDir(req), ['analytics'], req, res);
  });

  router.post(`/${p}planner`, (req: Request, res: Response): void => {
    spawnAction(ctx.getProjectDir(req), ['planner'], req, res);
  });

  router.post(`/${p}install-cron`, (req: Request, res: Response): void => {
    const projectDir = ctx.getProjectDir(req);
    try {
      // Force-install replaces this project's entries in one pass.
      runCliCommand(projectDir, ['install', '--force']);
      res.json({ started: true });
    } catch (error) {
      res.status(500).json({ error: formatCommandError(error) });
    }
  });

  router.post(`/${p}uninstall-cron`, (req: Request, res: Response): void => {
    const projectDir = ctx.getProjectDir(req);
    try {
      // Keep logs when pausing schedules from the UI/API.
      runCliCommand(projectDir, ['uninstall', '--keep-logs']);
      res.json({ started: true });
    } catch (error) {
      res.status(500).json({ error: formatCommandError(error) });
    }
  });

  router.post(`/${p}cancel`, async (req: Request, res: Response): Promise<void> => {
    try {
      const projectDir = ctx.getProjectDir(req);
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
      res.status(500).json({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  router.post(`/${p}retry`, (req: Request, res: Response): void => {
    try {
      const projectDir = ctx.getProjectDir(req);
      const config = ctx.getConfig(req);
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
        res.status(404).json({ error: `PRD "${normalized}" not found in done/` });
        return;
      }

      fs.renameSync(donePath, pendingPath);
      res.json({ message: `Moved "${normalized}" back to pending` });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  router.post(`/${p}clear-lock`, async (req: Request, res: Response): Promise<void> => {
    try {
      const projectDir = ctx.getProjectDir(req);
      const config = ctx.getConfig(req);
      const lockPath = executorLockPath(projectDir);
      const lock = checkLockFile(lockPath);

      if (lock.running) {
        res.status(409).json({ error: 'Executor is actively running — use Stop instead' });
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
        ctx.getSseClients(req),
        'status_changed',
        await fetchStatusSnapshot(projectDir, config),
      );

      res.json({ cleared: true });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  return router;
}

// ==================== Public exports ====================

export interface IActionRoutesDeps {
  projectDir: string;
  getConfig: () => INightWatchConfig;
  sseClients: SseClientSet;
}

/**
 * Single-project action routes (mounted at /api/actions).
 */
export function createActionRoutes(deps: IActionRoutesDeps): Router {
  return createActionRouteHandlers({
    getConfig: () => deps.getConfig(),
    getProjectDir: () => deps.projectDir,
    getSseClients: () => deps.sseClients,
    pathPrefix: '',
  });
}

/**
 * Project-scoped action routes for global mode (mounted at /api/projects/:id).
 * Reads projectDir/config from req set by project-resolver middleware.
 */
export function createProjectActionRoutes(deps: {
  projectSseClients: Map<string, SseClientSet>;
}): Router {
  const { projectSseClients } = deps;
  return createActionRouteHandlers({
    getConfig: (req) => req.projectConfig!,
    getProjectDir: (req) => req.projectDir!,
    getSseClients: (req) => {
      const projectDir = req.projectDir!;
      if (!projectSseClients.has(projectDir)) {
        projectSseClients.set(projectDir, new Set());
      }
      return projectSseClients.get(projectDir)!;
    },
    pathPrefix: 'actions/',
  });
}
