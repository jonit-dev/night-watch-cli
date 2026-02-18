/**
 * SQLite database client for Night Watch CLI
 * Opens (or creates) the database at ${NIGHT_WATCH_HOME}/state.db
 * Applies WAL journal mode and busy_timeout pragmas on open.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import Database from "better-sqlite3";

import { GLOBAL_CONFIG_DIR, STATE_DB_FILE_NAME } from "../../constants.js";

let _db: Database.Database | null = null;

/**
 * Get the path to the SQLite database file.
 * Mirrors the same pattern used by getRegistryPath() and getHistoryPath().
 */
export function getDbPath(): string {
  const base =
    process.env.NIGHT_WATCH_HOME || path.join(os.homedir(), GLOBAL_CONFIG_DIR);
  return path.join(base, STATE_DB_FILE_NAME);
}

/**
 * Return the singleton Database instance, creating it on first call.
 * The database directory is created if it does not exist.
 * Pragmas applied: journal_mode = WAL, busy_timeout = 5000.
 */
export function getDb(): Database.Database {
  if (_db) {
    return _db;
  }

  const dbPath = getDbPath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);

  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");

  _db = db;
  return _db;
}

/**
 * Close the current singleton database connection and reset it.
 * Primarily useful in tests to allow re-opening against a different path.
 */
export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}
