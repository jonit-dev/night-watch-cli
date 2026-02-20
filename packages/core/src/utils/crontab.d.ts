/**
 * Crontab utility functions for Night Watch CLI
 * Provides safe read/write operations for user crontab
 */
/**
 * Marker prefix used to identify Night Watch entries
 */
export declare const CRONTAB_MARKER_PREFIX = "# night-watch-cli:";
/**
 * Read current crontab entries
 * Returns empty array if user has no crontab
 */
export declare function readCrontab(): string[];
/**
 * Write crontab entries
 * @param lines - Array of crontab lines to write
 * @throws Error if crontab write fails
 */
export declare function writeCrontab(lines: string[]): void;
/**
 * Generate a marker comment for identifying entries
 * @param projectName - Name of the project
 */
export declare function generateMarker(projectName: string): string;
/**
 * Add a crontab entry if it doesn't already exist
 * @param entry - The crontab entry to add
 * @param marker - The marker to use for deduplication
 * @returns true if entry was added, false if it already existed
 */
export declare function addEntry(entry: string, marker: string): boolean;
/**
 * Remove all crontab entries containing the marker
 * @param marker - The marker to search for
 * @returns Number of entries removed
 */
export declare function removeEntries(marker: string): number;
/**
 * Check if an entry with the marker exists
 * @param marker - The marker to search for
 * @returns true if entry exists
 */
export declare function hasEntry(marker: string): boolean;
/**
 * Get all entries containing the marker
 * @param marker - The marker to search for
 * @returns Array of matching entries
 */
export declare function getEntries(marker: string): string[];
/**
 * Get all Night Watch entries for a project directory (independent of marker text)
 * @param projectDir - Absolute project directory
 */
export declare function getProjectEntries(projectDir: string): string[];
/**
 * Remove Night Watch entries for a project directory and/or marker
 * @param projectDir - Absolute project directory
 * @param marker - Optional marker for backward compatibility
 * @returns Number of entries removed
 */
export declare function removeEntriesForProject(projectDir: string, marker?: string): number;
//# sourceMappingURL=crontab.d.ts.map