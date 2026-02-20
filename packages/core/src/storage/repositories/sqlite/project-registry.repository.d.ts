/**
 * SQLite implementation of IProjectRegistryRepository.
 * Persists project registry entries in the `projects` table.
 */
import 'reflect-metadata';
import Database from "better-sqlite3";
import { IRegistryEntry } from "@/utils/registry.js";
import { IProjectRegistryRepository } from "../interfaces.js";
export declare class SqliteProjectRegistryRepository implements IProjectRegistryRepository {
    private readonly _db;
    constructor(db: Database.Database);
    getAll(): IRegistryEntry[];
    upsert(entry: IRegistryEntry): void;
    remove(projectPath: string): boolean;
    clear(): void;
    updateSlackChannel(path: string, channelId: string): void;
}
//# sourceMappingURL=project-registry.repository.d.ts.map