/**
 * HTTP API Server for Night Watch CLI
 * Provides REST API endpoints for the Web UI
 */

import express, { Express, NextFunction, Request, Response } from "express";
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
import { collectPrInfo, collectPrdInfo, fetchStatusSnapshot, getLastLogLines } from "../utils/status-data.js";
import { saveConfig } from "../utils/config-writer.js";

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
  // Prevent path traversal and ensure valid filename
  return /^[a-zA-Z0-9_-]+(\.md)?$/.test(name) && !name.includes("..");
}

/**
 * Create and configure the Express application
 */
export function createApp(projectDir: string): Express {
  const app = express();

  // Middleware
  app.use(cors());
  app.use(express.json());

  // Load configuration
  let config = loadConfig(projectDir);

  // Helper to reload config
  const reloadConfig = () => {
    config = loadConfig(projectDir);
  };

  // ==================== API Routes ====================

  /**
   * GET /api/status
   * Returns full project status snapshot
   */
  app.get("/api/status", (_req: Request, res: Response): void => {
    try {
      const snapshot = fetchStatusSnapshot(projectDir, config);
      res.json(snapshot);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  /**
   * GET /api/prds
   * Returns PRD list with status and content
   */
  app.get("/api/prds", (_req: Request, res: Response): void => {
    try {
      const prds = collectPrdInfo(projectDir, config.prdDir, config.maxRuntime);

      // Enrich each PRD with file content
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
        return {
          ...prd,
          content,
        };
      });

      res.json(prdsWithContent);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  /**
   * GET /api/prds/:name
   * Returns specific PRD file content
   */
  app.get("/api/prds/:name", (req: Request, res: Response): void => {
    try {
      const { name } = req.params;

      // Validate name to prevent path traversal
      if (!validatePrdName(name as string)) {
        res.status(400).json({ error: "Invalid PRD name" });
        return;
      }

      // Add .md extension if not present
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
  });

  /**
   * GET /api/prs
   * Returns open PRs with CI status
   */
  app.get("/api/prs", (_req: Request, res: Response): void => {
    try {
      const prs = collectPrInfo(projectDir, config.branchPatterns);
      res.json(prs);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  /**
   * GET /api/logs/:name
   * Returns last N lines of log file
   */
  app.get("/api/logs/:name", (req: Request, res: Response): void => {
    try {
      const { name } = req.params;

      // Validate log name
      const validNames = ["executor", "reviewer"];
      if (!validNames.includes(name as string)) {
        res.status(400).json({ error: `Invalid log name. Must be one of: ${validNames.join(", ")}` });
        return;
      }

      // Parse lines query parameter (default 200)
      const linesParam = req.query.lines;
      const lines = typeof linesParam === "string" ? parseInt(linesParam, 10) : 200;
      const linesToRead = isNaN(lines) || lines < 1 ? 200 : Math.min(lines, 10000);

      const logPath = path.join(projectDir, LOG_DIR, `${name as string}.log`);
      const logLines = getLastLogLines(logPath, linesToRead);

      res.json({ name, lines: logLines });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  /**
   * GET /api/config
   * Returns current configuration
   */
  app.get("/api/config", (_req: Request, res: Response): void => {
    try {
      res.json(config);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  /**
   * PUT /api/config
   * Updates configuration fields
   */
  app.put("/api/config", (req: Request, res: Response): void => {
    try {
      const changes = req.body as Partial<INightWatchConfig>;

      // Validate changes
      if (typeof changes !== "object" || changes === null) {
        res.status(400).json({ error: "Invalid request body" });
        return;
      }

      // Validate provider if present
      if (changes.provider !== undefined) {
        const validProviders = ["claude", "codex"];
        if (!validProviders.includes(changes.provider)) {
          res.status(400).json({ error: `Invalid provider. Must be one of: ${validProviders.join(", ")}` });
          return;
        }
      }

      // Validate reviewerEnabled if present
      if (changes.reviewerEnabled !== undefined) {
        if (typeof changes.reviewerEnabled !== "boolean") {
          res.status(400).json({ error: "reviewerEnabled must be a boolean" });
          return;
        }
      }

      // Validate maxRuntime if present
      if (changes.maxRuntime !== undefined) {
        if (typeof changes.maxRuntime !== "number" || changes.maxRuntime < 60) {
          res.status(400).json({ error: "maxRuntime must be a number >= 60" });
          return;
        }
      }

      // Validate reviewerMaxRuntime if present
      if (changes.reviewerMaxRuntime !== undefined) {
        if (typeof changes.reviewerMaxRuntime !== "number" || changes.reviewerMaxRuntime < 60) {
          res.status(400).json({ error: "reviewerMaxRuntime must be a number >= 60" });
          return;
        }
      }

      // Validate minReviewScore if present
      if (changes.minReviewScore !== undefined) {
        if (typeof changes.minReviewScore !== "number" || changes.minReviewScore < 0 || changes.minReviewScore > 100) {
          res.status(400).json({ error: "minReviewScore must be a number between 0 and 100" });
          return;
        }
      }

      // Validate maxLogSize if present
      if (changes.maxLogSize !== undefined) {
        if (typeof changes.maxLogSize !== "number" || changes.maxLogSize < 0) {
          res.status(400).json({ error: "maxLogSize must be a positive number" });
          return;
        }
      }

      // Validate branchPatterns if present
      if (changes.branchPatterns !== undefined) {
        if (!Array.isArray(changes.branchPatterns) || !changes.branchPatterns.every((p) => typeof p === "string")) {
          res.status(400).json({ error: "branchPatterns must be an array of strings" });
          return;
        }
      }

      // Validate prdPriority if present
      if (changes.prdPriority !== undefined) {
        if (!Array.isArray(changes.prdPriority) || !changes.prdPriority.every((p) => typeof p === "string")) {
          res.status(400).json({ error: "prdPriority must be an array of strings" });
          return;
        }
      }

      // Validate cronSchedule if present
      if (changes.cronSchedule !== undefined) {
        if (typeof changes.cronSchedule !== "string" || changes.cronSchedule.trim().length === 0) {
          res.status(400).json({ error: "cronSchedule must be a non-empty string" });
          return;
        }
      }

      // Validate reviewerSchedule if present
      if (changes.reviewerSchedule !== undefined) {
        if (typeof changes.reviewerSchedule !== "string" || changes.reviewerSchedule.trim().length === 0) {
          res.status(400).json({ error: "reviewerSchedule must be a non-empty string" });
          return;
        }
      }

      // Validate notifications.webhooks if present
      if (changes.notifications?.webhooks !== undefined) {
        if (!Array.isArray(changes.notifications.webhooks)) {
          res.status(400).json({ error: "notifications.webhooks must be an array" });
          return;
        }

        // Validate each webhook
        for (const webhook of changes.notifications.webhooks) {
          const issues = validateWebhook(webhook);
          if (issues.length > 0) {
            res.status(400).json({ error: `Invalid webhook: ${issues.join(", ")}` });
            return;
          }
        }
      }

      // Save changes
      const result = saveConfig(projectDir, changes);

      if (!result.success) {
        res.status(500).json({ error: result.error });
        return;
      }

      // Reload config and return updated config
      reloadConfig();
      res.json(config);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  /**
   * GET /api/doctor
   * Returns health check results
   */
  app.get("/api/doctor", (_req: Request, res: Response): void => {
    try {
      const checks: IHealthCheck[] = [];

      // Check 1: Git repository
      try {
        execSync("git rev-parse --is-inside-work-tree", {
          cwd: projectDir,
          stdio: "pipe",
        });
        checks.push({ name: "git", status: "pass", detail: "Git repository detected" });
      } catch {
        checks.push({ name: "git", status: "fail", detail: "Not a git repository" });
      }

      // Check 2: Provider CLI
      try {
        execSync(`which ${config.provider}`, { stdio: "pipe" });
        checks.push({ name: "provider", status: "pass", detail: `Provider CLI found: ${config.provider}` });
      } catch {
        checks.push({ name: "provider", status: "fail", detail: `Provider CLI not found: ${config.provider}` });
      }

      // Check 3: Crontab status
      try {
        const { getEntries, getProjectEntries, generateMarker } = require("../utils/crontab.js");
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

      // Check 4: Config file
      const configPath = path.join(projectDir, CONFIG_FILE_NAME);
      if (fs.existsSync(configPath)) {
        checks.push({ name: "config", status: "pass", detail: "Config file exists" });
      } else {
        checks.push({ name: "config", status: "warn", detail: "Config file not found (using defaults)" });
      }

      // Check 5: PRD directory
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
  });

  /**
   * POST /api/actions/run
   * Spawns the executor as a detached child process
   */
  app.post("/api/actions/run", (_req: Request, res: Response): void => {
    try {
      const child = spawn("night-watch", ["run"], {
        detached: true,
        stdio: "ignore",
        cwd: projectDir,
      });

      child.unref();

      // Track the process (ensure pid is defined)
      if (child.pid !== undefined) {
        spawnedProcesses.set(child.pid, child);
        res.json({ started: true, pid: child.pid });
      } else {
        res.status(500).json({ error: "Failed to spawn process: no PID assigned" });
      }
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  /**
   * POST /api/actions/review
   * Spawns the reviewer as a detached child process
   */
  app.post("/api/actions/review", (_req: Request, res: Response): void => {
    try {
      const child = spawn("night-watch", ["review"], {
        detached: true,
        stdio: "ignore",
        cwd: projectDir,
      });

      child.unref();

      // Track the process (ensure pid is defined)
      if (child.pid !== undefined) {
        spawnedProcesses.set(child.pid, child);
        res.json({ started: true, pid: child.pid });
      } else {
        res.status(500).json({ error: "Failed to spawn process: no PID assigned" });
      }
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  /**
   * POST /api/actions/install-cron
   * Spawns the install command
   */
  app.post("/api/actions/install-cron", (_req: Request, res: Response): void => {
    try {
      const child = spawn("night-watch", ["install"], {
        detached: true,
        stdio: "ignore",
        cwd: projectDir,
      });

      child.unref();

      // Track the process (ensure pid is defined)
      if (child.pid !== undefined) {
        spawnedProcesses.set(child.pid, child);
        res.json({ started: true, pid: child.pid });
      } else {
        res.status(500).json({ error: "Failed to spawn process: no PID assigned" });
      }
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  /**
   * POST /api/actions/uninstall-cron
   * Spawns the uninstall command
   */
  app.post("/api/actions/uninstall-cron", (_req: Request, res: Response): void => {
    try {
      const child = spawn("night-watch", ["uninstall"], {
        detached: true,
        stdio: "ignore",
        cwd: projectDir,
      });

      child.unref();

      // Track the process (ensure pid is defined)
      if (child.pid !== undefined) {
        spawnedProcesses.set(child.pid, child);
        res.json({ started: true, pid: child.pid });
      } else {
        res.status(500).json({ error: "Failed to spawn process: no PID assigned" });
      }
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  // ==================== Static Files ====================

  // Serve static files from web/dist
  const webDistPath = path.join(__dirname, "../../web/dist");
  if (fs.existsSync(webDistPath)) {
    app.use(express.static(webDistPath));
  }

  // ==================== SPA Fallback ====================

  // For non-API routes, serve index.html (SPA fallback)
  app.use((req: Request, res: Response, next: NextFunction): void => {
    if (req.path.startsWith("/api/")) {
      next();
      return;
    }

    const indexPath = path.join(webDistPath, "index.html");
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      next();
    }
  });

  // ==================== Error Handler ====================

  app.use(errorHandler);

  return app;
}

/**
 * Start the HTTP server
 */
export function startServer(projectDir: string, port: number): void {
  const app = createApp(projectDir);

  const server = app.listen(port, () => {
    console.log(`Night Watch UI running at http://localhost:${port}`);
  });

  // Handle graceful shutdown
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
