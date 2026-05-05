/**
 * Dot-path helpers for non-interactive config inspection and edits.
 */

import * as fs from 'fs';
import * as path from 'path';
import { CONFIG_FILE_NAME } from '../constants.js';
import { getDefaultConfig, loadConfig } from '../config.js';
import { getValidJobTypes } from '../jobs/job-registry.js';
import type { INightWatchConfig, JobType } from '../types.js';
import { saveConfig } from './config-writer.js';

export interface IConfigPathResult {
  path: string;
  value: unknown;
}

export interface IConfigSetResult extends IConfigPathResult {
  previousValue: unknown;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function splitConfigPath(dotPath: string): string[] {
  const parts = dotPath
    .split('.')
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0 || parts.some((part) => part === '__proto__' || part === 'constructor')) {
    throw new Error(`Invalid config path: ${dotPath}`);
  }
  return parts;
}

function readRawConfig(projectDir: string): Record<string, unknown> {
  const configPath = path.join(projectDir, CONFIG_FILE_NAME);
  if (!fs.existsSync(configPath)) {
    return {};
  }
  return JSON.parse(fs.readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
}

function writeRawConfig(projectDir: string, rawConfig: Record<string, unknown>): void {
  const configPath = path.join(projectDir, CONFIG_FILE_NAME);
  fs.writeFileSync(configPath, `${JSON.stringify(rawConfig, null, 2)}\n`);
}

function getValueAtPath(source: unknown, parts: string[]): unknown {
  let current = source;
  for (const part of parts) {
    if (!isPlainObject(current) || !(part in current)) {
      return undefined;
    }
    current = current[part];
  }
  return current;
}

function setValueAtPath(target: Record<string, unknown>, parts: string[], value: unknown): void {
  let current = target;
  for (const part of parts.slice(0, -1)) {
    const next = current[part];
    if (next === undefined) {
      current[part] = {};
    } else if (!isPlainObject(next)) {
      throw new Error(`Cannot set ${parts.join('.')}: ${part} is not an object`);
    }
    current = current[part] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]!] = value;
}

function hasKnownConfigPath(parts: string[]): boolean {
  if (parts[0] === 'pausedJobs' && parts.length === 2) {
    return getValidJobTypes().includes(parts[1] as JobType);
  }

  const defaults = getDefaultConfig() as unknown as Record<string, unknown>;
  let current: unknown = defaults;
  for (const part of parts) {
    if (!isPlainObject(current) || !(part in current)) {
      return false;
    }
    current = current[part];
  }
  return true;
}

export function parseConfigValue(rawValue: string): unknown {
  const trimmed = rawValue.trim();
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === 'null') return null;
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(trimmed)) {
    return Number(trimmed);
  }
  if (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']')) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    return JSON.parse(trimmed);
  }
  return rawValue;
}

export function getConfigValue(projectDir: string, dotPath: string): IConfigPathResult {
  const parts = splitConfigPath(dotPath);
  if (!hasKnownConfigPath(parts)) {
    throw new Error(`Unknown config path: ${dotPath}`);
  }
  const config = loadConfig(projectDir) as unknown as Record<string, unknown>;
  return { path: parts.join('.'), value: getValueAtPath(config, parts) };
}

export function setConfigValue(
  projectDir: string,
  dotPath: string,
  value: unknown,
): IConfigSetResult {
  const parts = splitConfigPath(dotPath);
  if (!hasKnownConfigPath(parts)) {
    throw new Error(`Unknown config path: ${dotPath}`);
  }

  const rawConfig = readRawConfig(projectDir);
  const originalRawConfig = JSON.parse(JSON.stringify(rawConfig)) as Record<string, unknown>;
  const currentConfig = loadConfig(projectDir) as unknown as Record<string, unknown>;
  const previousValue = getValueAtPath(currentConfig, parts);

  setValueAtPath(rawConfig, parts, value);
  const result = saveConfig(projectDir, rawConfig as unknown as Partial<INightWatchConfig>);
  if (!result.success) {
    throw new Error(`Failed to save config: ${result.error}`);
  }

  const reloaded = loadConfig(projectDir) as unknown as Record<string, unknown>;
  const reloadedValue = getValueAtPath(reloaded, parts);
  if (JSON.stringify(reloadedValue) !== JSON.stringify(value)) {
    writeRawConfig(projectDir, originalRawConfig);
    throw new Error(`Invalid value for config path: ${parts.join('.')}`);
  }

  return { path: parts.join('.'), previousValue, value: reloadedValue };
}
