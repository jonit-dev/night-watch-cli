/**
 * Queue command — manage the global job queue.
 * Provides subcommands for viewing, clearing, and dispatching queued jobs.
 */

import * as path from 'path';
import { spawn } from 'child_process';

import chalk from 'chalk';
import { Command } from 'commander';

import {
  DEFAULT_QUEUE_MAX_WAIT_TIME,
  canStartJob,
  claimJobSlot,
  clearQueue,
  dispatchNextJob,
  enqueueJob,
  expireStaleJobs,
  getQueueStatus,
  getScriptPath,
  loadConfig,
  markJobRunning,
  removeJob,
  resolveJobProvider,
  resolvePreset,
  resolveProviderBucketKey,
  updateJobStatus,
} from '@night-watch/core';
import type { IQueueEntry, JobType, Provider } from '@night-watch/core';
import { createLogger } from '@night-watch/core';
import { buildQueuedJobEnv } from './shared/env-builder.js';

const logger = createLogger('queue');

const VALID_JOB_TYPES: JobType[] = [
  'executor',
  'reviewer',
  'qa',
  'audit',
  'slicer',
  'planner',
  'pr-resolver',
  'merger',
];

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
    .option('--provider-key <key>', 'Provider bucket key (e.g. claude-native, codex)')
    .action((jobType: string, projectDir: string, opts: { env?: string; providerKey?: string }) => {
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
      const queueConfig = loadConfig(projectDir).queue;
      const id = enqueueJob(
        projectDir,
        projectName,
        jobType as JobType,
        envVars,
        queueConfig,
        opts.providerKey,
      );

      console.log(chalk.green(`Enqueued ${jobType} for ${projectName} (ID: ${id})`));
    });

  // night-watch queue resolve-key
  queue
    .command('resolve-key')
    .description('Resolve the provider bucket key for a given project and job type')
    .requiredOption('--project <dir>', 'Project directory')
    .requiredOption(
      '--job-type <type>',
      'Job type (executor, reviewer, qa, audit, slicer, planner, pr-resolver, merger)',
    )
    .action((opts: { project: string; jobType: string }) => {
      try {
        const config = loadConfig(opts.project);
        const presetId = resolveJobProvider(config, opts.jobType as JobType);
        const preset = resolvePreset(config, presetId);
        const effectiveProviderEnv: Record<string, string> = {
          ...(config.providerEnv ?? {}),
          ...(preset.envVars ?? {}),
        };
        const key = resolveProviderBucketKey(preset.command as Provider, effectiveProviderEnv);
        process.stdout.write(`${key}\n`);
      } catch {
        process.stdout.write('');
      }
      process.exit(0);
    });

  // night-watch queue dispatch
  queue
    .command('dispatch')
    .description('Dispatch the next pending job (used by cron scripts)')
    .option('--log <file>', 'Log file to write dispatch output')
    .option('--project-dir <dir>', 'Project directory to load queue config from (defaults to cwd)')
    .action((_opts: { log?: string; projectDir?: string }) => {
      const configDir = _opts.projectDir ?? process.cwd();
      const entry = dispatchNextJob(loadConfig(configDir).queue);

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

      // Rebuild env from queued project's config (not from dispatcher process.env)
      // This ensures provider-specific env (ANTHROPIC_BASE_URL, API keys, model ids)
      // always comes from the queued job's own project config.
      let projectEnv: Record<string, string>;
      try {
        projectEnv = buildQueuedJobEnv(entry);
      } catch {
        // If config load fails, fall back to process env
        projectEnv = {};
      }
      const env = {
        ...process.env,
        ...projectEnv,
        // Overlay persisted runtime-only NW_* queue markers from the queue entry
        // (These are queue-specific flags, not provider identity)
        ...filterQueueMarkers(entry.envJson),
        NW_QUEUE_DISPATCHED: '1',
        NW_QUEUE_ENTRY_ID: String(entry.id),
      };

      // Resolve the bundled script path for the current install context.
      const scriptPath = getScriptPath(scriptName);

      logger.info(`Spawning: ${scriptPath} ${entry.projectPath}`);

      try {
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
        markJobRunning(entry.id, child.pid ?? undefined);
      } catch (error) {
        updateJobStatus(entry.id, 'pending');
        logger.error(
          `Failed to dispatch ${entry.jobType} for ${entry.projectName}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        process.exit(1);
      }
    });

  // night-watch queue claim
  queue
    .command('claim <job-type> <project-dir>')
    .description(
      'Atomically claim a concurrency slot and insert a running entry (used by cron scripts)',
    )
    .option('--provider-key <key>', 'Provider bucket key (e.g. claude-native, codex)')
    .option('--pid <pid>', 'PID of the calling process (stored for stale-job detection)')
    .action((jobType: string, projectDir: string, opts: { providerKey?: string; pid?: string }) => {
      if (!VALID_JOB_TYPES.includes(jobType as JobType)) {
        console.error(`Invalid job type: ${jobType}`);
        console.error(`Valid types: ${VALID_JOB_TYPES.join(', ')}`);
        process.exit(1);
      }

      const queueConfig = loadConfig(projectDir).queue;
      const projectName = path.basename(projectDir);
      const callerPid = opts.pid ? parseInt(opts.pid, 10) : undefined;
      const result = claimJobSlot(
        projectDir,
        projectName,
        jobType as JobType,
        opts.providerKey,
        queueConfig,
        callerPid,
      );

      if (!result.claimed) {
        process.exit(1);
      }

      // Print only the numeric ID so bash callers can capture it cleanly.
      process.stdout.write(`${result.id}\n`);
      process.exit(0);
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

  queue
    .command('can-start')
    .description('Return a zero exit status when the global queue has an available slot')
    .option('--project-dir <dir>', 'Project directory to load queue config from (defaults to cwd)')
    .action((opts: { projectDir?: string }) => {
      const configDir = opts.projectDir ?? process.cwd();
      const queueConfig = loadConfig(configDir).queue;
      process.exit(canStartJob(queueConfig) ? 0 : 1);
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

/**
 * NW_* env keys that are legitimate queue/runtime markers (not provider identity keys).
 * Only these keys from a queued entry's envJson are forwarded at dispatch time.
 * Provider identity (ANTHROPIC_BASE_URL, API keys, model ids) is always recomputed
 * from the queued job's own project config via buildQueuedJobEnv.
 */
const QUEUE_MARKER_KEYS = new Set([
  'NW_DRY_RUN',
  'NW_CRON_TRIGGER',
  'NW_DEFAULT_BRANCH',
  'NW_TARGET_PR',
  'NW_REVIEWER_WORKER_MODE',
  'NW_REVIEWER_PARALLEL',
  'NW_REVIEWER_WORKER_STAGGER',
  'NW_REVIEWER_MAX_RUNTIME',
  'NW_REVIEWER_MAX_RETRIES',
  'NW_REVIEWER_RETRY_DELAY',
  'NW_REVIEWER_MAX_PRS_PER_RUN',
  'NW_MIN_REVIEW_SCORE',
  'NW_BRANCH_PATTERNS',
  'NW_PRD_DIR',
  'NW_AUTO_MERGE',
  'NW_AUTO_MERGE_METHOD',
  'NW_MAX_RUNTIME',
  'NW_QA_MAX_RUNTIME',
]);

/**
 * Filter envJson to only pass through legitimate queue/runtime markers.
 * Drops any provider identity keys that may have been persisted in the queue entry.
 */
function filterQueueMarkers(envJson: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(envJson)) {
    if (QUEUE_MARKER_KEYS.has(key)) {
      result[key] = value;
    }
  }
  return result;
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
    case 'planner':
      return 'night-watch-plan-cron.sh';
    case 'pr-resolver':
      return 'night-watch-pr-resolver-cron.sh';
    case 'merger':
      return 'night-watch-merger-cron.sh';
    default:
      return null;
  }
}

export function queueCommand(program: Command): void {
  program.addCommand(createQueueCommand());
}
