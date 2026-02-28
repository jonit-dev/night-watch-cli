/**
 * Tests for SqliteKanbanIssueRepository — local kanban board data layer.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runMigrations } from '../storage/sqlite/migrations.js';
import { SqliteKanbanIssueRepository } from '../storage/repositories/sqlite/kanban-issue.repository.js';

describe('SqliteKanbanIssueRepository', () => {
  let db: Database.Database;
  let repo: SqliteKanbanIssueRepository;
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-kanban-test-'));
    const dbPath = path.join(tempDir, 'test.db');
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    runMigrations(db);
    repo = new SqliteKanbanIssueRepository(db);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('should create an issue with default Draft column', () => {
    const issue = repo.create({ title: 'Test issue' });

    expect(issue.columnName).toBe('Draft');
    expect(issue.title).toBe('Test issue');
    expect(issue.body).toBe('');
    expect(issue.labels).toEqual([]);
    expect(issue.assignees).toEqual([]);
    expect(issue.isClosed).toBe(false);
  });

  it('should retrieve issue by number', () => {
    const created = repo.create({ title: 'Find me' });
    const found = repo.getByNumber(created.number);

    expect(found).not.toBeNull();
    expect(found!.title).toBe('Find me');
  });

  it('should move issue to new column', () => {
    const issue = repo.create({ title: 'Move me' });
    repo.move(issue.number, 'Ready');

    const readyIssues = repo.getByColumn('Ready');
    expect(readyIssues).toHaveLength(1);
    expect(readyIssues[0].number).toBe(issue.number);
  });

  it('should soft-close an issue', () => {
    const issue = repo.create({ title: 'Close me' });
    repo.close(issue.number);

    const openIssues = repo.getAll();
    expect(openIssues.find((i) => i.number === issue.number)).toBeUndefined();

    const allIssues = repo.getAll(true);
    expect(allIssues.find((i) => i.number === issue.number)).toBeDefined();
  });

  it('should add a comment', () => {
    const issue = repo.create({ title: 'Comment target' });
    expect(() => repo.addComment(issue.number, 'Hello world')).not.toThrow();
  });

  it('should return issues grouped by column', () => {
    repo.create({ title: 'Draft issue 1' });
    repo.create({ title: 'Draft issue 2' });

    const draftIssues = repo.getByColumn('Draft');
    expect(draftIssues).toHaveLength(2);
  });
});
