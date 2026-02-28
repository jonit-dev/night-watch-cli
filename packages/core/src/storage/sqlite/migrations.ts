/**
 * SQLite schema migrations for Night Watch CLI.
 * Creates all required tables if they do not already exist (idempotent).
 */

import Database from 'better-sqlite3';

/** Current schema version */
const SCHEMA_VERSION = '1';

/**
 * Run all migrations against the provided database instance.
 * Safe to call multiple times — all DDL statements use IF NOT EXISTS.
 */
export function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id         INTEGER PRIMARY KEY,
      name       TEXT    NOT NULL,
      path       TEXT    NOT NULL UNIQUE,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS execution_history (
      id           INTEGER PRIMARY KEY,
      project_path TEXT    NOT NULL,
      prd_file     TEXT    NOT NULL,
      timestamp    INTEGER NOT NULL,
      outcome      TEXT    NOT NULL,
      exit_code    INTEGER NOT NULL,
      attempt      INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_history_lookup
      ON execution_history(project_path, prd_file, timestamp DESC);

    CREATE TABLE IF NOT EXISTS prd_states (
      project_path TEXT NOT NULL,
      prd_name     TEXT NOT NULL,
      status       TEXT NOT NULL,
      branch       TEXT NOT NULL,
      timestamp    INTEGER NOT NULL,
      PRIMARY KEY(project_path, prd_name)
    );

    CREATE TABLE IF NOT EXISTS roadmap_states (
      prd_dir    TEXT PRIMARY KEY,
      version    INTEGER NOT NULL,
      last_scan  TEXT    NOT NULL,
      items_json TEXT    NOT NULL
    );

    CREATE TABLE IF NOT EXISTS schema_meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agent_personas (
      id                    TEXT    PRIMARY KEY,
      name                  TEXT    NOT NULL,
      role                  TEXT    NOT NULL,
      avatar_url            TEXT,
      soul_json             TEXT    NOT NULL DEFAULT '{}',
      style_json            TEXT    NOT NULL DEFAULT '{}',
      skill_json            TEXT    NOT NULL DEFAULT '{}',
      model_config_json     TEXT,
      system_prompt_override TEXT,
      is_active             INTEGER NOT NULL DEFAULT 1,
      created_at            INTEGER NOT NULL,
      updated_at            INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS kanban_issues (
      number      INTEGER PRIMARY KEY AUTOINCREMENT,
      title       TEXT    NOT NULL,
      body        TEXT    NOT NULL DEFAULT '',
      column_name TEXT    NOT NULL DEFAULT 'Draft',
      labels_json TEXT    NOT NULL DEFAULT '[]',
      assignees_json TEXT NOT NULL DEFAULT '[]',
      is_closed   INTEGER NOT NULL DEFAULT 0,
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_kanban_column
      ON kanban_issues(column_name, is_closed);

    CREATE TABLE IF NOT EXISTS kanban_comments (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      issue_number INTEGER NOT NULL REFERENCES kanban_issues(number),
      body        TEXT    NOT NULL,
      created_at  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS campaign_schedules (
      id                   INTEGER PRIMARY KEY,
      campaign_id          TEXT    NOT NULL,
      ad_account_id        TEXT    NOT NULL,
      campaign_name        TEXT    NOT NULL,
      start_date           INTEGER NOT NULL,
      end_date             INTEGER NOT NULL,
      budget_schedule_json TEXT,
      status               TEXT    NOT NULL,
      created_at           INTEGER NOT NULL,
      updated_at           INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_campaign_schedules_campaign_id
      ON campaign_schedules(campaign_id);
    CREATE INDEX IF NOT EXISTS idx_campaign_schedules_date_range
      ON campaign_schedules(start_date, end_date);

  `);

  // Phase 2 cleanup: drop slack_discussions table (multi-agent deliberation removed)
  db.exec(`DROP TABLE IF EXISTS slack_discussions`);

  // Phase 2 cleanup: drop slack_channel_id column from projects (no longer needed)
  // SQLite does not support DROP COLUMN before version 3.35.0; use a safe recreate approach.
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS projects_new (
        id         INTEGER PRIMARY KEY,
        name       TEXT    NOT NULL,
        path       TEXT    NOT NULL UNIQUE,
        created_at INTEGER NOT NULL
      );
      INSERT OR IGNORE INTO projects_new (id, name, path, created_at)
        SELECT id, name, path, created_at FROM projects;
      DROP TABLE projects;
      ALTER TABLE projects_new RENAME TO projects;
    `);
  } catch {
    // Projects table already in clean shape — no-op
  }

  // Upsert the current schema version into schema_meta
  db.prepare(
    `INSERT INTO schema_meta (key, value) VALUES ('schema_version', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(SCHEMA_VERSION);
}
