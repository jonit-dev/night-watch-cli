/**
 * Tests for SQLite schema migrations
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Database from 'better-sqlite3';

import { runMigrations } from '../../../storage/sqlite/migrations.js';

const EXPECTED_TABLES = [
  'agent_personas',
  'execution_history',
  'job_queue',
  'job_runs',
  'kanban_comments',
  'kanban_issues',
  'prd_states',
  'projects',
  'roadmap_states',
  'schema_meta',
];

let tmpDir: string;
let db: Database.Database;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-migrations-test-'));
  // Use a temp-file database for isolation (avoids WAL issues in CI)
  db = new Database(path.join(tmpDir, 'test.db'));
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('runMigrations', () => {
  it('creates schema on empty db', () => {
    runMigrations(db);

    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
      .all() as Array<{ name: string }>;

    const tableNames = tables.map((t) => t.name).filter((n) => n !== 'sqlite_sequence');
    expect(tableNames).toEqual(expect.arrayContaining(EXPECTED_TABLES));
    expect(tableNames).toHaveLength(EXPECTED_TABLES.length);
  });

  it('stores schema_version in schema_meta after migration', () => {
    runMigrations(db);

    const row = db.prepare(`SELECT value FROM schema_meta WHERE key = 'schema_version'`).get() as
      | { value: string }
      | undefined;

    expect(row).toBeDefined();
    expect(row?.value).toBe('1');
  });

  it('migration is idempotent — running twice does not error or drop data', () => {
    runMigrations(db);

    // Insert a row into projects to confirm it survives a second migration run
    db.prepare(`INSERT INTO projects (name, path, created_at) VALUES (?, ?, ?)`).run(
      'test-project',
      '/tmp/test-project',
      Math.floor(Date.now() / 1000),
    );

    // Should not throw
    expect(() => runMigrations(db)).not.toThrow();

    // Data inserted before the second run must still be present
    const row = db.prepare(`SELECT name FROM projects WHERE path = '/tmp/test-project'`).get() as
      | { name: string }
      | undefined;

    expect(row).toBeDefined();
    expect(row?.name).toBe('test-project');
  });

  it('migration is idempotent — schema_version is still correct after second run', () => {
    runMigrations(db);
    runMigrations(db);

    const row = db.prepare(`SELECT value FROM schema_meta WHERE key = 'schema_version'`).get() as
      | { value: string }
      | undefined;

    expect(row?.value).toBe('1');
  });

  it('creates job_runs table with correct columns', () => {
    runMigrations(db);

    const columns = db
      .prepare(`PRAGMA table_info(job_runs)`)
      .all() as Array<{ name: string; type: string; notnull: number; dflt_value: string | null }>;

    const colNames = columns.map((c) => c.name);
    expect(colNames).toEqual(
      expect.arrayContaining([
        'id',
        'project_path',
        'job_type',
        'provider_key',
        'queue_entry_id',
        'status',
        'queued_at',
        'started_at',
        'finished_at',
        'wait_seconds',
        'duration_seconds',
        'throttled_count',
        'metadata_json',
      ]),
    );

    // Verify NOT NULL constraints
    const notNullCols = columns.filter((c) => c.notnull === 1).map((c) => c.name);
    expect(notNullCols).toEqual(
      expect.arrayContaining(['project_path', 'job_type', 'provider_key', 'status', 'started_at']),
    );
  });

  it('creates job_queue table without pressure columns', () => {
    runMigrations(db);

    const columns = db
      .prepare(`PRAGMA table_info(job_queue)`)
      .all() as Array<{ name: string }>;

    const colNames = columns.map((c) => c.name);

    // provider_key must be present
    expect(colNames).toContain('provider_key');

    // pressure columns must NOT be present
    expect(colNames).not.toContain('ai_pressure');
    expect(colNames).not.toContain('runtime_pressure');
  });

  it('idx_job_runs_lookup index is created', () => {
    runMigrations(db);

    const indexes = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='job_runs'`)
      .all() as Array<{ name: string }>;

    expect(indexes.map((i) => i.name)).toContain('idx_job_runs_lookup');
  });
});
