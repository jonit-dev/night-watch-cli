/**
 * SQLite implementation of IRoadmapStateRepository.
 * Persists roadmap state in the `roadmap_states` table, keyed by prd_dir.
 */
import 'reflect-metadata';
import Database from "better-sqlite3";
import { IRoadmapState } from "@/utils/roadmap-state.js";
import { IRoadmapStateRepository } from "../interfaces.js";
export declare class SqliteRoadmapStateRepository implements IRoadmapStateRepository {
    private readonly _db;
    constructor(db: Database.Database);
    load(prdDir: string): IRoadmapState | null;
    save(prdDir: string, state: IRoadmapState): void;
}
//# sourceMappingURL=roadmap-state.repository.d.ts.map