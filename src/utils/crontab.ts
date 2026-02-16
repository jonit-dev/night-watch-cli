/**
 * Crontab utility functions for Night Watch CLI
 * Provides safe read/write operations for user crontab
 */

import { execSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

/**
 * Marker prefix used to identify Night Watch entries
 */
export const CRONTAB_MARKER_PREFIX = "# night-watch-cli:";

/**
 * Check whether a crontab line belongs to the given project directory.
 * Supports unquoted, single-quoted, and double-quoted cd paths.
 */
function isEntryForProject(line: string, projectDir: string): boolean {
  if (!line.includes(CRONTAB_MARKER_PREFIX)) {
    return false;
  }

  const normalized = projectDir.replace(/\/+$/, "");
  const candidates = [
    `cd ${normalized}`,
    `cd '${normalized}'`,
    `cd "${normalized}"`,
  ];

  return candidates.some((candidate) => line.includes(candidate));
}

/**
 * Read current crontab entries
 * Returns empty array if user has no crontab
 */
export function readCrontab(): string[] {
  try {
    const output = execSync("crontab -l 2>/dev/null", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return output.trim().split("\n").filter((line) => line.length > 0);
  } catch (error) {
    // crontab -l returns error if no crontab exists
    // This is expected and should return empty array
    return [];
  }
}

/**
 * Write crontab entries
 * @param lines - Array of crontab lines to write
 * @throws Error if crontab write fails
 */
export function writeCrontab(lines: string[]): void {
  const content = lines.join("\n");

  // Create a backup first
  try {
    const currentCrontab = readCrontab();
    if (currentCrontab.length > 0) {
      execSync(`crontab -l > /tmp/night-watch-crontab-backup-$(date +%s).txt`, {
        encoding: "utf-8",
      });
    }
  } catch {
    // Ignore backup errors
  }

  // Write new crontab via temp file to avoid shell line length limits
  const tmpFile = path.join(os.tmpdir(), `night-watch-crontab-${Date.now()}.txt`);
  try {
    fs.writeFileSync(tmpFile, content + "\n");
    execSync(`crontab ${tmpFile}`, { encoding: "utf-8" });
  } catch (error) {
    throw new Error(
      `Failed to write crontab: ${error instanceof Error ? error.message : String(error)}`
    );
  } finally {
    try { fs.unlinkSync(tmpFile); } catch { /* ignore cleanup errors */ }
  }
}

/**
 * Generate a marker comment for identifying entries
 * @param projectName - Name of the project
 */
export function generateMarker(projectName: string): string {
  return `${CRONTAB_MARKER_PREFIX} ${projectName}`;
}

/**
 * Add a crontab entry if it doesn't already exist
 * @param entry - The crontab entry to add
 * @param marker - The marker to use for deduplication
 * @returns true if entry was added, false if it already existed
 */
export function addEntry(entry: string, marker: string): boolean {
  // Check if entry already exists
  if (hasEntry(marker)) {
    return false;
  }

  const lines = readCrontab();

  // Add the entry with marker comment on the same line
  const entryWithMarker = entry.endsWith(marker)
    ? entry
    : `${entry}  ${marker}`;

  lines.push(entryWithMarker);
  writeCrontab(lines);

  return true;
}

/**
 * Remove all crontab entries containing the marker
 * @param marker - The marker to search for
 * @returns Number of entries removed
 */
export function removeEntries(marker: string): number {
  const lines = readCrontab();
  const filtered = lines.filter((line) => !line.includes(marker));
  const removedCount = lines.length - filtered.length;

  if (removedCount > 0) {
    writeCrontab(filtered);
  }

  return removedCount;
}

/**
 * Check if an entry with the marker exists
 * @param marker - The marker to search for
 * @returns true if entry exists
 */
export function hasEntry(marker: string): boolean {
  const lines = readCrontab();
  return lines.some((line) => line.includes(marker));
}

/**
 * Get all entries containing the marker
 * @param marker - The marker to search for
 * @returns Array of matching entries
 */
export function getEntries(marker: string): string[] {
  const lines = readCrontab();
  return lines.filter((line) => line.includes(marker));
}

/**
 * Get all Night Watch entries for a project directory (independent of marker text)
 * @param projectDir - Absolute project directory
 */
export function getProjectEntries(projectDir: string): string[] {
  const lines = readCrontab();
  return lines.filter((line) => isEntryForProject(line, projectDir));
}

/**
 * Remove Night Watch entries for a project directory and/or marker
 * @param projectDir - Absolute project directory
 * @param marker - Optional marker for backward compatibility
 * @returns Number of entries removed
 */
export function removeEntriesForProject(projectDir: string, marker?: string): number {
  const lines = readCrontab();
  const filtered = lines.filter(
    (line) => !isEntryForProject(line, projectDir) && !(marker && line.includes(marker))
  );
  const removedCount = lines.length - filtered.length;

  if (removedCount > 0) {
    writeCrontab(filtered);
  }

  return removedCount;
}
