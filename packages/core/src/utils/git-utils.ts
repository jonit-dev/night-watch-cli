/**
 * Git utilities for Night Watch CLI
 * Replaces bash functions from night-watch-helpers.sh
 */

import { execFileSync } from 'child_process';

/**
 * Get the Unix timestamp of the latest commit on a branch.
 * Checks both remote (origin/branch) and local (branch) refs.
 * Returns the newer timestamp if both exist, or null if branch doesn't exist.
 */
export function getBranchTipTimestamp(projectDir: string, branch: string): number | null {
  let remoteTs: number | null = null;
  let localTs: number | null = null;

  // Try remote branch
  try {
    const output = execFileSync(
      'git',
      ['-C', projectDir, 'log', '-1', '--format=%ct', `refs/remotes/origin/${branch}`],
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    ).trim();
    if (output) {
      remoteTs = parseInt(output, 10);
    }
  } catch {
    // Remote branch doesn't exist
  }

  // Try local branch
  try {
    const output = execFileSync(
      'git',
      ['-C', projectDir, 'log', '-1', '--format=%ct', `refs/heads/${branch}`],
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    ).trim();
    if (output) {
      localTs = parseInt(output, 10);
    }
  } catch {
    // Local branch doesn't exist
  }

  // Return the newer timestamp
  if (remoteTs !== null && localTs !== null) {
    return localTs > remoteTs ? localTs : remoteTs;
  }
  if (remoteTs !== null) {
    return remoteTs;
  }
  if (localTs !== null) {
    return localTs;
  }
  return null;
}

/**
 * Detect the default branch for a project.
 * Compares timestamps of 'main' and 'master' branches.
 * Falls back to origin/HEAD symbolic ref, or 'main' as final default.
 */
export function detectDefaultBranch(projectDir: string): string {
  const mainTs = getBranchTipTimestamp(projectDir, 'main');
  const masterTs = getBranchTipTimestamp(projectDir, 'master');

  // If both exist, return the one with newer commits
  if (mainTs !== null && masterTs !== null) {
    return mainTs >= masterTs ? 'main' : 'master';
  }

  // If only one exists, return it
  if (mainTs !== null) {
    return 'main';
  }
  if (masterTs !== null) {
    return 'master';
  }

  // Try origin/HEAD symbolic ref
  try {
    const output = execFileSync(
      'git',
      ['-C', projectDir, 'symbolic-ref', 'refs/remotes/origin/HEAD'],
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    ).trim();
    const match = output.match(/^refs\/remotes\/origin\/(.+)$/);
    if (match) {
      return match[1];
    }
  } catch {
    // Symbolic ref not available
  }

  // Final fallback
  return 'main';
}

/**
 * Resolve the best available ref for creating a worktree.
 * Priority: origin/${defaultBranch} > ${defaultBranch} > origin/HEAD > HEAD
 * Returns null if no valid ref found.
 */
export function resolveWorktreeBaseRef(projectDir: string, defaultBranch: string): string | null {
  // Try origin/defaultBranch
  try {
    execFileSync(
      'git',
      [
        '-C',
        projectDir,
        'rev-parse',
        '--verify',
        '--quiet',
        `refs/remotes/origin/${defaultBranch}`,
      ],
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    );
    return `origin/${defaultBranch}`;
  } catch {
    // Remote branch doesn't exist
  }

  // Try local defaultBranch
  try {
    execFileSync(
      'git',
      ['-C', projectDir, 'rev-parse', '--verify', '--quiet', `refs/heads/${defaultBranch}`],
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    );
    return defaultBranch;
  } catch {
    // Local branch doesn't exist
  }

  // Try origin/HEAD
  try {
    execFileSync(
      'git',
      ['-C', projectDir, 'rev-parse', '--verify', '--quiet', 'refs/remotes/origin/HEAD'],
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    );
    return 'origin/HEAD';
  } catch {
    // origin/HEAD doesn't exist
  }

  // Final fallback: HEAD (handles local-only repos with no remote)
  try {
    execFileSync('git', ['-C', projectDir, 'rev-parse', '--verify', '--quiet', 'HEAD'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return 'HEAD';
  } catch {
    // No valid ref found
  }

  return null;
}
