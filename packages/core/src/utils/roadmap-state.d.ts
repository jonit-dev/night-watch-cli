/**
 * Roadmap State Manager for Night Watch CLI
 * Manages roadmap processing state via the SQLite repository layer.
 * Writes the legacy .roadmap-state.json file alongside SQLite for backward
 * compatibility and falls back to it when no SQLite row exists for a given
 * prdDir (migration path).
 */
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
/**
 * Get the path to the roadmap state file
 */
export declare function getStateFilePath(prdDir: string): string;
/**
 * Load the roadmap state.
 * Checks the SQLite repository first; falls back to the legacy JSON file when
 * no SQLite entry exists for prdDir (supports migration from old installs).
 * Returns an empty state if neither source has data.
 *
 * @param prdDir - Directory containing PRD files (primary key in SQLite)
 * @returns The loaded or empty roadmap state
 */
export declare function loadRoadmapState(prdDir: string): IRoadmapState;
/**
 * Save the roadmap state.
 * Writes to SQLite (primary) and also writes the legacy .roadmap-state.json
 * file so that external tooling and existing tests continue to work.
 *
 * @param prdDir - Directory containing PRD files (primary key in SQLite)
 * @param state - The state to save
 */
export declare function saveRoadmapState(prdDir: string, state: IRoadmapState): void;
/**
 * Create an empty roadmap state
 */
export declare function createEmptyState(): IRoadmapState;
/**
 * Check if an item has already been processed
 *
 * @param state - The roadmap state
 * @param hash - The item hash to check
 * @returns True if the item has been processed
 */
export declare function isItemProcessed(state: IRoadmapState, hash: string): boolean;
/**
 * Mark an item as processed in the state
 *
 * @param state - The roadmap state (will be mutated)
 * @param hash - The item hash
 * @param item - The state item data
 * @returns The updated state
 */
export declare function markItemProcessed(state: IRoadmapState, hash: string, item: IRoadmapStateItem): IRoadmapState;
/**
 * Remove an item from the state (e.g., if PRD was deleted)
 *
 * @param state - The roadmap state (will be mutated)
 * @param hash - The item hash to remove
 * @returns True if the item was found and removed
 */
export declare function unmarkItemProcessed(state: IRoadmapState, hash: string): boolean;
/**
 * Get all processed item hashes
 */
export declare function getProcessedHashes(state: IRoadmapState): string[];
/**
 * Get state item by hash
 */
export declare function getStateItem(state: IRoadmapState, hash: string): IRoadmapStateItem | undefined;
//# sourceMappingURL=roadmap-state.d.ts.map