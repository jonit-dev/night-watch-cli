/**
 * Tests for the global job queue utilities
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Database from 'better-sqlite3';

import { runMigrations } from '../../storage/sqlite/migrations.js';
import {
  clearQueue,
  dispatchNextJob,
  enqueueJob,
  expireStaleJobs,
  getNextPendingJob,
  getQueueEntry,
  getQueueStatus,
  getRunningJob,
  markJobRunning,
  removeJob,
} from '../../utils/job-queue.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-queue-test-'));
  // job-queue.ts reads NIGHT_WATCH_HOME to locate state.db
  process.env.NIGHT_WATCH_HOME = tmpDir;

  // Bootstrap the schema in the temp db
  const db = new Database(path.join(tmpDir, 'state.db'));
  runMigrations(db);
  db.close();
});

afterEach(() => {
  delete process.env.NIGHT_WATCH_HOME;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('enqueueJob', () => {
  it('inserts a pending job and returns its id', () => {
    const id = enqueueJob('/projects/foo', 'foo', 'executor', {});
    expect(id).toBeGreaterThan(0);

    const entry = getQueueEntry(id);
    expect(entry).not.toBeNull();
    expect(entry?.status).toBe('pending');
    expect(entry?.jobType).toBe('executor');
    expect(entry?.projectName).toBe('foo');
  });

  it('stores env vars as JSON', () => {
    const id = enqueueJob('/projects/bar', 'bar', 'reviewer', { FOO: 'bar', BAZ: '1' });
    const entry = getQueueEntry(id);
    expect(entry?.envJson).toEqual({ FOO: 'bar', BAZ: '1' });
  });
});

describe('getNextPendingJob', () => {
  it('returns null when queue is empty', () => {
    expect(getNextPendingJob()).toBeNull();
  });

  it('returns the highest-priority pending job', () => {
    enqueueJob(
      '/p/a',
      'a',
      'executor',
      {},
      {
        maxConcurrency: 1,
        maxWaitTime: 3600,
        priority: { executor: 5, reviewer: 10, qa: 1, audit: 1, slicer: 1 },
      },
    );
    enqueueJob(
      '/p/b',
      'b',
      'reviewer',
      {},
      {
        maxConcurrency: 1,
        maxWaitTime: 3600,
        priority: { executor: 5, reviewer: 10, qa: 1, audit: 1, slicer: 1 },
      },
    );

    const next = getNextPendingJob();
    expect(next?.projectName).toBe('b'); // reviewer has higher priority (10)
  });
});

describe('dispatchNextJob', () => {
  it('returns null when no pending jobs exist', () => {
    expect(dispatchNextJob()).toBeNull();
  });

  it('moves a pending job to dispatched status', () => {
    const id = enqueueJob('/projects/foo', 'foo', 'executor', {});
    const entry = dispatchNextJob();

    expect(entry).not.toBeNull();
    expect(entry?.id).toBe(id);
    expect(entry?.status).toBe('dispatched');

    const stored = getQueueEntry(id);
    expect(stored?.status).toBe('dispatched');
    expect(stored?.dispatchedAt).not.toBeNull();
  });

  it('respects maxConcurrency — blocks dispatch when at limit', () => {
    enqueueJob('/projects/a', 'a', 'executor', {});
    enqueueJob('/projects/b', 'b', 'executor', {});

    // Dispatch first job
    const first = dispatchNextJob({
      maxConcurrency: 1,
      maxWaitTime: 3600,
      priority: { executor: 1, reviewer: 1, qa: 1, audit: 1, slicer: 1 },
    });
    expect(first).not.toBeNull();

    // Mark it running to trigger concurrency check
    markJobRunning(first!.id);

    // Second dispatch should be blocked
    const second = dispatchNextJob({
      maxConcurrency: 1,
      maxWaitTime: 3600,
      priority: { executor: 1, reviewer: 1, qa: 1, audit: 1, slicer: 1 },
    });
    expect(second).toBeNull();
  });

  it('counts dispatched jobs in concurrency check', () => {
    enqueueJob('/projects/a', 'a', 'executor', {});
    enqueueJob('/projects/b', 'b', 'executor', {});

    // Dispatch first job (leaves it as dispatched, not running)
    dispatchNextJob({
      maxConcurrency: 1,
      maxWaitTime: 3600,
      priority: { executor: 1, reviewer: 1, qa: 1, audit: 1, slicer: 1 },
    });

    // Second dispatch should be blocked by dispatched count
    const second = dispatchNextJob({
      maxConcurrency: 1,
      maxWaitTime: 3600,
      priority: { executor: 1, reviewer: 1, qa: 1, audit: 1, slicer: 1 },
    });
    expect(second).toBeNull();
  });
});

describe('markJobRunning', () => {
  it('transitions a job to running status', () => {
    const id = enqueueJob('/projects/foo', 'foo', 'executor', {});
    dispatchNextJob();
    markJobRunning(id);

    expect(getQueueEntry(id)?.status).toBe('running');
  });

  it('causes getRunningJob to return the job', () => {
    const id = enqueueJob('/projects/foo', 'foo', 'executor', {});
    dispatchNextJob();
    markJobRunning(id);

    const running = getRunningJob();
    expect(running?.id).toBe(id);
  });
});

describe('removeJob', () => {
  it('deletes the entry from the queue', () => {
    const id = enqueueJob('/projects/foo', 'foo', 'executor', {});
    removeJob(id);
    expect(getQueueEntry(id)).toBeNull();
  });
});

describe('clearQueue', () => {
  it('removes all pending jobs', () => {
    enqueueJob('/p/a', 'a', 'executor', {});
    enqueueJob('/p/b', 'b', 'reviewer', {});
    const count = clearQueue();
    expect(count).toBe(2);
    expect(getNextPendingJob()).toBeNull();
  });

  it('filters by job type when specified', () => {
    enqueueJob('/p/a', 'a', 'executor', {});
    enqueueJob('/p/b', 'b', 'reviewer', {});
    const count = clearQueue('executor');
    expect(count).toBe(1);
    expect(getNextPendingJob()?.jobType).toBe('reviewer');
  });

  it('does not remove dispatched or running jobs', () => {
    const id = enqueueJob('/p/a', 'a', 'executor', {});
    dispatchNextJob();
    markJobRunning(id);

    const count = clearQueue();
    expect(count).toBe(0);
    expect(getQueueEntry(id)?.status).toBe('running');
  });
});

describe('expireStaleJobs', () => {
  it('expires pending jobs older than maxWaitTime', () => {
    const db = new Database(path.join(tmpDir, 'state.db'));
    const pastTs = Math.floor(Date.now() / 1000) - 7201;
    db.prepare(
      `INSERT INTO job_queue (project_path, project_name, job_type, priority, status, env_json, enqueued_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run('/p/old', 'old', 'executor', 0, 'pending', '{}', pastTs);
    db.close();

    const expired = expireStaleJobs(7200);
    expect(expired).toBe(1);
  });

  it('expires stale dispatched jobs based on dispatched_at', () => {
    const db = new Database(path.join(tmpDir, 'state.db'));
    const pastTs = Math.floor(Date.now() / 1000) - 7201;
    db.prepare(
      `INSERT INTO job_queue (project_path, project_name, job_type, priority, status, env_json, enqueued_at, dispatched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('/p/dispatched', 'dispatched', 'executor', 0, 'dispatched', '{}', pastTs, pastTs);
    db.close();

    const expired = expireStaleJobs(7200);
    expect(expired).toBe(1);
  });

  it('expires stale running jobs based on dispatched_at', () => {
    const db = new Database(path.join(tmpDir, 'state.db'));
    const pastTs = Math.floor(Date.now() / 1000) - 7201;
    db.prepare(
      `INSERT INTO job_queue (project_path, project_name, job_type, priority, status, env_json, enqueued_at, dispatched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('/p/running', 'running', 'executor', 0, 'running', '{}', pastTs, pastTs);
    db.close();

    const expired = expireStaleJobs(7200);
    expect(expired).toBe(1);
  });

  it('does not expire recent jobs', () => {
    enqueueJob('/p/fresh', 'fresh', 'executor', {});
    const expired = expireStaleJobs(7200);
    expect(expired).toBe(0);
  });
});

describe('getQueueStatus', () => {
  it('returns empty status when queue is empty', () => {
    const status = getQueueStatus();
    expect(status.running).toBeNull();
    expect(status.pending.total).toBe(0);
    expect(status.items).toHaveLength(0);
  });

  it('reflects enqueued and running jobs', () => {
    // executor has priority 50, reviewer has priority 40 — executor gets dispatched first
    const id1 = enqueueJob('/p/a', 'a', 'executor', {});
    enqueueJob('/p/b', 'b', 'reviewer', {});
    const dispatched = dispatchNextJob();
    expect(dispatched?.id).toBe(id1);
    markJobRunning(id1);

    const status = getQueueStatus();
    expect(status.running).not.toBeNull();
    expect(status.pending.total).toBe(1); // reviewer still pending
  });
});

// ---------------------------------------------------------------------------
// Phase 2: Provider-Aware Weighted Scheduler tests
// ---------------------------------------------------------------------------

const conservativeConfig = {
  enabled: true,
  mode: 'conservative' as const,
  maxConcurrency: 1,
  maxWaitTime: 3600,
  priority: { executor: 50, reviewer: 40, slicer: 30, qa: 20, audit: 10 },
  jobWeights: {},
  providerBuckets: {},
};

describe('provider-aware scheduler: conservative mode', () => {
  it('preserves serial dispatch semantics — blocks after first job', () => {
    enqueueJob('/p/a', 'a', 'executor', {}, conservativeConfig);
    enqueueJob('/p/b', 'b', 'executor', {}, conservativeConfig);

    const first = dispatchNextJob(conservativeConfig);
    expect(first).not.toBeNull();

    // Mark running to trigger concurrency check
    markJobRunning(first!.id);

    const second = dispatchNextJob(conservativeConfig);
    expect(second).toBeNull();
  });
});

describe('provider-aware scheduler: same-bucket heavy jobs do not dispatch in parallel', () => {
  it('blocks second executor for the same bucket when bucket maxConcurrency=1 is exhausted', () => {
    const config = {
      enabled: true,
      mode: 'provider-aware' as const,
      maxConcurrency: 2, // global allows 2, but bucket allows only 1
      maxWaitTime: 3600,
      priority: { executor: 50, reviewer: 40, slicer: 30, qa: 20, audit: 10 },
      jobWeights: {},
      providerBuckets: {
        'claude-native': { maxConcurrency: 1, aiCapacity: 6, runtimeCapacity: 6 },
      },
    };

    // Enqueue first executor for claude-native, dispatch and mark running
    const id1 = enqueueJob(
      '/p/a',
      'a',
      'executor',
      {},
      config,
      'claude-native',
      5,
      4,
    );
    const first = dispatchNextJob(config);
    expect(first?.id).toBe(id1);
    markJobRunning(first!.id);

    // Enqueue second executor for the same claude-native bucket
    enqueueJob('/p/b', 'b', 'executor', {}, config, 'claude-native', 5, 4);

    // Second dispatch must be blocked — bucket concurrency exhausted
    const second = dispatchNextJob(config);
    expect(second).toBeNull();
  });
});

describe('provider-aware scheduler: cross-bucket jobs can dispatch in parallel', () => {
  it('allows a codex job to start while a claude-native job is running', () => {
    const config = {
      enabled: true,
      mode: 'provider-aware' as const,
      maxConcurrency: 2,
      maxWaitTime: 3600,
      priority: { executor: 50, reviewer: 40, slicer: 30, qa: 20, audit: 10 },
      jobWeights: {},
      providerBuckets: {
        'claude-native': { maxConcurrency: 1, aiCapacity: 6, runtimeCapacity: 6 },
        codex: { maxConcurrency: 1, aiCapacity: 6, runtimeCapacity: 6 },
      },
    };

    // Enqueue and mark an executor for claude-native as running
    const id1 = enqueueJob('/p/a', 'a', 'executor', {}, config, 'claude-native', 5, 4);
    const first = dispatchNextJob(config);
    expect(first?.id).toBe(id1);
    markJobRunning(first!.id);

    // Enqueue a reviewer for codex — different bucket
    enqueueJob('/p/b', 'b', 'reviewer', {}, config, 'codex', 2, 2);

    // Second dispatch should succeed (cross-bucket, global concurrency=2 not exhausted)
    const second = dispatchNextJob(config);
    expect(second).not.toBeNull();
    expect(second?.providerKey).toBe('codex');
  });
});

describe('enqueueJob with provider metadata', () => {
  it('stores and returns providerKey, aiPressure, runtimePressure', () => {
    const id = enqueueJob('/p/a', 'a', 'executor', {}, undefined, 'claude-native', 5, 4);
    const entry = getQueueEntry(id);
    expect(entry?.providerKey).toBe('claude-native');
    expect(entry?.aiPressure).toBe(5);
    expect(entry?.runtimePressure).toBe(4);
  });

  it('stores null when no provider metadata is given', () => {
    const id = enqueueJob('/p/a', 'a', 'reviewer', {});
    const entry = getQueueEntry(id);
    expect(entry?.providerKey).toBeUndefined();
    expect(entry?.aiPressure).toBeUndefined();
    expect(entry?.runtimePressure).toBeUndefined();
  });
});
