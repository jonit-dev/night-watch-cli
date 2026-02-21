/**
 * Serve command for Night Watch CLI
 * Starts the HTTP API server for the Web UI
 */

import * as fs from 'fs';
import { Command } from 'commander';
import { LOCK_FILE_PREFIX } from '@night-watch/core';
import { startGlobalServer, startServer } from '@night-watch/server';

type TServeMode = 'global' | 'local';

interface IServeLockResult {
  acquired: boolean;
  lockPath: string;
  existingPid?: number;
  stalePidCleaned?: number;
  message?: string;
}

export function getServeLockPath(mode: TServeMode, port: number): string {
  return `${LOCK_FILE_PREFIX}serve-${mode}-${port}.lock`;
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readPid(lockPath: string): number | null {
  try {
    if (!fs.existsSync(lockPath)) return null;
    const raw = fs.readFileSync(lockPath, 'utf-8').trim();
    const pid = parseInt(raw, 10);
    return Number.isFinite(pid) ? pid : null;
  } catch {
    return null;
  }
}

export function acquireServeLock(mode: TServeMode, port: number): IServeLockResult {
  const lockPath = getServeLockPath(mode, port);
  let stalePidCleaned: number | undefined;

  // Two attempts: second after stale lock cleanup.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = fs.openSync(lockPath, 'wx');
      fs.writeFileSync(fd, `${process.pid}\n`);
      fs.closeSync(fd);
      return { acquired: true, lockPath, stalePidCleaned };
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code !== 'EEXIST') {
        return {
          acquired: false,
          lockPath,
          message: err.message,
        };
      }

      const existingPid = readPid(lockPath);
      if (existingPid && isProcessRunning(existingPid)) {
        return {
          acquired: false,
          lockPath,
          existingPid,
          message: `already running with PID ${existingPid}`,
        };
      }

      try {
        fs.unlinkSync(lockPath);
        if (existingPid) {
          stalePidCleaned = existingPid;
        }
      } catch (unlinkError) {
        const unlinkErr = unlinkError as NodeJS.ErrnoException;
        return {
          acquired: false,
          lockPath,
          existingPid: existingPid ?? undefined,
          message: `stale lock exists but could not be removed: ${unlinkErr.message}`,
        };
      }
    }
  }

  return {
    acquired: false,
    lockPath,
    message: 'failed to acquire serve lock',
  };
}

export function releaseServeLock(lockPath: string): void {
  try {
    if (!fs.existsSync(lockPath)) return;

    const lockPid = readPid(lockPath);
    // Only remove lock if it belongs to this process or lock pid is unreadable.
    if (lockPid !== null && lockPid !== process.pid) return;

    fs.unlinkSync(lockPath);
  } catch {
    // Best-effort cleanup only.
  }
}

export function serveCommand(program: Command): void {
  program
    .command('serve')
    .description('Start the Night Watch web UI server')
    .option('-p, --port <number>', 'Port to run the server on', '7575')
    .option('-g, --global', 'Start in global mode (manage all registered projects)')
    .action((options) => {
      const port = parseInt(options.port, 10);
      if (isNaN(port) || port < 1 || port > 65535) {
        console.error(`Invalid port: ${options.port}. Port must be between 1 and 65535.`);
        process.exit(1);
      }

      const mode: TServeMode = options.global ? 'global' : 'local';
      const lock = acquireServeLock(mode, port);
      if (!lock.acquired) {
        const pidPart = lock.existingPid ? ` (PID ${lock.existingPid})` : '';
        const detail = lock.message ? `: ${lock.message}` : '';
        console.error(
          `[serve] Another Night Watch ${mode} server is already running on port ${port}${pidPart}${detail}`,
        );
        console.error(
          '[serve] Stop the existing process first, or use --port with a different value.',
        );
        process.exit(1);
      }

      if (lock.stalePidCleaned) {
        console.warn(
          `[serve] cleaned stale lock from PID ${lock.stalePidCleaned} (${lock.lockPath})`,
        );
      }
      console.log(`[serve] lock acquired ${lock.lockPath} pid=${process.pid}`);
      process.on('exit', () => {
        releaseServeLock(lock.lockPath);
      });

      if (options.global) {
        const execArgv = process.execArgv.length > 0 ? process.execArgv.join(' ') : '(none)';
        console.log(`[serve] mode=global port=${port} pid=${process.pid} node=${process.version}`);
        console.log(`[serve] execPath=${process.execPath}`);
        console.log(`[serve] execArgv=${execArgv}`);
        console.log(`[serve] argv=${process.argv.join(' ')}`);
      }

      if (options.global) {
        startGlobalServer(port);
      } else {
        const projectDir = process.cwd();
        startServer(projectDir, port);
      }
    });
}
