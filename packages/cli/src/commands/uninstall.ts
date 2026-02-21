/**
 * Uninstall command for Night Watch CLI
 * Removes crontab entries for the current project
 */

import { Command } from 'commander';
import * as path from 'path';
import * as fs from 'fs';
import {
  dim,
  generateMarker,
  getEntries,
  getProjectEntries,
  getProjectName,
  removeEntriesForProject,
  success,
  error as uiError,
  warn,
} from '@night-watch/core';

export interface IUninstallOptions {
  keepLogs?: boolean;
}

export interface IUninstallResult {
  success: boolean;
  removedCount: number;
  error?: string;
}

/**
 * Core uninstall logic, reusable from dashboard.
 * Returns result without printing to console.
 */
export function performUninstall(
  projectDir: string,
  options?: { keepLogs?: boolean },
): IUninstallResult {
  try {
    const projectName = getProjectName(projectDir);
    const marker = generateMarker(projectName);

    const existingEntries = Array.from(
      new Set([...getEntries(marker), ...getProjectEntries(projectDir)]),
    );
    if (existingEntries.length === 0) {
      return { success: true, removedCount: 0 };
    }

    const removedCount = removeEntriesForProject(projectDir, marker);

    if (!options?.keepLogs) {
      const logDir = path.join(projectDir, 'logs');
      if (fs.existsSync(logDir)) {
        const logFiles = ['executor.log', 'reviewer.log', 'slicer.log', 'audit.log'];
        logFiles.forEach((logFile) => {
          const logPath = path.join(logDir, logFile);
          if (fs.existsSync(logPath)) {
            fs.unlinkSync(logPath);
          }
        });

        try {
          const remainingFiles = fs.readdirSync(logDir);
          if (remainingFiles.length === 0) {
            fs.rmdirSync(logDir);
          }
        } catch {
          // Ignore errors removing directory
        }
      }
    }

    return { success: true, removedCount };
  } catch (err) {
    return {
      success: false,
      removedCount: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Uninstall crontab entries for night-watch
 */
export function uninstallCommand(program: Command): void {
  program
    .command('uninstall')
    .description('Remove crontab entries')
    .option('--keep-logs', 'Preserve log files')
    .action(async (options: IUninstallOptions) => {
      try {
        // Get project directory
        const projectDir = process.cwd();

        // Get project name
        const projectName = getProjectName(projectDir);
        const marker = generateMarker(projectName);

        // Check if there are entries to remove
        const existingEntries = Array.from(
          new Set([...getEntries(marker), ...getProjectEntries(projectDir)]),
        );
        if (existingEntries.length === 0) {
          warn(`No Night Watch crontab entries found for ${projectName}.`);
          dim('Nothing to uninstall.');
          return;
        }

        // Show entries that will be removed
        dim(`Removing Night Watch crontab entries for ${projectName}:`);
        existingEntries.forEach((entry) => dim(`  ${entry}`));

        // Remove entries
        const removedCount = removeEntriesForProject(projectDir, marker);

        // Handle log files
        if (!options.keepLogs) {
          const logDir = path.join(projectDir, 'logs');
          if (fs.existsSync(logDir)) {
            const logFiles = ['executor.log', 'reviewer.log', 'slicer.log', 'audit.log'];
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
              console.log();
              dim(`Removed ${logsRemoved} log file(s).`);
            }
          }
        } else {
          console.log();
          dim('Log files preserved.');
        }

        success(`Successfully removed ${removedCount} crontab entry/entries.`);
      } catch (err) {
        uiError(
          `Error uninstalling Night Watch: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exit(1);
      }
    });
}
