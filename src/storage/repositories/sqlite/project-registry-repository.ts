/**
 * SQLite implementation of IProjectRegistryRepository.
 * Persists project registry entries in the `projects` table.
 */

import Database from "better-sqlite3";

import { IRegistryEntry } from "@/utils/registry.js";
import { IProjectRegistryRepository } from "../interfaces.js";

interface IProjectRow {
  name: string;
  path: string;
  created_at: number;
  slack_channel_id?: string | null;
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
      .prepare<[], IProjectRow>("SELECT name, path, slack_channel_id FROM projects ORDER BY name")
      .all();

    return rows.map((row) => ({
      name: row.name,
      path: row.path,
      ...(row.slack_channel_id ? { slackChannelId: row.slack_channel_id } : {}),
    }));
  }

  upsert(entry: IRegistryEntry): void {
    const createdAt = Math.floor(Date.now() / 1000);

    this._db
      .prepare<[string, string, number, string | null]>(
        `INSERT INTO projects (name, path, created_at, slack_channel_id)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(path) DO UPDATE SET name = excluded.name, slack_channel_id = COALESCE(excluded.slack_channel_id, slack_channel_id)`
      )
      .run(entry.name, entry.path, createdAt, entry.slackChannelId ?? null);
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

  updateSlackChannel(path: string, channelId: string): void {
    this._db
      .prepare<[string | null, string]>(
        `UPDATE projects SET slack_channel_id = ? WHERE path = ?`
      )
      .run(channelId || null, path);
  }
}
