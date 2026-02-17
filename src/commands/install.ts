/**
 * Install command for Night Watch CLI
 * Adds crontab entries for automated PRD execution
 */

import { Command } from "commander";
import { execSync } from "child_process";
import * as path from "path";
import * as fs from "fs";
import { loadConfig } from "../config.js";
import { INightWatchConfig } from "../types.js";
import { LOG_DIR } from "../constants.js";
import {
  generateMarker,
  getEntries,
  getProjectEntries,
  readCrontab,
  writeCrontab,
} from "../utils/crontab.js";
import {
  dim,
  header,
  success,
  error as uiError,
  warn,
} from "../utils/ui.js";

export interface IInstallOptions {
  schedule?: string;
  reviewerSchedule?: string;
  noReviewer?: boolean;
}

/**
 * Safely quote a value for POSIX shell commands.
 */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\"'\"'")}'`;
}

/**
 * Get the path to the night-watch binary
 */
function getNightWatchBinPath(): string {
  // Try to find night-watch in npm global bin
  try {
    const npmBin = execSync("npm bin -g", { encoding: "utf-8" }).trim();
    const binPath = path.join(npmBin, "night-watch");
    if (fs.existsSync(binPath)) {
      return binPath;
    }
  } catch {
    // Ignore error, fall back to which
  }

  // Try which command
  try {
    return execSync("which night-watch", { encoding: "utf-8" }).trim();
  } catch {
    // Fall back to assuming it's in PATH
    return "night-watch";
  }
}

/**
 * Get the directory containing the node binary.
 * Cron runs with a minimal PATH that typically doesn't include nvm/fnm/volta paths,
 * so we need to explicitly add the node bin directory to each cron entry.
 */
function getNodeBinDir(): string {
  try {
    const nodePath = execSync("which node", { encoding: "utf-8" }).trim();
    return path.dirname(nodePath);
  } catch {
    return "";
  }
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
 * Apply minute offset to a cron schedule expression.
 * Replaces the minute field (first field) with the offset value.
 * Only applies if the minute field is a single number (e.g. "0").
 * Complex expressions (e.g. star-slash, comma-separated) are left unchanged.
 */
export function applyScheduleOffset(schedule: string, offset: number): string {
  if (offset === 0) return schedule;
  const parts = schedule.split(/\s+/);
  if (parts.length < 5) return schedule;
  // Only replace if minute field is a plain number
  if (/^\d+$/.test(parts[0])) {
    parts[0] = String(offset);
    return parts.join(" ");
  }
  return schedule;
}

export interface IInstallResult {
  success: boolean;
  entries: string[];
  error?: string;
}

/**
 * Core install logic, reusable from dashboard.
 * Returns result without printing to console.
 */
export function performInstall(
  projectDir: string,
  config: INightWatchConfig,
  options?: { schedule?: string; reviewerSchedule?: string; noReviewer?: boolean; force?: boolean }
): IInstallResult {
  try {
    const offset = config.cronScheduleOffset ?? 0;
    const executorSchedule = applyScheduleOffset(options?.schedule || config.cronSchedule, offset);
    const reviewerSchedule = applyScheduleOffset(options?.reviewerSchedule || config.reviewerSchedule, offset);
    const nightWatchBin = getNightWatchBinPath();
    const projectName = getProjectName(projectDir);
    const marker = generateMarker(projectName);
    const logDir = path.join(projectDir, LOG_DIR);

    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    const executorLog = path.join(logDir, "executor.log");
    const reviewerLog = path.join(logDir, "reviewer.log");

    // Check if already installed (unless force)
    if (!options?.force) {
      const existingEntries = Array.from(
        new Set([...getEntries(marker), ...getProjectEntries(projectDir)])
      );
      if (existingEntries.length > 0) {
        return { success: false, entries: existingEntries, error: "Already installed. Uninstall first or use force." };
      }
    }

    const entries: string[] = [];
    const nodeBinDir = getNodeBinDir();
    const pathPrefix = nodeBinDir ? `export PATH="${nodeBinDir}:$PATH" && ` : "";

    let providerEnvPrefix = "";
    if (config.providerEnv && Object.keys(config.providerEnv).length > 0) {
      const exports = Object.entries(config.providerEnv)
        .map(([key, value]) => `export ${key}=${shellQuote(value)}`)
        .join(" && ");
      providerEnvPrefix = exports + " && ";
    }

    const executorEntry = `${executorSchedule} ${pathPrefix}${providerEnvPrefix}cd ${shellQuote(projectDir)} && ${shellQuote(nightWatchBin)} run >> ${shellQuote(executorLog)} 2>&1  ${marker}`;
    entries.push(executorEntry);

    const installReviewer = options?.noReviewer === true ? false : config.reviewerEnabled;
    if (installReviewer) {
      const reviewerEntry = `${reviewerSchedule} ${pathPrefix}${providerEnvPrefix}cd ${shellQuote(projectDir)} && ${shellQuote(nightWatchBin)} review >> ${shellQuote(reviewerLog)} 2>&1  ${marker}`;
      entries.push(reviewerEntry);
    }

    const currentCrontab = readCrontab();
    const newCrontab = [...currentCrontab, ...entries];
    writeCrontab(newCrontab);

    return { success: true, entries };
  } catch (err) {
    return {
      success: false,
      entries: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Install crontab entries for night-watch
 */
export function installCommand(program: Command): void {
  program
    .command("install")
    .description("Add crontab entries for automated execution")
    .option("-s, --schedule <cron>", "Cron schedule for PRD executor")
    .option("--reviewer-schedule <cron>", "Cron schedule for reviewer")
    .option("--no-reviewer", "Skip installing reviewer cron")
    .action(async (options: IInstallOptions) => {
      try {
        // Get project directory
        const projectDir = process.cwd();

        // Load configuration
        const config = loadConfig(projectDir);

        // Get schedule from options or config, applying offset
        const offset = config.cronScheduleOffset ?? 0;
        const executorSchedule = applyScheduleOffset(options.schedule || config.cronSchedule, offset);
        const reviewerSchedule = applyScheduleOffset(options.reviewerSchedule || config.reviewerSchedule, offset);

        // Get paths
        const nightWatchBin = getNightWatchBinPath();
        const projectName = getProjectName(projectDir);
        const marker = generateMarker(projectName);
        const logDir = path.join(projectDir, LOG_DIR);

        // Ensure log directory exists
        if (!fs.existsSync(logDir)) {
          fs.mkdirSync(logDir, { recursive: true });
        }

        const executorLog = path.join(logDir, "executor.log");
        const reviewerLog = path.join(logDir, "reviewer.log");

        // Check if already installed
        const existingEntries = Array.from(
          new Set([...getEntries(marker), ...getProjectEntries(projectDir)])
        );
        if (existingEntries.length > 0) {
          warn(`Night Watch is already installed for ${projectName}.`);
          console.log();
          dim("Existing crontab entries:");
          existingEntries.forEach((entry) => dim(`  ${entry}`));
          console.log();
          dim("Run 'night-watch uninstall' first to reinstall.");
          return;
        }

        // Create crontab entries
        const entries: string[] = [];

        // Detect node bin directory for cron PATH
        const nodeBinDir = getNodeBinDir();
        const pathPrefix = nodeBinDir ? `export PATH="${nodeBinDir}:$PATH" && ` : "";

        // Build providerEnv export prefix for cron entries
        let providerEnvPrefix = "";
        if (config.providerEnv && Object.keys(config.providerEnv).length > 0) {
          const exports = Object.entries(config.providerEnv)
            .map(([key, value]) => `export ${key}=${shellQuote(value)}`)
            .join(" && ");
          providerEnvPrefix = exports + " && ";
        }

        // Executor entry
        const executorEntry = `${executorSchedule} ${pathPrefix}${providerEnvPrefix}cd ${shellQuote(projectDir)} && ${shellQuote(nightWatchBin)} run >> ${shellQuote(executorLog)} 2>&1  ${marker}`;
        entries.push(executorEntry);

        // Determine if reviewer should be installed
        // Priority: --no-reviewer flag > config.reviewerEnabled
        const installReviewer = options.noReviewer === true ? false : config.reviewerEnabled;

        // Reviewer entry (if enabled)
        if (installReviewer) {
          const reviewerEntry = `${reviewerSchedule} ${pathPrefix}${providerEnvPrefix}cd ${shellQuote(projectDir)} && ${shellQuote(nightWatchBin)} review >> ${shellQuote(reviewerLog)} 2>&1  ${marker}`;
          entries.push(reviewerEntry);
        }

        // Add all entries
        const currentCrontab = readCrontab();
        const newCrontab = [...currentCrontab, ...entries];
        writeCrontab(newCrontab);

        // Success message
        success(`Night Watch installed successfully for ${projectName}!`);
        console.log();
        header("Crontab Entries Added");
        entries.forEach((entry) => dim(`  ${entry}`));
        console.log();
        header("Log Files");
        dim(`  Executor: ${executorLog}`);
        if (installReviewer) {
          dim(`  Reviewer: ${reviewerLog}`);
        }
        console.log();
        dim("To uninstall, run: night-watch uninstall");
        dim("To check status, run: night-watch status");
      } catch (err) {
        uiError(
          `Error installing Night Watch: ${err instanceof Error ? err.message : String(err)}`
        );
        process.exit(1);
      }
    });
}
