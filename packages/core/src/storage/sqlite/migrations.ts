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

    CREATE TABLE IF NOT EXISTS job_queue (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      project_path     TEXT    NOT NULL,
      project_name     TEXT    NOT NULL,
      job_type         TEXT    NOT NULL,
      priority         INTEGER NOT NULL DEFAULT 0,
      status           TEXT    NOT NULL DEFAULT 'pending',
      env_json         TEXT    NOT NULL DEFAULT '{}',
      enqueued_at      INTEGER NOT NULL,
      dispatched_at    INTEGER,
      expired_at       INTEGER,
      provider_key     TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_queue_pending
      ON job_queue(status, priority DESC, enqueued_at ASC);

    CREATE TABLE IF NOT EXISTS job_runs (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      project_path      TEXT    NOT NULL,
      job_type          TEXT    NOT NULL,
      provider_key      TEXT    NOT NULL,
      queue_entry_id    INTEGER,
      status            TEXT    NOT NULL,
      queued_at         INTEGER,
      started_at        INTEGER NOT NULL,
      finished_at       INTEGER,
      wait_seconds      INTEGER,
      duration_seconds  INTEGER,
      throttled_count   INTEGER NOT NULL DEFAULT 0,
      metadata_json     TEXT    NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS idx_job_runs_lookup
      ON job_runs(project_path, started_at DESC, job_type, provider_key);

    CREATE TABLE IF NOT EXISTS session_outcomes (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      project_path       TEXT    NOT NULL,
      job_type           TEXT    NOT NULL,
      provider_key       TEXT    NOT NULL,
      prd_file           TEXT,
      pr_number          INTEGER,
      branch_name        TEXT,
      started_at         INTEGER NOT NULL,
      finished_at        INTEGER NOT NULL,
      duration_seconds   INTEGER,
      outcome            TEXT    NOT NULL,
      exit_code          INTEGER,
      attempt            INTEGER NOT NULL DEFAULT 1,
      retry_count        INTEGER NOT NULL DEFAULT 0,
      review_score       INTEGER,
      ci_status          TEXT,
      failure_category   TEXT,
      failure_signature  TEXT,
      metadata_json      TEXT    NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS idx_session_outcomes_lookup
      ON session_outcomes(project_path, finished_at DESC, job_type, outcome);

    CREATE TABLE IF NOT EXISTS feedback_patterns (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      project_path       TEXT    NOT NULL,
      pattern_key        TEXT    NOT NULL,
      job_type           TEXT    NOT NULL,
      category           TEXT    NOT NULL,
      title              TEXT    NOT NULL,
      description        TEXT    NOT NULL,
      sample_count       INTEGER NOT NULL DEFAULT 0,
      confidence         REAL    NOT NULL DEFAULT 0,
      first_seen_at      INTEGER NOT NULL,
      last_seen_at       INTEGER NOT NULL,
      status             TEXT    NOT NULL DEFAULT 'observing',
      metadata_json      TEXT    NOT NULL DEFAULT '{}',
      UNIQUE(project_path, pattern_key, job_type)
    );
    CREATE INDEX IF NOT EXISTS idx_feedback_patterns_lookup
      ON feedback_patterns(project_path, job_type, status, confidence DESC);

    CREATE TABLE IF NOT EXISTS prompt_augmentations (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      project_path       TEXT    NOT NULL,
      pattern_id         INTEGER REFERENCES feedback_patterns(id),
      job_type           TEXT    NOT NULL,
      prompt_text        TEXT    NOT NULL,
      status             TEXT    NOT NULL DEFAULT 'active',
      created_at         INTEGER NOT NULL,
      updated_at         INTEGER NOT NULL,
      expires_at         INTEGER,
      applied_count      INTEGER NOT NULL DEFAULT 0,
      success_count      INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_prompt_augmentations_active
      ON prompt_augmentations(project_path, job_type, status, expires_at);
  `);

  // Phase 2 cleanup: drop slack_discussions table (multi-agent deliberation removed)
  db.exec(`DROP TABLE IF EXISTS slack_discussions`);

  // Provider-aware scheduler: add provider_key column to job_queue if absent
  // (for databases created before this column was added to the CREATE TABLE statement).
  try {
    db.exec(`ALTER TABLE job_queue ADD COLUMN provider_key TEXT`);
  } catch {
    // Column already exists — safe to ignore
  }

  // Store PID in queue entries for direct stale-job detection (guards against
  // cases where lock files are cleaned up but the queue entry is still "running").
  try {
    db.exec(`ALTER TABLE job_queue ADD COLUMN pid INTEGER`);
  } catch {
    // Column already exists — safe to ignore
  }

  // Phase 2 cleanup: drop slack_channel_id column from projects (no longer needed)
  // Guarded by schema_meta so this destructive recreation runs exactly once.
  // Without the guard, every server restart would DROP TABLE projects, creating a
  // race window where concurrent queries get "no such table: projects".
  const projectsSchemaV2Done = db
    .prepare<
      [],
      { value: string }
    >("SELECT value FROM schema_meta WHERE key = 'projects_schema_v2'")
    .get();

  if (!projectsSchemaV2Done) {
    const columns = db.prepare<[], { name: string }>('PRAGMA table_info(projects)').all();

    if (columns.some((c) => c.name === 'slack_channel_id')) {
      // Only recreate if the old column is actually present
      db.transaction(() => {
        db.prepare(
          `
          CREATE TABLE projects_new (
            id         INTEGER PRIMARY KEY,
            name       TEXT    NOT NULL,
            path       TEXT    NOT NULL UNIQUE,
            created_at INTEGER NOT NULL
          )
        `,
        ).run();
        db.prepare(
          `INSERT OR IGNORE INTO projects_new (id, name, path, created_at)
           SELECT id, name, path, created_at FROM projects`,
        ).run();
        db.prepare('DROP TABLE projects').run();
        db.prepare('ALTER TABLE projects_new RENAME TO projects').run();
      })();
    }

    db.prepare(
      `INSERT INTO schema_meta (key, value) VALUES ('projects_schema_v2', '1')
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run();
  }

  // Upsert the current schema version into schema_meta
  db.prepare(
    `INSERT INTO schema_meta (key, value) VALUES ('schema_version', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(SCHEMA_VERSION);
}
