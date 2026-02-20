/**
 * Execution history ledger for Night Watch CLI
 * Stores PRD execution records in the SQLite repository layer.
 * Decoupled from PRD file paths — keyed by project directory + PRD filename.
 */
import { resetRepositories } from "../storage/repositories/index.js";
import { closeDb } from "../storage/sqlite/client.js";
export type ExecutionOutcome = "success" | "failure" | "timeout" | "rate_limited";
export interface IExecutionRecord {
    timestamp: number;
    outcome: ExecutionOutcome;
    exitCode: number;
    attempt: number;
}
interface IPrdHistory {
    records: IExecutionRecord[];
}
/**
 * Full history structure: projectDir -> prdFile -> records
 */
export type IExecutionHistory = Record<string, Record<string, IPrdHistory>>;
/**
 * Get the path to the history file.
 * Kept for backward compatibility.
 */
export declare function getHistoryPath(): string;
/**
 * Load execution history from the SQLite repository.
 * Returns the full IExecutionHistory structure reconstructed from the DB.
 */
export declare function loadHistory(): IExecutionHistory;
/**
 * Save execution history to the repository.
 * Full replace: clears all existing records then inserts all records from the
 * provided IExecutionHistory structure in a single transaction.
 */
export declare function saveHistory(history: IExecutionHistory): void;
/**
 * Record a PRD execution result.
 * Appends a record and trims to MAX_HISTORY_RECORDS_PER_PRD.
 */
export declare function recordExecution(projectDir: string, prdFile: string, outcome: ExecutionOutcome, exitCode: number, attempt?: number): void;
/**
 * Get the most recent execution record for a PRD.
 * Returns null if no history exists.
 */
export declare function getLastExecution(projectDir: string, prdFile: string): IExecutionRecord | null;
/**
 * Check if a PRD is in cooldown after a recent non-success execution.
 * Returns true if the PRD should be skipped.
 */
export declare function isInCooldown(projectDir: string, prdFile: string, cooldownPeriod: number): boolean;
export { closeDb, resetRepositories };
//# sourceMappingURL=execution-history.d.ts.map