/**
 * Worktree management utilities for Night Watch CLI
 * Replaces bash functions from night-watch-helpers.sh
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { resolveWorktreeBaseRef } from './git-utils.js';

/**
 * Result of preparing a worktree
 */
export interface IPrepareWorktreeResult {
  success: boolean;
  worktreePath: string;
  error?: string;
}

/**
 * Options for preparing a branch worktree
 */
export interface IPrepareBranchWorktreeOptions {
  projectDir: string;
  worktreeDir: string;
  branchName: string;
  defaultBranch: string;
  logFile?: string;
}

/**
 * Options for preparing a detached worktree
 */
export interface IPrepareDetachedWorktreeOptions {
  projectDir: string;
  worktreeDir: string;
  defaultBranch: string;
  logFile?: string;
}

/**
 * Execute a git command, optionally logging output
 */
function gitExec(
  args: string[],
  cwd: string,
  logFile?: string,
): { success: boolean; error?: string } {
  try {
    const result = execFileSync('git', args, {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Append to log file if provided
    if (logFile && result) {
      try {
        fs.appendFileSync(logFile, result);
      } catch {
        // Ignore log write errors
      }
    }

    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Append error to log file if provided
    if (logFile) {
      try {
        fs.appendFileSync(logFile, errorMessage + '\n');
      } catch {
        // Ignore log write errors
      }
    }

    return { success: false, error: errorMessage };
  }
}

/**
 * Check if a branch exists locally
 */
function branchExistsLocally(projectDir: string, branchName: string): boolean {
  try {
    execFileSync(
      'git',
      ['-C', projectDir, 'rev-parse', '--verify', '--quiet', `refs/heads/${branchName}`],
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a branch exists remotely
 */
function branchExistsRemotely(projectDir: string, branchName: string): boolean {
  try {
    execFileSync(
      'git',
      ['-C', projectDir, 'rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branchName}`],
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Create an isolated worktree on a branch without checking out that branch
 * in the user's current project directory.
 */
export function prepareBranchWorktree(
  options: IPrepareBranchWorktreeOptions,
): IPrepareWorktreeResult {
  const { projectDir, worktreeDir, branchName, defaultBranch, logFile } = options;

  // Remove stale directory that exists on disk but is not registered in git's
  // worktree list (left over from a killed or interrupted previous run).
  if (fs.existsSync(worktreeDir)) {
    const isRegistered = isWorktreeRegistered(projectDir, worktreeDir);
    if (!isRegistered) {
      try {
        fs.rmSync(worktreeDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  // Fetch origin/defaultBranch
  gitExec(['fetch', 'origin', defaultBranch], projectDir, logFile);

  // Resolve base ref
  const baseRef = resolveWorktreeBaseRef(projectDir, defaultBranch);
  if (!baseRef) {
    return {
      success: false,
      worktreePath: worktreeDir,
      error: 'No valid base ref found for worktree',
    };
  }

  // If branch exists locally, just add worktree pointing to it
  if (branchExistsLocally(projectDir, branchName)) {
    const result = gitExec(['worktree', 'add', worktreeDir, branchName], projectDir, logFile);
    return {
      success: result.success,
      worktreePath: worktreeDir,
      error: result.error,
    };
  }

  // If branch exists remotely, create local tracking branch
  if (branchExistsRemotely(projectDir, branchName)) {
    const result = gitExec(
      ['worktree', 'add', '-b', branchName, worktreeDir, `origin/${branchName}`],
      projectDir,
      logFile,
    );
    return {
      success: result.success,
      worktreePath: worktreeDir,
      error: result.error,
    };
  }

  // Create new branch from base ref
  const result = gitExec(
    ['worktree', 'add', '-b', branchName, worktreeDir, baseRef],
    projectDir,
    logFile,
  );
  return {
    success: result.success,
    worktreePath: worktreeDir,
    error: result.error,
  };
}

/**
 * Create an isolated detached worktree (useful for reviewer/controller flows).
 */
export function prepareDetachedWorktree(
  options: IPrepareDetachedWorktreeOptions,
): IPrepareWorktreeResult {
  const { projectDir, worktreeDir, defaultBranch, logFile } = options;

  // Remove stale directory that exists on disk but is not registered in git's
  // worktree list (left over from a killed or interrupted previous run).
  if (fs.existsSync(worktreeDir)) {
    const isRegistered = isWorktreeRegistered(projectDir, worktreeDir);
    if (!isRegistered) {
      try {
        fs.rmSync(worktreeDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  // Fetch origin/defaultBranch
  gitExec(['fetch', 'origin', defaultBranch], projectDir, logFile);

  // Resolve base ref
  const baseRef = resolveWorktreeBaseRef(projectDir, defaultBranch);
  if (!baseRef) {
    return {
      success: false,
      worktreePath: worktreeDir,
      error: 'No valid base ref found for worktree',
    };
  }

  // Create detached worktree
  const result = gitExec(
    ['worktree', 'add', '--detach', worktreeDir, baseRef],
    projectDir,
    logFile,
  );
  return {
    success: result.success,
    worktreePath: worktreeDir,
    error: result.error,
  };
}

/**
 * Check if a worktree path is registered in git's worktree list
 */
function isWorktreeRegistered(projectDir: string, worktreePath: string): boolean {
  try {
    const output = execFileSync('git', ['-C', projectDir, 'worktree', 'list', '--porcelain'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const lines = output.split('\n');
    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        const wtPath = line.substring('worktree '.length);
        if (wtPath === worktreePath) {
          return true;
        }
      }
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Clean up night-watch worktrees for a project.
 * Returns array of removed worktree paths.
 */
export function cleanupWorktrees(projectDir: string, scope?: string): string[] {
  const projectName = path.basename(projectDir);
  const matchToken = scope ? scope : `${projectName}-nw`;
  const removed: string[] = [];

  try {
    const output = execFileSync('git', ['-C', projectDir, 'worktree', 'list', '--porcelain'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const lines = output.split('\n');
    const worktreePaths: string[] = [];

    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        worktreePaths.push(line.substring('worktree '.length));
      }
    }

    for (const wtPath of worktreePaths) {
      if (wtPath.includes(matchToken)) {
        // Force remove the worktree
        const result = gitExec(['worktree', 'remove', '--force', wtPath], projectDir);
        if (result.success) {
          removed.push(wtPath);
        }
      }
    }
  } catch {
    // Ignore errors
  }

  return removed;
}
