/**
 * Tests for structured session outcome storage.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SqliteSessionOutcomeRepository } from '../../storage/repositories/sqlite/session-outcome.repository.js';
import { runMigrations } from '../../storage/sqlite/migrations.js';

describe('SqliteSessionOutcomeRepository', () => {
  let db: Database.Database;
  let repo: SqliteSessionOutcomeRepository;
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-session-outcomes-test-'));
    db = new Database(path.join(tempDir, 'test.db'));
    db.pragma('journal_mode = WAL');
    runMigrations(db);
    repo = new SqliteSessionOutcomeRepository(db);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('should record structured session outcome', () => {
    const outcome = repo.insertOutcome({
      projectPath: '/tmp/project',
      jobType: 'executor',
      providerKey: 'codex',
      prdFile: 'docs/prds/example.md',
      prNumber: 97,
      branchName: 'night-watch/nw-97',
      startedAt: 1_700_000_000,
      finishedAt: 1_700_000_090,
      durationSeconds: 90,
      outcome: 'failure',
      exitCode: 1,
      attempt: 2,
      retryCount: 1,
      failureCategory: 'tests',
      failureSignature: 'vitest failed in session-outcomes.test.ts',
      metadata: {
        command: 'yarn workspace @night-watch/core test',
        failures: ['expected true to be false'],
      },
    });

    expect(outcome.id).toBeGreaterThan(0);
    expect(outcome.projectPath).toBe('/tmp/project');
    expect(outcome.jobType).toBe('executor');
    expect(outcome.providerKey).toBe('codex');
    expect(outcome.prdFile).toBe('docs/prds/example.md');
    expect(outcome.prNumber).toBe(97);
    expect(outcome.durationSeconds).toBe(90);
    expect(outcome.outcome).toBe('failure');
    expect(outcome.attempt).toBe(2);
    expect(outcome.retryCount).toBe(1);
    expect(outcome.metadata).toEqual({
      command: 'yarn workspace @night-watch/core test',
      failures: ['expected true to be false'],
    });

    const queried = repo.queryOutcomes({ projectPath: '/tmp/project', jobType: 'executor' });
    expect(queried).toHaveLength(1);
    expect(queried[0]).toEqual(outcome);

    const summary = repo.querySummary({ projectPath: '/tmp/project' });
    expect(summary.totalCount).toBe(1);
    expect(summary.failureCount).toBe(1);
    expect(summary.byFailureCategory).toEqual({ tests: 1 });
    expect(summary.averageDurationSeconds).toBe(90);
  });

  it('should redact secrets in metadata', () => {
    const outcome = repo.insertOutcome({
      projectPath: '/tmp/project',
      jobType: 'reviewer',
      providerKey: 'claude',
      startedAt: 1_700_000_000,
      finishedAt: 1_700_000_030,
      outcome: 'failure',
      metadata: {
        apiKey: 'sk-1234567890abcdefghijklmnopqrstuvwxyz',
        nested: {
          authorization: 'Bearer secret-token-value-12345',
          log: 'request failed with token=ghp_abcdefghijklmnopqrstuvwxyz1234567890ABCD',
        },
        safe: 'keep this value',
      },
    });

    expect(outcome.metadata).toEqual({
      apiKey: '[REDACTED_SECRET]',
      nested: {
        authorization: '[REDACTED_SECRET]',
        log: 'request failed with token=[REDACTED_SECRET]',
      },
      safe: 'keep this value',
    });

    const raw = db
      .prepare('SELECT metadata_json FROM session_outcomes WHERE id = ?')
      .get(outcome.id) as { metadata_json: string };
    expect(raw.metadata_json).not.toContain('sk-1234567890abcdefghijklmnopqrstuvwxyz');
    expect(raw.metadata_json).not.toContain('secret-token-value-12345');
    expect(raw.metadata_json).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz1234567890ABCD');
  });
});
