/**
 * Status command for Night Watch CLI
 * Shows current status including lock files, PRDs, PRs, and logs
 */

import { Command } from "commander";
import { execSync } from "child_process";
import * as path from "path";
import * as fs from "fs";
import chalk from "chalk";
import { loadConfig } from "../config.js";
import { LOCK_FILE_PREFIX, LOG_DIR, DEFAULT_PRD_DIR } from "../constants.js";
import { getEntries, generateMarker, getProjectEntries } from "../utils/crontab.js";
import {
  header,
  label,
  dim,
  createTable,
  formatRunningStatus,
  formatInstalledStatus,
} from "../utils/ui.js";

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
        const lockProjectName = path.basename(projectDir);
        const marker = generateMarker(projectName);
        const crontabEntries = Array.from(
          new Set([...getEntries(marker), ...getProjectEntries(projectDir)])
        );

        // Gather status info
        const status: StatusInfo = {
          projectName,
          projectDir,
          provider: config.provider,
          reviewerEnabled: config.reviewerEnabled,
          executor: checkLockFile(`${LOCK_FILE_PREFIX}${lockProjectName}.lock`),
          reviewer: checkLockFile(`${LOCK_FILE_PREFIX}pr-reviewer-${lockProjectName}.lock`),
          prds: countPRDs(projectDir, config.prdDir),
          prs: { open: countOpenPRs(projectDir, config.branchPatterns) },
          crontab: {
            installed: crontabEntries.length > 0,
            entries: crontabEntries,
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
        console.log();
        console.log(chalk.bold.cyan(`Night Watch Status: ${status.projectName}`));
        console.log(chalk.dim("─".repeat(40)));
        console.log();
        dim(`Project Directory: ${status.projectDir}`);

        // Configuration section with table
        header("Configuration");
        const configTable = createTable({ head: ["Setting", "Value"] });
        configTable.push(["Provider", status.provider]);
        configTable.push(["Reviewer", status.reviewerEnabled ? "Enabled" : "Disabled"]);
        console.log(configTable.toString());

        // Process status section with colored indicators
        header("Process Status");
        const processTable = createTable({ head: ["Process", "Status"] });
        processTable.push(["Executor", formatRunningStatus(status.executor.running, status.executor.pid)]);
        processTable.push(["Reviewer", formatRunningStatus(status.reviewer.running, status.reviewer.pid)]);
        console.log(processTable.toString());

        // PRD status section with table
        header("PRD Status");
        const prdTable = createTable({ head: ["Status", "Count"] });
        prdTable.push(["Pending", String(status.prds.pending)]);
        prdTable.push(["Completed", String(status.prds.done)]);
        console.log(prdTable.toString());

        // PR status section with table
        header("PR Status");
        const prTable = createTable({ head: ["Type", "Count"] });
        prTable.push(["Open PRs (night-watch/feat branches)", String(status.prs.open)]);
        console.log(prTable.toString());

        // Crontab status section with colored output
        header("Crontab Status");
        console.log(`  ${formatInstalledStatus(status.crontab.installed)}`);
        if (status.crontab.installed && options.verbose) {
          console.log();
          dim("  Entries:");
          status.crontab.entries.forEach((entry) => dim(`    ${entry}`));
        }
        console.log();

        // Log status section with table
        header("Log Files");
        const logTable = createTable({ head: ["Log", "Size", "Status"] });
        if (status.logs.executor) {
          logTable.push([
            "Executor",
            status.logs.executor.exists ? formatBytes(status.logs.executor.size) : "-",
            status.logs.executor.exists ? "Exists" : "Not found",
          ]);
        }
        if (status.logs.reviewer) {
          logTable.push([
            "Reviewer",
            status.logs.reviewer.exists ? formatBytes(status.logs.reviewer.size) : "-",
            status.logs.reviewer.exists ? "Exists" : "Not found",
          ]);
        }
        console.log(logTable.toString());

        // Show last lines in verbose mode
        if (options.verbose) {
          if (status.logs.executor?.exists && status.logs.executor.lastLines.length > 0) {
            dim("  Executor last 5 lines:");
            status.logs.executor.lastLines.forEach((line) => dim(`    ${line}`));
          }
          if (status.logs.reviewer?.exists && status.logs.reviewer.lastLines.length > 0) {
            dim("  Reviewer last 5 lines:");
            status.logs.reviewer.lastLines.forEach((line) => dim(`    ${line}`));
          }
        }

        // Tips section with dim styling
        header("Commands");
        dim("  night-watch install  - Install crontab entries");
        dim("  night-watch logs     - View logs");
        dim("  night-watch run      - Run executor now");
        dim("  night-watch review   - Run reviewer now");
        console.log();
      } catch (error) {
        console.error(
          `Error getting status: ${error instanceof Error ? error.message : String(error)}`
        );
        process.exit(1);
      }
    });
}
