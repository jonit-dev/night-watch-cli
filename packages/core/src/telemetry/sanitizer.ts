import {
  ITelemetryEventProperties,
  TELEMETRY_ERROR_CATEGORIES,
  TELEMETRY_EVENT_NAMES,
  TelemetryErrorCategory,
  TelemetryEventName,
} from './schema.js';

const STRING_PROPERTIES = ['cliVersion', 'command', 'jobType', 'provider', 'platform'] as const;
const WEB_STRING_PROPERTIES = [
  'routeName',
  'uiArea',
  'action',
  'resource',
  'result',
  'statusCategory',
] as const;
const BOOLEAN_PROPERTIES = ['success', 'failure', 'boardMode', 'enabled', 'globalMode'] as const;
const INTEGER_PROPERTIES = [
  'durationMs',
  'exitCode',
  'nodeMajorVersion',
  'registeredProjectCount',
  'projectCount',
  'selectedProjectIndex',
  'itemCount',
  'columnCount',
  'pendingCount',
  'runningCount',
] as const;

const SAFE_STRING_PATTERN = /^[a-zA-Z0-9_.:-]{1,80}$/;
const WEB_ALLOWED_VALUES = {
  routeName: [
    'dashboard',
    'analytics',
    'prs',
    'board',
    'scheduling',
    'logs',
    'roadmap',
    'settings',
    'unknown',
  ],
  uiArea: [
    'app',
    'navigation',
    'dashboard',
    'project_selector',
    'jobs',
    'schedules',
    'settings',
    'feedback',
    'logs',
    'queue',
    'board',
    'roadmap',
    'prs',
  ],
  action: [
    'open',
    'view',
    'refresh',
    'select',
    'trigger',
    'pause',
    'resume',
    'cancel',
    'clear',
    'save',
    'toggle',
    'create',
    'move',
    'close',
    'filter',
    'follow',
    'unfollow',
    'retry',
    'remove',
  ],
  resource: [
    'app',
    'route',
    'project',
    'dashboard',
    'job',
    'schedule',
    'settings',
    'feedback',
    'augmentation',
    'logs',
    'queue',
    'board_issue',
    'roadmap',
    'prs',
    'config',
    'cron',
    'lock',
  ],
  result: ['success', 'failure', 'accepted', 'rejected', 'partial', 'unknown'],
  statusCategory: [
    'success',
    'failure',
    'warning',
    'empty',
    'disabled',
    'not_configured',
    'unknown',
  ],
} as const;

export interface ISanitizedTelemetryEvent {
  eventName: TelemetryEventName;
  properties: ITelemetryEventProperties;
}

export function isAllowedTelemetryEventName(eventName: string): eventName is TelemetryEventName {
  return TELEMETRY_EVENT_NAMES.includes(eventName as TelemetryEventName);
}

function isSuspiciousString(value: string): boolean {
  if (!SAFE_STRING_PATTERN.test(value)) {
    return true;
  }
  return value.includes('/') || value.includes('\\') || /^[a-z][a-z0-9+.-]*:/i.test(value);
}

function sanitizeString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || isSuspiciousString(trimmed)) {
    return undefined;
  }
  return trimmed;
}

function sanitizeAllowedWebString<K extends keyof typeof WEB_ALLOWED_VALUES>(
  key: K,
  value: unknown,
): (typeof WEB_ALLOWED_VALUES)[K][number] | undefined {
  const sanitized = sanitizeString(value);
  if (!sanitized) {
    return undefined;
  }
  return (WEB_ALLOWED_VALUES[key] as readonly string[]).includes(sanitized)
    ? (sanitized as (typeof WEB_ALLOWED_VALUES)[K][number])
    : undefined;
}

function sanitizeBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function sanitizeInteger(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    return undefined;
  }
  return value;
}

export function mapTelemetryErrorCategory(value: unknown): TelemetryErrorCategory {
  if (typeof value === 'string') {
    const normalized = value.toLowerCase();
    if (TELEMETRY_ERROR_CATEGORIES.includes(normalized as TelemetryErrorCategory)) {
      return normalized as TelemetryErrorCategory;
    }
    if (normalized.includes('timeout') || normalized.includes('timed out')) return 'timeout';
    if (normalized.includes('rate')) return 'rate_limit';
    if (normalized.includes('github') || normalized.includes('gh ')) return 'github';
    if (normalized.includes('network') || normalized.includes('fetch')) return 'network';
    if (
      normalized.includes('provider') ||
      normalized.includes('claude') ||
      normalized.includes('codex')
    ) {
      return 'provider';
    }
    if (normalized.includes('config')) return 'config';
    if (normalized.includes('valid')) return 'validation';
  }
  return 'unknown';
}

export function sanitizeTelemetryEvent(
  eventName: string,
  properties: Record<string, unknown> = {},
): ISanitizedTelemetryEvent | null {
  if (!isAllowedTelemetryEventName(eventName)) {
    return null;
  }

  const sanitized: ITelemetryEventProperties = {};

  for (const key of STRING_PROPERTIES) {
    const value = sanitizeString(properties[key]);
    if (value !== undefined) {
      sanitized[key] = value;
    }
  }

  for (const key of WEB_STRING_PROPERTIES) {
    const value = sanitizeAllowedWebString(key, properties[key]);
    if (value !== undefined) {
      sanitized[key] = value;
    }
  }

  for (const key of BOOLEAN_PROPERTIES) {
    const value = sanitizeBoolean(properties[key]);
    if (value !== undefined) {
      sanitized[key] = value;
    }
  }

  for (const key of INTEGER_PROPERTIES) {
    const value = sanitizeInteger(properties[key]);
    if (value !== undefined) {
      sanitized[key] = value;
    }
  }

  if (properties.errorCategory !== undefined) {
    sanitized.errorCategory = mapTelemetryErrorCategory(properties.errorCategory);
  }

  return { eventName, properties: sanitized };
}
