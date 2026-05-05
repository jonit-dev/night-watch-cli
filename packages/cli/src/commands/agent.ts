/**
 * Machine-readable agent manageability commands.
 */

import { Command } from 'commander';
import {
  createBoardProvider,
  fetchStatusSnapshot,
  getConfigValue,
  getJobRunsAnalytics,
  getQueueStatus,
  getValidJobTypes,
  loadConfig,
  parseConfigValue,
  setConfigValue,
} from '@night-watch/core';
import type {
  IJobRunAnalytics,
  INightWatchConfig,
  IStatusSnapshot,
  JobType,
} from '@night-watch/core';

const SCHEMA_VERSION = 1;
const JSON_OPTION = '--json';
const JSON_OPTION_DESCRIPTION = 'Output as JSON';

export interface IJsonOptions {
  json?: boolean;
}

interface ICommandErrorPayload {
  schemaVersion: number;
  ok: false;
  error: string;
}

interface IHealthCheck {
  name: string;
  ok: boolean;
  message: string;
}

interface IHealthPayload {
  schemaVersion: number;
  ok: boolean;
  checks: IHealthCheck[];
}

interface ILastRunInfo {
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastExitCode: number | null;
}

interface ILegacyStatus {
  projectName: string;
  projectDir: string;
  provider: string;
  reviewerEnabled: boolean;
  autoMerge: boolean;
  autoMergeMethod: string;
  executor: { running: boolean; pid: number | null };
  reviewer: { running: boolean; pid: number | null };
  qa: { running: boolean; pid: number | null };
  audit: { running: boolean; pid: number | null };
  planner: { running: boolean; pid: number | null };
  analytics: { running: boolean; pid: number | null };
  merger: { running: boolean; pid: number | null };
  prds: { pending: number; claimed: number; done: number };
  prs: { open: number };
  crontab: { installed: boolean; entries: string[] };
  logs: Record<string, { path: string; lastLines: string[]; exists: boolean; size: number }>;
}

interface IAgentStatusPayload {
  schemaVersion: number;
  generatedAt: string;
  project: {
    name: string;
    dir: string;
    provider: string;
  };
  status: ILegacyStatus;
  paused: Record<string, boolean>;
  queue: ReturnType<typeof getQueueStatus>;
  board: {
    configured: boolean;
    columns: Array<{ id: string; name: string }>;
    items: unknown[];
    error: string | null;
  };
  health: IHealthPayload;
  lastRuns: Record<string, ILastRunInfo>;
}

function writeJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function fail(message: string, options?: IJsonOptions): never {
  if (options?.json) {
    const payload: ICommandErrorPayload = {
      schemaVersion: SCHEMA_VERSION,
      ok: false,
      error: message,
    };
    process.stderr.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    process.stderr.write(`${message}\n`);
  }
  process.exit(1);
}

function getProcess(
  snapshot: IStatusSnapshot,
  name: string,
): { running: boolean; pid: number | null } {
  const processInfo = snapshot.processes.find((processEntry) => processEntry.name === name);
  return { running: processInfo?.running ?? false, pid: processInfo?.pid ?? null };
}

function buildLegacyStatus(snapshot: IStatusSnapshot, config: INightWatchConfig): ILegacyStatus {
  const pendingPrds = snapshot.prds.filter(
    (prd) => prd.status === 'ready' || prd.status === 'blocked',
  ).length;
  const claimedPrds = snapshot.prds.filter((prd) => prd.status === 'in-progress').length;
  const donePrds = snapshot.prds.filter((prd) => prd.status === 'done').length;
  const logs = Object.fromEntries(
    snapshot.logs.map((log) => [
      log.name,
      { path: log.path, lastLines: log.lastLines, exists: log.exists, size: log.size },
    ]),
  );

  return {
    projectName: snapshot.projectName,
    projectDir: snapshot.projectDir,
    provider: config.provider,
    reviewerEnabled: config.reviewerEnabled,
    autoMerge: config.autoMerge,
    autoMergeMethod: config.autoMergeMethod,
    executor: getProcess(snapshot, 'executor'),
    reviewer: getProcess(snapshot, 'reviewer'),
    qa: getProcess(snapshot, 'qa'),
    audit: getProcess(snapshot, 'audit'),
    planner: getProcess(snapshot, 'planner'),
    analytics: getProcess(snapshot, 'analytics'),
    merger: getProcess(snapshot, 'merger'),
    prds: { pending: pendingPrds, claimed: claimedPrds, done: donePrds },
    prs: { open: snapshot.prs.length },
    crontab: snapshot.crontab,
    logs,
  };
}

function buildPausedState(config: INightWatchConfig): Record<string, boolean> {
  return Object.fromEntries(
    getValidJobTypes().map((jobType) => [jobType, config.pausedJobs?.[jobType] === true]),
  );
}

function buildLastRuns(analytics: IJobRunAnalytics): Record<string, ILastRunInfo> {
  const lastRuns = Object.fromEntries(
    getValidJobTypes().map((jobType) => [
      jobType,
      { lastSuccessAt: null, lastFailureAt: null, lastExitCode: null },
    ]),
  ) as Record<string, ILastRunInfo>;

  for (const run of analytics.recentRuns) {
    const item = lastRuns[run.jobType];
    if (!item) continue;
    const finishedAt = run.finishedAt ? new Date(run.finishedAt * 1000).toISOString() : null;
    if (run.status === 'success' && item.lastSuccessAt === null) {
      item.lastSuccessAt = finishedAt;
      item.lastExitCode = 0;
    } else if (run.status !== 'success' && item.lastFailureAt === null) {
      item.lastFailureAt = finishedAt;
      item.lastExitCode = 1;
    }
  }

  return lastRuns;
}

async function getBoardSnapshot(
  projectDir: string,
  config: INightWatchConfig,
): Promise<IAgentStatusPayload['board']> {
  if (config.boardProvider?.enabled === false || !config.boardProvider?.projectNumber) {
    return { configured: false, columns: [], items: [], error: null };
  }

  try {
    const provider = createBoardProvider(config.boardProvider, projectDir);
    const [columns, items] = await Promise.all([provider.getColumns(), provider.getAllIssues()]);
    return { configured: true, columns, items, error: null };
  } catch (error) {
    return {
      configured: true,
      columns: [],
      items: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function buildHealth(snapshot: IStatusSnapshot, config: INightWatchConfig): IHealthPayload {
  const checks: IHealthCheck[] = [
    {
      name: 'config',
      ok: true,
      message: 'Configuration loaded',
    },
    {
      name: 'cron',
      ok: snapshot.crontab.installed,
      message: snapshot.crontab.installed
        ? 'Cron entries installed'
        : 'No Night Watch cron entries found',
    },
    {
      name: 'queue',
      ok: true,
      message: config.queue.enabled ? 'Global queue enabled' : 'Global queue disabled',
    },
    {
      name: 'provider',
      ok: Boolean(config.provider),
      message: config.provider
        ? `Provider configured: ${config.provider}`
        : 'No provider configured',
    },
  ];

  const staleLocks = snapshot.processes.filter(
    (processInfo) => !processInfo.running && processInfo.pid !== null,
  );
  checks.push({
    name: 'locks',
    ok: staleLocks.length === 0,
    message:
      staleLocks.length === 0
        ? 'No stale lock files detected'
        : `Stale lock files detected for ${staleLocks.map((lock) => lock.name).join(', ')}`,
  });

  return { schemaVersion: SCHEMA_VERSION, ok: checks.every((check) => check.ok), checks };
}

async function buildAgentStatus(projectDir: string): Promise<IAgentStatusPayload> {
  const config = loadConfig(projectDir);
  const snapshot = await fetchStatusSnapshot(projectDir, config);
  const analytics = getJobRunsAnalytics(24 * 30);
  const health = buildHealth(snapshot, config);

  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: snapshot.timestamp.toISOString(),
    project: { name: snapshot.projectName, dir: snapshot.projectDir, provider: config.provider },
    status: buildLegacyStatus(snapshot, config),
    paused: buildPausedState(config),
    queue: getQueueStatus(),
    board: await getBoardSnapshot(projectDir, config),
    health,
    lastRuns: buildLastRuns(analytics),
  };
}

function normalizeJobType(job: string): JobType {
  if (getValidJobTypes().includes(job as JobType)) {
    return job as JobType;
  }
  throw new Error(`Invalid job: ${job}. Valid jobs: ${getValidJobTypes().join(', ')}`);
}

export function agentCommand(program: Command): void {
  const agent = program.command('agent').description('Machine-readable agent operations');

  agent
    .command('status')
    .description('Print a stable machine-readable project snapshot')
    .requiredOption(JSON_OPTION, 'Output status as JSON')
    .action(async () => {
      writeJson(await buildAgentStatus(process.cwd()));
    });
}

export function configCommand(program: Command): void {
  const config = program.command('config').description('Inspect and edit Night Watch config');

  config
    .command('list')
    .description('Print resolved config')
    .option(JSON_OPTION, JSON_OPTION_DESCRIPTION)
    .action((options: IJsonOptions) => {
      const value = loadConfig(process.cwd());
      if (options.json) {
        writeJson({ schemaVersion: SCHEMA_VERSION, config: value });
      } else {
        writeJson(value);
      }
    });

  config
    .command('get <path>')
    .description('Read a resolved config value by dot path')
    .option(JSON_OPTION, JSON_OPTION_DESCRIPTION)
    .action((dotPath: string, options: IJsonOptions) => {
      try {
        const result = getConfigValue(process.cwd(), dotPath);
        if (options.json) {
          writeJson({ schemaVersion: SCHEMA_VERSION, ...result });
        } else {
          writeJson(result.value);
        }
      } catch (error) {
        fail(error instanceof Error ? error.message : String(error), options);
      }
    });

  config
    .command('set <path> <value>')
    .description('Write a config value by dot path')
    .option(JSON_OPTION, JSON_OPTION_DESCRIPTION)
    .action((dotPath: string, rawValue: string, options: IJsonOptions) => {
      try {
        const result = setConfigValue(process.cwd(), dotPath, parseConfigValue(rawValue));
        if (options.json) {
          writeJson({ schemaVersion: SCHEMA_VERSION, ok: true, ...result });
        } else {
          process.stdout.write(`Updated ${result.path}\n`);
        }
      } catch (error) {
        fail(error instanceof Error ? error.message : String(error), options);
      }
    });
}

export function healthCommand(program: Command): void {
  program
    .command('health')
    .description('Check automation readiness')
    .option(JSON_OPTION, JSON_OPTION_DESCRIPTION)
    .action(async (options: IJsonOptions) => {
      const config = loadConfig(process.cwd());
      const snapshot = await fetchStatusSnapshot(process.cwd(), config);
      const health = buildHealth(snapshot, config);
      if (options.json) {
        writeJson(health);
      } else {
        for (const check of health.checks) {
          process.stdout.write(`${check.ok ? 'ok' : 'fail'} ${check.name}: ${check.message}\n`);
        }
      }
      if (!health.ok) {
        process.exitCode = 1;
      }
    });
}

export function jobCommand(program: Command): void {
  const job = program.command('job').description('Manage Night Watch jobs');

  job
    .command('pause <job>')
    .description('Pause a cron/queue-dispatched job')
    .option(JSON_OPTION, JSON_OPTION_DESCRIPTION)
    .action((jobName: string, options: IJsonOptions) => {
      try {
        const jobType = normalizeJobType(jobName);
        const result = setConfigValue(process.cwd(), `pausedJobs.${jobType}`, true);
        if (options.json) {
          writeJson({
            schemaVersion: SCHEMA_VERSION,
            ok: true,
            job: jobType,
            paused: result.value,
          });
        } else {
          process.stdout.write(`Paused ${jobType}\n`);
        }
      } catch (error) {
        fail(error instanceof Error ? error.message : String(error), options);
      }
    });

  job
    .command('resume <job>')
    .description('Resume a cron/queue-dispatched job')
    .option(JSON_OPTION, JSON_OPTION_DESCRIPTION)
    .action((jobName: string, options: IJsonOptions) => {
      try {
        const jobType = normalizeJobType(jobName);
        const result = setConfigValue(process.cwd(), `pausedJobs.${jobType}`, false);
        if (options.json) {
          writeJson({
            schemaVersion: SCHEMA_VERSION,
            ok: true,
            job: jobType,
            paused: result.value,
          });
        } else {
          process.stdout.write(`Resumed ${jobType}\n`);
        }
      } catch (error) {
        fail(error instanceof Error ? error.message : String(error), options);
      }
    });

  job
    .command('is-paused <job>')
    .description('Return zero when a job is paused')
    .action((jobName: string) => {
      try {
        const jobType = normalizeJobType(jobName);
        const paused = loadConfig(process.cwd()).pausedJobs?.[jobType] === true;
        process.exit(paused ? 0 : 1);
      } catch {
        process.exit(1);
      }
    });
}
