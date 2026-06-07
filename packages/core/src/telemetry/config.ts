import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { GLOBAL_CONFIG_DIR, TELEMETRY_FILE_NAME } from '../constants.js';

export interface ITelemetryConfig {
  schemaVersion: 1;
  installId: string;
  enabled: boolean;
  noticeShownAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ITelemetryEffectiveState {
  config: ITelemetryConfig;
  enabled: boolean;
  reason: 'config' | 'env:NW_TELEMETRY_DISABLED' | 'env:DO_NOT_TRACK' | 'missing-api-key';
  path: string;
}

export interface ITelemetryConfigOptions {
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
}

export function getTelemetryConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  const base = env.NIGHT_WATCH_HOME || path.join(os.homedir(), GLOBAL_CONFIG_DIR);
  return path.join(base, TELEMETRY_FILE_NAME);
}

export function isTelemetryEnvDisabled(
  env: NodeJS.ProcessEnv = process.env,
): 'env:NW_TELEMETRY_DISABLED' | 'env:DO_NOT_TRACK' | null {
  if (env.NW_TELEMETRY_DISABLED === '1') {
    return 'env:NW_TELEMETRY_DISABLED';
  }
  if (env.DO_NOT_TRACK === '1') {
    return 'env:DO_NOT_TRACK';
  }
  return null;
}

function createTelemetryConfig(now: Date): ITelemetryConfig {
  const timestamp = now.toISOString();
  return {
    schemaVersion: 1,
    installId: crypto.randomUUID(),
    enabled: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function parseTelemetryConfig(raw: string): ITelemetryConfig | null {
  const parsed = JSON.parse(raw) as Partial<ITelemetryConfig>;
  if (
    parsed.schemaVersion !== 1 ||
    typeof parsed.installId !== 'string' ||
    parsed.installId.length === 0 ||
    typeof parsed.enabled !== 'boolean' ||
    typeof parsed.createdAt !== 'string' ||
    typeof parsed.updatedAt !== 'string'
  ) {
    return null;
  }

  return {
    schemaVersion: 1,
    installId: parsed.installId,
    enabled: parsed.enabled,
    noticeShownAt:
      typeof parsed.noticeShownAt === 'string' && parsed.noticeShownAt.length > 0
        ? parsed.noticeShownAt
        : undefined,
    createdAt: parsed.createdAt,
    updatedAt: parsed.updatedAt,
  };
}

function saveTelemetryConfig(config: ITelemetryConfig, env: NodeJS.ProcessEnv = process.env): void {
  const filePath = getTelemetryConfigPath(env);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}

export function loadOrCreateTelemetryConfig(
  options: ITelemetryConfigOptions = {},
): ITelemetryConfig {
  const env = options.env ?? process.env;
  const now = options.now?.() ?? new Date();
  const filePath = getTelemetryConfigPath(env);

  try {
    if (fs.existsSync(filePath)) {
      const parsed = parseTelemetryConfig(fs.readFileSync(filePath, 'utf-8'));
      if (parsed) {
        return parsed;
      }
    }
  } catch {
    // Invalid or unreadable local telemetry state is recoverable.
  }

  const fresh = createTelemetryConfig(now);
  try {
    saveTelemetryConfig(fresh, env);
  } catch {
    // Telemetry config persistence must not block CLI usage.
  }
  return fresh;
}

export function getTelemetryEffectiveState(
  options: ITelemetryConfigOptions & { apiKey?: string } = {},
): ITelemetryEffectiveState {
  const env = options.env ?? process.env;
  const config = loadOrCreateTelemetryConfig(options);
  const envDisabled = isTelemetryEnvDisabled(env);
  const pathValue = getTelemetryConfigPath(env);

  if (envDisabled) {
    return { config, enabled: false, path: pathValue, reason: envDisabled };
  }
  if (!config.enabled) {
    return { config, enabled: false, path: pathValue, reason: 'config' };
  }
  if (options.apiKey !== undefined && options.apiKey.trim().length === 0) {
    return { config, enabled: false, path: pathValue, reason: 'missing-api-key' };
  }
  return { config, enabled: true, path: pathValue, reason: 'config' };
}

export function setTelemetryEnabled(
  enabled: boolean,
  options: ITelemetryConfigOptions = {},
): ITelemetryConfig {
  const env = options.env ?? process.env;
  const config = loadOrCreateTelemetryConfig(options);
  const updated = {
    ...config,
    enabled,
    updatedAt: (options.now?.() ?? new Date()).toISOString(),
  };
  saveTelemetryConfig(updated, env);
  return updated;
}

export function markTelemetryNoticeShown(options: ITelemetryConfigOptions = {}): ITelemetryConfig {
  const env = options.env ?? process.env;
  const config = loadOrCreateTelemetryConfig(options);
  const timestamp = (options.now?.() ?? new Date()).toISOString();
  const updated = {
    ...config,
    noticeShownAt: config.noticeShownAt ?? timestamp,
    updatedAt: timestamp,
  };
  saveTelemetryConfig(updated, env);
  return updated;
}
