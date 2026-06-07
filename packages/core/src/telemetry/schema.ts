export const TELEMETRY_EVENT_NAMES = [
  'cli_first_run',
  'cli_init_completed',
  'command_started',
  'command_completed',
  'job_started',
  'job_completed',
  'job_failed',
  'pr_opened',
  'review_completed',
  'auto_merge_completed',
  'doctor_failed',
  'telemetry_enabled',
  'telemetry_disabled',
] as const;

export type TelemetryEventName = (typeof TELEMETRY_EVENT_NAMES)[number];

export const TELEMETRY_ERROR_CATEGORIES = [
  'config',
  'provider',
  'github',
  'network',
  'rate_limit',
  'timeout',
  'validation',
  'unknown',
] as const;

export type TelemetryErrorCategory = (typeof TELEMETRY_ERROR_CATEGORIES)[number];

export interface ITelemetryEventProperties {
  cliVersion?: string;
  command?: string;
  jobType?: string;
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

export interface ITelemetryEventInput {
  eventName: string;
  properties?: Record<string, unknown>;
}
