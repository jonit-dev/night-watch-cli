/**
 * Status command for Night Watch CLI
 * Shows current status including lock files, PRDs, PRs, and logs
 */

import { Command } from "commander";
import { execSync } from "child_process";
import * as path from "path";
import * as fs from "fs";
import { loadConfig } from "../config.js";
import { LOCK_FILE_PREFIX, LOG_DIR, DEFAULT_PRD_DIR } from "../constants.js";
import { getEntries, generateMarker } from "../utils/crontab.js";

export interface StatusOptions {
  verbose?: boolean;
  json?: boolean;
}

interface StatusInfo {
  projectName: string;
  projectDir: string;
  provider: string;
  reviewerEnabled: boolean;
  executor: {
    running: boolean;
    pid: number | null;
  };
  reviewer: {
    running: boolean;
    pid: number | null;
  };
  prds: {
    pending: number;
    done: number;
  };
  prs: {
    open: number;
  };
  crontab: {
    installed: boolean;
    entries: string[];
  };
  logs: {
    executor?: {
      path: string;
      lastLines: string[];
      exists: boolean;
      size: number;
    };
    reviewer?: {
      path: string;
      lastLines: string[];
      exists: boolean;
      size: number;
    };
  };
}

/**
 * Get the project name from directory or package.json
 */
function getProjectName(projectDir: string): string {
  // Try to get name from package.json
  const packageJsonPath = path.join(projectDir, "package.json");
  if (fs.existsSync(packageJsonPath)) {
    try {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
      if (packageJson.name) {
        return packageJson.name;
      }
    } catch {
      // Ignore parse errors
    }
  }

  // Fall back to directory name
  return path.basename(projectDir);
}

/**
 * Check if a process with the given PID is running
 */
function isProcessRunning(pid: number): boolean {
  try {
    // Sending signal 0 doesn't actually kill the process, just checks if it exists
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read PID from lock file and check if process is running
 */
function checkLockFile(lockPath: string): { running: boolean; pid: number | null } {
  if (!fs.existsSync(lockPath)) {
    return { running: false, pid: null };
  }

  try {
    const pidStr = fs.readFileSync(lockPath, "utf-8").trim();
    const pid = parseInt(pidStr, 10);

    if (isNaN(pid)) {
      return { running: false, pid: null };
    }

    return {
      running: isProcessRunning(pid),
      pid,
    };
  } catch {
    return { running: false, pid: null };
  }
}

/**
 * Count PRDs in the PRD directory
 */
function countPRDs(projectDir: string, prdDir: string): { pending: number; done: number } {
  const fullPrdPath = path.join(projectDir, prdDir);

  if (!fs.existsSync(fullPrdPath)) {
    return { pending: 0, done: 0 };
  }

  let pending = 0;
  let done = 0;

  const countInDir = (dir: string) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (entry.name === "done") {
          // Count files in done directory
          try {
            const doneEntries = fs.readdirSync(fullPath);
            done += doneEntries.filter((e) => e.endsWith(".md")).length;
          } catch {
            // Ignore errors
          }
        } else {
          // Recurse into other directories
          countInDir(fullPath);
        }
      } else if (entry.name.endsWith(".md")) {
        pending++;
      }
    }
  };

  try {
    countInDir(fullPrdPath);
  } catch {
    // Ignore errors
  }

  return { pending, done };
}

/**
 * Count open PRs on night-watch/ or feat/ branches using gh CLI
 */
function countOpenPRs(projectDir: string, branchPatterns: string[]): number {
  try {
    // Check if we're in a git repo
    execSync("git rev-parse --git-dir", {
      cwd: projectDir,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Check if gh CLI is available
    try {
      execSync("which gh", { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
    } catch {
      return 0;
    }

    // Get open PRs
    const output = execSync("gh pr list --state open --json headRefName,number", {
      cwd: projectDir,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });

    const prs = JSON.parse(output);

    // Filter PRs by branch patterns
    const matchingPRs = prs.filter((pr: { headRefName: string }) =>
      branchPatterns.some((pattern) => pr.headRefName.startsWith(pattern))
    );

    return matchingPRs.length;
  } catch {
    return 0;
  }
}

/**
 * Get last N lines from a log file
 */
function getLastLogLines(logPath: string, lines: number): string[] {
  if (!fs.existsSync(logPath)) {
    return [];
  }

  try {
    const content = fs.readFileSync(logPath, "utf-8");
    const allLines = content.trim().split("\n");
    return allLines.slice(-lines);
  } catch {
    return [];
  }
}

/**
 * Get log file info
 */
function getLogInfo(logPath: string, lastLines: number = 5): { path: string; lastLines: string[]; exists: boolean; size: number } {
  const exists = fs.existsSync(logPath);
  return {
    path: logPath,
    lastLines: exists ? getLastLogLines(logPath, lastLines) : [],
    exists,
    size: exists ? fs.statSync(logPath).size : 0,
  };
}

/**
 * Format bytes to human-readable size
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

/**
 * Status command implementation
 */
export function statusCommand(program: Command): void {
  program
    .command("status")
    .description("Show current night-watch status")
    .option("-v, --verbose", "Show detailed status information")
    .option("--json", "Output status as JSON")
    .action(async (options: StatusOptions) => {
      try {
        const projectDir = process.cwd();
        const config = loadConfig(projectDir);
        const projectName = getProjectName(projectDir);
        const marker = generateMarker(projectName);

        // Gather status info
        const status: StatusInfo = {
          projectName,
          projectDir,
          provider: config.provider,
          reviewerEnabled: config.reviewerEnabled,
          executor: checkLockFile(`${LOCK_FILE_PREFIX}executor.lock`),
          reviewer: checkLockFile(`${LOCK_FILE_PREFIX}reviewer.lock`),
          prds: countPRDs(projectDir, config.prdDir),
          prs: { open: countOpenPRs(projectDir, config.branchPatterns) },
          crontab: {
            installed: getEntries(marker).length > 0,
            entries: getEntries(marker),
          },
          logs: {
            executor: getLogInfo(path.join(projectDir, LOG_DIR, "executor.log")),
            reviewer: getLogInfo(path.join(projectDir, LOG_DIR, "reviewer.log")),
          },
        };

        // Output as JSON if requested
        if (options.json) {
          console.log(JSON.stringify(status, null, 2));
          return;
        }

        // Print formatted status dashboard
        console.log("\n========================================");
        console.log(`  Night Watch Status: ${status.projectName}`);
        console.log("========================================\n");

        // Project directory
        console.log(`Project Directory: ${status.projectDir}\n`);

        // Configuration
        console.log("--- Configuration ---");
        console.log(`  Provider:  ${status.provider}`);
        console.log(`  Reviewer:  ${status.reviewerEnabled ? "Enabled" : "Disabled"}`);
        console.log();

        // Process status
        console.log("--- Process Status ---");
        console.log(
          `  Executor: ${status.executor.running ? `Running (PID: ${status.executor.pid})` : status.executor.pid ? `Stale lock file (PID: ${status.executor.pid})` : "Not running"}`
        );
        console.log(
          `  Reviewer: ${status.reviewer.running ? `Running (PID: ${status.reviewer.pid})` : status.reviewer.pid ? `Stale lock file (PID: ${status.reviewer.pid})` : "Not running"}`
        );
        console.log();

        // PRD status
        console.log("--- PRD Status ---");
        console.log(`  Pending PRDs: ${status.prds.pending}`);
        console.log(`  Completed PRDs: ${status.prds.done}`);
        console.log();

        // PR status
        console.log("--- PR Status ---");
        console.log(`  Open PRs (night-watch/feat branches): ${status.prs.open}`);
        console.log();

        // Crontab status
        console.log("--- Crontab Status ---");
        console.log(`  Installed: ${status.crontab.installed ? "Yes" : "No"}`);
        if (status.crontab.installed && options.verbose) {
          console.log("  Entries:");
          status.crontab.entries.forEach((entry) => console.log(`    ${entry}`));
        }
        console.log();

        // Log status
        console.log("--- Log Files ---");
        if (status.logs.executor) {
          console.log(
            `  Executor: ${status.logs.executor.exists ? `Exists (${formatBytes(status.logs.executor.size)})` : "Not found"}`
          );
          if (options.verbose && status.logs.executor.lastLines.length > 0) {
            console.log("    Last 5 lines:");
            status.logs.executor.lastLines.forEach((line) =>
              console.log(`      ${line}`)
            );
          }
        }
        if (status.logs.reviewer) {
          console.log(
            `  Reviewer: ${status.logs.reviewer.exists ? `Exists (${formatBytes(status.logs.reviewer.size)})` : "Not found"}`
          );
          if (options.verbose && status.logs.reviewer.lastLines.length > 0) {
            console.log("    Last 5 lines:");
            status.logs.reviewer.lastLines.forEach((line) =>
              console.log(`      ${line}`)
            );
          }
        }
        console.log();

        // Tips
        console.log("--- Commands ---");
        console.log("  'night-watch install'  - Install crontab entries");
        console.log("  'night-watch logs'     - View logs");
        console.log("  'night-watch run'      - Run executor now");
        console.log("  'night-watch review'   - Run reviewer now");
        console.log();
      } catch (error) {
        console.error(
          `Error getting status: ${error instanceof Error ? error.message : String(error)}`
        );
        process.exit(1);
      }
    });
}
