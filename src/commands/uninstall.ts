/**
 * Uninstall command for Night Watch CLI
 * Removes crontab entries for the current project
 */

import { Command } from "commander";
import * as path from "path";
import * as fs from "fs";
import { removeEntries, generateMarker, getEntries } from "../utils/crontab.js";

export interface UninstallOptions {
  keepLogs?: boolean;
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
 * Uninstall crontab entries for night-watch
 */
export function uninstallCommand(program: Command): void {
  program
    .command("uninstall")
    .description("Remove crontab entries")
    .option("--keep-logs", "Preserve log files")
    .action(async (options: UninstallOptions) => {
      try {
        // Get project directory
        const projectDir = process.cwd();

        // Get project name
        const projectName = getProjectName(projectDir);
        const marker = generateMarker(projectName);

        // Check if there are entries to remove
        const existingEntries = getEntries(marker);
        if (existingEntries.length === 0) {
          console.log(`No Night Watch crontab entries found for ${projectName}.`);
          console.log("Nothing to uninstall.");
          return;
        }

        // Show entries that will be removed
        console.log(`Removing Night Watch crontab entries for ${projectName}:`);
        existingEntries.forEach((entry) => console.log(`  ${entry}`));

        // Remove entries
        const removedCount = removeEntries(marker);

        // Handle log files
        if (!options.keepLogs) {
          const logDir = path.join(projectDir, "logs");
          if (fs.existsSync(logDir)) {
            const logFiles = ["executor.log", "reviewer.log"];
            let logsRemoved = 0;

            logFiles.forEach((logFile) => {
              const logPath = path.join(logDir, logFile);
              if (fs.existsSync(logPath)) {
                fs.unlinkSync(logPath);
                logsRemoved++;
              }
            });

            // Try to remove log directory if empty
            try {
              const remainingFiles = fs.readdirSync(logDir);
              if (remainingFiles.length === 0) {
                fs.rmdirSync(logDir);
              }
            } catch {
              // Ignore errors removing directory
            }

            if (logsRemoved > 0) {
              console.log(`\nRemoved ${logsRemoved} log file(s).`);
            }
          }
        } else {
          console.log("\nLog files preserved.");
        }

        console.log(`\nSuccessfully removed ${removedCount} crontab entry/entries.`);
      } catch (error) {
        console.error(
          `Error uninstalling Night Watch: ${error instanceof Error ? error.message : String(error)}`
        );
        process.exit(1);
      }
    });
}
