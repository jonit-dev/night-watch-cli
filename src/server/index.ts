/**
 * HTTP API Server for Night Watch CLI
 * Provides REST API endpoints for the Web UI
 * Supports both single-project and global (multi-project) modes
 */

import express, { Express, NextFunction, Request, Response, Router } from "express";
import cors from "cors";
import { ChildProcess, execSync, spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { dirname } from "path";
import { fileURLToPath } from "url";

import { CONFIG_FILE_NAME, LOG_DIR } from "../constants.js";
import { INightWatchConfig } from "../types.js";
import { loadConfig } from "../config.js";
import { validateWebhook } from "../commands/doctor.js";
import { checkLockFile, collectPrInfo, collectPrdInfo, executorLockPath, fetchStatusSnapshot, getLastLogLines, reviewerLockPath } from "../utils/status-data.js";
import { performCancel } from "../commands/cancel.js";
import { saveConfig } from "../utils/config-writer.js";
import { loadRegistry, validateRegistry } from "../utils/registry.js";
import { generateMarker, getEntries, getProjectEntries } from "../utils/crontab.js";
import { CronExpressionParser } from "cron-parser";
import { sendNotifications } from "../utils/notify.js";
import { getRoadmapStatus, scanRoadmap } from "../utils/roadmap-scanner.js";
import { loadRoadmapState } from "../utils/roadmap-state.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Track spawned processes
const spawnedProcesses = new Map<number, ChildProcess>();

/**
 * Health check result interface
 */
interface IHealthCheck {
  name: string;
  status: "pass" | "fail" | "warn";
  detail?: string;
}

/**
 * Error handler middleware
 */
function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  console.error("API Error:", err);
  res.status(500).json({ error: err.message });
}

/**
 * Validate PRD name to prevent path traversal
 */
function validatePrdName(name: string): boolean {
  return /^[a-zA-Z0-9_-]+(\.md)?$/.test(name) && !name.includes("..");
}

// ==================== Extracted Route Handlers ====================

function handleGetStatus(projectDir: string, config: INightWatchConfig, _req: Request, res: Response): void {
  try {
    const snapshot = fetchStatusSnapshot(projectDir, config);
    res.json(snapshot);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
}

function handleGetPrds(projectDir: string, config: INightWatchConfig, _req: Request, res: Response): void {
  try {
    const prds = collectPrdInfo(projectDir, config.prdDir, config.maxRuntime);

    const prdsWithContent = prds.map((prd) => {
      const prdPath = path.join(projectDir, config.prdDir, `${prd.name}.md`);
      let content = "";
      if (fs.existsSync(prdPath)) {
        try {
          content = fs.readFileSync(prdPath, "utf-8");
        } catch {
          content = "";
        }
      }
      return { ...prd, content };
    });

    res.json(prdsWithContent);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
}

function handleGetPrdByName(projectDir: string, config: INightWatchConfig, req: Request, res: Response): void {
  try {
    const { name } = req.params;

    if (!validatePrdName(name as string)) {
      res.status(400).json({ error: "Invalid PRD name" });
      return;
    }

    const nameStr = name as string;
    const filename = nameStr.endsWith(".md") ? nameStr : `${nameStr}.md`;
    const prdPath = path.join(projectDir, config.prdDir, filename);

    if (!fs.existsSync(prdPath)) {
      res.status(404).json({ error: "PRD not found" });
      return;
    }

    const content = fs.readFileSync(prdPath, "utf-8");
    res.json({ name: filename.replace(/\.md$/, ""), content });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
}

function handleGetPrs(projectDir: string, config: INightWatchConfig, _req: Request, res: Response): void {
  try {
    const prs = collectPrInfo(projectDir, config.branchPatterns);
    res.json(prs);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
}

function handleGetLogs(projectDir: string, _config: INightWatchConfig, req: Request, res: Response): void {
  try {
    const { name } = req.params;

    const validNames = ["executor", "reviewer"];
    if (!validNames.includes(name as string)) {
      res.status(400).json({ error: `Invalid log name. Must be one of: ${validNames.join(", ")}` });
      return;
    }

    const linesParam = req.query.lines;
    const lines = typeof linesParam === "string" ? parseInt(linesParam, 10) : 200;
    const linesToRead = isNaN(lines) || lines < 1 ? 200 : Math.min(lines, 10000);

    const logPath = path.join(projectDir, LOG_DIR, `${name as string}.log`);
    const logLines = getLastLogLines(logPath, linesToRead);

    res.json({ name, lines: logLines });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
}

function handleGetConfig(config: INightWatchConfig, _req: Request, res: Response): void {
  try {
    res.json(config);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
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
    const changes = req.body as Partial<INightWatchConfig>;

    if (typeof changes !== "object" || changes === null) {
      res.status(400).json({ error: "Invalid request body" });
      return;
    }

    if (changes.provider !== undefined) {
      const validProviders = ["claude", "codex"];
      if (!validProviders.includes(changes.provider)) {
        res.status(400).json({ error: `Invalid provider. Must be one of: ${validProviders.join(", ")}` });
        return;
      }
    }

    if (changes.reviewerEnabled !== undefined) {
      if (typeof changes.reviewerEnabled !== "boolean") {
        res.status(400).json({ error: "reviewerEnabled must be a boolean" });
        return;
      }
    }

    if (changes.maxRuntime !== undefined) {
      if (typeof changes.maxRuntime !== "number" || changes.maxRuntime < 60) {
        res.status(400).json({ error: "maxRuntime must be a number >= 60" });
        return;
      }
    }

    if (changes.reviewerMaxRuntime !== undefined) {
      if (typeof changes.reviewerMaxRuntime !== "number" || changes.reviewerMaxRuntime < 60) {
        res.status(400).json({ error: "reviewerMaxRuntime must be a number >= 60" });
        return;
      }
    }

    if (changes.minReviewScore !== undefined) {
      if (typeof changes.minReviewScore !== "number" || changes.minReviewScore < 0 || changes.minReviewScore > 100) {
        res.status(400).json({ error: "minReviewScore must be a number between 0 and 100" });
        return;
      }
    }

    if (changes.maxLogSize !== undefined) {
      if (typeof changes.maxLogSize !== "number" || changes.maxLogSize < 0) {
        res.status(400).json({ error: "maxLogSize must be a positive number" });
        return;
      }
    }

    if (changes.branchPatterns !== undefined) {
      if (!Array.isArray(changes.branchPatterns) || !changes.branchPatterns.every((p) => typeof p === "string")) {
        res.status(400).json({ error: "branchPatterns must be an array of strings" });
        return;
      }
    }

    if (changes.prdPriority !== undefined) {
      if (!Array.isArray(changes.prdPriority) || !changes.prdPriority.every((p) => typeof p === "string")) {
        res.status(400).json({ error: "prdPriority must be an array of strings" });
        return;
      }
    }

    if (changes.cronSchedule !== undefined) {
      if (typeof changes.cronSchedule !== "string" || changes.cronSchedule.trim().length === 0) {
        res.status(400).json({ error: "cronSchedule must be a non-empty string" });
        return;
      }
    }

    if (changes.reviewerSchedule !== undefined) {
      if (typeof changes.reviewerSchedule !== "string" || changes.reviewerSchedule.trim().length === 0) {
        res.status(400).json({ error: "reviewerSchedule must be a non-empty string" });
        return;
      }
    }

    if (changes.notifications?.webhooks !== undefined) {
      if (!Array.isArray(changes.notifications.webhooks)) {
        res.status(400).json({ error: "notifications.webhooks must be an array" });
        return;
      }

      for (const webhook of changes.notifications.webhooks) {
        const issues = validateWebhook(webhook);
        if (issues.length > 0) {
          res.status(400).json({ error: `Invalid webhook: ${issues.join(", ")}` });
          return;
        }
      }
    }

    if (changes.roadmapScanner !== undefined) {
      const rs = changes.roadmapScanner;
      if (typeof rs !== "object" || rs === null) {
        res.status(400).json({ error: "roadmapScanner must be an object" });
        return;
      }

      if (rs.enabled !== undefined && typeof rs.enabled !== "boolean") {
        res.status(400).json({ error: "roadmapScanner.enabled must be a boolean" });
        return;
      }

      if (rs.roadmapPath !== undefined) {
        if (typeof rs.roadmapPath !== "string" || rs.roadmapPath.trim().length === 0) {
          res.status(400).json({ error: "roadmapScanner.roadmapPath must be a non-empty string" });
          return;
        }
      }

      if (rs.autoScanInterval !== undefined) {
        if (typeof rs.autoScanInterval !== "number" || rs.autoScanInterval < 30) {
          res.status(400).json({ error: "roadmapScanner.autoScanInterval must be a number >= 30" });
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
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
}

function handleGetDoctor(projectDir: string, config: INightWatchConfig, _req: Request, res: Response): void {
  try {
    const checks: IHealthCheck[] = [];

    try {
      execSync("git rev-parse --is-inside-work-tree", { cwd: projectDir, stdio: "pipe" });
      checks.push({ name: "git", status: "pass", detail: "Git repository detected" });
    } catch {
      checks.push({ name: "git", status: "fail", detail: "Not a git repository" });
    }

    try {
      execSync(`which ${config.provider}`, { stdio: "pipe" });
      checks.push({ name: "provider", status: "pass", detail: `Provider CLI found: ${config.provider}` });
    } catch {
      checks.push({ name: "provider", status: "fail", detail: `Provider CLI not found: ${config.provider}` });
    }

    try {
      const projectName = path.basename(projectDir);
      const marker = generateMarker(projectName);
      const crontabEntries = [...getEntries(marker), ...getProjectEntries(projectDir)];
      if (crontabEntries.length > 0) {
        checks.push({
          name: "crontab",
          status: "pass",
          detail: `${crontabEntries.length} crontab entr(y/ies) installed`,
        });
      } else {
        checks.push({ name: "crontab", status: "warn", detail: "No crontab entries installed" });
      }
    } catch (_error) {
      checks.push({ name: "crontab", status: "fail", detail: "Failed to check crontab" });
    }

    const configPath = path.join(projectDir, CONFIG_FILE_NAME);
    if (fs.existsSync(configPath)) {
      checks.push({ name: "config", status: "pass", detail: "Config file exists" });
    } else {
      checks.push({ name: "config", status: "warn", detail: "Config file not found (using defaults)" });
    }

    const prdDir = path.join(projectDir, config.prdDir);
    if (fs.existsSync(prdDir)) {
      const prds = fs.readdirSync(prdDir).filter((f) => f.endsWith(".md") && f !== "NIGHT-WATCH-SUMMARY.md");
      checks.push({ name: "prdDir", status: "pass", detail: `PRD directory exists (${prds.length} PRDs)` });
    } else {
      checks.push({ name: "prdDir", status: "warn", detail: `PRD directory not found: ${config.prdDir}` });
    }

    res.json(checks);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
}

function handleSpawnAction(projectDir: string, command: string[], _req: Request, res: Response): void {
  try {
    // Prevent duplicate execution: check the lock file before spawning
    const lockPath = command[0] === "run"
      ? executorLockPath(projectDir)
      : command[0] === "review"
        ? reviewerLockPath(projectDir)
        : null;

    if (lockPath) {
      const lock = checkLockFile(lockPath);
      if (lock.running) {
        const processType = command[0] === "run" ? "Executor" : "Reviewer";
        res.status(409).json({
          error: `${processType} is already running (PID ${lock.pid})`,
          pid: lock.pid,
        });
        return;
      }
    }

    const child = spawn("night-watch", command, {
      detached: true,
      stdio: "ignore",
      cwd: projectDir,
    });

    child.unref();

    if (child.pid !== undefined) {
      spawnedProcesses.set(child.pid, child);

      // Fire notification for executor start (non-blocking)
      if (command[0] === "run") {
        const config = loadConfig(projectDir);
        sendNotifications(config, {
          event: "run_started",
          projectName: path.basename(projectDir),
          exitCode: 0,
          provider: config.provider,
        }).catch(() => { /* silently ignore notification errors */ });
      }

      res.json({ started: true, pid: child.pid });
    } else {
      res.status(500).json({ error: "Failed to spawn process: no PID assigned" });
    }
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
}

function handleGetScheduleInfo(projectDir: string, config: INightWatchConfig, _req: Request, res: Response): void {
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
        nextRun: installed && config.reviewerEnabled ? computeNextRun(config.reviewerSchedule) : null,
      },
      paused: !installed,
      entries,
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
}

function handleGetRoadmap(projectDir: string, config: INightWatchConfig, _req: Request, res: Response): void {
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
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
}

async function handlePostRoadmapScan(projectDir: string, config: INightWatchConfig, _req: Request, res: Response): Promise<void> {
  try {
    if (!config.roadmapScanner.enabled) {
      res.status(409).json({ error: "Roadmap scanner is disabled" });
      return;
    }

    const result = await scanRoadmap(projectDir, config);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
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

    if (typeof enabled !== "boolean") {
      res.status(400).json({ error: "enabled must be a boolean" });
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
}

async function handleCancelAction(projectDir: string, req: Request, res: Response): Promise<void> {
  try {
    const { type = "all" } = req.body as { type?: string };
    const validTypes = ["run", "review", "all"];
    if (!validTypes.includes(type)) {
      res.status(400).json({ error: `Invalid type. Must be one of: ${validTypes.join(", ")}` });
      return;
    }

    const results = await performCancel(projectDir, { type: type as "run" | "review" | "all", force: true });
    const hasFailure = results.some((r) => !r.success);
    res.status(hasFailure ? 500 : 200).json({ results });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
}

function handleRetryAction(projectDir: string, config: INightWatchConfig, req: Request, res: Response): void {
  try {
    const { prdName } = req.body as { prdName?: string };

    if (!prdName || typeof prdName !== "string") {
      res.status(400).json({ error: "prdName is required" });
      return;
    }

    if (!validatePrdName(prdName)) {
      res.status(400).json({ error: "Invalid PRD name" });
      return;
    }

    const prdDir = path.join(projectDir, config.prdDir);
    const normalized = prdName.endsWith(".md") ? prdName : `${prdName}.md`;
    const pendingPath = path.join(prdDir, normalized);
    const donePath = path.join(prdDir, "done", normalized);

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
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
}

// ==================== Static Files + SPA Fallback ====================

function setupStaticFiles(app: Express): void {
  const webDistPath = path.resolve(__dirname, "../../web/dist");
  if (fs.existsSync(webDistPath)) {
    app.use(express.static(webDistPath));
  }

  app.use((req: Request, res: Response, next: NextFunction): void => {
    if (req.path.startsWith("/api/")) {
      next();
      return;
    }

    const indexPath = path.resolve(webDistPath, "index.html");
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

  // API Routes
  app.get("/api/status", (req, res) => handleGetStatus(projectDir, config, req, res));
  app.get("/api/schedule-info", (req, res) => handleGetScheduleInfo(projectDir, config, req, res));
  app.get("/api/prds", (req, res) => handleGetPrds(projectDir, config, req, res));
  app.get("/api/prds/:name", (req, res) => handleGetPrdByName(projectDir, config, req, res));
  app.get("/api/prs", (req, res) => handleGetPrs(projectDir, config, req, res));
  app.get("/api/logs/:name", (req, res) => handleGetLogs(projectDir, config, req, res));
  app.get("/api/config", (req, res) => handleGetConfig(config, req, res));
  app.put("/api/config", (req, res) => handlePutConfig(projectDir, () => config, reloadConfig, req, res));
  app.get("/api/doctor", (req, res) => handleGetDoctor(projectDir, config, req, res));
  app.post("/api/actions/run", (req, res) => handleSpawnAction(projectDir, ["run"], req, res));
  app.post("/api/actions/review", (req, res) => handleSpawnAction(projectDir, ["review"], req, res));
  app.post("/api/actions/install-cron", (req, res) => handleSpawnAction(projectDir, ["install"], req, res));
  app.post("/api/actions/uninstall-cron", (req, res) => handleSpawnAction(projectDir, ["uninstall"], req, res));
  app.post("/api/actions/cancel", (req, res) => handleCancelAction(projectDir, req, res));
  app.post("/api/actions/retry", (req, res) => handleRetryAction(projectDir, config, req, res));
  app.get("/api/roadmap", (req, res) => handleGetRoadmap(projectDir, config, req, res));
  app.post("/api/roadmap/scan", (req, res) => handlePostRoadmapScan(projectDir, config, req, res));
  app.put("/api/roadmap/toggle", (req, res) => handlePutRoadmapToggle(projectDir, () => config, reloadConfig, req, res));

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
      if (status.status === "complete" || status.status === "no-roadmap") return;
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
  const decodedId = decodeURIComponent(projectId).replace(/~/g, "/");
  const entries = loadRegistry();
  const entry = entries.find((e) => e.name === decodedId);

  if (!entry) {
    res.status(404).json({ error: `Project not found: ${decodedId}` });
    return;
  }

  if (!fs.existsSync(entry.path) || !fs.existsSync(path.join(entry.path, CONFIG_FILE_NAME))) {
    res.status(404).json({ error: `Project path invalid or missing config: ${entry.path}` });
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

  const dir = (req: Request): string => req.projectDir!;
  const cfg = (req: Request): INightWatchConfig => req.projectConfig!;

  router.get("/status", (req, res) => handleGetStatus(dir(req), cfg(req), req, res));
  router.get("/schedule-info", (req, res) => handleGetScheduleInfo(dir(req), cfg(req), req, res));
  router.get("/prds", (req, res) => handleGetPrds(dir(req), cfg(req), req, res));
  router.get("/prds/:name", (req, res) => handleGetPrdByName(dir(req), cfg(req), req, res));
  router.get("/prs", (req, res) => handleGetPrs(dir(req), cfg(req), req, res));
  router.get("/logs/:name", (req, res) => handleGetLogs(dir(req), cfg(req), req, res));
  router.get("/config", (req, res) => handleGetConfig(cfg(req), req, res));
  router.put("/config", (req, res) => {
    const projectDir = dir(req);
    let config = cfg(req);
    handlePutConfig(
      projectDir,
      () => config,
      () => { config = loadConfig(projectDir); },
      req,
      res,
    );
  });
  router.get("/doctor", (req, res) => handleGetDoctor(dir(req), cfg(req), req, res));
  router.post("/actions/run", (req, res) => handleSpawnAction(dir(req), ["run"], req, res));
  router.post("/actions/review", (req, res) => handleSpawnAction(dir(req), ["review"], req, res));
  router.post("/actions/install-cron", (req, res) => handleSpawnAction(dir(req), ["install"], req, res));
  router.post("/actions/uninstall-cron", (req, res) => handleSpawnAction(dir(req), ["uninstall"], req, res));
  router.post("/actions/cancel", (req, res) => handleCancelAction(dir(req), req, res));
  router.post("/actions/retry", (req, res) => handleRetryAction(dir(req), cfg(req), req, res));
  router.get("/roadmap", (req, res) => handleGetRoadmap(dir(req), cfg(req), req, res));
  router.post("/roadmap/scan", (req, res) => handlePostRoadmapScan(dir(req), cfg(req), req, res));
  router.put("/roadmap/toggle", (req, res) => handlePutRoadmapToggle(dir(req), () => cfg(req), () => {}, req, res));

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
  app.get("/api/projects", (_req: Request, res: Response): void => {
    try {
      const entries = loadRegistry();
      const { invalid } = validateRegistry();
      const invalidPaths = new Set(invalid.map((e) => e.path));

      res.json(entries.map((e) => ({
        name: e.name,
        path: e.path,
        valid: !invalidPaths.has(e.path),
      })));
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  // Project-scoped routes
  app.use("/api/projects/:projectId", resolveProject, createProjectRouter());

  setupStaticFiles(app);
  app.use(errorHandler);

  return app;
}

// ==================== Server Startup ====================

/**
 * Graceful shutdown handler
 */
function setupGracefulShutdown(server: ReturnType<Express["listen"]>): void {
  process.on("SIGTERM", () => {
    console.log("SIGTERM received, shutting down server...");
    server.close(() => {
      console.log("Server closed");
      process.exit(0);
    });
  });

  process.on("SIGINT", () => {
    console.log("\nSIGINT received, shutting down server...");
    server.close(() => {
      console.log("Server closed");
      process.exit(0);
    });
  });
}

/**
 * Start the HTTP server (single-project mode)
 */
export function startServer(projectDir: string, port: number): void {
  const app = createApp(projectDir);

  const server = app.listen(port, () => {
    console.log(`Night Watch UI running at http://localhost:${port}`);
  });

  setupGracefulShutdown(server);
}

/**
 * Start the HTTP server (global multi-project mode)
 */
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

  console.log(`Managing ${valid.length} project(s):`);
  valid.forEach((p) => console.log(`  - ${p.name} (${p.path})`));

  const app = createGlobalApp();

  const server = app.listen(port, () => {
    console.log(`Night Watch Global UI running at http://localhost:${port}`);
  });

  setupGracefulShutdown(server);
}
