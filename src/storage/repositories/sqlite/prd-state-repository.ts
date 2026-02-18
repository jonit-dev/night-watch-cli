/**
 * SQLite implementation of IPrdStateRepository.
 * Persists PRD state entries in the `prd_states` table.
 */

import Database from "better-sqlite3";

import { IPrdStateEntry } from "../../../utils/prd-states.js";
import { IPrdStateRepository } from "../interfaces.js";

interface IPrdStateRow {
  project_path: string;
  prd_name: string;
  status: string;
  branch: string;
  timestamp: number;
}

export class SqlitePrdStateRepository implements IPrdStateRepository {
  private readonly _db: Database.Database;

  constructor(db: Database.Database) {
    this._db = db;
  }

  get(projectPath: string, prdName: string): IPrdStateEntry | null {
    const row = this._db
      .prepare<[string, string], IPrdStateRow>(
        `SELECT status, branch, timestamp
         FROM prd_states
         WHERE project_path = ? AND prd_name = ?`
      )
      .get(projectPath, prdName);

    if (!row) {
      return null;
    }

    return {
      status: row.status as IPrdStateEntry["status"],
      branch: row.branch,
      timestamp: row.timestamp,
    };
  }

  getAll(projectPath: string): Record<string, IPrdStateEntry> {
    const rows = this._db
      .prepare<[string], IPrdStateRow>(
        `SELECT prd_name, status, branch, timestamp
         FROM prd_states
         WHERE project_path = ?`
      )
      .all(projectPath);

    const result: Record<string, IPrdStateEntry> = {};
    for (const row of rows) {
      result[row.prd_name] = {
        status: row.status as IPrdStateEntry["status"],
        branch: row.branch,
        timestamp: row.timestamp,
      };
    }
    return result;
  }

  readAll(): Record<string, Record<string, IPrdStateEntry>> {
    const rows = this._db
      .prepare<[], IPrdStateRow>(
        "SELECT project_path, prd_name, status, branch, timestamp FROM prd_states"
      )
      .all();

    const result: Record<string, Record<string, IPrdStateEntry>> = {};
    for (const row of rows) {
      if (!result[row.project_path]) {
        result[row.project_path] = {};
      }
      result[row.project_path][row.prd_name] = {
        status: row.status as IPrdStateEntry["status"],
        branch: row.branch,
        timestamp: row.timestamp,
      };
    }
    return result;
  }

  set(projectPath: string, prdName: string, entry: IPrdStateEntry): void {
    this._db
      .prepare<[string, string, string, string, number]>(
        `INSERT INTO prd_states (project_path, prd_name, status, branch, timestamp)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(project_path, prd_name)
         DO UPDATE SET status = excluded.status,
                       branch = excluded.branch,
                       timestamp = excluded.timestamp`
      )
      .run(projectPath, prdName, entry.status, entry.branch, entry.timestamp);
  }

  delete(projectPath: string, prdName: string): void {
    this._db
      .prepare<[string, string]>(
        `DELETE FROM prd_states WHERE project_path = ? AND prd_name = ?`
      )
      .run(projectPath, prdName);
  }
}
