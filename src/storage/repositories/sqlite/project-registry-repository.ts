/**
 * SQLite implementation of IProjectRegistryRepository.
 * Persists project registry entries in the `projects` table.
 */

import Database from "better-sqlite3";

import { IRegistryEntry } from "../../../utils/registry.js";
import { IProjectRegistryRepository } from "../interfaces.js";

interface IProjectRow {
  name: string;
  path: string;
  created_at: number;
}

export class SqliteProjectRegistryRepository
  implements IProjectRegistryRepository
{
  private readonly _db: Database.Database;

  constructor(db: Database.Database) {
    this._db = db;
  }

  getAll(): IRegistryEntry[] {
    const rows = this._db
      .prepare<[], IProjectRow>("SELECT name, path FROM projects ORDER BY name")
      .all();

    return rows.map((row) => ({ name: row.name, path: row.path }));
  }

  upsert(entry: IRegistryEntry): void {
    const createdAt = Math.floor(Date.now() / 1000);

    this._db
      .prepare<[string, string, number]>(
        `INSERT INTO projects (name, path, created_at)
         VALUES (?, ?, ?)
         ON CONFLICT(path) DO UPDATE SET name = excluded.name`
      )
      .run(entry.name, entry.path, createdAt);
  }

  remove(projectPath: string): boolean {
    const result = this._db
      .prepare<[string]>("DELETE FROM projects WHERE path = ?")
      .run(projectPath);

    return result.changes > 0;
  }

  clear(): void {
    this._db.prepare("DELETE FROM projects").run();
  }
}
