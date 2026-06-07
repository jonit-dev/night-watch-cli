import {
  INightWatchConfig,
  JobType,
  TelemetryErrorCategory,
  mapTelemetryErrorCategory,
  trackTelemetryEvent,
  validateRegistry,
} from '@night-watch/core';

export interface ICliTelemetryBaseProperties {
  cliVersion?: string;
  command?: string;
  jobType?: JobType;
  provider?: string;
  success?: boolean;
  failure?: boolean;
  durationMs?: number;
  exitCode?: number;
  platform?: string;
  nodeMajorVersion?: number;
  boardMode?: boolean;
  registeredProjectCount?: number;
  errorCategory?: TelemetryErrorCategory;
}

export type CliTelemetryReporter = (
  eventName: string,
  properties?: Record<string, unknown>,
) => Promise<unknown>;

let cliVersion = 'unknown';
let telemetryReporter: CliTelemetryReporter = (eventName, properties) =>
  trackTelemetryEvent(eventName, properties);

export function setCliTelemetryVersion(version: string): void {
  cliVersion = version;
}

export function setTelemetryReporterForTests(reporter: CliTelemetryReporter): void {
  telemetryReporter = reporter;
}

export function resetTelemetryReporterForTests(): void {
  telemetryReporter = (eventName, properties) => trackTelemetryEvent(eventName, properties);
}

function getNodeMajorVersion(): number {
  const major = parseInt(process.versions.node.split('.')[0] ?? '0', 10);
  return Number.isNaN(major) ? 0 : major;
}

function getRegisteredProjectCount(): number {
  try {
    return validateRegistry().valid.length;
  } catch {
    return 0;
  }
}

export function buildTelemetryBaseProperties(
  config?: INightWatchConfig,
): ICliTelemetryBaseProperties {
  return {
    cliVersion,
    platform: process.platform,
    nodeMajorVersion: getNodeMajorVersion(),
    boardMode: config ? config.boardProvider?.enabled !== false : undefined,
    registeredProjectCount: getRegisteredProjectCount(),
  };
}

export function fireTelemetryEvent(
  eventName: string,
  properties: Record<string, unknown> = {},
): void {
  void telemetryReporter(eventName, properties).catch(() => undefined);
}

export async function trackCommandStarted(
  command: string,
  config?: INightWatchConfig,
): Promise<void> {
  await telemetryReporter('command_started', {
    ...buildTelemetryBaseProperties(config),
    command,
  }).catch(() => undefined);
}

export async function trackCommandCompleted(
  command: string,
  startedAt: number,
  exitCode: number,
  config?: INightWatchConfig,
  extraProps: Record<string, unknown> = {},
): Promise<void> {
  await telemetryReporter('command_completed', {
    ...buildTelemetryBaseProperties(config),
    ...extraProps,
    command,
    durationMs: Math.max(0, Date.now() - startedAt),
    exitCode,
    success: exitCode === 0,
    failure: exitCode !== 0,
  }).catch(() => undefined);
}

export async function trackJobStarted(
  jobType: JobType,
  provider: string,
  config?: INightWatchConfig,
): Promise<void> {
  await telemetryReporter('job_started', {
    ...buildTelemetryBaseProperties(config),
    jobType,
    provider,
  }).catch(() => undefined);
}

export async function trackJobCompletedOrFailed(
  jobType: JobType,
  provider: string,
  startedAt: number,
  exitCode: number,
  config?: INightWatchConfig,
  errorCategory?: unknown,
): Promise<void> {
  await telemetryReporter(exitCode === 0 ? 'job_completed' : 'job_failed', {
    ...buildTelemetryBaseProperties(config),
    jobType,
    provider,
    durationMs: Math.max(0, Date.now() - startedAt),
    exitCode,
    success: exitCode === 0,
    failure: exitCode !== 0,
    errorCategory: exitCode === 0 ? undefined : mapTelemetryErrorCategory(errorCategory),
  }).catch(() => undefined);
}
