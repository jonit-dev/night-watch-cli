/**
 * Shared utilities for the Slack module.
 * Extracted from deliberation.ts and interaction-listener.ts to eliminate DRY violations.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Wait for the specified milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Build command-line invocation for spawning Night Watch processes.
 * Returns null if CLI entry path is unavailable.
 *
 * Handles three scenarios:
 * 1. Dev mode via tsx CLI: process.argv[1] is tsx/dist/cli.mjs, actual entry is argv[2]
 * 2. Dev mode direct .ts: process.argv[1] is a .ts file
 * 3. Production mode: process.argv[1] is a .js file
 *
 * In all dev scenarios, spawn via tsx CLI (fresh process, no watch-server IPC)
 * to avoid stream errors from IPC reconnection attempts.
 */
export function buildCurrentCliInvocation(args: string[]): string[] | null {
  const cliEntry = process.argv[1];
  if (!cliEntry) return null;

  // Scenario 1: Running via tsx CLI (tsx --watch packages/cli/src/cli.ts serve)
  // In this case, process.argv[1] is tsx/dist/cli.mjs, and actual entry is argv[2]
  if (isTsxInvokerPath(cliEntry)) {
    const actualEntry = process.argv[2];
    if (actualEntry) {
      // If actual entry is a .ts file, spawn via tsx CLI
      if (actualEntry.endsWith('.ts')) {
        const tsxCli = findTsxCliPath(actualEntry);
        if (tsxCli) {
          return [tsxCli, actualEntry, ...args];
        }
      }
      // If actual entry is a .js file, run directly with filtered flags
      const filteredExecArgv = filterTsxExecArgv(process.execArgv);
      return [...filteredExecArgv, actualEntry, ...args];
    }
  }

  // Scenario 2: Direct .ts entry (tsx packages/cli/src/cli.ts serve)
  // Spawn via tsx CLI to get a fresh process without watch-server IPC
  if (cliEntry.endsWith('.ts')) {
    const tsxCli = findTsxCliPath(cliEntry);
    if (tsxCli) {
      return [tsxCli, cliEntry, ...args];
    }
  }

  // Scenario 3: Production mode (.js entry)
  // Strip ALL tsx flags (preflight + loader) that would attempt IPC reconnection
  const filteredExecArgv = filterTsxExecArgv(process.execArgv);
  return [...filteredExecArgv, cliEntry, ...args];
}

/**
 * Check if the given path is a tsx invoker CLI (e.g., tsx/dist/cli.mjs)
 */
function isTsxInvokerPath(entryPath: string): boolean {
  return (
    entryPath.includes('/tsx/dist/cli.') ||
    entryPath.includes('\\tsx\\dist\\cli.') ||
    entryPath.endsWith('/tsx/cli.mjs') ||
    entryPath.endsWith('\\tsx\\cli.mjs')
  );
}

/**
 * Locate the tsx CLI entry point (cli.mjs) relative to the current CLI file.
 * Returns null if not found (e.g. production builds where tsx isn't installed).
 */
function findTsxCliPath(cliEntry: string): string | null {
  const dir = path.dirname(cliEntry);
  const candidates = [
    path.resolve(dir, '..', '..', '..', 'node_modules', 'tsx', 'dist', 'cli.mjs'),
    path.resolve(dir, '..', '..', '..', '..', 'node_modules', 'tsx', 'dist', 'cli.mjs'),
    path.resolve(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs'),
  ];
  return candidates.find((c) => fs.existsSync(c)) ?? null;
}

/**
 * Strip tsx watch-mode flags from execArgv so child processes don't inherit
 * tsx's IPC infrastructure.  tsx adds pairs like:
 *   --require .../tsx/dist/preflight.cjs
 *   --import  file://.../tsx/dist/loader.mjs
 * Both flags must be dropped: the preflight sets up the IPC back-channel, and the
 * loader also attempts to reconnect to the parent watch server on startup.
 */
function filterTsxExecArgv(execArgv: string[]): string[] {
  const filtered: string[] = [];
  let i = 0;
  while (i < execArgv.length) {
    const flag = execArgv[i];
    const next = execArgv[i + 1] ?? '';
    // Drop paired flags whose value points into the tsx dist directory.
    if (
      (flag === '--require' || flag === '--import') &&
      (next.includes('/tsx/dist/') || next.includes('\\tsx\\dist\\'))
    ) {
      i += 2; // skip both the flag and its value
      continue;
    }
    filtered.push(flag);
    i += 1;
  }
  return filtered;
}

/**
 * Build a clean environment for subprocess spawning.
 *
 * Inherits the full process environment but removes:
 * - Claude Code session markers (CLAUDECODE, CLAUDE_CODE_*) — these cause the
 *   claude CLI to refuse to start when launched inside an existing Claude Code
 *   session ("Claude Code cannot be launched inside another Claude Code session").
 * - Claude session-specific vars that could confuse provider invocations.
 *
 * Any caller-supplied overrides are merged in last and take precedence.
 */
export function buildSubprocessEnv(
  overrides: Record<string, string | undefined> = {},
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };

  // Strip Claude Code session vars that block nested claude invocations.
  const claudeSessionVars = [
    'CLAUDECODE',
    'CLAUDE_CODE_SSE_PORT',
    'CLAUDE_CODE_ENTRYPOINT',
    'CLAUDE_CODE_IDE_PORT',
    'CLAUDE_CODE_CLI_PATH',
  ];
  for (const key of claudeSessionVars) {
    delete env[key];
  }

  // Apply caller overrides (undefined values delete the key).
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete env[key];
    } else {
      env[key] = value;
    }
  }

  return env;
}

/**
 * Resolve the path to night-watch-cli's tsconfig.json for use as TSX_TSCONFIG_PATH.
 *
 * tsx has a known bug (https://github.com/privatenumber/tsx/issues/482) where path
 * alias resolution uses cwd rather than the source file location when spawning a
 * subprocess with a different cwd. Setting TSX_TSCONFIG_PATH forces tsx to use the
 * correct tsconfig regardless of cwd.
 *
 * Supports both dev (src/cli.ts) and built (dist/src/cli.js) layouts.
 */
export function getNightWatchTsconfigPath(): string | null {
  const cliEntry = process.argv[1];
  if (!cliEntry) return null;
  const srcDir = path.dirname(cliEntry);
  const candidates = [
    path.resolve(srcDir, '..', 'tsconfig.json'), // dev:   src/ -> root
    path.resolve(srcDir, '..', '..', 'tsconfig.json'), // built: dist/src/ -> root
  ];
  return candidates.find((c) => fs.existsSync(c)) ?? null;
}

/**
 * Format a command for logging (escapes arguments for shell safety).
 */
export function formatCommandForLog(bin: string, args: string[]): string {
  return [bin, ...args].map((part) => JSON.stringify(part)).join(' ');
}

export interface INormalizeTextOptions {
  /** Remove all non-alphanumeric characters except spaces */
  aggressive?: boolean;
  /** Preserve path-like characters (/, ., -, _) */
  preservePaths?: boolean;
}

/**
 * Normalize text for comparison or parsing.
 * Consolidates normalizeForComparison and normalizeForParsing into a single function with options.
 */
export function normalizeText(text: string, options: INormalizeTextOptions = {}): string {
  const { aggressive = true, preservePaths = false } = options;

  let result = text.toLowerCase();

  if (preservePaths) {
    // Preserve path-like characters for parsing project hints
    result = result.replace(/[^\w\s./-]/g, ' ');
  } else if (aggressive) {
    // Aggressive normalization for comparison (removes all non-alphanumeric)
    result = result.replace(/[^a-z0-9\s]/g, ' ');
  }

  return result.replace(/\s+/g, ' ').trim();
}

/**
 * Extract a human-readable error message from an unknown error type.
 * Replaces the repeated `err instanceof Error ? err.message : String(err)` pattern.
 */
export function extractErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === 'string') {
    return err;
  }
  return String(err);
}

/**
 * Normalize a project reference for matching.
 */
export function normalizeProjectRef(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Strip Slack user ID mentions from text.
 * Example: "Hey <@U12345> hello" -> "Hey  hello"
 */
export function stripSlackUserMentions(text: string): string {
  return text.replace(/<@[A-Z0-9]+>/g, ' ');
}

/**
 * Normalize a handle/name for comparison (removes non-alphanumeric).
 */
export function normalizeHandle(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Return a random integer in the inclusive range [min, max].
 */
export function randomInt(min: number, max: number): number {
  if (max <= min) return min;
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
