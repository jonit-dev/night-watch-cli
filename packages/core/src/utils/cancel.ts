/**
 * Process cancellation utilities.
 * Used by both the CLI cancel command and the server action routes.
 */

import * as fs from 'fs';
import { LOCK_FILE_PREFIX } from '../constants.js';
import { checkLockFile, isProcessRunning, projectRuntimeKey } from './status-data.js';

export interface ICancelOptions {
  type: 'run' | 'review' | 'all';
  force?: boolean;
}

export interface ICancelResult {
  success: boolean;
  message: string;
  cleanedUp?: boolean;
}

/**
 * Get lock file paths for a project
 */
export function getLockFilePaths(projectDir: string): {
  executor: string;
  reviewer: string;
} {
  const runtimeKey = projectRuntimeKey(projectDir);
  return {
    executor: `${LOCK_FILE_PREFIX}${runtimeKey}.lock`,
    reviewer: `${LOCK_FILE_PREFIX}pr-reviewer-${runtimeKey}.lock`,
  };
}

/**
 * Wait for specified milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Attempt to cancel a single process (non-interactive, force mode).
 * The interactive variant with readline prompts lives in the CLI cancel command.
 */
export async function cancelProcess(
  processType: 'executor' | 'reviewer',
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

  // In non-interactive (force) mode just SIGTERM immediately
  if (!force) {
    return {
      success: false,
      message: `${processType} (PID ${pid}) is running — use force=true to kill`,
    };
  }

  // Send SIGTERM
  try {
    process.kill(pid, 'SIGTERM');
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      message: `Failed to send SIGTERM to ${processType} (PID ${pid}): ${errorMessage}`,
    };
  }

  await sleep(3000);

  if (!isProcessRunning(pid)) {
    try { fs.unlinkSync(lockPath); } catch { /* ignore */ }
    return {
      success: true,
      message: `${processType} (PID ${pid}) terminated successfully`,
    };
  }

  // Send SIGKILL
  try {
    process.kill(pid, 'SIGKILL');
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      message: `Failed to send SIGKILL to ${processType} (PID ${pid}): ${errorMessage}`,
    };
  }

  await sleep(500);

  if (!isProcessRunning(pid)) {
    try { fs.unlinkSync(lockPath); } catch { /* ignore */ }
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
 * Cancel running executor and/or reviewer processes.
 */
export async function performCancel(
  projectDir: string,
  options: ICancelOptions
): Promise<ICancelResult[]> {
  const lockPaths = getLockFilePaths(projectDir);
  const results: ICancelResult[] = [];
  const force = options.force ?? false;

  if (options.type === 'run' || options.type === 'all') {
    const result = await cancelProcess('executor', lockPaths.executor, force);
    results.push(result);
  }

  if (options.type === 'review' || options.type === 'all') {
    const result = await cancelProcess('reviewer', lockPaths.reviewer, force);
    results.push(result);
  }

  return results;
}
