/**
 * SQLite implementation of IRoadmapStateRepository.
 * Persists roadmap state in the `roadmap_states` table, keyed by prd_dir.
 */

import Database from "better-sqlite3";

import { IRoadmapState } from "../../../utils/roadmap-state.js";
import { IRoadmapStateRepository } from "../interfaces.js";

interface IRoadmapStateRow {
  prd_dir: string;
  version: number;
  last_scan: string;
  items_json: string;
}

export class SqliteRoadmapStateRepository implements IRoadmapStateRepository {
  private readonly _db: Database.Database;

  constructor(db: Database.Database) {
    this._db = db;
  }

  load(prdDir: string): IRoadmapState | null {
    const row = this._db
      .prepare<[string], IRoadmapStateRow>(
        `SELECT version, last_scan, items_json
         FROM roadmap_states
         WHERE prd_dir = ?`
      )
      .get(prdDir);

    if (!row) {
      return null;
    }

    let items: IRoadmapState["items"] = {};
    try {
      const parsed: unknown = JSON.parse(row.items_json);
      if (typeof parsed === "object" && parsed !== null) {
        items = parsed as IRoadmapState["items"];
      }
    } catch {
      items = {};
    }

    return {
      version: row.version,
      lastScan: row.last_scan,
      items,
    };
  }

  save(prdDir: string, state: IRoadmapState): void {
    const itemsJson = JSON.stringify(state.items);

    this._db
      .prepare<[string, number, string, string]>(
        `INSERT INTO roadmap_states (prd_dir, version, last_scan, items_json)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(prd_dir)
         DO UPDATE SET version    = excluded.version,
                       last_scan  = excluded.last_scan,
                       items_json = excluded.items_json`
      )
      .run(prdDir, state.version, state.lastScan, itemsJson);
  }
}
