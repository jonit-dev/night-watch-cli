/**
 * HTTP API Server for Night Watch CLI
 * Provides REST API endpoints for the Web UI
 * Supports both single-project and global (multi-project) modes
 */

import { ChildProcess, execSync, spawn } from 'child_process';
import cors from 'cors';
import express, {
  Express,
  NextFunction,
  Request,
  Response,
  Router,
} from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

import { CronExpressionParser } from 'cron-parser';
import {
  CreateAgentPersonaInput,
  IAgentPersona,
  UpdateAgentPersonaInput,
} from '../../shared/types.js';
import { createBoardProvider } from '../board/factory.js';
import { BOARD_COLUMNS, BoardColumnName } from '../board/types.js';
import { performCancel } from '../commands/cancel.js';
import { validateWebhook } from '../commands/doctor.js';
import { loadConfig } from '../config.js';
import {
  CLAIM_FILE_EXTENSION,
  CONFIG_FILE_NAME,
  LOG_DIR,
  LOG_FILE_NAMES,
} from '../constants.js';
import { getRepositories } from '../storage/repositories/index.js';
import { INightWatchConfig } from '../types.js';
import { saveConfig } from '../utils/config-writer.js';
import {
  generateMarker,
  getEntries,
  getProjectEntries,
} from '../utils/crontab.js';
import { sendNotifications } from '../utils/notify.js';
import { loadRegistry, validateRegistry } from '../utils/registry.js';
import { getRoadmapStatus, scanRoadmap } from '../utils/roadmap-scanner.js';
import { loadRoadmapState } from '../utils/roadmap-state.js';
import {
  checkLockFile,
  collectPrInfo,
  collectPrdInfo,
  executorLockPath,
  fetchStatusSnapshot,
  getLastLogLines,
  reviewerLockPath,
} from '../utils/status-data.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Find the package root (works from both src/ in dev and dist/src/ in production)
function findPackageRoot(dir: string): string {
  let d = dir;
  for (let i = 0; i < 5; i++) {
    if (fs.existsSync(path.join(d, 'package.json'))) return d;
    d = dirname(d);
  }
  return dir;
}
const __packageRoot = findPackageRoot(__dirname);

// Track spawned processes
const spawnedProcesses = new Map<number, ChildProcess>();

// ==================== SSE Support ====================

/**
 * SSE client registry type
 */
type SseClientSet = Set<Response>;

/**
 * Broadcast an SSE event to all connected clients
 */
function broadcastSSE(
  clients: SseClientSet,
  event: string,
  data: unknown,
): void {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) {
    try {
      client.write(msg);
    } catch {
      clients.delete(client);
    }
  }
}

/**
 * Start the SSE status change watcher that broadcasts when snapshot changes
 */
function startSseStatusWatcher(
  clients: SseClientSet,
  projectDir: string,
  getConfig: () => INightWatchConfig,
): ReturnType<typeof setInterval> {
  let lastSnapshotHash = '';
  return setInterval(() => {
    if (clients.size === 0) return;
    try {
      const snapshot = fetchStatusSnapshot(projectDir, getConfig());
      const hash = JSON.stringify({
        processes: snapshot.processes,
        prds: snapshot.prds.map((p) => ({ n: p.name, s: p.status })),
      });
      if (hash !== lastSnapshotHash) {
        lastSnapshotHash = hash;
        broadcastSSE(clients, 'status_changed', snapshot);
      }
    } catch {
      // Silently ignore errors during status polling
    }
  }, 2000);
}

/**
 * Health check result interface
 */
interface IHealthCheck {
  name: string;
  status: 'pass' | 'fail' | 'warn';
  detail?: string;
}

/**
 * Error handler middleware
 */
function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  console.error('API Error:', err);
  res.status(500).json({ error: err.message });
}

/**
 * Validate PRD name to prevent path traversal
 */
function validatePrdName(name: string): boolean {
  return /^[a-zA-Z0-9_-]+(\.md)?$/.test(name) && !name.includes('..');
}

/**
 * Mask persona model env var values before returning API payloads.
 */
function maskPersonaSecrets(persona: IAgentPersona): IAgentPersona {
  const modelConfig = persona.modelConfig;
  const envVars = modelConfig?.envVars;
  if (!modelConfig || !envVars) return persona;

  return {
    ...persona,
    modelConfig: {
      ...modelConfig,
      envVars: Object.fromEntries(
        Object.keys(envVars).map((key) => [key, '***']),
      ),
    },
  };
}

// ==================== Extracted Route Handlers ====================

function handleGetStatus(
  projectDir: string,
  config: INightWatchConfig,
  _req: Request,
  res: Response,
): void {
  try {
    const snapshot = fetchStatusSnapshot(projectDir, config);
    res.json(snapshot);
  } catch (error) {
    res
      .status(500)
      .json({ error: error instanceof Error ? error.message : String(error) });
  }
}

function handleGetPrds(
  projectDir: string,
  config: INightWatchConfig,
  _req: Request,
  res: Response,
): void {
  try {
    const prds = collectPrdInfo(projectDir, config.prdDir, config.maxRuntime);

    const prdsWithContent = prds.map((prd) => {
      const prdPath = path.join(projectDir, config.prdDir, `${prd.name}.md`);
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
}

function handleGetPrdByName(
  projectDir: string,
  config: INightWatchConfig,
  req: Request,
  res: Response,
): void {
  try {
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
}

function handleGetPrs(
  projectDir: string,
  config: INightWatchConfig,
  _req: Request,
  res: Response,
): void {
  try {
    const prs = collectPrInfo(projectDir, config.branchPatterns);
    res.json(prs);
  } catch (error) {
    res
      .status(500)
      .json({ error: error instanceof Error ? error.message : String(error) });
  }
}

function handleGetLogs(
  projectDir: string,
  _config: INightWatchConfig,
  req: Request,
  res: Response,
): void {
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

    // Map logical name (executor/reviewer) to actual file name (night-watch/night-watch-pr-reviewer)
    const fileName = LOG_FILE_NAMES[name as string] || name;
    const logPath = path.join(projectDir, LOG_DIR, `${fileName}.log`);
    const logLines = getLastLogLines(logPath, linesToRead);

    res.json({ name, lines: logLines });
  } catch (error) {
    res
      .status(500)
      .json({ error: error instanceof Error ? error.message : String(error) });
  }
}

function handleGetConfig(
  config: INightWatchConfig,
  _req: Request,
  res: Response,
): void {
  try {
    res.json(config);
  } catch (error) {
    res
      .status(500)
      .json({ error: error instanceof Error ? error.message : String(error) });
  }
}

function handlePutConfig(
  projectDir: string,
  getConfig: () => INightWatchConfig,
  reloadConfig: () => void,
  req: Request,
  res: Response,
): void {
  try {
    let changes = req.body as Partial<INightWatchConfig>;

    if (typeof changes !== 'object' || changes === null) {
      res.status(400).json({ error: 'Invalid request body' });
      return;
    }

    if (changes.provider !== undefined) {
      const validProviders = ['claude', 'codex'];
      if (!validProviders.includes(changes.provider)) {
        res.status(400).json({
          error: `Invalid provider. Must be one of: ${validProviders.join(', ')}`,
        });
        return;
      }
    }

    if (changes.reviewerEnabled !== undefined) {
      if (typeof changes.reviewerEnabled !== 'boolean') {
        res.status(400).json({ error: 'reviewerEnabled must be a boolean' });
        return;
      }
    }

    if (changes.maxRuntime !== undefined) {
      if (typeof changes.maxRuntime !== 'number' || changes.maxRuntime < 60) {
        res.status(400).json({ error: 'maxRuntime must be a number >= 60' });
        return;
      }
    }

    if (changes.reviewerMaxRuntime !== undefined) {
      if (
        typeof changes.reviewerMaxRuntime !== 'number' ||
        changes.reviewerMaxRuntime < 60
      ) {
        res
          .status(400)
          .json({ error: 'reviewerMaxRuntime must be a number >= 60' });
        return;
      }
    }

    if (changes.minReviewScore !== undefined) {
      if (
        typeof changes.minReviewScore !== 'number' ||
        changes.minReviewScore < 0 ||
        changes.minReviewScore > 100
      ) {
        res
          .status(400)
          .json({ error: 'minReviewScore must be a number between 0 and 100' });
        return;
      }
    }

    if (changes.maxLogSize !== undefined) {
      if (typeof changes.maxLogSize !== 'number' || changes.maxLogSize < 0) {
        res.status(400).json({ error: 'maxLogSize must be a positive number' });
        return;
      }
    }

    if (changes.branchPatterns !== undefined) {
      if (
        !Array.isArray(changes.branchPatterns) ||
        !changes.branchPatterns.every((p) => typeof p === 'string')
      ) {
        res
          .status(400)
          .json({ error: 'branchPatterns must be an array of strings' });
        return;
      }
    }

    if (changes.prdPriority !== undefined) {
      if (
        !Array.isArray(changes.prdPriority) ||
        !changes.prdPriority.every((p) => typeof p === 'string')
      ) {
        res
          .status(400)
          .json({ error: 'prdPriority must be an array of strings' });
        return;
      }
    }

    if (changes.cronSchedule !== undefined) {
      if (
        typeof changes.cronSchedule !== 'string' ||
        changes.cronSchedule.trim().length === 0
      ) {
        res
          .status(400)
          .json({ error: 'cronSchedule must be a non-empty string' });
        return;
      }
    }

    if (changes.reviewerSchedule !== undefined) {
      if (
        typeof changes.reviewerSchedule !== 'string' ||
        changes.reviewerSchedule.trim().length === 0
      ) {
        res
          .status(400)
          .json({ error: 'reviewerSchedule must be a non-empty string' });
        return;
      }
    }

    if (changes.notifications?.webhooks !== undefined) {
      if (!Array.isArray(changes.notifications.webhooks)) {
        res
          .status(400)
          .json({ error: 'notifications.webhooks must be an array' });
        return;
      }

      for (const webhook of changes.notifications.webhooks) {
        const issues = validateWebhook(webhook);
        if (issues.length > 0) {
          res
            .status(400)
            .json({ error: `Invalid webhook: ${issues.join(', ')}` });
          return;
        }
      }
    }

    if (changes.roadmapScanner !== undefined) {
      const rs = changes.roadmapScanner;
      if (typeof rs !== 'object' || rs === null) {
        res.status(400).json({ error: 'roadmapScanner must be an object' });
        return;
      }

      if (rs.enabled !== undefined && typeof rs.enabled !== 'boolean') {
        res
          .status(400)
          .json({ error: 'roadmapScanner.enabled must be a boolean' });
        return;
      }

      if (rs.roadmapPath !== undefined) {
        if (
          typeof rs.roadmapPath !== 'string' ||
          rs.roadmapPath.trim().length === 0
        ) {
          res.status(400).json({
            error: 'roadmapScanner.roadmapPath must be a non-empty string',
          });
          return;
        }
      }

      if (rs.autoScanInterval !== undefined) {
        if (
          typeof rs.autoScanInterval !== 'number' ||
          rs.autoScanInterval < 30
        ) {
          res.status(400).json({
            error: 'roadmapScanner.autoScanInterval must be a number >= 30',
          });
          return;
        }
      }
    }


    const result = saveConfig(projectDir, changes);

    if (!result.success) {
      res.status(500).json({ error: result.error });
      return;
    }

    reloadConfig();
    res.json(getConfig());
  } catch (error) {
    res
      .status(500)
      .json({ error: error instanceof Error ? error.message : String(error) });
  }
}

function handleGetDoctor(
  projectDir: string,
  config: INightWatchConfig,
  _req: Request,
  res: Response,
): void {
  try {
    const checks: IHealthCheck[] = [];

    try {
      execSync('git rev-parse --is-inside-work-tree', {
        cwd: projectDir,
        stdio: 'pipe',
      });
      checks.push({
        name: 'git',
        status: 'pass',
        detail: 'Git repository detected',
      });
    } catch {
      checks.push({
        name: 'git',
        status: 'fail',
        detail: 'Not a git repository',
      });
    }

    try {
      execSync(`which ${config.provider}`, { stdio: 'pipe' });
      checks.push({
        name: 'provider',
        status: 'pass',
        detail: `Provider CLI found: ${config.provider}`,
      });
    } catch {
      checks.push({
        name: 'provider',
        status: 'fail',
        detail: `Provider CLI not found: ${config.provider}`,
      });
    }

    try {
      const projectName = path.basename(projectDir);
      const marker = generateMarker(projectName);
      const crontabEntries = [
        ...getEntries(marker),
        ...getProjectEntries(projectDir),
      ];
      if (crontabEntries.length > 0) {
        checks.push({
          name: 'crontab',
          status: 'pass',
          detail: `${crontabEntries.length} crontab entr(y/ies) installed`,
        });
      } else {
        checks.push({
          name: 'crontab',
          status: 'warn',
          detail: 'No crontab entries installed',
        });
      }
    } catch (_error) {
      checks.push({
        name: 'crontab',
        status: 'fail',
        detail: 'Failed to check crontab',
      });
    }

    const configPath = path.join(projectDir, CONFIG_FILE_NAME);
    if (fs.existsSync(configPath)) {
      checks.push({
        name: 'config',
        status: 'pass',
        detail: 'Config file exists',
      });
    } else {
      checks.push({
        name: 'config',
        status: 'warn',
        detail: 'Config file not found (using defaults)',
      });
    }

    const prdDir = path.join(projectDir, config.prdDir);
    if (fs.existsSync(prdDir)) {
      const prds = fs
        .readdirSync(prdDir)
        .filter((f) => f.endsWith('.md') && f !== 'NIGHT-WATCH-SUMMARY.md');
      checks.push({
        name: 'prdDir',
        status: 'pass',
        detail: `PRD directory exists (${prds.length} PRDs)`,
      });
    } else {
      checks.push({
        name: 'prdDir',
        status: 'warn',
        detail: `PRD directory not found: ${config.prdDir}`,
      });
    }

    res.json(checks);
  } catch (error) {
    res
      .status(500)
      .json({ error: error instanceof Error ? error.message : String(error) });
  }
}

function handleSpawnAction(
  projectDir: string,
  command: string[],
  req: Request,
  res: Response,
  onSpawned?: (pid: number) => void,
): void {
  try {
    // Prevent duplicate execution: check the lock file before spawning
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

    // Extract optional prdName for priority execution (only for "run" command)
    const prdName =
      command[0] === 'run'
        ? (req.body?.prdName as string | undefined)
        : undefined;

    // Build extra env vars for priority hint
    const extraEnv: NodeJS.ProcessEnv = {};
    if (prdName) {
      extraEnv.NW_PRD_PRIORITY = prdName; // bash script respects NW_PRD_PRIORITY
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

      // Fire notification for executor start (non-blocking)
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

      // Notify SSE clients about executor start
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
      .json({ error: error instanceof Error ? error.message : String(error) });
  }
}

function handleGetScheduleInfo(
  projectDir: string,
  config: INightWatchConfig,
  _req: Request,
  res: Response,
): void {
  try {
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
}

function handleGetRoadmap(
  projectDir: string,
  config: INightWatchConfig,
  _req: Request,
  res: Response,
): void {
  try {
    const status = getRoadmapStatus(projectDir, config);
    const prdDir = path.join(projectDir, config.prdDir);
    const state = loadRoadmapState(prdDir);
    res.json({
      ...status,
      lastScan: state.lastScan || null,
      autoScanInterval: config.roadmapScanner.autoScanInterval,
    });
  } catch (error) {
    res
      .status(500)
      .json({ error: error instanceof Error ? error.message : String(error) });
  }
}

async function handlePostRoadmapScan(
  projectDir: string,
  config: INightWatchConfig,
  _req: Request,
  res: Response,
): Promise<void> {
  try {
    if (!config.roadmapScanner.enabled) {
      res.status(409).json({ error: 'Roadmap scanner is disabled' });
      return;
    }

    const result = await scanRoadmap(projectDir, config);
    res.json(result);
  } catch (error) {
    res
      .status(500)
      .json({ error: error instanceof Error ? error.message : String(error) });
  }
}

function handlePutRoadmapToggle(
  projectDir: string,
  getConfig: () => INightWatchConfig,
  reloadConfig: () => void,
  req: Request,
  res: Response,
): void {
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
    res
      .status(500)
      .json({ error: error instanceof Error ? error.message : String(error) });
  }
}

// ==================== Slack Integration ====================

import { SlackClient } from '../slack/client.js';
import { SlackInteractionListener } from '../slack/interaction-listener.js';

async function handlePostSlackChannels(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const { botToken } = (req.body ?? {}) as { botToken?: string };
    if (!botToken || typeof botToken !== 'string') {
      res.status(400).json({ error: 'botToken is required' });
      return;
    }

    const slack = new SlackClient(botToken);
    const channels = await slack.listChannels();
    res.json(channels);
  } catch (error) {
    res
      .status(500)
      .json({ error: error instanceof Error ? error.message : String(error) });
  }
}

async function handlePostSlackChannelCreate(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const { botToken, name } = (req.body ?? {}) as {
      botToken?: string;
      name?: string;
    };
    if (!botToken || typeof botToken !== 'string') {
      res.status(400).json({ error: 'botToken is required' });
      return;
    }
    if (!name || typeof name !== 'string') {
      res.status(400).json({ error: 'name is required' });
      return;
    }

    const slack = new SlackClient(botToken);
    const channelId = await slack.createChannel(name);
    let invitedCount = 0;
    let inviteWarning: string | null = null;
    let welcomeMessagePosted = false;

    // Auto-invite everyone in the workspace
    try {
      const users = await slack.listUsers();
      const userIds = users.map((u) => u.id);
      if (userIds.length > 0) {
        // inviteUsers can take up to 1000 IDs
        invitedCount = await slack.inviteUsers(channelId, userIds);
      }
    } catch (inviteErr) {
      console.warn('Failed to auto-invite users to new channel:', inviteErr);
      inviteWarning =
        inviteErr instanceof Error ? inviteErr.message : String(inviteErr);
    }

    // Post a first message so the channel pops up in the user's Slack
    try {
      await slack.postMessage(
        channelId,
        `👋 *Night Watch AI* has linked this channel for integration. Ready to work!`,
      );
      welcomeMessagePosted = true;
    } catch (msgErr) {
      console.warn('Failed to post welcome message to new channel:', msgErr);
    }

    res.json({
      channelId,
      invitedCount,
      inviteWarning,
      welcomeMessagePosted,
    });
  } catch (error) {
    res
      .status(500)
      .json({ error: error instanceof Error ? error.message : String(error) });
  }
}

// ==================== Board Cache ====================

interface IBoardCache {
  data: unknown;
  timestamp: number;
}

const BOARD_CACHE_TTL_MS = 60_000; // 60 seconds
const boardCacheMap = new Map<string, IBoardCache>();

function getCachedBoardData(projectDir: string): unknown | null {
  const entry = boardCacheMap.get(projectDir);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > BOARD_CACHE_TTL_MS) {
    boardCacheMap.delete(projectDir);
    return null;
  }
  return entry.data;
}

function setCachedBoardData(projectDir: string, data: unknown): void {
  boardCacheMap.set(projectDir, { data, timestamp: Date.now() });
}

function invalidateBoardCache(projectDir: string): void {
  boardCacheMap.delete(projectDir);
}

// ==================== Board Handlers ====================

function getBoardProvider(config: INightWatchConfig, projectDir: string) {
  if (!config.boardProvider?.enabled || !config.boardProvider?.projectNumber) {
    return null;
  }
  return createBoardProvider(config.boardProvider, projectDir);
}

async function handleGetBoardStatus(
  projectDir: string,
  config: INightWatchConfig,
  _req: Request,
  res: Response,
): Promise<void> {
  try {
    const provider = getBoardProvider(config, projectDir);
    if (!provider) {
      res.status(404).json({ error: 'Board not configured' });
      return;
    }

    const cached = getCachedBoardData(projectDir);
    if (cached) {
      res.json(cached);
      return;
    }

    const issues = await provider.getAllIssues();
    const columns: Record<BoardColumnName, typeof issues> = {
      Draft: [],
      Ready: [],
      'In Progress': [],
      Review: [],
      Done: [],
    };
    for (const issue of issues) {
      const col = issue.column ?? 'Draft';
      columns[col].push(issue);
    }

    const result = { enabled: true, columns };
    setCachedBoardData(projectDir, result);
    res.json(result);
  } catch (error) {
    res
      .status(500)
      .json({ error: error instanceof Error ? error.message : String(error) });
  }
}

async function handleGetBoardIssues(
  projectDir: string,
  config: INightWatchConfig,
  _req: Request,
  res: Response,
): Promise<void> {
  try {
    const provider = getBoardProvider(config, projectDir);
    if (!provider) {
      res.status(404).json({ error: 'Board not configured' });
      return;
    }
    const issues = await provider.getAllIssues();
    res.json(issues);
  } catch (error) {
    res
      .status(500)
      .json({ error: error instanceof Error ? error.message : String(error) });
  }
}

async function handlePostBoardIssue(
  projectDir: string,
  config: INightWatchConfig,
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const provider = getBoardProvider(config, projectDir);
    if (!provider) {
      res.status(404).json({ error: 'Board not configured' });
      return;
    }
    const { title, body, column } = req.body as {
      title?: string;
      body?: string;
      column?: BoardColumnName;
    };
    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      res.status(400).json({ error: 'title is required' });
      return;
    }
    if (column && !BOARD_COLUMNS.includes(column)) {
      res.status(400).json({
        error: `Invalid column. Must be one of: ${BOARD_COLUMNS.join(', ')}`,
      });
      return;
    }
    const issue = await provider.createIssue({
      title: title.trim(),
      body: body ?? '',
      column,
    });
    invalidateBoardCache(projectDir);
    res.status(201).json(issue);
  } catch (error) {
    res
      .status(500)
      .json({ error: error instanceof Error ? error.message : String(error) });
  }
}

async function handlePatchBoardIssueMove(
  projectDir: string,
  config: INightWatchConfig,
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const provider = getBoardProvider(config, projectDir);
    if (!provider) {
      res.status(404).json({ error: 'Board not configured' });
      return;
    }
    const issueNumber = parseInt(req.params.number as string, 10);
    if (isNaN(issueNumber)) {
      res.status(400).json({ error: 'Invalid issue number' });
      return;
    }
    const { column } = req.body as { column?: BoardColumnName };
    if (!column || !BOARD_COLUMNS.includes(column)) {
      res.status(400).json({
        error: `Invalid column. Must be one of: ${BOARD_COLUMNS.join(', ')}`,
      });
      return;
    }
    await provider.moveIssue(issueNumber, column);
    invalidateBoardCache(projectDir);
    res.json({ moved: true });
  } catch (error) {
    res
      .status(500)
      .json({ error: error instanceof Error ? error.message : String(error) });
  }
}

async function handlePostBoardIssueComment(
  projectDir: string,
  config: INightWatchConfig,
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const provider = getBoardProvider(config, projectDir);
    if (!provider) {
      res.status(404).json({ error: 'Board not configured' });
      return;
    }
    const issueNumber = parseInt(req.params.number as string, 10);
    if (isNaN(issueNumber)) {
      res.status(400).json({ error: 'Invalid issue number' });
      return;
    }
    const { body } = req.body as { body?: string };
    if (!body || typeof body !== 'string' || body.trim().length === 0) {
      res.status(400).json({ error: 'body is required' });
      return;
    }
    await provider.commentOnIssue(issueNumber, body);
    invalidateBoardCache(projectDir);
    res.json({ commented: true });
  } catch (error) {
    res
      .status(500)
      .json({ error: error instanceof Error ? error.message : String(error) });
  }
}

async function handleDeleteBoardIssue(
  projectDir: string,
  config: INightWatchConfig,
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const provider = getBoardProvider(config, projectDir);
    if (!provider) {
      res.status(404).json({ error: 'Board not configured' });
      return;
    }
    const issueNumber = parseInt(req.params.number as string, 10);
    if (isNaN(issueNumber)) {
      res.status(400).json({ error: 'Invalid issue number' });
      return;
    }
    await provider.closeIssue(issueNumber);
    invalidateBoardCache(projectDir);
    res.json({ closed: true });
  } catch (error) {
    res
      .status(500)
      .json({ error: error instanceof Error ? error.message : String(error) });
  }
}

async function handleCancelAction(
  projectDir: string,
  req: Request,
  res: Response,
): Promise<void> {
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
      .json({ error: error instanceof Error ? error.message : String(error) });
  }
}

function handleRetryAction(
  projectDir: string,
  config: INightWatchConfig,
  req: Request,
  res: Response,
): void {
  try {
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
    res
      .status(500)
      .json({ error: error instanceof Error ? error.message : String(error) });
  }
}

/**
 * Handle clearing stale executor lock and orphaned claim files.
 * Returns 409 if executor is actively running (should use Stop instead).
 */
function handleClearLockAction(
  projectDir: string,
  config: INightWatchConfig,
  sseClients: SseClientSet,
  _req: Request,
  res: Response,
): void {
  try {
    const lockPath = executorLockPath(projectDir);
    const lock = checkLockFile(lockPath);

    if (lock.running) {
      res
        .status(409)
        .json({ error: 'Executor is actively running — use Stop instead' });
      return;
    }

    // Remove the stale lock file if it exists
    if (fs.existsSync(lockPath)) {
      fs.unlinkSync(lockPath);
    }

    // Clean up any orphaned claim files
    const prdDir = path.join(projectDir, config.prdDir);
    if (fs.existsSync(prdDir)) {
      cleanOrphanedClaims(prdDir);
    }

    // Broadcast updated status via SSE
    broadcastSSE(
      sseClients,
      'status_changed',
      fetchStatusSnapshot(projectDir, config),
    );

    res.json({ cleared: true });
  } catch (error) {
    res
      .status(500)
      .json({ error: error instanceof Error ? error.message : String(error) });
  }
}

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
      // This is a claim file - remove it since executor is not running
      try {
        fs.unlinkSync(fullPath);
      } catch {
        // Ignore errors during cleanup
      }
    }
  }
}

// ==================== Static Files + SPA Fallback ====================

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

/**
 * Create and configure the Express application (single-project mode)
 */
export function createApp(projectDir: string): Express {
  const app = express();

  app.use(cors());
  app.use(express.json());

  let config = loadConfig(projectDir);

  const reloadConfig = () => {
    config = loadConfig(projectDir);
  };

  // SSE client registry for real-time push
  const sseClients: SseClientSet = new Set();

  // SSE endpoint for real-time status updates
  app.get('/api/status/events', (req: Request, res: Response): void => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    sseClients.add(res);

    // Send current snapshot immediately on connect
    try {
      const snapshot = fetchStatusSnapshot(projectDir, config);
      res.write(`event: status_changed\ndata: ${JSON.stringify(snapshot)}\n\n`);
    } catch {
      // Ignore errors during initial snapshot
    }

    req.on('close', () => {
      sseClients.delete(res);
    });
  });

  // Start the SSE status watcher (runs until process exits)
  startSseStatusWatcher(sseClients, projectDir, () => config);

  // API Routes
  app.get('/api/status', (req, res) =>
    handleGetStatus(projectDir, config, req, res),
  );
  app.get('/api/schedule-info', (req, res) =>
    handleGetScheduleInfo(projectDir, config, req, res),
  );
  app.get('/api/prds', (req, res) =>
    handleGetPrds(projectDir, config, req, res),
  );
  app.get('/api/prds/:name', (req, res) =>
    handleGetPrdByName(projectDir, config, req, res),
  );
  app.get('/api/prs', (req, res) => handleGetPrs(projectDir, config, req, res));
  app.get('/api/logs/:name', (req, res) =>
    handleGetLogs(projectDir, config, req, res),
  );
  app.get('/api/config', (req, res) => handleGetConfig(config, req, res));
  app.put('/api/config', (req, res) =>
    handlePutConfig(projectDir, () => config, reloadConfig, req, res),
  );
  app.get('/api/doctor', (req, res) =>
    handleGetDoctor(projectDir, config, req, res),
  );
  app.post('/api/actions/run', (req, res) =>
    handleSpawnAction(projectDir, ['run'], req, res, (pid) => {
      broadcastSSE(sseClients, 'executor_started', { pid });
    }),
  );
  app.post('/api/actions/review', (req, res) =>
    handleSpawnAction(projectDir, ['review'], req, res),
  );
  app.post('/api/actions/install-cron', (req, res) =>
    handleSpawnAction(projectDir, ['install'], req, res),
  );
  app.post('/api/actions/uninstall-cron', (req, res) =>
    handleSpawnAction(projectDir, ['uninstall'], req, res),
  );
  app.post('/api/actions/cancel', (req, res) =>
    handleCancelAction(projectDir, req, res),
  );
  app.post('/api/actions/retry', (req, res) =>
    handleRetryAction(projectDir, config, req, res),
  );
  app.post('/api/actions/clear-lock', (req, res) =>
    handleClearLockAction(projectDir, config, sseClients, req, res),
  );
  app.get('/api/roadmap', (req, res) =>
    handleGetRoadmap(projectDir, config, req, res),
  );
  app.post('/api/roadmap/scan', (req, res) =>
    handlePostRoadmapScan(projectDir, config, req, res),
  );
  app.put('/api/roadmap/toggle', (req, res) =>
    handlePutRoadmapToggle(projectDir, () => config, reloadConfig, req, res),
  );

  app.post('/api/slack/channels/create', (req, res) =>
    handlePostSlackChannelCreate(req, res),
  );

  app.post('/api/slack/channels', (req, res) =>
    handlePostSlackChannels(req, res),
  );

  // Board routes
  app.get('/api/board/status', (req, res) =>
    handleGetBoardStatus(projectDir, config, req, res),
  );
  app.get('/api/board/issues', (req, res) =>
    handleGetBoardIssues(projectDir, config, req, res),
  );
  app.post('/api/board/issues', (req, res) =>
    handlePostBoardIssue(projectDir, config, req, res),
  );
  app.patch('/api/board/issues/:number/move', (req, res) =>
    handlePatchBoardIssueMove(projectDir, config, req, res),
  );
  app.post('/api/board/issues/:number/comment', (req, res) =>
    handlePostBoardIssueComment(projectDir, config, req, res),
  );
  app.delete('/api/board/issues/:number', (req, res) =>
    handleDeleteBoardIssue(projectDir, config, req, res),
  );

  // ==================== Agent Personas ====================

  app.post('/api/agents/seed-defaults', (_req, res) => {
    try {
      const repos = getRepositories();
      repos.agentPersona.seedDefaults();
      res.json({ message: 'Default personas seeded successfully' });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/api/agents', (_req, res) => {
    try {
      const repos = getRepositories();
      const personas = repos.agentPersona.getAll();
      const masked = personas.map(maskPersonaSecrets);
      res.json(masked);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/api/agents/:id', (req, res) => {
    try {
      const repos = getRepositories();
      const persona = repos.agentPersona.getById(req.params.id as string);
      if (!persona) return res.status(404).json({ error: 'Agent not found' });
      const masked = maskPersonaSecrets(persona);
      return res.json(masked);
    } catch (err) {
      return res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/api/agents/:id/prompt', async (req, res) => {
    try {
      const repos = getRepositories();
      const persona = repos.agentPersona.getById(req.params.id as string);
      if (!persona) return res.status(404).json({ error: 'Agent not found' });
      const { compileSoul } = await import('../agents/soul-compiler.js');
      const prompt = compileSoul(persona);
      return res.json({ prompt });
    } catch (err) {
      return res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post('/api/agents', (req, res) => {
    try {
      const repos = getRepositories();
      const input = req.body as CreateAgentPersonaInput;
      if (!input.name || !input.role) {
        return res.status(400).json({ error: 'name and role are required' });
      }
      const persona = repos.agentPersona.create(input);
      return res.status(201).json(maskPersonaSecrets(persona));
    } catch (err) {
      return res.status(500).json({ error: (err as Error).message });
    }
  });

  app.put('/api/agents/:id', (req, res) => {
    try {
      const repos = getRepositories();
      const persona = repos.agentPersona.update(
        req.params.id as string,
        req.body as UpdateAgentPersonaInput,
      );
      res.json(maskPersonaSecrets(persona));
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes('not found'))
        return res.status(404).json({ error: msg });
      return res.status(500).json({ error: msg });
    }
  });

  app.delete('/api/agents/:id', (req, res) => {
    try {
      const repos = getRepositories();
      repos.agentPersona.delete(req.params.id as string);
      res.status(204).send();
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post('/api/agents/:id/avatar', (req, res) => {
    try {
      const repos = getRepositories();
      const { avatarUrl } = req.body as { avatarUrl: string };
      if (!avatarUrl)
        return res.status(400).json({ error: 'avatarUrl is required' });
      const persona = repos.agentPersona.update(req.params.id as string, {
        avatarUrl,
      });
      return res.json(maskPersonaSecrets(persona));
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes('not found'))
        return res.status(404).json({ error: msg });
      return res.status(500).json({ error: msg });
    }
  });

  // ==================== Slack Discussions ====================

  app.get('/api/discussions', (_req, res) => {
    try {
      const repos = getRepositories();
      const discussions = repos.slackDiscussion.getActive(projectDir);
      res.json(discussions);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/api/discussions/:id', (req, res) => {
    try {
      const repos = getRepositories();
      const discussion = repos.slackDiscussion.getById(req.params.id as string);
      if (!discussion)
        return res.status(404).json({ error: 'Discussion not found' });
      return res.json(discussion);
    } catch (err) {
      return res.status(500).json({ error: (err as Error).message });
    }
  });

  // Auto-scan timer
  let autoScanTimer: ReturnType<typeof setInterval> | null = null;

  function startAutoScan(): void {
    stopAutoScan();
    const currentConfig = loadConfig(projectDir);
    if (!currentConfig.roadmapScanner.enabled) return;
    const intervalMs = currentConfig.roadmapScanner.autoScanInterval * 1000;
    autoScanTimer = setInterval(() => {
      const cfg = loadConfig(projectDir);
      if (!cfg.roadmapScanner.enabled) return;
      const status = getRoadmapStatus(projectDir, cfg);
      if (status.status === 'complete' || status.status === 'no-roadmap')
        return;
      // Fire and forget - async scan
      scanRoadmap(projectDir, cfg).catch(() => {
        // Silently ignore auto-scan errors
      });
    }, intervalMs);
  }

  function stopAutoScan(): void {
    if (autoScanTimer) {
      clearInterval(autoScanTimer);
      autoScanTimer = null;
    }
  }

  if (config.roadmapScanner.enabled) {
    startAutoScan();
  }

  setupStaticFiles(app);
  app.use(errorHandler);

  return app;
}

// ==================== Global (Multi-Project) Mode ====================

/**
 * Middleware that resolves a project from the registry by :projectId param
 */
function resolveProject(req: Request, res: Response, next: NextFunction): void {
  const projectId = req.params.projectId as string;
  // Decode ~ back to / (frontend encodes / as ~ to avoid Express 5 %2F routing issues)
  const decodedId = decodeURIComponent(projectId).replace(/~/g, '/');
  const entries = loadRegistry();
  const entry = entries.find((e) => e.name === decodedId);

  if (!entry) {
    res.status(404).json({ error: `Project not found: ${decodedId}` });
    return;
  }

  if (
    !fs.existsSync(entry.path) ||
    !fs.existsSync(path.join(entry.path, CONFIG_FILE_NAME))
  ) {
    res
      .status(404)
      .json({ error: `Project path invalid or missing config: ${entry.path}` });
    return;
  }

  req.projectDir = entry.path;
  req.projectConfig = loadConfig(entry.path);
  next();
}

/**
 * Create a router with all project-scoped endpoints
 */
function createProjectRouter(): Router {
  const router = Router({ mergeParams: true });

  // Per-project SSE client registry and watchers
  const projectSseClients = new Map<string, SseClientSet>();
  const projectSseWatchers = new Map<string, ReturnType<typeof setInterval>>();

  const dir = (req: Request): string => req.projectDir!;
  const cfg = (req: Request): INightWatchConfig => req.projectConfig!;

  // SSE endpoint for project-scoped status updates
  router.get('/status/events', (req: Request, res: Response): void => {
    const projectDir = dir(req);
    const config = cfg(req);

    // Initialize client set for this project if not exists
    if (!projectSseClients.has(projectDir)) {
      projectSseClients.set(projectDir, new Set());
    }
    const clients = projectSseClients.get(projectDir)!;

    // Start watcher for this project if not already running
    if (!projectSseWatchers.has(projectDir)) {
      const watcher = startSseStatusWatcher(clients, projectDir, () =>
        loadConfig(projectDir),
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

  router.get('/status', (req, res) =>
    handleGetStatus(dir(req), cfg(req), req, res),
  );
  router.get('/schedule-info', (req, res) =>
    handleGetScheduleInfo(dir(req), cfg(req), req, res),
  );
  router.get('/prds', (req, res) =>
    handleGetPrds(dir(req), cfg(req), req, res),
  );
  router.get('/prds/:name', (req, res) =>
    handleGetPrdByName(dir(req), cfg(req), req, res),
  );
  router.get('/prs', (req, res) => handleGetPrs(dir(req), cfg(req), req, res));
  router.get('/logs/:name', (req, res) =>
    handleGetLogs(dir(req), cfg(req), req, res),
  );
  router.get('/config', (req, res) => handleGetConfig(cfg(req), req, res));
  router.put('/config', (req, res) => {
    const projectDir = dir(req);
    let config = cfg(req);
    handlePutConfig(
      projectDir,
      () => config,
      () => {
        config = loadConfig(projectDir);
      },
      req,
      res,
    );
  });
  router.get('/doctor', (req, res) =>
    handleGetDoctor(dir(req), cfg(req), req, res),
  );
  router.post('/actions/run', (req, res) => {
    const projectDir = dir(req);
    handleSpawnAction(projectDir, ['run'], req, res, (pid) => {
      const clients = projectSseClients.get(projectDir);
      if (clients) {
        broadcastSSE(clients, 'executor_started', { pid });
      }
    });
  });
  router.post('/actions/review', (req, res) =>
    handleSpawnAction(dir(req), ['review'], req, res),
  );
  router.post('/actions/install-cron', (req, res) =>
    handleSpawnAction(dir(req), ['install'], req, res),
  );
  router.post('/actions/uninstall-cron', (req, res) =>
    handleSpawnAction(dir(req), ['uninstall'], req, res),
  );
  router.post('/actions/cancel', (req, res) =>
    handleCancelAction(dir(req), req, res),
  );
  router.post('/actions/retry', (req, res) =>
    handleRetryAction(dir(req), cfg(req), req, res),
  );
  router.post('/actions/clear-lock', (req, res) => {
    const projectDir = dir(req);
    const config = cfg(req);
    const clients = projectSseClients.get(projectDir);
    handleClearLockAction(projectDir, config, clients ?? new Set(), req, res);
  });
  router.get('/roadmap', (req, res) =>
    handleGetRoadmap(dir(req), cfg(req), req, res),
  );
  router.post('/roadmap/scan', (req, res) =>
    handlePostRoadmapScan(dir(req), cfg(req), req, res),
  );
  router.put('/roadmap/toggle', (req, res) => {
    const projectDir = dir(req);
    let config = cfg(req);
    handlePutRoadmapToggle(
      projectDir,
      () => config,
      () => {
        config = loadConfig(projectDir);
      },
      req,
      res,
    );
  });

  // Board routes
  router.get('/board/status', (req, res) =>
    handleGetBoardStatus(dir(req), cfg(req), req, res),
  );
  router.get('/board/issues', (req, res) =>
    handleGetBoardIssues(dir(req), cfg(req), req, res),
  );
  router.post('/board/issues', (req, res) =>
    handlePostBoardIssue(dir(req), cfg(req), req, res),
  );
  router.patch('/board/issues/:number/move', (req, res) =>
    handlePatchBoardIssueMove(dir(req), cfg(req), req, res),
  );
  router.post('/board/issues/:number/comment', (req, res) =>
    handlePostBoardIssueComment(dir(req), cfg(req), req, res),
  );
  router.delete('/board/issues/:number', (req, res) =>
    handleDeleteBoardIssue(dir(req), cfg(req), req, res),
  );

  // ==================== Agent Personas ====================

  router.post('/agents/seed-defaults', (_req, res) => {
    try {
      const repos = getRepositories();
      repos.agentPersona.seedDefaults();
      res.json({ message: 'Default personas seeded successfully' });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.get('/agents', (_req, res) => {
    try {
      const repos = getRepositories();
      const personas = repos.agentPersona.getAll();
      const masked = personas.map(maskPersonaSecrets);
      res.json(masked);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.get('/agents/:id', (req, res) => {
    try {
      const repos = getRepositories();
      const persona = repos.agentPersona.getById(req.params.id as string);
      if (!persona) return res.status(404).json({ error: 'Agent not found' });
      const masked = maskPersonaSecrets(persona);
      return res.json(masked);
    } catch (err) {
      return res.status(500).json({ error: (err as Error).message });
    }
  });

  router.get('/agents/:id/prompt', async (req, res) => {
    try {
      const repos = getRepositories();
      const persona = repos.agentPersona.getById(req.params.id as string);
      if (!persona) return res.status(404).json({ error: 'Agent not found' });
      const { compileSoul } = await import('../agents/soul-compiler.js');
      const prompt = compileSoul(persona);
      return res.json({ prompt });
    } catch (err) {
      return res.status(500).json({ error: (err as Error).message });
    }
  });

  router.post('/agents', (req, res) => {
    try {
      const repos = getRepositories();
      const input = req.body as CreateAgentPersonaInput;
      if (!input.name || !input.role) {
        return res.status(400).json({ error: 'name and role are required' });
      }
      const persona = repos.agentPersona.create(input);
      return res.status(201).json(maskPersonaSecrets(persona));
    } catch (err) {
      return res.status(500).json({ error: (err as Error).message });
    }
  });

  router.put('/agents/:id', (req, res) => {
    try {
      const repos = getRepositories();
      const persona = repos.agentPersona.update(
        req.params.id as string,
        req.body as UpdateAgentPersonaInput,
      );
      res.json(maskPersonaSecrets(persona));
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes('not found'))
        return res.status(404).json({ error: msg });
      return res.status(500).json({ error: msg });
    }
  });

  router.delete('/agents/:id', (req, res) => {
    try {
      const repos = getRepositories();
      repos.agentPersona.delete(req.params.id as string);
      res.status(204).send();
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.post('/agents/:id/avatar', (req, res) => {
    try {
      const repos = getRepositories();
      const { avatarUrl } = req.body as { avatarUrl: string };
      if (!avatarUrl)
        return res.status(400).json({ error: 'avatarUrl is required' });
      const persona = repos.agentPersona.update(req.params.id as string, {
        avatarUrl,
      });
      return res.json(maskPersonaSecrets(persona));
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes('not found'))
        return res.status(404).json({ error: msg });
      return res.status(500).json({ error: msg });
    }
  });

  // ==================== Slack Channels ====================

  router.post('/slack/channels', (req, res) =>
    handlePostSlackChannels(req, res),
  );
  router.post('/slack/channels/create', (req, res) =>
    handlePostSlackChannelCreate(req, res),
  );

  // ==================== Slack Discussions ====================

  router.get('/discussions', (req, res) => {
    try {
      const repos = getRepositories();
      const discussions = repos.slackDiscussion.getActive(dir(req));
      res.json(discussions);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.get('/discussions/:id', (req, res) => {
    try {
      const repos = getRepositories();
      const discussion = repos.slackDiscussion.getById(req.params.id as string);
      if (!discussion)
        return res.status(404).json({ error: 'Discussion not found' });
      return res.json(discussion);
    } catch (err) {
      return res.status(500).json({ error: (err as Error).message });
    }
  });

  return router;
}

/**
 * Create the Express application for global (multi-project) mode
 */
export function createGlobalApp(): Express {
  const app = express();

  app.use(cors());
  app.use(express.json());

  // List all registered projects
  app.get('/api/projects', (_req: Request, res: Response): void => {
    try {
      const entries = loadRegistry();
      const { invalid } = validateRegistry();
      const invalidPaths = new Set(invalid.map((e) => e.path));

      res.json(
        entries.map((e) => ({
          name: e.name,
          path: e.path,
          valid: !invalidPaths.has(e.path),
        })),
      );
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Project-scoped routes
  app.use('/api/projects/:projectId', resolveProject, createProjectRouter());

  setupStaticFiles(app);
  app.use(errorHandler);

  return app;
}

// ==================== Server Startup ====================

/**
 * Graceful shutdown handler
 */
function setupGracefulShutdown(
  server: ReturnType<Express['listen']>,
  beforeClose?: () => Promise<void> | void,
): void {
  let shuttingDown = false;

  const shutdown = (signal: 'SIGTERM' | 'SIGINT'): void => {
    if (shuttingDown) return;
    shuttingDown = true;

    if (signal === 'SIGINT') {
      console.log('\nSIGINT received, shutting down server...');
    } else {
      console.log('SIGTERM received, shutting down server...');
    }

    Promise.resolve(beforeClose?.())
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`Pre-shutdown cleanup failed: ${message}`);
      })
      .finally(() => {
        server.close(() => {
          console.log('Server closed');
          process.exit(0);
        });
      });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

/**
 * Start the HTTP server (single-project mode)
 */
export function startServer(projectDir: string, port: number): void {
  const config = loadConfig(projectDir);
  const app = createApp(projectDir);
  const listener = new SlackInteractionListener(config);

  const server = app.listen(port, () => {
    console.log(`\nNight Watch UI  http://localhost:${port}`);
    console.log(`Project         ${projectDir}`);
    console.log(`Provider        ${config.provider}`);

    const slack = config.slack;
    if (slack?.enabled && slack.botToken) {
      console.log(`Slack           enabled — channels: ${Object.entries(slack.channels ?? {}).map(([k, v]) => `#${k}=${v}`).join(', ')}`);
      if (slack.replicateApiToken) {
        console.log(`Avatar gen      Replicate Flux enabled`);
      }
    } else {
      console.log(`Slack           not configured`);
    }
    console.log('');
  });

  void listener.start().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`Slack interaction listener failed to start: ${message}`);
  });

  setupGracefulShutdown(server, async () => {
    await listener.stop();
  });
}

/**
 * Start the HTTP server (global multi-project mode)
 */
export function startGlobalServer(port: number): void {
  const entries = loadRegistry();

  if (entries.length === 0) {
    console.error(
      "No projects registered. Run 'night-watch init' in a project first.",
    );
    process.exit(1);
  }

  const { valid, invalid } = validateRegistry();
  if (invalid.length > 0) {
    console.warn(
      `Warning: ${invalid.length} registered project(s) have invalid paths and will be skipped.`,
    );
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
  const listenersBySlackToken = new Map<string, SlackInteractionListener>();
  for (const project of valid) {
    const config = loadConfig(project.path);
    const slack = config.slack;
    if (
      !slack?.enabled ||
      !slack.discussionEnabled ||
      !slack.botToken ||
      !slack.appToken
    ) {
      continue;
    }

    const key = `${slack.botToken}:${slack.appToken}`;
    if (!listenersBySlackToken.has(key)) {
      listenersBySlackToken.set(key, new SlackInteractionListener(config));
    }
  }
  const listeners = Array.from(listenersBySlackToken.values());

  const server = app.listen(port, () => {
    console.log(`Night Watch Global UI running at http://localhost:${port}`);
  });

  for (const listener of listeners) {
    void listener.start().catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`Slack interaction listener failed to start: ${message}`);
    });
  }

  setupGracefulShutdown(server, async () => {
    await Promise.allSettled(listeners.map((listener) => listener.stop()));
  });
}
