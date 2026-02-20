/**
 * HTTP API Server for Night Watch CLI
 * Provides REST API endpoints for the Web UI
 * Supports both single-project and global (multi-project) modes
 */

import * as fs from 'fs';
import * as path from 'path';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

import cors from 'cors';
import express, { Express, NextFunction, Request, Response } from 'express';

import { loadConfig } from '@night-watch/core/config.js';
import { type ISlackStack, createSlackStack } from '@night-watch/slack/factory.js';
import { collectPrInfo } from '@night-watch/core/utils/status-data.js';
import { loadRegistry, validateRegistry } from '@night-watch/core/utils/registry.js';
import { getRoadmapStatus, scanRoadmap } from '@night-watch/core/utils/roadmap-scanner.js';

import { errorHandler } from './middleware/error-handler.middleware.js';
import { setupGracefulShutdown } from './middleware/graceful-shutdown.middleware.js';
import { resolveProject } from './middleware/project-resolver.middleware.js';
import { SseClientSet, startSseStatusWatcher } from './middleware/sse.middleware.js';

import { createActionRoutes, createProjectActionRoutes } from './routes/action.routes.js';
import { createAgentRoutes } from './routes/agent.routes.js';
import { createBoardRoutes, createProjectBoardRoutes } from './routes/board.routes.js';
import { createConfigRoutes, createProjectConfigRoutes } from './routes/config.routes.js';
import { createDiscussionRoutes, createProjectDiscussionRoutes } from './routes/discussion.routes.js';
import { createDoctorRoutes, createProjectDoctorRoutes } from './routes/doctor.routes.js';
import { createLogRoutes, createProjectLogRoutes } from './routes/log.routes.js';
import { createPrdRoutes, createProjectPrdRoutes } from './routes/prd.routes.js';
import { createProjectRoadmapRoutes, createRoadmapRoutes } from './routes/roadmap.routes.js';
import { createProjectSseRoutes, createScheduleInfoRoutes, createStatusRoutes } from './routes/status.routes.js';
import { createSlackRoutes } from './routes/slack.routes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function findPackageRoot(dir: string): string {
  let d = dir;
  for (let i = 0; i < 5; i++) {
    if (fs.existsSync(path.join(d, 'package.json'))) return d;
    d = dirname(d);
  }
  return dir;
}
const __packageRoot = findPackageRoot(__dirname);

function setupStaticFiles(app: Express): void {
  const webDistPath = path.join(__packageRoot, 'web/dist');
  if (fs.existsSync(webDistPath)) {
    app.use(express.static(webDistPath));
  }

  app.use((req: Request, res: Response, next: NextFunction): void => {
    if (req.path.startsWith('/api/')) {
      next();
      return;
    }
    const indexPath = path.resolve(webDistPath, 'index.html');
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath, (err) => {
        if (err) next();
      });
    } else {
      next();
    }
  });
}

// ==================== Single-Project Mode ====================

export function createApp(projectDir: string): Express {
  const app = express();
  app.use(cors());
  app.use(express.json());

  let config = loadConfig(projectDir);
  const reloadConfig = (): void => { config = loadConfig(projectDir); };
  const sseClients: SseClientSet = new Set();

  startSseStatusWatcher(sseClients, projectDir, () => config);

  app.use('/api/status', createStatusRoutes({ projectDir, getConfig: () => config, sseClients }));
  app.use('/api/schedule-info', createScheduleInfoRoutes({ projectDir, getConfig: () => config }));
  app.use('/api/prds', createPrdRoutes({ projectDir, getConfig: () => config }));
  app.use('/api/config', createConfigRoutes({ projectDir, getConfig: () => config, reloadConfig }));
  app.use('/api/board', createBoardRoutes({ projectDir, getConfig: () => config }));
  app.use('/api/agents', createAgentRoutes());
  app.use('/api/slack', createSlackRoutes());
  app.use('/api/discussions', createDiscussionRoutes({ projectDir }));
  app.use('/api/actions', createActionRoutes({ projectDir, getConfig: () => config, sseClients }));
  app.use('/api/roadmap', createRoadmapRoutes({ projectDir, getConfig: () => config, reloadConfig }));
  app.use('/api/logs', createLogRoutes({ projectDir }));
  app.use('/api/doctor', createDoctorRoutes({ projectDir, getConfig: () => config }));

  app.get('/api/prs', (_req: Request, res: Response): void => {
    try {
      res.json(collectPrInfo(projectDir, config.branchPatterns));
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  // Auto-scan timer for roadmap
  let autoScanTimer: ReturnType<typeof setInterval> | null = null;
  const startAutoScan = (): void => {
    if (autoScanTimer) { clearInterval(autoScanTimer); autoScanTimer = null; }
    const cfg = loadConfig(projectDir);
    if (!cfg.roadmapScanner.enabled) return;
    autoScanTimer = setInterval(() => {
      const c = loadConfig(projectDir);
      if (!c.roadmapScanner.enabled) return;
      const status = getRoadmapStatus(projectDir, c);
      if (status.status === 'complete' || status.status === 'no-roadmap') return;
      scanRoadmap(projectDir, c).catch(() => { /* silently ignore */ });
    }, cfg.roadmapScanner.autoScanInterval * 1000);
  };
  if (config.roadmapScanner.enabled) startAutoScan();

  setupStaticFiles(app);
  app.use(errorHandler);
  return app;
}

// ==================== Global (Multi-Project) Mode ====================

function createProjectRouter() {
  const router = express.Router({ mergeParams: true });
  const projectSseClients = new Map<string, SseClientSet>();
  const projectSseWatchers = new Map<string, ReturnType<typeof setInterval>>();

  router.use(createProjectSseRoutes({ projectSseClients, projectSseWatchers }));
  router.use(createProjectPrdRoutes());
  router.use(createProjectConfigRoutes());
  router.use(createProjectDoctorRoutes());
  router.use(createProjectLogRoutes());
  router.use(createProjectBoardRoutes());
  router.use('/agents', createAgentRoutes());
  router.use('/slack', createSlackRoutes());
  router.use(createProjectDiscussionRoutes());
  router.use(createProjectActionRoutes({ projectSseClients }));
  router.use(createProjectRoadmapRoutes());

  router.get('/prs', (req: Request, res: Response): void => {
    try {
      res.json(collectPrInfo(req.projectDir!, req.projectConfig!.branchPatterns));
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  return router;
}

export function createGlobalApp(): Express {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get('/api/projects', (_req: Request, res: Response): void => {
    try {
      const entries = loadRegistry();
      const { invalid } = validateRegistry();
      const invalidPaths = new Set(invalid.map((e) => e.path));
      res.json(entries.map((e) => ({ name: e.name, path: e.path, valid: !invalidPaths.has(e.path) })));
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.use('/api/projects/:projectId', resolveProject, createProjectRouter());

  setupStaticFiles(app);
  app.use(errorHandler);
  return app;
}

// ==================== Server Startup ====================

export function startServer(projectDir: string, port: number): void {
  const config = loadConfig(projectDir);
  const app = createApp(projectDir);
  const { listener } = createSlackStack(config);

  const server = app.listen(port, () => {
    console.log(`\nNight Watch UI  http://localhost:${port}`);
    console.log(`Project         ${projectDir}`);
    console.log(`Provider        ${config.provider}`);
    const slack = config.slack;
    if (slack?.enabled && slack.botToken) {
      console.log(`Slack           enabled — channels: ${Object.entries(slack.channels ?? {}).map(([k, v]) => `#${k}=${v}`).join(', ')}`);
      if (slack.replicateApiToken) console.log(`Avatar gen      Replicate Flux enabled`);
    } else {
      console.log(`Slack           not configured`);
    }
    console.log('');
  });

  void listener.start().catch((err: unknown) => {
    console.warn(`Slack interaction listener failed to start: ${err instanceof Error ? err.message : String(err)}`);
  });

  setupGracefulShutdown(server, async () => { await listener.stop(); });
}

export function startGlobalServer(port: number): void {
  const entries = loadRegistry();

  if (entries.length === 0) {
    console.error("No projects registered. Run 'night-watch init' in a project first.");
    process.exit(1);
  }

  const { valid, invalid } = validateRegistry();
  if (invalid.length > 0) {
    console.warn(`Warning: ${invalid.length} registered project(s) have invalid paths and will be skipped.`);
  }

  console.log(`\nNight Watch Global UI`);
  console.log(`Managing ${valid.length} project(s):`);
  for (const p of valid) {
    const cfg = loadConfig(p.path);
    const slackStatus = cfg.slack?.enabled && cfg.slack.botToken ? 'slack:on' : 'slack:off';
    const avatarStatus = cfg.slack?.replicateApiToken ? ' avatar-gen:on' : '';
    console.log(`  - ${p.name} (${p.path}) [${slackStatus}${avatarStatus}]`);
  }

  const app = createGlobalApp();
  const listenersBySlackToken = new Map<string, ISlackStack>();
  for (const project of valid) {
    const cfg = loadConfig(project.path);
    const slack = cfg.slack;
    if (!slack?.enabled || !slack.discussionEnabled || !slack.botToken || !slack.appToken) continue;
    const key = `${slack.botToken}:${slack.appToken}`;
    if (!listenersBySlackToken.has(key)) {
      listenersBySlackToken.set(key, createSlackStack(cfg));
    }
  }
  const stacks = Array.from(listenersBySlackToken.values());

  const server = app.listen(port, () => {
    console.log(`Night Watch Global UI running at http://localhost:${port}`);
  });

  for (const { listener } of stacks) {
    void listener.start().catch((err: unknown) => {
      console.warn(`Slack interaction listener failed to start: ${err instanceof Error ? err.message : String(err)}`);
    });
  }

  setupGracefulShutdown(server, async () => {
    await Promise.allSettled(stacks.map(({ listener }) => listener.stop()));
  });
}
