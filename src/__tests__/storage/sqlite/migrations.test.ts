/**
 * Tests for SQLite schema migrations
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import Database from "better-sqlite3";

import { runMigrations } from "../../../storage/sqlite/migrations.js";

const EXPECTED_TABLES = [
  "agent_personas",
  "execution_history",
  "prd_states",
  "projects",
  "roadmap_states",
  "schema_meta",
  "slack_discussions",
];

let tmpDir: string;
let db: Database.Database;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nw-migrations-test-"));
  // Use a temp-file database for isolation (avoids WAL issues in CI)
  db = new Database(path.join(tmpDir, "test.db"));
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("runMigrations", () => {
  it("creates schema on empty db", () => {
    runMigrations(db);

    const tables = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`
      )
      .all() as Array<{ name: string }>;

    const tableNames = tables.map((t) => t.name);
    expect(tableNames).toEqual(expect.arrayContaining(EXPECTED_TABLES));
    expect(tableNames).toHaveLength(EXPECTED_TABLES.length);
  });

  it("stores schema_version in schema_meta after migration", () => {
    runMigrations(db);

    const row = db
      .prepare(`SELECT value FROM schema_meta WHERE key = 'schema_version'`)
      .get() as { value: string } | undefined;

    expect(row).toBeDefined();
    expect(row?.value).toBe("1");
  });

  it("migration is idempotent — running twice does not error or drop data", () => {
    runMigrations(db);

    // Insert a row into projects to confirm it survives a second migration run
    db.prepare(
      `INSERT INTO projects (name, path, created_at) VALUES (?, ?, ?)`
    ).run("test-project", "/tmp/test-project", Math.floor(Date.now() / 1000));

    // Should not throw
    expect(() => runMigrations(db)).not.toThrow();

    // Data inserted before the second run must still be present
    const row = db
      .prepare(`SELECT name FROM projects WHERE path = '/tmp/test-project'`)
      .get() as { name: string } | undefined;

    expect(row).toBeDefined();
    expect(row?.name).toBe("test-project");
  });

  it("migration is idempotent — schema_version is still correct after second run", () => {
    runMigrations(db);
    runMigrations(db);

    const row = db
      .prepare(`SELECT value FROM schema_meta WHERE key = 'schema_version'`)
      .get() as { value: string } | undefined;

    expect(row?.value).toBe("1");
  });
});
