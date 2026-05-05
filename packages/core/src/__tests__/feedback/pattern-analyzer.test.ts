/**
 * Tests for feedback pattern detection and activation.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { analyzeFeedbackOutcome } from '../../feedback/pattern-analyzer.js';
import { SqliteSessionOutcomeRepository } from '../../storage/repositories/sqlite/session-outcome.repository.js';
import { runMigrations } from '../../storage/sqlite/migrations.js';

describe('feedback pattern analyzer', () => {
  let db: Database.Database;
  let repo: SqliteSessionOutcomeRepository;
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-pattern-analyzer-test-'));
    db = new Database(path.join(tempDir, 'test.db'));
    db.pragma('journal_mode = WAL');
    runMigrations(db);
    repo = new SqliteSessionOutcomeRepository(db);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('should activate pattern after repeated failures', () => {
    const firstOutcome = repo.insertOutcome({
      failureCategory: 'test',
      failureSignature: 'test|packages/core/src|expected true to be false',
      finishedAt: 1_700_000_010,
      jobType: 'executor',
      metadata: {
        fileArea: 'packages/core/src',
        firstErrorLine: 'expected true to be false',
      },
      outcome: 'failure',
      projectPath: '/tmp/project',
      providerKey: 'codex',
      startedAt: 1_700_000_000,
    });

    const firstResult = analyzeFeedbackOutcome(repo, firstOutcome, {
      now: 1_700_000_010,
    });
    expect(firstResult.pattern?.status).toBe('observing');
    expect(repo.listActiveAugmentations('/tmp/project', 'executor', 1_700_000_010)).toHaveLength(0);

    const secondOutcome = repo.insertOutcome({
      failureCategory: 'test',
      failureSignature: 'test|packages/core/src|expected true to be false',
      finishedAt: 1_700_000_030,
      jobType: 'executor',
      metadata: {
        fileArea: 'packages/core/src',
        firstErrorLine: 'expected true to be false',
      },
      outcome: 'failure',
      projectPath: '/tmp/project',
      providerKey: 'codex',
      startedAt: 1_700_000_020,
    });

    const secondResult = analyzeFeedbackOutcome(repo, secondOutcome, {
      now: 1_700_000_030,
    });
    const activeAugmentations = repo.listActiveAugmentations(
      '/tmp/project',
      'executor',
      1_700_000_030,
    );

    expect(secondResult.pattern?.sampleCount).toBe(2);
    expect(secondResult.pattern?.status).toBe('active');
    expect(secondResult.pattern?.confidence).toBeGreaterThanOrEqual(0.75);
    expect(activeAugmentations).toHaveLength(1);
    expect(activeAugmentations[0].promptText).toContain('Provenance: pattern #');
    expect(activeAugmentations[0].promptText).toContain('samples=2');
  });
});
