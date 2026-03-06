/**
 * Queue command — manage the global job queue.
 * Provides subcommands for viewing, clearing, and dispatching queued jobs.
 */

import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';

import chalk from 'chalk';
import { Command } from 'commander';

import {
  DEFAULT_QUEUE_MAX_WAIT_TIME,
  GLOBAL_CONFIG_DIR,
  clearQueue,
  dispatchNextJob,
  enqueueJob,
  expireStaleJobs,
  getQueueStatus,
  markJobRunning,
  removeJob,
} from '@night-watch/core';
import type { IQueueEntry, JobType } from '@night-watch/core';
import { createLogger } from '@night-watch/core';

const logger = createLogger('queue');

const VALID_JOB_TYPES: JobType[] = ['executor', 'reviewer', 'qa', 'audit', 'slicer'];

function formatTimestamp(unixTs: number | null): string {
  if (unixTs === null) return '-';
  return new Date(unixTs * 1000).toLocaleString();
}

function formatDuration(unixTs: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - unixTs;
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function printQueueEntry(entry: IQueueEntry, indent = ''): void {
  console.log(
    `${indent}${chalk.bold(`[${entry.id}]`)} ${chalk.cyan(entry.jobType)} for ${chalk.dim(entry.projectName)}`,
  );
  console.log(
    `${indent}  Status: ${entry.status} | Priority: ${entry.priority} | Enqueued: ${formatDuration(entry.enqueuedAt)}`,
  );
  if (entry.dispatchedAt) {
    console.log(`${indent}  Dispatched: ${formatTimestamp(entry.dispatchedAt)}`);
  }
}

export function createQueueCommand(): Command {
  const queue = new Command('queue');
  queue.description('Manage the global job queue');

  // night-watch queue status
  queue
    .command('status')
    .description('Show current queue status')
    .option('--json', 'Output as JSON')
    .action((opts: { json?: boolean }) => {
      const status = getQueueStatus();

      if (opts.json) {
        console.log(JSON.stringify({ ...status, enabled: true }, null, 2));
        return;
      }

      console.log(chalk.bold('\n📦 Global Job Queue Status\n'));

      if (status.running) {
        console.log(chalk.yellow('🔄 Running:'));
        printQueueEntry(status.running, '  ');
        console.log();
      } else {
        console.log(chalk.dim('  No job currently running'));
      }

      console.log();
      console.log(chalk.bold(`📋 Pending: ${status.pending.total} jobs`));

      if (status.pending.total > 0) {
        const byType = Object.entries(status.pending.byType);
        if (byType.length > 0) {
          console.log('  By type:');
          for (const [type, count] of byType) {
            console.log(`    ${type}: ${count}`);
          }
        }

        console.log();
        console.log(chalk.dim('  Next up:'));
        const nextUp = status.items.find((i) => i.status === 'pending');
        if (nextUp) {
          printQueueEntry(nextUp, '  ');
        }
      }

      if (status.items.length > 1) {
        console.log();
        console.log(chalk.dim('  All queued items:'));
        for (const item of status.items) {
          if (item.status === 'pending') {
            printQueueEntry(item, '  ');
          }
        }
      }

      console.log();
    });

  // night-watch queue list
  queue
    .command('list')
    .description('List all queue entries')
    .option('--status <status>', 'Filter by status (pending, running, dispatched, expired)')
    .option('--json', 'Output as JSON')
    .action((opts: { status?: string; json?: boolean }) => {
      const status = getQueueStatus();
      let items = status.items;

      if (opts.status) {
        items = items.filter((i) => i.status === opts.status);
      }

      if (opts.json) {
        console.log(JSON.stringify(items, null, 2));
        return;
      }

      if (items.length === 0) {
        console.log(chalk.dim('No queue entries found.'));
        return;
      }

      console.log(chalk.bold(`\n📋 Queue Entries (${items.length})\n`));
      for (const item of items) {
        printQueueEntry(item);
        console.log();
      }
    });

  // night-watch queue clear
  queue
    .command('clear')
    .description('Clear pending jobs from the queue')
    .option('--type <type>', 'Only clear jobs of this type')
    .option('--all', 'Clear all entries including running (dangerous)')
    .action((opts: { type?: string; all?: boolean }) => {
      if (opts.type && !VALID_JOB_TYPES.includes(opts.type as JobType)) {
        console.error(chalk.red(`Invalid job type: ${opts.type}`));
        console.error(chalk.dim(`Valid types: ${VALID_JOB_TYPES.join(', ')}`));
        process.exit(1);
      }

      const count = clearQueue(opts.type as JobType | undefined);
      console.log(chalk.green(`Cleared ${count} pending job(s) from the queue.`));
    });

  // night-watch queue enqueue
  queue
    .command('enqueue <job-type> <project-dir>')
    .description('Manually enqueue a job')
    .option('--env <json>', 'JSON object of environment variables to store', '{}')
    .action((jobType: string, projectDir: string, opts: { env?: string }) => {
      if (!VALID_JOB_TYPES.includes(jobType as JobType)) {
        console.error(chalk.red(`Invalid job type: ${jobType}`));
        console.error(chalk.dim(`Valid types: ${VALID_JOB_TYPES.join(', ')}`));
        process.exit(1);
      }

      let envVars: Record<string, string> = {};
      if (opts.env) {
        try {
          envVars = JSON.parse(opts.env) as Record<string, string>;
        } catch {
          console.error(chalk.red('Invalid JSON for --env'));
          process.exit(1);
        }
      }

      const projectName = path.basename(projectDir);
      const id = enqueueJob(projectDir, projectName, jobType as JobType, envVars);

      console.log(chalk.green(`Enqueued ${jobType} for ${projectName} (ID: ${id})`));
    });

  // night-watch queue dispatch
  queue
    .command('dispatch')
    .description('Dispatch the next pending job (used by cron scripts)')
    .option('--log <file>', 'Log file to write dispatch output')
    .action((_opts: { log?: string }) => {
      const entry = dispatchNextJob();

      if (!entry) {
        logger.info('No pending jobs to dispatch');
        return;
      }

      logger.info(`Dispatching ${entry.jobType} for ${entry.projectName} (ID: ${entry.id})`);

      // Construct the spawn command based on job type
      const scriptName = getScriptNameForJobType(entry.jobType);
      if (!scriptName) {
        logger.error(`Unknown job type: ${entry.jobType}`);
        return;
      }

      // Build environment with stored vars
      const env = {
        ...process.env,
        ...entry.envJson,
        NW_QUEUE_DISPATCHED: '1',
        NW_QUEUE_ENTRY_ID: String(entry.id),
      };

      // Find the script path
      const nightWatchHome =
        process.env.NIGHT_WATCH_HOME || path.join(os.homedir(), GLOBAL_CONFIG_DIR);
      const scriptPath = path.join(nightWatchHome, '..', 'scripts', scriptName);

      logger.info(`Spawning: ${scriptPath} ${entry.projectPath}`);

      // Spawn as detached to let it run independently
      const child = spawn('bash', [scriptPath, entry.projectPath], {
        detached: true,
        stdio: 'ignore',
        env,
        cwd: entry.projectPath,
      });

      child.unref();
      logger.info(`Spawned PID: ${child.pid}`);

      // Mark as running now that the process is launched
      markJobRunning(entry.id);
    });

  queue
    .command('complete <id>')
    .description('Remove a completed queue entry (used by cron scripts)')
    .action((id: string) => {
      const queueId = parseInt(id, 10);
      if (isNaN(queueId) || queueId < 1) {
        console.error(chalk.red('Queue entry id must be a positive integer'));
        process.exit(1);
      }

      removeJob(queueId);
    });

  // night-watch queue expire
  queue
    .command('expire')
    .description('Expire stale queued jobs')
    .option(
      '--max-wait <seconds>',
      'Maximum wait time in seconds',
      String(DEFAULT_QUEUE_MAX_WAIT_TIME),
    )
    .action((opts: { maxWait: string }) => {
      const maxWait = parseInt(opts.maxWait, 10);
      if (isNaN(maxWait) || maxWait < 60) {
        console.error(chalk.red('--max-wait must be at least 60 seconds'));
        process.exit(1);
      }

      const count = expireStaleJobs(maxWait);
      if (count > 0) {
        console.log(chalk.yellow(`Expired ${count} stale job(s)`));
      } else {
        console.log(chalk.dim('No stale jobs to expire'));
      }
    });

  return queue;
}

function getScriptNameForJobType(jobType: JobType): string | null {
  switch (jobType) {
    case 'executor':
      return 'night-watch-cron.sh';
    case 'reviewer':
      return 'night-watch-pr-reviewer-cron.sh';
    case 'qa':
      return 'night-watch-qa-cron.sh';
    case 'audit':
      return 'night-watch-audit-cron.sh';
    case 'slicer':
      return 'night-watch-slicer-cron.sh';
    default:
      return null;
  }
}

export function queueCommand(program: Command): void {
  program.addCommand(createQueueCommand());
}
