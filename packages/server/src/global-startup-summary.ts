import {
  type INightWatchConfig,
  type IRegistryEntry,
  type ISessionOutcomeSummary,
  type IStatusSnapshot,
  fetchStatusSnapshot,
  getRepositories,
  loadConfig,
} from '@night-watch/core';

const RESET = '\u001b[0m';
const DIM = '\u001b[2m';
const BOLD = '\u001b[1m';
const GREEN = '\u001b[32m';
const YELLOW = '\u001b[33m';
const RED = '\u001b[31m';
const CYAN = '\u001b[36m';

const FAILURE_OUTCOME_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export interface IProjectStartupSummary {
  name: string;
  path: string;
  status: 'running' | 'active' | 'paused' | 'error';
  readyPrds: number;
  openPrs: number;
  failedPrs: number;
  pendingPrs: number;
  failureRate: number | null;
  provider: string;
  cronInstalled: boolean;
  runningProcesses: string[];
  error?: string;
}

export interface IStartupSummaryFormatOptions {
  color?: boolean;
}

interface IColorPalette {
  bold: (value: string) => string;
  dim: (value: string) => string;
  green: (value: string) => string;
  yellow: (value: string) => string;
  red: (value: string) => string;
  cyan: (value: string) => string;
}

function paint(enabled: boolean, code: string, value: string): string {
  return enabled ? `${code}${value}${RESET}` : value;
}

function palette(color: boolean): IColorPalette {
  return {
    bold: (value) => paint(color, BOLD, value),
    dim: (value) => paint(color, DIM, value),
    green: (value) => paint(color, GREEN, value),
    yellow: (value) => paint(color, YELLOW, value),
    red: (value) => paint(color, RED, value),
    cyan: (value) => paint(color, CYAN, value),
  };
}

function shouldUseColor(): boolean {
  return Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
}

function failureRateFromSummary(summary: ISessionOutcomeSummary): number | null {
  if (summary.totalCount === 0) return null;
  const failed = summary.failureCount + summary.timeoutCount + summary.rateLimitedCount;
  return Math.round((failed / summary.totalCount) * 100);
}

function getExecutorStatus(
  config: INightWatchConfig,
  snapshot: Pick<IStatusSnapshot, 'crontab' | 'processes'>,
): IProjectStartupSummary['status'] {
  if (snapshot.processes.some((processInfo) => processInfo.running)) {
    return 'running';
  }

  const executorActive =
    snapshot.crontab.installed && config.executorEnabled !== false && !config.pausedJobs?.executor;
  return executorActive ? 'active' : 'paused';
}

function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split('\n')[0]?.trim() || 'unknown error';
}

function formatStatusMarker(
  status: IProjectStartupSummary['status'],
  colors: IColorPalette,
): string {
  if (status === 'error') return colors.red('x');
  if (status === 'paused') return colors.yellow('○');
  return colors.green('●');
}

export function buildProjectStartupSummary(
  entry: IRegistryEntry,
  config: INightWatchConfig,
  snapshot: IStatusSnapshot,
  outcomeSummary: ISessionOutcomeSummary,
): IProjectStartupSummary {
  return {
    name: entry.name,
    path: entry.path,
    status: getExecutorStatus(config, snapshot),
    readyPrds: snapshot.prds.filter((prd) => prd.status === 'ready').length,
    openPrs: snapshot.prs.length,
    failedPrs: snapshot.prs.filter((pr) => pr.ciStatus === 'fail').length,
    pendingPrs: snapshot.prs.filter((pr) => pr.ciStatus === 'pending').length,
    failureRate: failureRateFromSummary(outcomeSummary),
    provider: String(config.provider),
    cronInstalled: snapshot.crontab.installed,
    runningProcesses: snapshot.processes
      .filter((processInfo) => processInfo.running)
      .map((processInfo) => processInfo.name),
  };
}

export async function collectProjectStartupSummary(
  entry: IRegistryEntry,
): Promise<IProjectStartupSummary> {
  try {
    const config = loadConfig(entry.path);
    const snapshot = await fetchStatusSnapshot(entry.path, config);
    const fromFinishedAt = Date.now() - FAILURE_OUTCOME_WINDOW_MS;
    const outcomeSummary = getRepositories().sessionOutcomes.querySummary({
      projectPath: entry.path,
      fromFinishedAt,
    });

    return buildProjectStartupSummary(entry, config, snapshot, outcomeSummary);
  } catch (error) {
    return {
      name: entry.name,
      path: entry.path,
      status: 'error',
      readyPrds: 0,
      openPrs: 0,
      failedPrs: 0,
      pendingPrs: 0,
      failureRate: null,
      provider: 'n/a',
      cronInstalled: false,
      runningProcesses: [],
      error: describeError(error),
    };
  }
}

export function formatProjectStartupSummaryLine(
  summary: IProjectStartupSummary,
  options: IStartupSummaryFormatOptions = {},
): string {
  const color = options.color ?? shouldUseColor();
  const c = palette(color);
  const statusColor =
    summary.status === 'active' || summary.status === 'running' ? c.green : c.yellow;
  const statusText =
    summary.status === 'error' ? c.red('error') : statusColor(summary.status.padEnd(7, ' '));
  const marker = formatStatusMarker(summary.status, c);

  if (summary.status === 'error') {
    return `  ${marker} ${statusText} ${c.bold(summary.name)} ${c.red(summary.error ?? 'unknown error')} ${c.dim(summary.path)}`;
  }

  const prStatus =
    summary.failedPrs > 0 || summary.pendingPrs > 0
      ? ` (${summary.failedPrs} fail, ${summary.pendingPrs} pending)`
      : '';
  const failureText =
    summary.failureRate === null ? c.dim('fail n/a') : `fail ${c.cyan(`${summary.failureRate}%`)}`;
  const cronText = summary.cronInstalled ? c.green('cron on') : c.dim('cron off');
  const runningText =
    summary.runningProcesses.length > 0
      ? ` ${c.dim(`run ${summary.runningProcesses.join(',')}`)}`
      : '';

  return [
    `  ${marker}`,
    statusText,
    c.bold(summary.name),
    `ready ${c.cyan(String(summary.readyPrds))}`,
    `PRs ${c.cyan(String(summary.openPrs))}${prStatus}`,
    failureText,
    `provider ${c.cyan(summary.provider)}`,
    cronText,
    `${c.dim(summary.path)}${runningText}`,
  ].join(' ');
}
