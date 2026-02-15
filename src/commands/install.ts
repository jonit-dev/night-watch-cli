/**
 * Install command for Night Watch CLI
 * Adds crontab entries for automated PRD execution
 */

import { Command } from "commander";
import { execSync } from "child_process";
import * as path from "path";
import * as fs from "fs";
import { loadConfig } from "../config.js";
import { LOG_DIR } from "../constants.js";
import {
  addEntry,
  generateMarker,
  hasEntry,
  getEntries,
  readCrontab,
  writeCrontab,
} from "../utils/crontab.js";

export interface InstallOptions {
  schedule?: string;
  reviewerSchedule?: string;
  noReviewer?: boolean;
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
 * Install crontab entries for night-watch
 */
export function installCommand(program: Command): void {
  program
    .command("install")
    .description("Add crontab entries for automated execution")
    .option("-s, --schedule <cron>", "Cron schedule for PRD executor")
    .option("--reviewer-schedule <cron>", "Cron schedule for reviewer")
    .option("--no-reviewer", "Skip installing reviewer cron")
    .action(async (options: InstallOptions) => {
      try {
        // Get project directory
        const projectDir = process.cwd();

        // Load configuration
        const config = loadConfig(projectDir);

        // Get schedule from options or config
        const executorSchedule = options.schedule || config.cronSchedule;
        const reviewerSchedule = options.reviewerSchedule || config.reviewerSchedule;

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
        const existingEntries = getEntries(marker);
        if (existingEntries.length > 0) {
          console.log(`Night Watch is already installed for ${projectName}.`);
          console.log("\nExisting crontab entries:");
          existingEntries.forEach((entry) => console.log(`  ${entry}`));
          console.log("\nRun 'night-watch uninstall' first to reinstall.");
          return;
        }

        // Create crontab entries
        const entries: string[] = [];

        // Executor entry
        const executorEntry = `${executorSchedule} cd ${projectDir} && ${nightWatchBin} run >> ${executorLog} 2>&1  ${marker}`;
        entries.push(executorEntry);

        // Reviewer entry (unless --no-reviewer)
        if (!options.noReviewer) {
          const reviewerEntry = `${reviewerSchedule} cd ${projectDir} && ${nightWatchBin} review >> ${reviewerLog} 2>&1  ${marker}`;
          entries.push(reviewerEntry);
        }

        // Add all entries
        const currentCrontab = readCrontab();
        const newCrontab = [...currentCrontab, ...entries];
        writeCrontab(newCrontab);

        // Success message
        console.log(`\nNight Watch installed successfully for ${projectName}!`);
        console.log("\nCrontab entries added:");
        entries.forEach((entry) => console.log(`  ${entry}`));
        console.log("\nLog files:");
        console.log(`  Executor: ${executorLog}`);
        if (!options.noReviewer) {
          console.log(`  Reviewer: ${reviewerLog}`);
        }
        console.log("\nTo uninstall, run: night-watch uninstall");
        console.log("To check status, run: night-watch status");
      } catch (error) {
        console.error(
          `Error installing Night Watch: ${error instanceof Error ? error.message : String(error)}`
        );
        process.exit(1);
      }
    });
}
