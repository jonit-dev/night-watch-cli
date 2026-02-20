/**
 * SQLite implementation of IExecutionHistoryRepository.
 * Persists execution records in the `execution_history` table.
 */

import 'reflect-metadata';

import Database from "better-sqlite3";
import { inject, injectable } from "tsyringe";

import { IExecutionRecord } from "@/utils/execution-history.js";
import { IExecutionHistoryRepository } from "../interfaces.js";

interface IExecutionHistoryRow {
  project_path: string;
  prd_file: string;
  timestamp: number;
  outcome: string;
  exit_code: number;
  attempt: number;
}

@injectable()
export class SqliteExecutionHistoryRepository
  implements IExecutionHistoryRepository
{
  private readonly _db: Database.Database;

  constructor(@inject('Database') db: Database.Database) {
    this._db = db;
  }

  getRecords(projectPath: string, prdFile: string): IExecutionRecord[] {
    const rows = this._db
      .prepare<[string, string], Pick<IExecutionHistoryRow, "timestamp" | "outcome" | "exit_code" | "attempt">>(
        `SELECT timestamp, outcome, exit_code, attempt
         FROM execution_history
         WHERE project_path = ? AND prd_file = ?
         ORDER BY timestamp DESC, id DESC`
      )
      .all(projectPath, prdFile);

    return rows.map((row) => ({
      timestamp: row.timestamp,
      outcome: row.outcome as IExecutionRecord["outcome"],
      exitCode: row.exit_code,
      attempt: row.attempt,
    }));
  }

  addRecord(
    projectPath: string,
    prdFile: string,
    record: IExecutionRecord
  ): void {
    this._db
      .prepare<[string, string, number, string, number, number]>(
        `INSERT INTO execution_history
           (project_path, prd_file, timestamp, outcome, exit_code, attempt)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        projectPath,
        prdFile,
        record.timestamp,
        record.outcome,
        record.exitCode,
        record.attempt
      );
  }

  getAllHistory(): Record<string, Record<string, { records: IExecutionRecord[] }>> {
    const rows = this._db
      .prepare<[], IExecutionHistoryRow>(
        `SELECT project_path, prd_file, timestamp, outcome, exit_code, attempt
         FROM execution_history
         ORDER BY project_path, prd_file, timestamp ASC, id ASC`
      )
      .all();

    const history: Record<string, Record<string, { records: IExecutionRecord[] }>> = {};
    for (const row of rows) {
      if (!history[row.project_path]) {
        history[row.project_path] = {};
      }
      if (!history[row.project_path][row.prd_file]) {
        history[row.project_path][row.prd_file] = { records: [] };
      }
      history[row.project_path][row.prd_file].records.push({
        timestamp: row.timestamp,
        outcome: row.outcome as IExecutionRecord["outcome"],
        exitCode: row.exit_code,
        attempt: row.attempt,
      });
    }
    return history;
  }

  replaceAll(history: Record<string, Record<string, { records: IExecutionRecord[] }>>): void {
    const replaceAll = this._db.transaction(() => {
      this._db.prepare("DELETE FROM execution_history").run();
      const insert = this._db.prepare<[string, string, number, string, number, number]>(
        `INSERT INTO execution_history
           (project_path, prd_file, timestamp, outcome, exit_code, attempt)
         VALUES (?, ?, ?, ?, ?, ?)`
      );
      for (const [projectPath, prdMap] of Object.entries(history)) {
        for (const [prdFile, prdHistory] of Object.entries(prdMap)) {
          for (const record of prdHistory.records) {
            insert.run(projectPath, prdFile, record.timestamp, record.outcome, record.exitCode, record.attempt);
          }
        }
      }
    });
    replaceAll();
  }

  trimRecords(projectPath: string, prdFile: string, maxCount: number): void {
    // Count current records for this project/prd pair
    const countRow = this._db
      .prepare<[string, string], { count: number }>(
        `SELECT COUNT(*) as count
         FROM execution_history
         WHERE project_path = ? AND prd_file = ?`
      )
      .get(projectPath, prdFile);

    const total = countRow?.count ?? 0;
    if (total <= maxCount) {
      return;
    }

    const deleteCount = total - maxCount;

    // Delete the oldest records (lowest timestamp ids)
    this._db
      .prepare<[string, string, number]>(
        `DELETE FROM execution_history
         WHERE id IN (
           SELECT id FROM execution_history
           WHERE project_path = ? AND prd_file = ?
           ORDER BY timestamp ASC, id ASC
           LIMIT ?
         )`
      )
      .run(projectPath, prdFile, deleteCount);
  }
}
