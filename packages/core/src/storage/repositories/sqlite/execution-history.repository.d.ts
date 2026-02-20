/**
 * SQLite implementation of IExecutionHistoryRepository.
 * Persists execution records in the `execution_history` table.
 */
import 'reflect-metadata';
import Database from "better-sqlite3";
import { IExecutionRecord } from "@/utils/execution-history.js";
import { IExecutionHistoryRepository } from "../interfaces.js";
export declare class SqliteExecutionHistoryRepository implements IExecutionHistoryRepository {
    private readonly _db;
    constructor(db: Database.Database);
    getRecords(projectPath: string, prdFile: string): IExecutionRecord[];
    addRecord(projectPath: string, prdFile: string, record: IExecutionRecord): void;
    getAllHistory(): Record<string, Record<string, {
        records: IExecutionRecord[];
    }>>;
    replaceAll(history: Record<string, Record<string, {
        records: IExecutionRecord[];
    }>>): void;
    trimRecords(projectPath: string, prdFile: string, maxCount: number): void;
}
//# sourceMappingURL=execution-history.repository.d.ts.map