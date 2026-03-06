/**
 * Cron command — CLI interface for bash script integration.
 * Internal commands for night-watch cron scripts (not user-facing).
 * Uses exit-code signaling for bash integration.
 */

import { Command } from 'commander';
import {
  acquireLock,
  checkRateLimited,
  cleanupWorktrees,
  detectDefaultBranch,
  prepareBranchWorktree,
  prepareDetachedWorktree,
  releaseLock,
  rotateLog,
} from '@night-watch/core';

export function cronCommand(program: Command): void {
  const cron = program.command('cron').description('Internal commands for cron scripts');

  // detect-branch: Output the detected default branch name
  cron
    .command('detect-branch [projectDir]')
    .description('Detect the default branch for a project')
    .action((projectDir: string = process.cwd()) => {
      const branch = detectDefaultBranch(projectDir);
      process.stdout.write(branch + '\n');
    });

  // acquire-lock: Exit 0 if acquired, 1 if already locked
  cron
    .command('acquire-lock <lockFile>')
    .description('Acquire a lock file')
    .option('--pid <n>', 'PID to write to lock file', String(process.pid))
    .action((lockFile: string, options: { pid: string }) => {
      const pid = parseInt(options.pid, 10);
      if (isNaN(pid)) {
        process.stderr.write(`Invalid PID: ${options.pid}\n`);
        process.exit(2);
      }

      if (acquireLock(lockFile, pid)) {
        process.exit(0); // acquired
      } else {
        process.exit(1); // already locked
      }
    });

  // release-lock: Release a lock file
  cron
    .command('release-lock <lockFile>')
    .description('Release a lock file')
    .action((lockFile: string) => {
      releaseLock(lockFile);
      process.exit(0);
    });

  // prepare-worktree: Prepare a worktree for a branch
  cron
    .command('prepare-worktree <projectDir> <worktreeDir>')
    .description('Prepare a worktree for execution')
    .option('--branch <name>', 'Branch name (creates new if not exists)')
    .option('--default-branch <name>', 'Default branch name', 'main')
    .option('--detached', 'Create detached worktree', false)
    .action(
      (
        projectDir: string,
        worktreeDir: string,
        options: { branch?: string; defaultBranch: string; detached: boolean },
      ) => {
        if (options.detached) {
          const result = prepareDetachedWorktree({
            projectDir,
            worktreeDir,
            defaultBranch: options.defaultBranch,
          });
          if (result.success) {
            process.exit(0);
          } else {
            process.stderr.write(result.error || 'Failed to create detached worktree\n');
            process.exit(1);
          }
        } else if (options.branch) {
          const result = prepareBranchWorktree({
            projectDir,
            worktreeDir,
            branchName: options.branch,
            defaultBranch: options.defaultBranch,
          });
          if (result.success) {
            process.exit(0);
          } else {
            process.stderr.write(result.error || 'Failed to create branch worktree\n');
            process.exit(1);
          }
        } else {
          process.stderr.write('Either --branch or --detached is required\n');
          process.exit(2);
        }
      },
    );

  // cleanup-worktrees: Clean up night-watch worktrees
  cron
    .command('cleanup-worktrees <projectDir>')
    .description('Clean up night-watch worktrees')
    .option('--scope <token>', 'Scope token to match worktrees')
    .action((projectDir: string, options: { scope?: string }) => {
      const removed = cleanupWorktrees(projectDir, options.scope);
      if (removed.length > 0) {
        process.stdout.write(removed.join('\n') + '\n');
      }
      process.exit(0);
    });

  // check-rate-limit: Check if log file contains rate limit error
  cron
    .command('check-rate-limit <logFile>')
    .description('Check if log file contains rate limit (429) error')
    .option('--start-line <n>', 'Start checking from this line', '0')
    .action((logFile: string, options: { startLine: string }) => {
      const startLine = parseInt(options.startLine, 10);
      if (isNaN(startLine) || startLine < 0) {
        process.stderr.write(`Invalid start-line: ${options.startLine}\n`);
        process.exit(2);
      }

      if (checkRateLimited(logFile, startLine > 0 ? startLine : undefined)) {
        process.exit(0); // rate limited
      } else {
        process.exit(1); // not rate limited
      }
    });

  // rotate-log: Rotate log file if it exceeds max size
  cron
    .command('rotate-log <logFile>')
    .description('Rotate log file if it exceeds max size')
    .option('--max-size <bytes>', 'Maximum file size in bytes', '524288')
    .action((logFile: string, options: { maxSize: string }) => {
      const maxSize = parseInt(options.maxSize, 10);
      if (isNaN(maxSize) || maxSize < 0) {
        process.stderr.write(`Invalid max-size: ${options.maxSize}\n`);
        process.exit(2);
      }

      if (rotateLog(logFile, maxSize)) {
        process.exit(0); // rotated
      } else {
        process.exit(1); // no rotation needed
      }
    });
}
