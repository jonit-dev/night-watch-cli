/**
 * SQLite implementation of ISessionOutcomeRepository.
 * Persists structured feedback-loop outcomes, patterns, and prompt augmentations.
 */

import Database from 'better-sqlite3';
import { inject, injectable } from 'tsyringe';

import type {
  FeedbackPatternStatus,
  IFeedbackPattern,
  IFeedbackPatternUpsertInput,
  IPromptAugmentation,
  IPromptAugmentationInsertInput,
  ISessionOutcome,
  ISessionOutcomeInsertInput,
  ISessionOutcomeQueryInput,
  ISessionOutcomeSummary,
  ISessionOutcomeSummaryInput,
  JobType,
  PromptAugmentationStatus,
  SessionOutcomeStatus,
} from '@/types.js';

import { ISessionOutcomeRepository } from '../interfaces.js';

interface ISessionOutcomeRow {
  id: number;
  project_path: string;
  job_type: string;
  provider_key: string;
  prd_file: string | null;
  pr_number: number | null;
  branch_name: string | null;
  started_at: number;
  finished_at: number;
  duration_seconds: number | null;
  outcome: string;
  exit_code: number | null;
  attempt: number;
  retry_count: number;
  review_score: number | null;
  ci_status: string | null;
  failure_category: string | null;
  failure_signature: string | null;
  metadata_json: string;
}

interface IFeedbackPatternRow {
  id: number;
  project_path: string;
  pattern_key: string;
  job_type: string;
  category: string;
  title: string;
  description: string;
  sample_count: number;
  confidence: number;
  first_seen_at: number;
  last_seen_at: number;
  status: string;
  metadata_json: string;
}

interface IPromptAugmentationRow {
  id: number;
  project_path: string;
  pattern_id: number | null;
  job_type: string;
  prompt_text: string;
  status: string;
  created_at: number;
  updated_at: number;
  expires_at: number | null;
  applied_count: number;
  success_count: number;
}

interface ISummaryCountRow {
  key: string | null;
  count: number;
}

const SECRET_PLACEHOLDER = '[REDACTED_SECRET]';
const SECRET_KEY_PATTERN =
  /(?:api[_-]?key|authorization|client[_-]?secret|cookie|password|private[_-]?key|secret|token)/i;
const SECRET_TEXT_PATTERNS: Array<[RegExp, string]> = [
  [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    SECRET_PLACEHOLDER,
  ],
  [/\bsk-ant-[\w-]{20,}\b/g, SECRET_PLACEHOLDER],
  [/\bsk-[\w-]{20,}\b/g, SECRET_PLACEHOLDER],
  [/\bgh[opsru]_\w{30,}\b/g, SECRET_PLACEHOLDER],
  [/\bxox[baprs]-[\w-]{20,}\b/g, SECRET_PLACEHOLDER],
  [/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, SECRET_PLACEHOLDER],
  [/\b(Bearer|Basic)\s+[\w.~+/=-]{12,}/gi, `$1 ${SECRET_PLACEHOLDER}`],
];

function redactText(value: string): string {
  return SECRET_TEXT_PATTERNS.reduce(
    (current, [pattern, replacement]) => current.replace(pattern, replacement),
    value,
  );
}

function redactOptionalText(value: string | null | undefined): string | null {
  return value == null ? null : redactText(value);
}

function redactMetadataValue(
  value: unknown,
  key: string | undefined,
  seen: WeakSet<object>,
): unknown {
  if (key && SECRET_KEY_PATTERN.test(key)) {
    return SECRET_PLACEHOLDER;
  }

  if (typeof value === 'string') {
    return redactText(value);
  }

  if (value === null || typeof value !== 'object') {
    return value;
  }

  if (seen.has(value)) {
    return '[Circular]';
  }
  seen.add(value);

  if (Array.isArray(value)) {
    const redactedArray = value.map((item) => redactMetadataValue(item, undefined, seen));
    seen.delete(value);
    return redactedArray;
  }

  const redacted: Record<string, unknown> = {};
  for (const [entryKey, entryValue] of Object.entries(value)) {
    redacted[entryKey] = redactMetadataValue(entryValue, entryKey, seen);
  }
  seen.delete(value);
  return redacted;
}

function redactMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown> {
  const value = redactMetadataValue(metadata ?? {}, undefined, new WeakSet<object>());
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function parseMetadata(metadataJson: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(metadataJson);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return {};
  }
  return {};
}

function rowToOutcome(row: ISessionOutcomeRow): ISessionOutcome {
  return {
    id: row.id,
    projectPath: row.project_path,
    jobType: row.job_type as JobType,
    providerKey: row.provider_key,
    prdFile: row.prd_file,
    prNumber: row.pr_number,
    branchName: row.branch_name,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    durationSeconds: row.duration_seconds,
    outcome: row.outcome as SessionOutcomeStatus,
    exitCode: row.exit_code,
    attempt: row.attempt,
    retryCount: row.retry_count,
    reviewScore: row.review_score,
    ciStatus: row.ci_status,
    failureCategory: row.failure_category,
    failureSignature: row.failure_signature,
    metadata: parseMetadata(row.metadata_json),
  };
}

function rowToPattern(row: IFeedbackPatternRow): IFeedbackPattern {
  return {
    id: row.id,
    projectPath: row.project_path,
    patternKey: row.pattern_key,
    jobType: row.job_type as JobType,
    category: row.category,
    title: row.title,
    description: row.description,
    sampleCount: row.sample_count,
    confidence: row.confidence,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    status: row.status as FeedbackPatternStatus,
    metadata: parseMetadata(row.metadata_json),
  };
}

function rowToAugmentation(row: IPromptAugmentationRow): IPromptAugmentation {
  return {
    id: row.id,
    projectPath: row.project_path,
    patternId: row.pattern_id,
    jobType: row.job_type as JobType,
    promptText: row.prompt_text,
    status: row.status as PromptAugmentationStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
    appliedCount: row.applied_count,
    successCount: row.success_count,
  };
}

function buildOutcomeWhere(input: ISessionOutcomeSummaryInput | ISessionOutcomeQueryInput): {
  params: Array<number | string>;
  where: string;
} {
  const clauses = ['project_path = ?'];
  const params: Array<number | string> = [input.projectPath];

  if (input.jobType) {
    clauses.push('job_type = ?');
    params.push(input.jobType);
  }
  if ('outcome' in input && input.outcome) {
    clauses.push('outcome = ?');
    params.push(input.outcome);
  }
  if (input.fromFinishedAt != null) {
    clauses.push('finished_at >= ?');
    params.push(input.fromFinishedAt);
  }
  if (input.toFinishedAt != null) {
    clauses.push('finished_at <= ?');
    params.push(input.toFinishedAt);
  }

  return { params, where: clauses.join(' AND ') };
}

@injectable()
export class SqliteSessionOutcomeRepository implements ISessionOutcomeRepository {
  private readonly db: Database.Database;

  constructor(@inject('Database') db: Database.Database) {
    this.db = db;
  }

  insertOutcome(input: ISessionOutcomeInsertInput): ISessionOutcome {
    const metadataJson = JSON.stringify(redactMetadata(input.metadata));
    const result = this.db
      .prepare(
        `INSERT INTO session_outcomes
           (project_path, job_type, provider_key, prd_file, pr_number, branch_name,
            started_at, finished_at, duration_seconds, outcome, exit_code, attempt,
            retry_count, review_score, ci_status, failure_category, failure_signature,
            metadata_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.projectPath,
        input.jobType,
        input.providerKey,
        input.prdFile ?? null,
        input.prNumber ?? null,
        redactOptionalText(input.branchName),
        input.startedAt,
        input.finishedAt,
        input.durationSeconds ?? null,
        input.outcome,
        input.exitCode ?? null,
        input.attempt ?? 1,
        input.retryCount ?? 0,
        input.reviewScore ?? null,
        redactOptionalText(input.ciStatus),
        redactOptionalText(input.failureCategory),
        redactOptionalText(input.failureSignature),
        metadataJson,
      );

    return this.getOutcomeById(Number(result.lastInsertRowid))!;
  }

  queryOutcomes(input: ISessionOutcomeQueryInput): ISessionOutcome[] {
    const { params, where } = buildOutcomeWhere(input);
    const limit = Math.min(Math.max(input.limit ?? 100, 1), 500);
    const rows = this.db
      .prepare(
        `SELECT *
         FROM session_outcomes
         WHERE ${where}
         ORDER BY finished_at DESC, id DESC
         LIMIT ?`,
      )
      .all(...params, limit) as ISessionOutcomeRow[];

    return rows.map(rowToOutcome);
  }

  querySummary(input: ISessionOutcomeSummaryInput): ISessionOutcomeSummary {
    const { params, where } = buildOutcomeWhere(input);
    const outcomeRows = this.db
      .prepare(
        `SELECT outcome as key, COUNT(*) as count
         FROM session_outcomes
         WHERE ${where}
         GROUP BY outcome`,
      )
      .all(...params) as ISummaryCountRow[];

    const categoryRows = this.db
      .prepare(
        `SELECT failure_category as key, COUNT(*) as count
         FROM session_outcomes
         WHERE ${where} AND failure_category IS NOT NULL
         GROUP BY failure_category`,
      )
      .all(...params) as ISummaryCountRow[];

    const averageRow = this.db
      .prepare(
        `SELECT AVG(duration_seconds) as average_duration
         FROM session_outcomes
         WHERE ${where} AND duration_seconds IS NOT NULL`,
      )
      .get(...params) as { average_duration: number | null } | undefined;

    const byOutcome = Object.fromEntries(
      outcomeRows.map((row) => [row.key ?? 'unknown', row.count]),
    ) as Record<string, number>;
    const byFailureCategory = Object.fromEntries(
      categoryRows.map((row) => [row.key ?? 'unknown', row.count]),
    ) as Record<string, number>;

    return {
      totalCount: outcomeRows.reduce((total, row) => total + row.count, 0),
      successCount: byOutcome.success ?? 0,
      failureCount: byOutcome.failure ?? 0,
      timeoutCount: byOutcome.timeout ?? 0,
      rateLimitedCount: byOutcome.rate_limited ?? 0,
      skippedCount: byOutcome.skipped ?? 0,
      averageDurationSeconds: averageRow?.average_duration ?? null,
      byOutcome,
      byFailureCategory,
    };
  }

  upsertPattern(input: IFeedbackPatternUpsertInput): IFeedbackPattern {
    const now = Date.now();
    const existing = this.getPattern(input.projectPath, input.patternKey, input.jobType);
    const firstSeenAt = existing?.firstSeenAt ?? input.firstSeenAt ?? now;
    const lastSeenAt = input.lastSeenAt ?? now;
    const sampleCount = input.sampleCount ?? (existing ? existing.sampleCount + 1 : 1);
    const confidence = input.confidence ?? existing?.confidence ?? 0;
    const status = input.status ?? existing?.status ?? 'observing';
    const metadataJson = JSON.stringify(redactMetadata(input.metadata ?? existing?.metadata));

    this.db
      .prepare(
        `INSERT INTO feedback_patterns
           (project_path, pattern_key, job_type, category, title, description, sample_count,
            confidence, first_seen_at, last_seen_at, status, metadata_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(project_path, pattern_key, job_type)
         DO UPDATE SET category = excluded.category,
                       title = excluded.title,
                       description = excluded.description,
                       sample_count = excluded.sample_count,
                       confidence = excluded.confidence,
                       last_seen_at = excluded.last_seen_at,
                       status = excluded.status,
                       metadata_json = excluded.metadata_json`,
      )
      .run(
        input.projectPath,
        input.patternKey,
        input.jobType,
        redactText(input.category),
        redactText(input.title),
        redactText(input.description),
        sampleCount,
        confidence,
        firstSeenAt,
        lastSeenAt,
        status,
        metadataJson,
      );

    return this.getPattern(input.projectPath, input.patternKey, input.jobType)!;
  }

  createAugmentation(input: IPromptAugmentationInsertInput): IPromptAugmentation {
    const now = Date.now();
    const createdAt = input.createdAt ?? now;
    const updatedAt = input.updatedAt ?? createdAt;
    const result = this.db
      .prepare(
        `INSERT INTO prompt_augmentations
           (project_path, pattern_id, job_type, prompt_text, status, created_at, updated_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.projectPath,
        input.patternId ?? null,
        input.jobType,
        redactText(input.promptText),
        input.status ?? 'active',
        createdAt,
        updatedAt,
        input.expiresAt ?? null,
      );

    return this.getAugmentationById(Number(result.lastInsertRowid))!;
  }

  listActiveAugmentations(
    projectPath: string,
    jobType: JobType,
    now = Date.now(),
  ): IPromptAugmentation[] {
    const rows = this.db
      .prepare(
        `SELECT *
         FROM prompt_augmentations
         WHERE project_path = ?
           AND job_type = ?
           AND status = 'active'
           AND (expires_at IS NULL OR expires_at > ?)
         ORDER BY created_at ASC, id ASC`,
      )
      .all(projectPath, jobType, now) as IPromptAugmentationRow[];

    return rows.map(rowToAugmentation);
  }

  updateAugmentationStatus(id: number, status: PromptAugmentationStatus): void {
    this.db
      .prepare('UPDATE prompt_augmentations SET status = ?, updated_at = ? WHERE id = ?')
      .run(status, Date.now(), id);
  }

  incrementAugmentationCounts(id: number, success = false): void {
    this.db
      .prepare(
        `UPDATE prompt_augmentations
         SET applied_count = applied_count + 1,
             success_count = success_count + ?,
             updated_at = ?
         WHERE id = ?`,
      )
      .run(success ? 1 : 0, Date.now(), id);
  }

  private getOutcomeById(id: number): ISessionOutcome | null {
    const row = this.db.prepare('SELECT * FROM session_outcomes WHERE id = ?').get(id) as
      | ISessionOutcomeRow
      | undefined;
    return row ? rowToOutcome(row) : null;
  }

  private getPattern(
    projectPath: string,
    patternKey: string,
    jobType: JobType,
  ): IFeedbackPattern | null {
    const row = this.db
      .prepare(
        `SELECT *
         FROM feedback_patterns
         WHERE project_path = ? AND pattern_key = ? AND job_type = ?`,
      )
      .get(projectPath, patternKey, jobType) as IFeedbackPatternRow | undefined;
    return row ? rowToPattern(row) : null;
  }

  private getAugmentationById(id: number): IPromptAugmentation | null {
    const row = this.db.prepare('SELECT * FROM prompt_augmentations WHERE id = ?').get(id) as
      | IPromptAugmentationRow
      | undefined;
    return row ? rowToAugmentation(row) : null;
  }
}
