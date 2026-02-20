/**
 * Roadmap State Manager for Night Watch CLI
 * Manages roadmap processing state via the SQLite repository layer.
 * Writes the legacy .roadmap-state.json file alongside SQLite for backward
 * compatibility and falls back to it when no SQLite row exists for a given
 * prdDir (migration path).
 */
import * as fs from "fs";
import * as path from "path";
import { getRepositories } from "../storage/repositories/index.js";
/** Current version of the state file format */
const STATE_VERSION = 1;
/** Name of the state file */
const STATE_FILE_NAME = ".roadmap-state.json";
/**
 * Get the path to the roadmap state file
 */
export function getStateFilePath(prdDir) {
    return path.join(prdDir, STATE_FILE_NAME);
}
/**
 * Attempt to read state from the legacy JSON file.
 * Returns null if the file does not exist or is invalid.
 */
function readJsonState(prdDir) {
    const statePath = getStateFilePath(prdDir);
    if (!fs.existsSync(statePath)) {
        return null;
    }
    try {
        const content = fs.readFileSync(statePath, "utf-8");
        const parsed = JSON.parse(content);
        if (typeof parsed !== "object" || parsed === null) {
            return null;
        }
        const obj = parsed;
        if (typeof obj.version !== "number" || typeof obj.items !== "object") {
            return null;
        }
        if (obj.lastScan !== undefined && typeof obj.lastScan !== "string") {
            obj.lastScan = new Date().toISOString();
        }
        return {
            version: obj.version,
            lastScan: typeof obj.lastScan === "string" ? obj.lastScan : "",
            items: (obj.items ?? {}),
        };
    }
    catch {
        return null;
    }
}
/**
 * Load the roadmap state.
 * Checks the SQLite repository first; falls back to the legacy JSON file when
 * no SQLite entry exists for prdDir (supports migration from old installs).
 * Returns an empty state if neither source has data.
 *
 * @param prdDir - Directory containing PRD files (primary key in SQLite)
 * @returns The loaded or empty roadmap state
 */
export function loadRoadmapState(prdDir) {
    const { roadmapState } = getRepositories();
    const fromDb = roadmapState.load(prdDir);
    if (fromDb !== null) {
        return fromDb;
    }
    const fromJson = readJsonState(prdDir);
    if (fromJson !== null) {
        return fromJson;
    }
    return createEmptyState();
}
/**
 * Save the roadmap state.
 * Writes to SQLite (primary) and also writes the legacy .roadmap-state.json
 * file so that external tooling and existing tests continue to work.
 *
 * @param prdDir - Directory containing PRD files (primary key in SQLite)
 * @param state - The state to save
 */
export function saveRoadmapState(prdDir, state) {
    // Update lastScan timestamp
    state.lastScan = new Date().toISOString();
    // Persist to SQLite
    const { roadmapState } = getRepositories();
    roadmapState.save(prdDir, state);
    // Also write the legacy JSON file for backward compatibility
    const statePath = getStateFilePath(prdDir);
    const dir = path.dirname(statePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n", "utf-8");
}
/**
 * Create an empty roadmap state
 */
export function createEmptyState() {
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
export function isItemProcessed(state, hash) {
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
export function markItemProcessed(state, hash, item) {
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
export function unmarkItemProcessed(state, hash) {
    if (hash in state.items) {
        delete state.items[hash];
        return true;
    }
    return false;
}
/**
 * Get all processed item hashes
 */
export function getProcessedHashes(state) {
    return Object.keys(state.items);
}
/**
 * Get state item by hash
 */
export function getStateItem(state, hash) {
    return state.items[hash];
}
//# sourceMappingURL=roadmap-state.js.map