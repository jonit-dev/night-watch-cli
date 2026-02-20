/**
 * SQLite implementation of IPrdStateRepository.
 * Persists PRD state entries in the `prd_states` table.
 */
import 'reflect-metadata';
import Database from "better-sqlite3";
import { IPrdStateEntry } from "@/utils/prd-states.js";
import { IPrdStateRepository } from "../interfaces.js";
export declare class SqlitePrdStateRepository implements IPrdStateRepository {
    private readonly _db;
    constructor(db: Database.Database);
    get(projectPath: string, prdName: string): IPrdStateEntry | null;
    getAll(projectPath: string): Record<string, IPrdStateEntry>;
    readAll(): Record<string, Record<string, IPrdStateEntry>>;
    set(projectPath: string, prdName: string, entry: IPrdStateEntry): void;
    delete(projectPath: string, prdName: string): void;
}
//# sourceMappingURL=prd-state.repository.d.ts.map