/**
 * Shared utilities for the Slack module.
 * Extracted from deliberation.ts and interaction-listener.ts to eliminate DRY violations.
 */

/**
 * Wait for the specified milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Build command-line invocation for spawning Night Watch processes.
 * Returns null if CLI entry path is unavailable.
 */
export function buildCurrentCliInvocation(args: string[]): string[] | null {
  const cliEntry = process.argv[1];
  if (!cliEntry) return null;
  return [...process.execArgv, cliEntry, ...args];
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
export function normalizeText(
  text: string,
  options: INormalizeTextOptions = {},
): string {
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
