/**
 * SQLite database client for Night Watch CLI
 * Opens (or creates) the database at ${NIGHT_WATCH_HOME}/state.db
 * Applies WAL journal mode and busy_timeout pragmas on open.
 */
import Database from "better-sqlite3";
/**
 * Get the path to the SQLite database file.
 * Mirrors the same pattern used by getRegistryPath() and getHistoryPath().
 */
export declare function getDbPath(): string;
/**
 * Return the singleton Database instance, creating it on first call.
 * The database directory is created if it does not exist.
 * Pragmas applied: journal_mode = WAL, busy_timeout = 5000.
 */
export declare function getDb(): Database.Database;
/**
 * Close the current singleton database connection and reset it.
 * Primarily useful in tests to allow re-opening against a different path.
 */
export declare function closeDb(): void;
/**
 * Create (or open) a Database instance at `<projectDir>/state.db`.
 * Applies WAL journal mode and busy_timeout pragmas.
 * Unlike `getDb()`, this does NOT manage a singleton — callers own the instance.
 */
export declare function createDbForDir(projectDir: string): Database.Database;
//# sourceMappingURL=client.d.ts.map