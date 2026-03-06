/**
 * Global Job Queue utilities for Night Watch CLI.
 * Manages cross-project job queueing to prevent API rate limiting.
 */

import * as os from 'os';
import * as path from 'path';
import Database from 'better-sqlite3';
import { loadConfig } from '../config.js';
import {
  DEFAULT_QUEUE_MAX_WAIT_TIME,
  DEFAULT_QUEUE_PRIORITY,
  GLOBAL_CONFIG_DIR,
  QUEUE_LOCK_FILE_NAME,
  STATE_DB_FILE_NAME,
} from '../constants.js';
import type {
  IJobRunAnalytics,
  IJobRunRecord,
  IQueueConfig,
  IQueueEntry,
  IQueueStatus,
  JobType,
  QueueEntryStatus,
} from '../types.js';
import { createLogger } from './logger.js';
import { normalizeSchedulingPriority } from './scheduling.js';

const logger = createLogger('job-queue');

/**
 * Get the path to the state database (respects NIGHT_WATCH_HOME override for tests)
 */
function getStateDbPath(): string {
  const base = process.env.NIGHT_WATCH_HOME || path.join(os.homedir(), GLOBAL_CONFIG_DIR);
  return path.join(base, STATE_DB_FILE_NAME);
}

/**
 * Get the path to the queue lock file
 */
export function getQueueLockPath(): string {
  const base = process.env.NIGHT_WATCH_HOME || path.join(os.homedir(), GLOBAL_CONFIG_DIR);
  return path.join(base, QUEUE_LOCK_FILE_NAME);
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
    providerKey: (row.provider_key as string | null) ?? undefined,
    aiPressure: (row.ai_pressure as number | null) ?? undefined,
    runtimePressure: (row.runtime_pressure as number | null) ?? undefined,
  };
}

function getProjectSchedulingPriority(
  projectPath: string,
  cache: Map<string, number>,
): number {
  if (cache.has(projectPath)) {
    return cache.get(projectPath)!;
  }

  let priority = 3;
  try {
    priority = normalizeSchedulingPriority(loadConfig(projectPath).schedulingPriority);
  } catch {
    priority = 3;
  }

  cache.set(projectPath, priority);
  return priority;
}

function selectNextPendingEntry(db: Database.Database): IQueueEntry | null {
  const rows = db
    .prepare(
      `SELECT * FROM job_queue
       WHERE status = 'pending'
       ORDER BY priority DESC, enqueued_at ASC, id ASC`,
    )
    .all() as Array<Record<string, unknown>>;

  if (rows.length === 0) {
    return null;
  }

  const headByProject = new Map<string, IQueueEntry>();
  for (const row of rows) {
    const entry = rowToEntry(row);
    if (!headByProject.has(entry.projectPath)) {
      headByProject.set(entry.projectPath, entry);
    }
  }

  const priorityCache = new Map<string, number>();
  const candidates = Array.from(headByProject.values());
  candidates.sort((left, right) => {
    if (left.priority !== right.priority) {
      return right.priority - left.priority;
    }

    const leftProjectPriority = getProjectSchedulingPriority(left.projectPath, priorityCache);
    const rightProjectPriority = getProjectSchedulingPriority(right.projectPath, priorityCache);
    if (leftProjectPriority !== rightProjectPriority) {
      return rightProjectPriority - leftProjectPriority;
    }

    if (left.enqueuedAt !== right.enqueuedAt) {
      return left.enqueuedAt - right.enqueuedAt;
    }

    if (left.projectName !== right.projectName) {
      return left.projectName.localeCompare(right.projectName);
    }

    return left.id - right.id;
  });

  return candidates[0] ?? null;
}

/**
 * Get the priority for a job type based on config
 */
export function getJobPriority(jobType: JobType, config?: IQueueConfig): number {
  const priorityMap = config?.priority ?? DEFAULT_QUEUE_PRIORITY;
  return priorityMap[jobType] ?? 0;
}

/**
 * Enqueue a job to the global queue.
 *
 * @param projectPath - Absolute path to the project directory
 * @param projectName - Human-readable project name
 * @param jobType - Type of job (executor, reviewer, qa, audit, slicer)
 * @param envVars - Environment variables to pass to the job
 * @param config - Optional queue configuration (used for priority lookup)
 * @param providerKey - Optional provider bucket key (e.g. 'claude-native', 'codex')
 * @param aiPressure - Optional AI API pressure weight for this job
 * @param runtimePressure - Optional runtime/CPU pressure weight for this job
 * @returns The inserted queue entry ID
 */
export function enqueueJob(
  projectPath: string,
  projectName: string,
  jobType: JobType,
  envVars: Record<string, string>,
  config?: IQueueConfig,
  providerKey?: string,
  aiPressure?: number,
  runtimePressure?: number,
): number {
  const db = openDb();
  try {
    const priority = getJobPriority(jobType, config);
    const now = Math.floor(Date.now() / 1000);
    const envJson = JSON.stringify(envVars);

    const result = db
      .prepare(
        `INSERT INTO job_queue
           (project_path, project_name, job_type, priority, status, env_json, enqueued_at,
            provider_key, ai_pressure, runtime_pressure)
         VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`,
      )
      .run(
        projectPath,
        projectName,
        jobType,
        priority,
        envJson,
        now,
        providerKey ?? null,
        aiPressure ?? null,
        runtimePressure ?? null,
      );

    const id = result.lastInsertRowid as number;
    logger.info('Job enqueued', {
      id,
      jobType,
      project: projectName,
      priority,
      providerKey: providerKey ?? null,
      aiPressure: aiPressure ?? null,
      runtimePressure: runtimePressure ?? null,
    });
    return id;
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
    logger.debug('Job marked running', { id: queueId });
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
    logger.debug('Job removed from queue', { id: queueId });
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
    return selectNextPendingEntry(db);
  } finally {
    db.close();
  }
}

export function getInFlightCount(): number {
  const db = openDb();
  try {
    const running = db
      .prepare(`SELECT COUNT(*) as count FROM job_queue WHERE status IN ('running', 'dispatched')`)
      .get() as { count: number } | undefined;
    return running?.count ?? 0;
  } finally {
    db.close();
  }
}

export function canStartJob(config?: IQueueConfig): boolean {
  const maxConcurrency = config?.maxConcurrency ?? 1;
  return getInFlightCount() < maxConcurrency;
}

/**
 * Get in-flight pressure sums grouped by provider bucket key.
 * Used by the provider-aware scheduler to check per-bucket capacity.
 *
 * @param db - Open database connection (caller manages lifecycle)
 * @returns Map from providerKey → { count, totalAi, totalRuntime }
 */
function getInFlightPressureByBucket(
  db: Database.Database,
): Map<string, { count: number; totalAi: number; totalRuntime: number }> {
  const rows = db
    .prepare(
      `SELECT provider_key, COUNT(*) as count,
              COALESCE(SUM(ai_pressure), 0) as total_ai,
              COALESCE(SUM(runtime_pressure), 0) as total_runtime
       FROM job_queue
       WHERE status IN ('running', 'dispatched') AND provider_key IS NOT NULL
       GROUP BY provider_key`,
    )
    .all() as Array<{
    provider_key: string;
    count: number;
    total_ai: number;
    total_runtime: number;
  }>;

  const result = new Map<string, { count: number; totalAi: number; totalRuntime: number }>();
  for (const row of rows) {
    result.set(row.provider_key, {
      count: row.count,
      totalAi: row.total_ai,
      totalRuntime: row.total_runtime,
    });
  }
  return result;
}

/**
 * Get all pending candidates (one head entry per project), sorted by scheduling priority.
 * Used by the provider-aware dispatcher to iterate candidates and find the first that fits.
 *
 * @param db - Open database connection (caller manages lifecycle)
 */
function getAllPendingCandidates(db: Database.Database): IQueueEntry[] {
  const rows = db
    .prepare(
      `SELECT * FROM job_queue
       WHERE status = 'pending'
       ORDER BY priority DESC, enqueued_at ASC, id ASC`,
    )
    .all() as Array<Record<string, unknown>>;

  if (rows.length === 0) {
    return [];
  }

  // Take only the head (highest-priority pending) entry per project
  const headByProject = new Map<string, IQueueEntry>();
  for (const row of rows) {
    const entry = rowToEntry(row);
    if (!headByProject.has(entry.projectPath)) {
      headByProject.set(entry.projectPath, entry);
    }
  }

  // Sort candidates using the same multi-criteria order as selectNextPendingEntry
  const priorityCache = new Map<string, number>();
  const candidates = Array.from(headByProject.values());
  candidates.sort((left, right) => {
    if (left.priority !== right.priority) {
      return right.priority - left.priority;
    }

    const leftProjectPriority = getProjectSchedulingPriority(left.projectPath, priorityCache);
    const rightProjectPriority = getProjectSchedulingPriority(right.projectPath, priorityCache);
    if (leftProjectPriority !== rightProjectPriority) {
      return rightProjectPriority - leftProjectPriority;
    }

    if (left.enqueuedAt !== right.enqueuedAt) {
      return left.enqueuedAt - right.enqueuedAt;
    }

    if (left.projectName !== right.projectName) {
      return left.projectName.localeCompare(right.projectName);
    }

    return left.id - right.id;
  });

  return candidates;
}

/**
 * Check whether a candidate entry fits within the configured provider bucket capacity.
 *
 * When the entry's providerKey is not in providerBuckets, only the global maxConcurrency
 * check (already done by the caller) applies — this function returns true.
 *
 * @param candidate - The queue entry to test
 * @param config - Queue configuration (may be undefined)
 * @param pressureByBucket - Current in-flight pressure map from getInFlightPressureByBucket
 * @returns true if the candidate can be dispatched without exceeding bucket limits
 */
function fitsProviderCapacity(
  candidate: IQueueEntry,
  config: IQueueConfig | undefined,
  pressureByBucket: Map<string, { count: number; totalAi: number; totalRuntime: number }>,
): boolean {
  const bucketKey = candidate.providerKey;
  if (!bucketKey) {
    // No bucket assigned → no per-bucket check; only global limit applies (checked by caller)
    logger.debug('Capacity check skipped: no provider bucket assigned', { id: candidate.id });
    return true;
  }

  const bucketConfig = config?.providerBuckets?.[bucketKey];
  if (!bucketConfig) {
    // Bucket not configured → no per-bucket limit; only global limit applies
    logger.debug('Capacity check skipped: bucket not configured', { id: candidate.id, bucket: bucketKey });
    return true;
  }

  const inFlight = pressureByBucket.get(bucketKey) ?? { count: 0, totalAi: 0, totalRuntime: 0 };

  // Check bucket-level concurrency
  if (inFlight.count >= bucketConfig.maxConcurrency) {
    logger.debug('Capacity check failed: concurrency limit reached', {
      id: candidate.id,
      bucket: bucketKey,
      inFlightCount: inFlight.count,
      maxConcurrency: bucketConfig.maxConcurrency,
    });
    return false;
  }

  // Check AI capacity
  const aiPressure = candidate.aiPressure ?? 0;
  if (inFlight.totalAi + aiPressure > bucketConfig.aiCapacity) {
    logger.debug('Capacity check failed: AI capacity exceeded', {
      id: candidate.id,
      bucket: bucketKey,
      inFlightAi: inFlight.totalAi,
      candidateAi: aiPressure,
      aiCapacity: bucketConfig.aiCapacity,
    });
    return false;
  }

  // Check runtime capacity
  const runtimePressure = candidate.runtimePressure ?? 0;
  if (inFlight.totalRuntime + runtimePressure > bucketConfig.runtimeCapacity) {
    logger.debug('Capacity check failed: runtime capacity exceeded', {
      id: candidate.id,
      bucket: bucketKey,
      inFlightRuntime: inFlight.totalRuntime,
      candidateRuntime: runtimePressure,
      runtimeCapacity: bucketConfig.runtimeCapacity,
    });
    return false;
  }

  logger.debug('Capacity check passed', {
    id: candidate.id,
    bucket: bucketKey,
    inFlightCount: inFlight.count,
    inFlightAi: inFlight.totalAi,
    inFlightRuntime: inFlight.totalRuntime,
  });
  return true;
}

/**
 * Mark a job as dispatched and return it.
 *
 * In 'conservative' mode (default): takes the top-priority pending entry, subject to global
 * maxConcurrency.
 *
 * In 'provider-aware' mode: iterates all per-project head candidates (sorted by priority) and
 * dispatches the first one that satisfies both the global maxConcurrency limit and its
 * per-provider-bucket capacity constraints. This allows safe cross-provider parallelism.
 */
export function dispatchNextJob(config?: IQueueConfig): IQueueEntry | null {
  // First, expire stale jobs
  expireStaleJobs(config?.maxWaitTime ?? DEFAULT_QUEUE_MAX_WAIT_TIME);

  const db = openDb();
  try {
    const maxConcurrency = config?.maxConcurrency ?? 1;
    const mode = config?.mode ?? 'conservative';

    const running = db
      .prepare(`SELECT COUNT(*) as count FROM job_queue WHERE status IN ('running', 'dispatched')`)
      .get() as { count: number } | undefined;
    const runningCount = running?.count ?? 0;

    logger.debug('Dispatch attempt', { mode, runningCount, maxConcurrency });

    if (runningCount >= maxConcurrency) {
      logger.info('Dispatch skipped: global concurrency limit reached', { runningCount, maxConcurrency });
      return null;
    }

    const now = Math.floor(Date.now() / 1000);

    if (mode === 'conservative') {
      // Existing behaviour: dispatch the single top-priority pending entry
      const entry = selectNextPendingEntry(db);
      if (!entry) {
        logger.debug('Dispatch skipped: no pending jobs');
        return null;
      }

      db.prepare(`UPDATE job_queue SET status = 'dispatched', dispatched_at = ? WHERE id = ?`).run(
        now,
        entry.id,
      );

      logger.info('Job dispatched (conservative)', {
        id: entry.id,
        jobType: entry.jobType,
        project: entry.projectName,
        priority: entry.priority,
        providerKey: entry.providerKey ?? null,
        waitSeconds: now - entry.enqueuedAt,
      });
      return { ...entry, status: 'dispatched', dispatchedAt: now };
    }

    // provider-aware mode: find first candidate that fits bucket capacity
    const candidates = getAllPendingCandidates(db);
    if (candidates.length === 0) {
      logger.debug('Dispatch skipped: no pending jobs');
      return null;
    }

    logger.debug('Provider-aware dispatch: evaluating candidates', { candidateCount: candidates.length });

    const pressureByBucket = getInFlightPressureByBucket(db);

    for (const candidate of candidates) {
      if (fitsProviderCapacity(candidate, config, pressureByBucket)) {
        db
          .prepare(`UPDATE job_queue SET status = 'dispatched', dispatched_at = ? WHERE id = ?`)
          .run(now, candidate.id);

        logger.info('Job dispatched (provider-aware)', {
          id: candidate.id,
          jobType: candidate.jobType,
          project: candidate.projectName,
          priority: candidate.priority,
          providerKey: candidate.providerKey ?? null,
          waitSeconds: now - candidate.enqueuedAt,
        });
        return { ...candidate, status: 'dispatched', dispatchedAt: now };
      }
    }

    logger.info('Dispatch skipped: all candidates blocked by provider capacity', {
      candidateCount: candidates.length,
    });
    return null;
  } finally {
    db.close();
  }
}

/**
 * Get the full queue status (enriched with provider bucket breakdown and pressure metrics)
 */
export function getQueueStatus(): IQueueStatus {
  const db = openDb();
  try {
    // Get running job
    const runningRow = db
      .prepare(`SELECT * FROM job_queue WHERE status = 'running' LIMIT 1`)
      .get() as Record<string, unknown> | undefined;
    const running = runningRow ? rowToEntry(runningRow) : null;

    // Get pending counts by job type
    const pendingRows = db
      .prepare(
        `SELECT job_type, COUNT(*) as count FROM job_queue WHERE status = 'pending' GROUP BY job_type`,
      )
      .all() as Array<{ job_type: string; count: number }>;

    const byType: Record<string, number> = {};
    let total = 0;
    for (const row of pendingRows) {
      byType[row.job_type] = row.count;
      total += row.count;
    }

    // Get pending counts by provider bucket
    const bucketCountRows = db
      .prepare(
        `SELECT COALESCE(provider_key, '__unassigned__') as bucket, COUNT(*) as count
         FROM job_queue WHERE status = 'pending'
         GROUP BY provider_key`,
      )
      .all() as Array<{ bucket: string; count: number }>;

    const byProviderBucket: Record<string, number> = {};
    for (const row of bucketCountRows) {
      byProviderBucket[row.bucket] = row.count;
    }

    // Get in-flight pressure aggregates by provider bucket
    const pressureRows = db
      .prepare(
        `SELECT COALESCE(provider_key, '__unassigned__') as bucket,
                COUNT(*) as count,
                COALESCE(SUM(ai_pressure), 0) as ai_pressure,
                COALESCE(SUM(runtime_pressure), 0) as runtime_pressure
         FROM job_queue
         WHERE status IN ('running', 'dispatched')
         GROUP BY provider_key`,
      )
      .all() as Array<{
      bucket: string;
      count: number;
      ai_pressure: number;
      runtime_pressure: number;
    }>;

    const pressureByBucket: IQueueStatus['pressureByBucket'] = {};
    for (const row of pressureRows) {
      pressureByBucket[row.bucket] = {
        aiPressure: row.ai_pressure,
        runtimePressure: row.runtime_pressure,
        count: row.count,
      };
    }

    // Compute average wait for pending jobs
    const now = Math.floor(Date.now() / 1000);
    const waitRow = db
      .prepare(
        `SELECT AVG(? - enqueued_at) as avg_wait, MIN(enqueued_at) as oldest
         FROM job_queue WHERE status = 'pending'`,
      )
      .get(now) as { avg_wait: number | null; oldest: number | null } | undefined;

    const averageWaitSeconds = waitRow?.avg_wait != null ? Math.round(waitRow.avg_wait) : null;
    const oldestPendingAge =
      waitRow?.oldest != null ? now - waitRow.oldest : null;

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
      pending: { total, byType, byProviderBucket },
      items,
      pressureByBucket,
      averageWaitSeconds,
      oldestPendingAge,
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
      result = db
        .prepare(`DELETE FROM job_queue WHERE status = 'pending' AND job_type = ?`)
        .run(filter);
    } else {
      result = db.prepare(`DELETE FROM job_queue WHERE status = 'pending'`).run();
    }
    logger.info('Queue cleared', { count: result.changes, filter: filter ?? 'all' });
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
    // Expire pending jobs that waited too long, and dispatched/running jobs that never completed
    const result = db
      .prepare(
        `UPDATE job_queue
         SET status = 'expired', expired_at = ?
         WHERE (status = 'pending' AND enqueued_at < ?)
            OR (status IN ('dispatched', 'running') AND dispatched_at < ?)`,
      )
      .run(now, cutoff, cutoff);
    if (result.changes > 0) {
      logger.warn('Expired stale jobs', { count: result.changes, maxWaitTime });
    } else {
      logger.debug('No stale jobs to expire', { maxWaitTime });
    }
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

/**
 * Record a job execution run into the job_runs telemetry table.
 * @returns The auto-incremented id of the inserted row.
 */
export function recordJobRun(record: IJobRunRecord): number {
  const db = openDb();
  try {
    const result = db
      .prepare(
        `INSERT INTO job_runs
           (project_path, job_type, provider_key, queue_entry_id, status,
            queued_at, started_at, finished_at, wait_seconds, duration_seconds,
            throttled_count, metadata_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.projectPath,
        record.jobType,
        record.providerKey,
        record.queueEntryId ?? null,
        record.status,
        record.queuedAt ?? null,
        record.startedAt,
        record.finishedAt ?? null,
        record.waitSeconds ?? null,
        record.durationSeconds ?? null,
        record.throttledCount ?? 0,
        record.metadataJson ?? '{}',
      );
    return result.lastInsertRowid as number;
  } finally {
    db.close();
  }
}

/**
 * Query job_runs telemetry and live job_queue state to produce an analytics snapshot.
 *
 * @param windowHours - How many hours back to look for recent runs (default: 24)
 */
export function getJobRunsAnalytics(windowHours = 24): IJobRunAnalytics {
  const db = openDb();
  try {
    const now = Math.floor(Date.now() / 1000);
    const windowStart = now - windowHours * 3600;

    // Recent runs within the window
    const recentRows = db
      .prepare(
        `SELECT id, project_path, job_type, provider_key, status,
                started_at, finished_at, wait_seconds, duration_seconds, throttled_count
         FROM job_runs
         WHERE started_at >= ?
         ORDER BY started_at DESC
         LIMIT 200`,
      )
      .all(windowStart) as Array<{
      id: number;
      project_path: string;
      job_type: string;
      provider_key: string;
      status: string;
      started_at: number;
      finished_at: number | null;
      wait_seconds: number | null;
      duration_seconds: number | null;
      throttled_count: number;
    }>;

    const recentRuns = recentRows.map((r) => ({
      id: r.id,
      projectPath: r.project_path,
      jobType: r.job_type,
      providerKey: r.provider_key,
      status: r.status,
      startedAt: r.started_at,
      finishedAt: r.finished_at,
      waitSeconds: r.wait_seconds,
      durationSeconds: r.duration_seconds,
      throttledCount: r.throttled_count,
    }));

    // Per-bucket breakdown from live job_queue
    const bucketRows = db
      .prepare(
        `SELECT
           COALESCE(provider_key, '__unassigned__') as bucket,
           SUM(CASE WHEN status IN ('running', 'dispatched') THEN 1 ELSE 0 END) as running,
           SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
           COALESCE(SUM(CASE WHEN status IN ('running','dispatched') THEN ai_pressure ELSE 0 END), 0) as total_ai,
           COALESCE(SUM(CASE WHEN status IN ('running','dispatched') THEN runtime_pressure ELSE 0 END), 0) as total_runtime
         FROM job_queue
         WHERE status IN ('pending', 'running', 'dispatched')
         GROUP BY provider_key`,
      )
      .all() as Array<{
      bucket: string;
      running: number;
      pending: number;
      total_ai: number;
      total_runtime: number;
    }>;

    const byProviderBucket: IJobRunAnalytics['byProviderBucket'] = {};
    for (const row of bucketRows) {
      byProviderBucket[row.bucket] = {
        running: row.running,
        pending: row.pending,
        totalAiPressure: row.total_ai,
        totalRuntimePressure: row.total_runtime,
      };
    }

    // Average wait time from recent successful/finished runs
    const avgRow = db
      .prepare(
        `SELECT AVG(wait_seconds) as avg_wait
         FROM job_runs
         WHERE started_at >= ? AND wait_seconds IS NOT NULL`,
      )
      .get(windowStart) as { avg_wait: number | null } | undefined;

    const averageWaitSeconds =
      avgRow?.avg_wait != null ? Math.round(avgRow.avg_wait) : null;

    // Oldest pending job age
    const oldestRow = db
      .prepare(`SELECT MIN(enqueued_at) as oldest FROM job_queue WHERE status = 'pending'`)
      .get() as { oldest: number | null } | undefined;

    const oldestPendingAge =
      oldestRow?.oldest != null ? now - oldestRow.oldest : null;

    return {
      recentRuns,
      byProviderBucket,
      averageWaitSeconds,
      oldestPendingAge,
    };
  } finally {
    db.close();
  }
}
