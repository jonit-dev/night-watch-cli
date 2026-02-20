/**
 * Global project registry for Night Watch CLI
 * Manages project entries via the SQLite repository layer.
 */
import { resetRepositories } from "../storage/repositories/index.js";
import { closeDb } from "../storage/sqlite/client.js";
export interface IRegistryEntry {
    name: string;
    path: string;
    slackChannelId?: string;
}
/**
 * Get the path to the global registry file.
 * Kept for backward compatibility.
 */
export declare function getRegistryPath(): string;
/**
 * Load all registry entries from the SQLite repository.
 */
export declare function loadRegistry(): IRegistryEntry[];
/**
 * Save a full set of registry entries (full replace).
 * Deletes all existing entries then upserts each provided entry in a transaction.
 */
export declare function saveRegistry(entries: IRegistryEntry[]): void;
/**
 * Register a project in the global registry.
 * No-op if already registered by path. Returns the entry.
 */
export declare function registerProject(projectDir: string): IRegistryEntry;
/**
 * Remove a project from the registry by path.
 * Returns true if it was found and removed.
 */
export declare function unregisterProject(projectDir: string): boolean;
/**
 * Validate all registry entries.
 * Returns entries split into valid (path + config exist) and invalid.
 */
export declare function validateRegistry(): {
    valid: IRegistryEntry[];
    invalid: IRegistryEntry[];
};
export { closeDb, resetRepositories };
//# sourceMappingURL=registry.d.ts.map