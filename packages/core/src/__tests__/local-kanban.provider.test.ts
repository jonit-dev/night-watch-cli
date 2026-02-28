/**
 * Tests for LocalKanbanProvider — IBoardProvider backed by SQLite.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LocalKanbanProvider } from '../board/providers/local-kanban.js';
import { SqliteKanbanIssueRepository } from '../storage/repositories/sqlite/kanban-issue.repository.js';
import { runMigrations } from '../storage/sqlite/migrations.js';

describe('LocalKanbanProvider', () => {
  let db: Database.Database;
  let provider: LocalKanbanProvider;
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-local-kanban-test-'));
    const dbPath = path.join(tempDir, 'test.db');
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    runMigrations(db);
    const repo = new SqliteKanbanIssueRepository(db);
    provider = new LocalKanbanProvider(repo);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('should return empty board on first call', async () => {
    const issues = await provider.getAllIssues();
    expect(issues).toHaveLength(0);
  });

  it('should create and retrieve an issue', async () => {
    const created = await provider.createIssue({
      title: 'My first issue',
      body: 'Some description',
    });

    expect(created.title).toBe('My first issue');
    expect(created.body).toBe('Some description');
    expect(created.column).toBe('Draft');
    expect(created.url).toBe(`local://kanban/${created.number}`);

    const fetched = await provider.getIssue(created.number);
    expect(fetched).not.toBeNull();
    expect(fetched!.title).toBe('My first issue');
  });

  it('should move issue between columns', async () => {
    const created = await provider.createIssue({
      title: 'Move me',
      body: 'Will be moved to Ready',
    });

    await provider.moveIssue(created.number, 'Ready');

    const readyIssues = await provider.getIssuesByColumn('Ready');
    expect(readyIssues).toHaveLength(1);
    expect(readyIssues[0].number).toBe(created.number);
    expect(readyIssues[0].column).toBe('Ready');
  });

  it('should close issue and exclude from getAllIssues', async () => {
    const created = await provider.createIssue({
      title: 'Close me',
      body: 'Will be closed',
    });

    await provider.closeIssue(created.number);

    const allIssues = await provider.getAllIssues();
    expect(allIssues).toHaveLength(0);
  });

  it('should accept comment without error', async () => {
    const created = await provider.createIssue({
      title: 'Comment target',
      body: 'Has comments',
    });

    await expect(
      provider.commentOnIssue(created.number, 'A helpful comment'),
    ).resolves.toBeUndefined();
  });
});
