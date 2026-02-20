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
import { getProjectName } from "../utils/status-data.js";

export interface IInstallOptions {
  schedule?: string;
  reviewerSchedule?: string;
  noReviewer?: boolean;
  noSlicer?: boolean;
  noQa?: boolean;
  qa?: boolean;
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
 * Build PATH export for cron entries using relevant binary directories.
 */
export function buildCronPathPrefix(nodeBinDir: string, nightWatchBin: string): string {
  const nightWatchBinDir = (nightWatchBin.includes("/") || nightWatchBin.includes("\\"))
    ? path.dirname(nightWatchBin)
    : "";
  const pathParts = Array.from(
    new Set([nodeBinDir, nightWatchBinDir].filter((part) => part.length > 0))
  );
  if (pathParts.length === 0) {
    return "";
  }
  return `export PATH="${pathParts.join(":")}:$PATH" && `;
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
  options?: { schedule?: string; reviewerSchedule?: string; noReviewer?: boolean; noSlicer?: boolean; noQa?: boolean; qa?: boolean; force?: boolean }
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
    const pathPrefix = buildCronPathPrefix(nodeBinDir, nightWatchBin);
    const cliBinPrefix = `export NW_CLI_BIN=${shellQuote(nightWatchBin)} && `;

    let providerEnvPrefix = "";
    if (config.providerEnv && Object.keys(config.providerEnv).length > 0) {
      const exports = Object.entries(config.providerEnv)
        .map(([key, value]) => `export ${key}=${shellQuote(value)}`)
        .join(" && ");
      providerEnvPrefix = exports + " && ";
    }

    const executorEntry = `${executorSchedule} ${pathPrefix}${providerEnvPrefix}${cliBinPrefix}cd ${shellQuote(projectDir)} && ${shellQuote(nightWatchBin)} run >> ${shellQuote(executorLog)} 2>&1  ${marker}`;
    entries.push(executorEntry);

    const installReviewer = options?.noReviewer === true ? false : config.reviewerEnabled;
    if (installReviewer) {
      const reviewerEntry = `${reviewerSchedule} ${pathPrefix}${providerEnvPrefix}${cliBinPrefix}cd ${shellQuote(projectDir)} && ${shellQuote(nightWatchBin)} review >> ${shellQuote(reviewerLog)} 2>&1  ${marker}`;
      entries.push(reviewerEntry);
    }

    // Slicer entry (if roadmap scanner enabled and noSlicer not set)
    const installSlicer = options?.noSlicer === true ? false : config.roadmapScanner.enabled;
    if (installSlicer) {
      const slicerSchedule = applyScheduleOffset(config.roadmapScanner.slicerSchedule, offset);
      const slicerLog = path.join(logDir, "slicer.log");
      const slicerEntry = `${slicerSchedule} ${pathPrefix}${providerEnvPrefix}${cliBinPrefix}cd ${shellQuote(projectDir)} && ${shellQuote(nightWatchBin)} slice >> ${shellQuote(slicerLog)} 2>&1  ${marker}`;
      entries.push(slicerEntry);
    }

    // QA entry (if enabled and noQa not set)
    const disableQa = options?.noQa === true || options?.qa === false;
    const installQa = disableQa ? false : config.qa.enabled;
    if (installQa) {
      const qaSchedule = applyScheduleOffset(config.qa.schedule, offset);
      const qaLog = path.join(logDir, "qa.log");
      const qaEntry = `${qaSchedule} ${pathPrefix}${providerEnvPrefix}${cliBinPrefix}cd ${shellQuote(projectDir)} && ${shellQuote(nightWatchBin)} qa >> ${shellQuote(qaLog)} 2>&1  ${marker}`;
      entries.push(qaEntry);
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
    .option("--no-slicer", "Skip installing slicer cron")
    .option("--no-qa", "Skip installing QA cron")
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
        const pathPrefix = buildCronPathPrefix(nodeBinDir, nightWatchBin);
        const cliBinPrefix = `export NW_CLI_BIN=${shellQuote(nightWatchBin)} && `;

        // Build providerEnv export prefix for cron entries
        let providerEnvPrefix = "";
        if (config.providerEnv && Object.keys(config.providerEnv).length > 0) {
          const exports = Object.entries(config.providerEnv)
            .map(([key, value]) => `export ${key}=${shellQuote(value)}`)
            .join(" && ");
          providerEnvPrefix = exports + " && ";
        }

        // Executor entry
        const executorEntry = `${executorSchedule} ${pathPrefix}${providerEnvPrefix}${cliBinPrefix}cd ${shellQuote(projectDir)} && ${shellQuote(nightWatchBin)} run >> ${shellQuote(executorLog)} 2>&1  ${marker}`;
        entries.push(executorEntry);

        // Determine if reviewer should be installed
        // Priority: --no-reviewer flag > config.reviewerEnabled
        const installReviewer = options.noReviewer === true ? false : config.reviewerEnabled;

        // Reviewer entry (if enabled)
        if (installReviewer) {
          const reviewerEntry = `${reviewerSchedule} ${pathPrefix}${providerEnvPrefix}${cliBinPrefix}cd ${shellQuote(projectDir)} && ${shellQuote(nightWatchBin)} review >> ${shellQuote(reviewerLog)} 2>&1  ${marker}`;
          entries.push(reviewerEntry);
        }

        // Determine if slicer should be installed
        // Priority: --no-slicer flag > config.roadmapScanner.enabled
        const installSlicer = options.noSlicer === true ? false : config.roadmapScanner.enabled;

        // Slicer entry (if roadmap scanner enabled)
        let slicerLog: string | undefined;
        if (installSlicer) {
          slicerLog = path.join(logDir, "slicer.log");
          const slicerSchedule = applyScheduleOffset(config.roadmapScanner.slicerSchedule, offset);
          const slicerEntry = `${slicerSchedule} ${pathPrefix}${providerEnvPrefix}${cliBinPrefix}cd ${shellQuote(projectDir)} && ${shellQuote(nightWatchBin)} slice >> ${shellQuote(slicerLog)} 2>&1  ${marker}`;
          entries.push(slicerEntry);
        }

        // Determine if QA should be installed
        const disableQa = options.noQa === true || options.qa === false;
        const installQa = disableQa ? false : config.qa.enabled;

        // QA entry (if enabled)
        let qaLog: string | undefined;
        if (installQa) {
          qaLog = path.join(logDir, "qa.log");
          const qaSchedule = applyScheduleOffset(config.qa.schedule, offset);
          const qaEntry = `${qaSchedule} ${pathPrefix}${providerEnvPrefix}${cliBinPrefix}cd ${shellQuote(projectDir)} && ${shellQuote(nightWatchBin)} qa >> ${shellQuote(qaLog)} 2>&1  ${marker}`;
          entries.push(qaEntry);
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
        if (installSlicer && slicerLog) {
          dim(`  Slicer: ${slicerLog}`);
        }
        if (installQa && qaLog) {
          dim(`  QA: ${qaLog}`);
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
