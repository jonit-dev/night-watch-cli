/**
 * Execution history ledger for Night Watch CLI
 * Stores PRD execution records in ~/.night-watch/history.json
 * Decoupled from PRD file paths — keyed by project directory + PRD filename.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  GLOBAL_CONFIG_DIR,
  HISTORY_FILE_NAME,
  MAX_HISTORY_RECORDS_PER_PRD,
} from "../constants.js";

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
 * Get the path to the history file
 */
export function getHistoryPath(): string {
  const base =
    process.env.NIGHT_WATCH_HOME || path.join(os.homedir(), GLOBAL_CONFIG_DIR);
  return path.join(base, HISTORY_FILE_NAME);
}

/**
 * Load execution history from disk. Returns empty object if missing or invalid.
 */
export function loadHistory(): IExecutionHistory {
  const historyPath = getHistoryPath();
  if (!fs.existsSync(historyPath)) {
    return {};
  }
  try {
    const content = fs.readFileSync(historyPath, "utf-8");
    const parsed = JSON.parse(content);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return parsed as IExecutionHistory;
  } catch {
    return {};
  }
}

/**
 * Save execution history to disk.
 */
export function saveHistory(history: IExecutionHistory): void {
  const historyPath = getHistoryPath();
  const dir = path.dirname(historyPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(historyPath, JSON.stringify(history, null, 2) + "\n");
}

/**
 * Record a PRD execution result.
 * Appends a record and trims to MAX_HISTORY_RECORDS_PER_PRD.
 */
export function recordExecution(
  projectDir: string,
  prdFile: string,
  outcome: ExecutionOutcome,
  exitCode: number,
  attempt: number = 1
): void {
  const resolved = path.resolve(projectDir);
  const history = loadHistory();

  if (!history[resolved]) {
    history[resolved] = {};
  }
  if (!history[resolved][prdFile]) {
    history[resolved][prdFile] = { records: [] };
  }

  const record: IExecutionRecord = {
    timestamp: Math.floor(Date.now() / 1000),
    outcome,
    exitCode,
    attempt,
  };

  history[resolved][prdFile].records.push(record);

  // Trim to max records (keep most recent)
  const records = history[resolved][prdFile].records;
  if (records.length > MAX_HISTORY_RECORDS_PER_PRD) {
    history[resolved][prdFile].records = records.slice(
      records.length - MAX_HISTORY_RECORDS_PER_PRD
    );
  }

  saveHistory(history);
}

/**
 * Get the most recent execution record for a PRD.
 * Returns null if no history exists.
 */
export function getLastExecution(
  projectDir: string,
  prdFile: string
): IExecutionRecord | null {
  const resolved = path.resolve(projectDir);
  const history = loadHistory();
  const prdHistory = history[resolved]?.[prdFile];
  if (!prdHistory || prdHistory.records.length === 0) {
    return null;
  }
  return prdHistory.records[prdHistory.records.length - 1];
}

/**
 * Check if a PRD is in cooldown after a recent non-success execution.
 * Returns true if the PRD should be skipped.
 */
export function isInCooldown(
  projectDir: string,
  prdFile: string,
  cooldownPeriod: number
): boolean {
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
