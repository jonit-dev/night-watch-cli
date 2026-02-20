/**
 * Execution history ledger for Night Watch CLI
 * Stores PRD execution records in the SQLite repository layer.
 * Decoupled from PRD file paths — keyed by project directory + PRD filename.
 */
import * as os from "os";
import * as path from "path";
import { GLOBAL_CONFIG_DIR, HISTORY_FILE_NAME, MAX_HISTORY_RECORDS_PER_PRD, } from "../constants.js";
import { getRepositories, resetRepositories } from "../storage/repositories/index.js";
import { closeDb } from "../storage/sqlite/client.js";
/**
 * Get the path to the history file.
 * Kept for backward compatibility.
 */
export function getHistoryPath() {
    const base = process.env.NIGHT_WATCH_HOME || path.join(os.homedir(), GLOBAL_CONFIG_DIR);
    return path.join(base, HISTORY_FILE_NAME);
}
/**
 * Load execution history from the SQLite repository.
 * Returns the full IExecutionHistory structure reconstructed from the DB.
 */
export function loadHistory() {
    const { executionHistory } = getRepositories();
    return executionHistory.getAllHistory();
}
/**
 * Save execution history to the repository.
 * Full replace: clears all existing records then inserts all records from the
 * provided IExecutionHistory structure in a single transaction.
 */
export function saveHistory(history) {
    const { executionHistory } = getRepositories();
    executionHistory.replaceAll(history);
}
/**
 * Record a PRD execution result.
 * Appends a record and trims to MAX_HISTORY_RECORDS_PER_PRD.
 */
export function recordExecution(projectDir, prdFile, outcome, exitCode, attempt = 1) {
    const resolved = path.resolve(projectDir);
    const { executionHistory } = getRepositories();
    const record = {
        timestamp: Math.floor(Date.now() / 1000),
        outcome,
        exitCode,
        attempt,
    };
    executionHistory.addRecord(resolved, prdFile, record);
    executionHistory.trimRecords(resolved, prdFile, MAX_HISTORY_RECORDS_PER_PRD);
}
/**
 * Get the most recent execution record for a PRD.
 * Returns null if no history exists.
 */
export function getLastExecution(projectDir, prdFile) {
    const resolved = path.resolve(projectDir);
    const { executionHistory } = getRepositories();
    const records = executionHistory.getRecords(resolved, prdFile);
    return records.length > 0 ? records[0] : null;
}
/**
 * Check if a PRD is in cooldown after a recent non-success execution.
 * Returns true if the PRD should be skipped.
 */
export function isInCooldown(projectDir, prdFile, cooldownPeriod) {
    const last = getLastExecution(projectDir, prdFile);
    if (!last) {
        return false;
    }
    // Success records don't trigger cooldown
    if (last.outcome === "success") {
        return false;
    }
    const now = Math.floor(Date.now() / 1000);
    const age = now - last.timestamp;
    return age < cooldownPeriod;
}
export { closeDb, resetRepositories };
//# sourceMappingURL=execution-history.js.map