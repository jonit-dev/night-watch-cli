/**
 * Roadmap State Manager for Night Watch CLI
 * Manages .roadmap-state.json for tracking processed items
 */

import * as fs from "fs";
import * as path from "path";

/**
 * Represents the state of a single processed roadmap item
 */
export interface IRoadmapStateItem {
  /** Original title from roadmap */
  title: string;
  /** Path to the generated PRD file */
  prdFile: string;
  /** ISO timestamp when item was processed */
  createdAt: string;
}

/**
 * Represents the full roadmap state persisted to .roadmap-state.json
 */
export interface IRoadmapState {
  /** State file format version */
  version: number;
  /** ISO timestamp of last scan */
  lastScan: string;
  /** Map of item hash to state item */
  items: Record<string, IRoadmapStateItem>;
}

/** Current version of the state file format */
const STATE_VERSION = 1;

/** Name of the state file */
const STATE_FILE_NAME = ".roadmap-state.json";

/**
 * Get the path to the roadmap state file
 */
export function getStateFilePath(prdDir: string): string {
  return path.join(prdDir, STATE_FILE_NAME);
}

/**
 * Load the roadmap state from disk
 * Returns an empty state if the file does not exist or is invalid
 *
 * @param prdDir - Directory containing PRD files (where state file lives)
 * @returns The loaded or empty roadmap state
 */
export function loadRoadmapState(prdDir: string): IRoadmapState {
  const statePath = getStateFilePath(prdDir);

  if (!fs.existsSync(statePath)) {
    return createEmptyState();
  }

  try {
    const content = fs.readFileSync(statePath, "utf-8");
    const parsed = JSON.parse(content);

    // Validate structure
    if (typeof parsed !== "object" || parsed === null) {
      return createEmptyState();
    }

    // Ensure version and items exist
    if (typeof parsed.version !== "number" || typeof parsed.items !== "object") {
      return createEmptyState();
    }

    // Validate lastScan is a string if present
    if (parsed.lastScan !== undefined && typeof parsed.lastScan !== "string") {
      parsed.lastScan = new Date().toISOString();
    }

    return {
      version: parsed.version,
      lastScan: parsed.lastScan || "",
      items: parsed.items || {},
    };
  } catch {
    // Invalid JSON or other error
    return createEmptyState();
  }
}

/**
 * Save the roadmap state to disk
 *
 * @param prdDir - Directory containing PRD files (where state file lives)
 * @param state - The state to save
 */
export function saveRoadmapState(prdDir: string, state: IRoadmapState): void {
  const statePath = getStateFilePath(prdDir);

  // Ensure directory exists
  const dir = path.dirname(statePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Update lastScan timestamp
  state.lastScan = new Date().toISOString();

  // Write with pretty formatting
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n", "utf-8");
}

/**
 * Create an empty roadmap state
 */
export function createEmptyState(): IRoadmapState {
  return {
    version: STATE_VERSION,
    lastScan: "",
    items: {},
  };
}

/**
 * Check if an item has already been processed
 *
 * @param state - The roadmap state
 * @param hash - The item hash to check
 * @returns True if the item has been processed
 */
export function isItemProcessed(state: IRoadmapState, hash: string): boolean {
  return hash in state.items;
}

/**
 * Mark an item as processed in the state
 *
 * @param state - The roadmap state (will be mutated)
 * @param hash - The item hash
 * @param item - The state item data
 * @returns The updated state
 */
export function markItemProcessed(
  state: IRoadmapState,
  hash: string,
  item: IRoadmapStateItem
): IRoadmapState {
  state.items[hash] = item;
  return state;
}

/**
 * Remove an item from the state (e.g., if PRD was deleted)
 *
 * @param state - The roadmap state (will be mutated)
 * @param hash - The item hash to remove
 * @returns True if the item was found and removed
 */
export function unmarkItemProcessed(state: IRoadmapState, hash: string): boolean {
  if (hash in state.items) {
    delete state.items[hash];
    return true;
  }
  return false;
}

/**
 * Get all processed item hashes
 */
export function getProcessedHashes(state: IRoadmapState): string[] {
  return Object.keys(state.items);
}

/**
 * Get state item by hash
 */
export function getStateItem(
  state: IRoadmapState,
  hash: string
): IRoadmapStateItem | undefined {
  return state.items[hash];
}
