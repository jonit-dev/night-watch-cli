/**
 * SQLite schema migrations for Night Watch CLI.
 * Creates all required tables if they do not already exist (idempotent).
 */
/** Current schema version */
const SCHEMA_VERSION = "1";
/**
 * Run all migrations against the provided database instance.
 * Safe to call multiple times — all DDL statements use IF NOT EXISTS.
 */
export function runMigrations(db) {
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

    CREATE TABLE IF NOT EXISTS slack_discussions (
      id                TEXT    PRIMARY KEY,
      project_path      TEXT    NOT NULL,
      trigger_type      TEXT    NOT NULL,
      trigger_ref       TEXT    NOT NULL,
      channel_id        TEXT    NOT NULL,
      thread_ts         TEXT    NOT NULL,
      status            TEXT    NOT NULL DEFAULT 'active',
      round             INTEGER NOT NULL DEFAULT 1,
      participants_json TEXT    NOT NULL DEFAULT '[]',
      consensus_result  TEXT,
      created_at        INTEGER NOT NULL,
      updated_at        INTEGER NOT NULL
    );
  `);
    // Add slack_channel_id to projects table if it doesn't exist (migration for Phase 4)
    try {
        db.exec(`ALTER TABLE projects ADD COLUMN slack_channel_id TEXT`);
    }
    catch {
        // Column already exists — this is expected after first run
    }
    // Upsert the current schema version into schema_meta
    db.prepare(`INSERT INTO schema_meta (key, value) VALUES ('schema_version', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(SCHEMA_VERSION);
}
//# sourceMappingURL=migrations.js.map