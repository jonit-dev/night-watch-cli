/**
 * SQLite schema migrations for Night Watch CLI.
 * Creates all required tables if they do not already exist (idempotent).
 */
import Database from "better-sqlite3";
/**
 * Run all migrations against the provided database instance.
 * Safe to call multiple times — all DDL statements use IF NOT EXISTS.
 */
export declare function runMigrations(db: Database.Database): void;
//# sourceMappingURL=migrations.d.ts.map