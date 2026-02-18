/**
 * Cancel command for Night Watch CLI
 * Gracefully stops a running executor or reviewer process
 */

import { Command } from "commander";
import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import { LOCK_FILE_PREFIX } from "../constants.js";
import { checkLockFile } from "../utils/status-data.js";
import {
  dim,
  info,
  success,
  error as uiError,
  warn,
} from "../utils/ui.js";

export interface ICancelOptions {
  type: "run" | "review" | "all";
  force?: boolean;
}

/**
 * Get lock file paths for a project
 */
export function getLockFilePaths(projectName: string): {
  executor: string;
  reviewer: string;
} {
  return {
    executor: `${LOCK_FILE_PREFIX}${projectName}.lock`,
    reviewer: `${LOCK_FILE_PREFIX}pr-reviewer-${projectName}.lock`,
  };
}

/**
 * Prompt user for confirmation
 */
export async function promptConfirmation(prompt: string): Promise<boolean> {
  if (!process.stdin.isTTY) {
    return false;
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`${prompt} `, (answer) => {
      rl.close();
      const normalized = answer.toLowerCase().trim();
      resolve(normalized === "y" || normalized === "yes");
    });
  });
}

/**
 * Wait for specified milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Check if a process is still running
 */
export function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export interface ICancelResult {
  success: boolean;
  message: string;
  cleanedUp?: boolean;
}

/**
 * Attempt to cancel a single process
 */
export async function cancelProcess(
  processType: "executor" | "reviewer",
  lockPath: string,
  force: boolean = false
): Promise<ICancelResult> {
  const lockStatus = checkLockFile(lockPath);

  // No lock file exists
  if (!lockStatus.pid) {
    return {
      success: true,
      message: `${processType} is not running (no lock file)`,
    };
  }

  const pid = lockStatus.pid;

  // Lock file exists but process is not running (stale)
  if (!lockStatus.running) {
    // Clean up stale lock file
    try {
      fs.unlinkSync(lockPath);
      return {
        success: true,
        message: `${processType} is not running (cleaned up stale lock file for PID ${pid})`,
        cleanedUp: true,
      };
    } catch {
      return {
        success: true,
        message: `${processType} is not running (stale lock file exists but could not be removed)`,
      };
    }
  }

  // Process is running - prompt for confirmation
  const confirmPrompt = `Kill ${processType} (PID ${pid})? [y/N]`;
  if (!force) {
    const confirmed = await promptConfirmation(confirmPrompt);
    if (!confirmed) {
      return {
        success: false,
        message: `Cancelled - ${processType} (PID ${pid}) left running`,
      };
    }
  } else {
    dim(confirmPrompt + " y (forced)");
  }

  // Send SIGTERM
  try {
    process.kill(pid, "SIGTERM");
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      message: `Failed to send SIGTERM to ${processType} (PID ${pid}): ${errorMessage}`,
    };
  }

  info(`Sent SIGTERM to ${processType} (PID ${pid}), waiting 3 seconds...`);

  // Wait 3 seconds
  await sleep(3000);

  // Check if process is still running
  if (!isProcessRunning(pid)) {
    // Clean up lock file
    try {
      fs.unlinkSync(lockPath);
    } catch {
      // Ignore cleanup errors
    }
    return {
      success: true,
      message: `${processType} (PID ${pid}) terminated successfully`,
    };
  }

  // Process still running after SIGTERM
  warn(`${processType} (PID ${pid}) is still running after SIGTERM`);

  // Offer to send SIGKILL
  const killPrompt = `Send SIGKILL to ${processType} (PID ${pid})? [y/N]`;
  let shouldKill: boolean;
  if (!force) {
    shouldKill = await promptConfirmation(killPrompt);
  } else {
    dim(killPrompt + " y (forced)");
    shouldKill = true;
  }

  if (!shouldKill) {
    return {
      success: false,
      message: `${processType} (PID ${pid}) still running - SIGTERM sent but process did not terminate`,
    };
  }

  // Send SIGKILL
  try {
    process.kill(pid, "SIGKILL");
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      message: `Failed to send SIGKILL to ${processType} (PID ${pid}): ${errorMessage}`,
    };
  }

  // Wait briefly for SIGKILL to take effect
  await sleep(500);

  // Final check
  if (!isProcessRunning(pid)) {
    // Clean up lock file
    try {
      fs.unlinkSync(lockPath);
    } catch {
      // Ignore cleanup errors
    }
    return {
      success: true,
      message: `${processType} (PID ${pid}) killed successfully`,
    };
  }

  return {
    success: false,
    message: `${processType} (PID ${pid}) could not be terminated even with SIGKILL`,
  };
}

/**
 * Cancel running execution
 */
export async function performCancel(
  projectDir: string,
  options: ICancelOptions
): Promise<ICancelResult[]> {
  const projectName = path.basename(projectDir);
  const lockPaths = getLockFilePaths(projectName);
  const results: ICancelResult[] = [];
  const force = options.force ?? false;

  if (options.type === "run" || options.type === "all") {
    const result = await cancelProcess("executor", lockPaths.executor, force);
    results.push(result);
  }

  if (options.type === "review" || options.type === "all") {
    const result = await cancelProcess("reviewer", lockPaths.reviewer, force);
    results.push(result);
  }

  return results;
}

/**
 * Cancel command implementation
 */
export function cancelCommand(program: Command): void {
  program
    .command("cancel")
    .description("Cancel running executor or reviewer processes")
    .option(
      "-t, --type <type>",
      "Process type to cancel: 'run', 'review', or 'all'",
      "all"
    )
    .option("-f, --force", "Skip confirmation prompts")
    .action(async (options: { type: string; force?: boolean }) => {
      try {
        // Validate type option
        const validTypes = ["run", "review", "all"];
        if (!validTypes.includes(options.type)) {
          uiError(
            `Invalid type '${options.type}'. Must be one of: ${validTypes.join(", ")}`
          );
          process.exit(1);
        }

        const cancelOptions: ICancelOptions = {
          type: options.type as "run" | "review" | "all",
          force: options.force,
        };

        const projectDir = process.cwd();
        const results = await performCancel(projectDir, cancelOptions);

        // Output results
        for (const result of results) {
          if (result.success) {
            success(result.message);
          } else {
            uiError(result.message);
          }
        }

        // Exit with error code if any cancel failed
        const hasFailure = results.some((r) => !r.success);
        if (hasFailure) {
          process.exit(1);
        }
      } catch (err) {
        uiError(
          `Error cancelling processes: ${err instanceof Error ? err.message : String(err)}`
        );
        process.exit(1);
      }
    });
}
