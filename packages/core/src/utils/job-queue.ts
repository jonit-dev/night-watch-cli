/**
 * Global Job Queue utilities for Night Watch CLI.
 * Manages cross-project job queueing to prevent API rate limiting.
 */

import * as os from 'os';
import * as path from 'path';
import Database from 'better-sqlite3';
import {
  DEFAULT_QUEUE_MAX_WAIT_TIME,
  DEFAULT_QUEUE_PRIORITY,
  GLOBAL_CONFIG_DIR,
  QUEUE_LOCK_FILE_NAME,
  STATE_DB_FILE_NAME,
} from '../constants.js';
import type { IQueueConfig, IQueueEntry, IQueueStatus, JobType, QueueEntryStatus } from '../types.js';

/**
 * Get the path to the state database
 */
function getStateDbPath(): string {
  return path.join(os.homedir(), GLOBAL_CONFIG_DIR, STATE_DB_FILE_NAME);
}

/**
 * Get the path to the queue lock file
 */
export function getQueueLockPath(): string {
  return path.join(os.homedir(), GLOBAL_CONFIG_DIR, QUEUE_LOCK_FILE_NAME);
}

/**
 * Open the state database
 */
function openDb(): Database.Database {
  const dbPath = getStateDbPath();
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  return db;
}

/**
 * Convert a database row to IQueueEntry
 */
function rowToEntry(row: Record<string, unknown>): IQueueEntry {
  return {
    id: row.id as number,
    projectPath: row.project_path as string,
    projectName: row.project_name as string,
    jobType: row.job_type as JobType,
    priority: row.priority as number,
    status: row.status as QueueEntryStatus,
    envJson: JSON.parse((row.env_json as string) || '{}'),
    enqueuedAt: row.enqueued_at as number,
    dispatchedAt: row.dispatched_at as number | null,
    expiredAt: row.expired_at as number | null,
  };
}

/**
 * Get the priority for a job type based on config
 */
export function getJobPriority(jobType: JobType, config?: IQueueConfig): number {
  const priorityMap = config?.priority ?? DEFAULT_QUEUE_PRIORITY;
  return priorityMap[jobType] ?? 0;
}

/**
 * Enqueue a job to the global queue
 * @returns The inserted queue entry ID
 */
export function enqueueJob(
  projectPath: string,
  projectName: string,
  jobType: JobType,
  envVars: Record<string, string>,
  config?: IQueueConfig,
): number {
  const db = openDb();
  try {
    const priority = getJobPriority(jobType, config);
    const now = Math.floor(Date.now() / 1000);
    const envJson = JSON.stringify(envVars);

    const result = db
      .prepare(
        `INSERT INTO job_queue (project_path, project_name, job_type, priority, status, env_json, enqueued_at)
         VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
      )
      .run(projectPath, projectName, jobType, priority, envJson, now);

    return result.lastInsertRowid as number;
  } finally {
    db.close();
  }
}

/**
 * Get the currently running job (status = 'running')
 */
export function getRunningJob(): IQueueEntry | null {
  const db = openDb();
  try {
    const row = db.prepare(`SELECT * FROM job_queue WHERE status = 'running' LIMIT 1`).get() as
      | Record<string, unknown>
      | undefined;
    return row ? rowToEntry(row) : null;
  } finally {
    db.close();
  }
}

/**
 * Mark a job as running (used when acquiring the global gate)
 */
export function markJobRunning(queueId: number): void {
  const db = openDb();
  try {
    db.prepare(`UPDATE job_queue SET status = 'running' WHERE id = ?`).run(queueId);
  } finally {
    db.close();
  }
}

/**
 * Remove a completed job from the queue
 */
export function removeJob(queueId: number): void {
  const db = openDb();
  try {
    db.prepare(`DELETE FROM job_queue WHERE id = ?`).run(queueId);
  } finally {
    db.close();
  }
}

/**
 * Get the next pending job by priority (highest first), then FIFO
 */
export function getNextPendingJob(): IQueueEntry | null {
  const db = openDb();
  try {
    const row = db
      .prepare(
        `SELECT * FROM job_queue
         WHERE status = 'pending'
         ORDER BY priority DESC, enqueued_at ASC
         LIMIT 1`,
      )
      .get() as Record<string, unknown> | undefined;
    return row ? rowToEntry(row) : null;
  } finally {
    db.close();
  }
}

/**
 * Mark a job as dispatched and return it
 */
export function dispatchNextJob(config?: IQueueConfig): IQueueEntry | null {
  // First, expire stale jobs
  expireStaleJobs(config?.maxWaitTime ?? DEFAULT_QUEUE_MAX_WAIT_TIME);

  const db = openDb();
  try {
    // Check if we're at max concurrency
    const running = db.prepare(`SELECT COUNT(*) as count FROM job_queue WHERE status = 'running'`).get() as
      | { count: number }
      | undefined;
    const runningCount = running?.count ?? 0;
    const maxConcurrency = config?.maxConcurrency ?? 1;

    if (runningCount >= maxConcurrency) {
      return null;
    }

    // Get next pending job
    const row = db
      .prepare(
        `SELECT * FROM job_queue
         WHERE status = 'pending'
         ORDER BY priority DESC, enqueued_at ASC
         LIMIT 1`,
      )
      .get() as Record<string, unknown> | undefined;

    if (!row) {
      return null;
    }

    const entry = rowToEntry(row);
    const now = Math.floor(Date.now() / 1000);

    // Mark as dispatched
    db.prepare(`UPDATE job_queue SET status = 'dispatched', dispatched_at = ? WHERE id = ?`).run(now, entry.id);

    return { ...entry, status: 'dispatched', dispatchedAt: now };
  } finally {
    db.close();
  }
}

/**
 * Get the full queue status
 */
export function getQueueStatus(): IQueueStatus {
  const db = openDb();
  try {
    // Get running job
    const runningRow = db.prepare(`SELECT * FROM job_queue WHERE status = 'running' LIMIT 1`).get() as
      | Record<string, unknown>
      | undefined;
    const running = runningRow ? rowToEntry(runningRow) : null;

    // Get pending counts
    const pendingRows = db
      .prepare(`SELECT job_type, COUNT(*) as count FROM job_queue WHERE status = 'pending' GROUP BY job_type`)
      .all() as Array<{ job_type: string; count: number }>;

    const byType: Record<string, number> = {};
    let total = 0;
    for (const row of pendingRows) {
      byType[row.job_type] = row.count;
      total += row.count;
    }

    // Get all items (pending + running, ordered by priority)
    const itemsRows = db
      .prepare(
        `SELECT * FROM job_queue
         WHERE status IN ('pending', 'running', 'dispatched')
         ORDER BY priority DESC, enqueued_at ASC`,
      )
      .all() as Array<Record<string, unknown>>;
    const items = itemsRows.map(rowToEntry);

    return {
      enabled: true, // Caller should check config
      running,
      pending: { total, byType },
      items,
    };
  } finally {
    db.close();
  }
}

/**
 * Clear pending jobs from the queue
 * @param filter Optional job type filter
 * @returns Number of cleared entries
 */
export function clearQueue(filter?: JobType): number {
  const db = openDb();
  try {
    let result;
    if (filter) {
      result = db.prepare(`DELETE FROM job_queue WHERE status = 'pending' AND job_type = ?`).run(filter);
    } else {
      result = db.prepare(`DELETE FROM job_queue WHERE status = 'pending'`).run();
    }
    return result.changes;
  } finally {
    db.close();
  }
}

/**
 * Expire stale jobs that have been waiting longer than maxWaitTime
 * @returns Number of expired entries
 */
export function expireStaleJobs(maxWaitTime: number): number {
  const db = openDb();
  try {
    const now = Math.floor(Date.now() / 1000);
    const cutoff = now - maxWaitTime;
    const result = db
      .prepare(
        `UPDATE job_queue
         SET status = 'expired', expired_at = ?
         WHERE status = 'pending' AND enqueued_at < ?`,
      )
      .run(now, cutoff);
    return result.changes;
  } finally {
    db.close();
  }
}

/**
 * Clean up expired jobs (delete them)
 * @returns Number of deleted entries
 */
export function cleanupExpiredJobs(): number {
  const db = openDb();
  try {
    const result = db.prepare(`DELETE FROM job_queue WHERE status = 'expired'`).run();
    return result.changes;
  } finally {
    db.close();
  }
}

/**
 * Get queue entry by ID
 */
export function getQueueEntry(id: number): IQueueEntry | null {
  const db = openDb();
  try {
    const row = db.prepare(`SELECT * FROM job_queue WHERE id = ?`).get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? rowToEntry(row) : null;
  } finally {
    db.close();
  }
}

/**
 * Update an existing queue entry's status
 */
export function updateJobStatus(id: number, status: QueueEntryStatus): void {
  const db = openDb();
  try {
    db.prepare(`UPDATE job_queue SET status = ? WHERE id = ?`).run(status, id);
  } finally {
    db.close();
  }
}
