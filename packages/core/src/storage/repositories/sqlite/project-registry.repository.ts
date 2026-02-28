/**
 * SQLite implementation of IProjectRegistryRepository.
 * Persists project registry entries in the `projects` table.
 */

import Database from 'better-sqlite3';
import { inject, injectable } from 'tsyringe';

import { IRegistryEntry } from '@/utils/registry.js';
import { IProjectRegistryRepository } from '../interfaces.js';

interface IProjectRow {
  name: string;
  path: string;
  created_at: number;
}

@injectable()
export class SqliteProjectRegistryRepository implements IProjectRegistryRepository {
  private readonly db: Database.Database;

  constructor(@inject('Database') db: Database.Database) {
    this.db = db;
  }

  getAll(): IRegistryEntry[] {
    const rows = this.db
      .prepare<[], IProjectRow>('SELECT name, path FROM projects ORDER BY name')
      .all();

    return rows.map((row) => ({
      name: row.name,
      path: row.path,
    }));
  }

  upsert(entry: IRegistryEntry): void {
    const createdAt = Math.floor(Date.now() / 1000);

    this.db
      .prepare<[string, string, number]>(
        `INSERT INTO projects (name, path, created_at)
         VALUES (?, ?, ?)
         ON CONFLICT(path) DO UPDATE SET name = excluded.name`,
      )
      .run(entry.name, entry.path, createdAt);
  }

  remove(projectPath: string): boolean {
    const result = this.db
      .prepare<[string]>('DELETE FROM projects WHERE path = ?')
      .run(projectPath);

    return result.changes > 0;
  }

  clear(): void {
    this.db.prepare('DELETE FROM projects').run();
  }
}
