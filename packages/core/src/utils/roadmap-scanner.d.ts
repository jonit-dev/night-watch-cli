/**
 * Roadmap Scanner for Night Watch CLI
 * Scans ROADMAP.md files and generates PRD skeleton files
 */
import { INightWatchConfig } from "../types.js";
import { IRoadmapItem } from "./roadmap-parser.js";
/**
 * Status of the roadmap scanner
 */
export interface IRoadmapStatus {
    /** Whether ROADMAP.md file was found */
    found: boolean;
    /** Whether the scanner is enabled in config */
    enabled: boolean;
    /** Total number of items in roadmap */
    totalItems: number;
    /** Number of items that have been processed */
    processedItems: number;
    /** Number of items pending processing */
    pendingItems: number;
    /** Current status of the scanner */
    status: "idle" | "scanning" | "complete" | "disabled" | "no-roadmap";
    /** All roadmap items with processing status */
    items: Array<IRoadmapItem & {
        processed: boolean;
        prdFile?: string;
    }>;
}
/**
 * Result of a roadmap scan operation
 */
export interface IScanResult {
    /** List of PRD files created */
    created: string[];
    /** List of items skipped (already processed or checked) */
    skipped: string[];
    /** List of errors encountered */
    errors: string[];
}
/**
 * Result of slicing a single roadmap item
 */
export interface ISliceResult {
    /** Whether slicing was successful */
    sliced: boolean;
    /** The created PRD file path (relative to PRD dir) */
    file?: string;
    /** Error message if slicing failed */
    error?: string;
    /** The roadmap item that was processed */
    item?: IRoadmapItem;
}
/**
 * Get the current status of the roadmap scanner
 *
 * @param projectDir - The project directory
 * @param config - The Night Watch configuration
 * @returns The roadmap scanner status
 */
export declare function getRoadmapStatus(projectDir: string, config: INightWatchConfig): IRoadmapStatus;
/**
 * Slice a single roadmap item into a PRD using the AI provider
 *
 * @param projectDir - The project directory
 * @param prdDir - The PRD directory
 * @param item - The roadmap item to slice
 * @param config - The Night Watch configuration
 * @returns The slice result
 */
export declare function sliceRoadmapItem(projectDir: string, prdDir: string, item: IRoadmapItem, config: INightWatchConfig): Promise<ISliceResult>;
/**
 * Slice the next unprocessed roadmap item
 *
 * @param projectDir - The project directory
 * @param config - The Night Watch configuration
 * @returns The slice result
 */
export declare function sliceNextItem(projectDir: string, config: INightWatchConfig): Promise<ISliceResult>;
/**
 * Scan the roadmap and slice ONE item
 * This is now async and processes only a single item per call
 *
 * @param projectDir - The project directory
 * @param config - The Night Watch configuration
 * @returns The scan result with created, skipped, and error lists
 */
export declare function scanRoadmap(projectDir: string, config: INightWatchConfig): Promise<IScanResult>;
/**
 * Check if there are new (unprocessed) items in the roadmap
 */
export declare function hasNewItems(projectDir: string, config: INightWatchConfig): boolean;
//# sourceMappingURL=roadmap-scanner.d.ts.map