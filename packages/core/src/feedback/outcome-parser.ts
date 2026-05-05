/**
 * Tolerant parsing for Night Watch job outcomes.
 */

import type { ISessionOutcomeInsertInput, JobType, SessionOutcomeStatus } from '@/types.js';
import type { IScriptResult } from '@/utils/script-result.js';

export const FAILURE_CATEGORIES = [
  'typescript',
  'eslint',
  'test',
  'ci',
  'review-score',
  'rate-limit',
  'timeout',
  'conflict',
  'unknown',
] as const;

export type FailureCategory = (typeof FAILURE_CATEGORIES)[number];

export interface IOutcomeParserInput {
  projectPath: string;
  jobType: JobType;
  providerKey: string;
  startedAt: number;
  finishedAt: number;
  exitCode: number;
  stdout?: string;
  stderr?: string;
  scriptResult?: IScriptResult | null;
  minReviewScore?: number;
  metadata?: Record<string, unknown>;
}

export interface IFailureClassification {
  category: FailureCategory;
  failureSignature: string;
  fileArea: string | null;
  firstErrorLine: string | null;
}

export interface IFailureClassificationInput {
  projectPath: string;
  stdout?: string;
  stderr?: string;
  scriptResult?: IScriptResult | null;
  minReviewScore?: number;
  exitCode?: number;
}

interface IClassifierRule {
  category: FailureCategory;
  pattern: RegExp;
}

const SECRET_PLACEHOLDER = '[REDACTED_SECRET]';
const MAX_SIGNATURE_LENGTH = 240;
const MAX_ERROR_LINE_LENGTH = 300;
const ANSI_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');
const FILE_PATH_PATTERN = /\.(?:[cm]?[jt]sx?|json|md|css|scss|ya?ml)$/i;
const TOKEN_SPLIT_PATTERN = /[\s('"`]+/;

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
  [/\b(token|api[_-]?key|password|secret)=["']?[\w.~+/=-]{12,}/gi, `$1=${SECRET_PLACEHOLDER}`],
];

const CLASSIFIER_RULES: IClassifierRule[] = [
  {
    category: 'timeout',
    pattern:
      /\b(timed?\s*out|timeout|etimedout|operation was aborted|exit code 124|signal sigterm)\b/i,
  },
  {
    category: 'rate-limit',
    pattern:
      /\b(429|rate[- ]?limit(?:ed)?|too many requests|quota exceeded|resource_exhausted|overloaded)\b/i,
  },
  {
    category: 'conflict',
    pattern:
      /\b(merge conflict|conflict \(|conflict:|unmerged files|needs merge|automatic merge failed|both modified:)\b/i,
  },
  {
    category: 'typescript',
    pattern: /\b(TS\d{4}|typescript error|tsc\b.*(?:failed|error)|error TS\d{4})\b/i,
  },
  {
    category: 'eslint',
    pattern:
      /\b(eslint|@typescript-eslint|no-unused-vars|no-explicit-any|react-hooks\/rules-of-hooks)\b/i,
  },
  {
    category: 'test',
    pattern: /\b(vitest|jest|playwright|cypress|mocha|assertionerror)\b/i,
  },
  {
    category: 'test',
    pattern: /\b(test files?|tests?)\b.*\bfailed\b/i,
  },
  {
    category: 'test',
    pattern: /\b(expect\(|locator\(|FAIL\s+\S+\.(?:test|spec)\.)/i,
  },
  {
    category: 'review-score',
    pattern:
      /\b(review score|final_score|score)\b.*\b(below|minimum|min|required|threshold|failed|miss)\b/i,
  },
  {
    category: 'ci',
    pattern:
      /\b(ci|github actions|workflow|status check|required check|check run|failing checks?)\b.*\b(fail|error|cancel|timed out|action_required)\b/i,
  },
];

function stripAnsi(value: string): string {
  return value.replace(ANSI_PATTERN, '');
}

export function redactOutcomeText(value: string): string {
  return SECRET_TEXT_PATTERNS.reduce(
    (current, [pattern, replacement]) => current.replace(pattern, replacement),
    value,
  );
}

function trimLine(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`;
}

function normalizeLine(value: string, projectPath: string): string {
  let normalized = stripAnsi(redactOutcomeText(value)).trim();
  if (projectPath) {
    normalized = normalized.replaceAll(projectPath, '<project>');
  }

  return trimLine(
    normalized
      .replace(/:\d+:\d+/g, ':<line>:<col>')
      .replace(/:\d+\b/g, ':<line>')
      .replace(/\b0x[0-9a-f]+\b/gi, '<hex>')
      .replace(/\b\d{4,}\b/g, '<num>')
      .replace(/\s+/g, ' ')
      .toLowerCase(),
    MAX_ERROR_LINE_LENGTH,
  );
}

function getOutputLines(stdout: string | undefined, stderr: string | undefined): string[] {
  return `${stdout ?? ''}\n${stderr ?? ''}`
    .split(/\r?\n/)
    .map((line) => stripAnsi(redactOutcomeText(line)).trim())
    .filter((line) => line.length > 0 && !line.startsWith('NIGHT_WATCH_RESULT:'));
}

function extractFilePath(line: string, projectPath: string): string | null {
  const normalizedLine = line.replaceAll('\\', '/');
  const normalizedProjectPath = projectPath.replaceAll('\\', '/');

  if (normalizedProjectPath) {
    const projectPrefix = `${normalizedProjectPath}/`;
    const projectIndex = normalizedLine.indexOf(projectPrefix);
    if (projectIndex >= 0) {
      const relativeLine = normalizedLine.slice(projectIndex + projectPrefix.length);
      const relativePath = extractFilePathToken(relativeLine.split(TOKEN_SPLIT_PATTERN));
      if (relativePath) {
        return relativePath;
      }
    }
  }

  return extractFilePathToken(normalizedLine.split(TOKEN_SPLIT_PATTERN));
}

function extractFilePathToken(tokens: string[]): string | null {
  for (const token of tokens) {
    const withoutLocation = cleanFilePathToken(token);
    if (FILE_PATH_PATTERN.test(withoutLocation)) {
      return withoutLocation;
    }
  }
  return null;
}

function cleanFilePathToken(token: string): string {
  let candidate = token;
  const locationIndex = findLocationIndex(candidate);
  if (locationIndex >= 0) {
    candidate = candidate.slice(0, locationIndex);
  }

  while (candidate.startsWith('(') || candidate.startsWith('[') || candidate.startsWith('{')) {
    candidate = candidate.slice(1);
  }
  while (candidate.endsWith(')') || candidate.endsWith(',') || candidate.endsWith(';')) {
    candidate = candidate.slice(0, -1);
  }
  return candidate.startsWith('./') ? candidate.slice(2) : candidate;
}

function findLocationIndex(value: string): number {
  for (let index = 0; index < value.length - 1; index += 1) {
    if (value[index] === ':' && value[index + 1] >= '0' && value[index + 1] <= '9') {
      return index;
    }
  }
  return -1;
}

function filePathToArea(filePath: string | null): string | null {
  if (!filePath) {
    return null;
  }

  const segments = filePath.split('/').filter(Boolean);
  if (segments.length <= 1) {
    return '.';
  }
  return segments.slice(0, Math.min(segments.length - 1, 3)).join('/');
}

function findFirstMatchingLine(lines: string[], category: FailureCategory): string | null {
  const rule = CLASSIFIER_RULES.find((entry) => entry.category === category);
  if (rule) {
    const matched = lines.find((line) => rule.pattern.test(line));
    if (matched) {
      return matched;
    }
  }

  return (
    lines.find((line) =>
      /\b(error|failed|failure|fatal|exception|conflict|timeout)\b/i.test(line),
    ) ??
    lines[0] ??
    null
  );
}

function classifyCategory(
  lines: string[],
  scriptResult: IScriptResult | null | undefined,
  minReviewScore: number | undefined,
  exitCode: number | undefined,
): FailureCategory {
  const status = scriptResult?.status ?? '';
  const data = scriptResult?.data ?? {};
  const combined = [...lines, status, data.reason ?? '', data.detail ?? ''].join('\n');

  if (exitCode === 124 || status === 'timeout') {
    return 'timeout';
  }
  if (status === 'rate_limited' || data.rate_limit_fallback === '1') {
    return 'rate-limit';
  }

  const reviewScore = parseOptionalNumber(data.final_score ?? data.review_score);
  if (
    reviewScore != null &&
    minReviewScore != null &&
    Number.isFinite(minReviewScore) &&
    reviewScore < minReviewScore
  ) {
    return 'review-score';
  }

  for (const rule of CLASSIFIER_RULES) {
    if (rule.pattern.test(combined)) {
      return rule.category;
    }
  }

  return 'unknown';
}

export function classifyFailure(input: IFailureClassificationInput): IFailureClassification {
  const lines = getOutputLines(input.stdout, input.stderr);
  const category = classifyCategory(
    lines,
    input.scriptResult,
    input.minReviewScore,
    input.exitCode,
  );
  const firstErrorLine = findFirstMatchingLine(lines, category);
  const filePath =
    (firstErrorLine ? extractFilePath(firstErrorLine, input.projectPath) : null) ??
    lines.map((line) => extractFilePath(line, input.projectPath)).find((value) => value != null) ??
    null;
  const fileArea = filePathToArea(filePath);
  const normalizedLine = firstErrorLine
    ? normalizeLine(firstErrorLine, input.projectPath)
    : 'no-error-line';
  const failureSignature = trimLine(
    `${category}|${fileArea ?? 'unknown-area'}|${normalizedLine}`,
    MAX_SIGNATURE_LENGTH,
  );

  return {
    category,
    failureSignature,
    fileArea,
    firstErrorLine: firstErrorLine ? trimLine(firstErrorLine, MAX_ERROR_LINE_LENGTH) : null,
  };
}

function parseOptionalNumber(value: string | undefined): number | null {
  if (!value) {
    return null;
  }
  const normalized = value.trim().replace(/^#/, '');
  const parsed = parseInt(normalized, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function parseFirstPrNumber(scriptResult: IScriptResult | null | undefined): number | null {
  const data = scriptResult?.data ?? {};
  const direct =
    parseOptionalNumber(data.pr_number) ??
    parseOptionalNumber(data.prNumber) ??
    parseOptionalNumber(data.pr) ??
    parseOptionalNumber(data.failed_pr);
  if (direct != null) {
    return direct;
  }

  const urlMatch = data.pr_url?.match(/\/pull\/(\d+)/);
  if (urlMatch?.[1]) {
    return parseOptionalNumber(urlMatch[1]);
  }

  const prsRaw = data.prs ?? data.auto_merged;
  if (!prsRaw) {
    return null;
  }
  const firstToken = prsRaw.split(',').find((token) => parseOptionalNumber(token) != null);
  return parseOptionalNumber(firstToken);
}

function parseAttemptCount(
  scriptResult: IScriptResult | null | undefined,
  lines: string[],
): number {
  const fromData =
    parseOptionalNumber(scriptResult?.data.attempt) ??
    parseOptionalNumber(scriptResult?.data.attempts);
  if (fromData != null && fromData > 0) {
    return fromData;
  }

  let maxAttempt = 1;
  for (const line of lines) {
    const match = /\bATTEMPT:\s*(\d+)\//i.exec(line) ?? /\bStarting attempt\s+(\d+)\//i.exec(line);
    if (match?.[1]) {
      maxAttempt = Math.max(maxAttempt, parseInt(match[1], 10));
    }
  }
  return maxAttempt;
}

function parseRetryCount(scriptResult: IScriptResult | null | undefined, attempt: number): number {
  const retryCount = parseOptionalNumber(scriptResult?.data.retry_count);
  if (retryCount != null && retryCount >= 0) {
    return retryCount;
  }
  return Math.max(0, attempt - 1);
}

function markerIndicatesFailure(scriptResult: IScriptResult | null | undefined): boolean {
  const data = scriptResult?.data ?? {};
  const positiveFailureCount =
    (parseOptionalNumber(data.failed) ?? 0) > 0 ||
    (parseOptionalNumber(data.prs_failed) ?? 0) > 0 ||
    (parseOptionalNumber(data.failed_count) ?? 0) > 0;
  if (positiveFailureCount) {
    return true;
  }

  return [data.failed_pr, data.auto_merge_failed, data.failed_automation]
    .filter((value): value is string => typeof value === 'string')
    .some((value) => value.trim().length > 0 && value.trim().toLowerCase() !== 'none');
}

function determineOutcome(
  exitCode: number,
  scriptResult: IScriptResult | null | undefined,
  category: FailureCategory,
): SessionOutcomeStatus {
  const status = scriptResult?.status ?? '';
  if (status === 'queued' || status.startsWith('skip_')) {
    return 'skipped';
  }
  if (exitCode === 124 || status === 'timeout' || category === 'timeout') {
    return 'timeout';
  }
  if (status === 'rate_limited' || (exitCode !== 0 && category === 'rate-limit')) {
    return 'rate_limited';
  }
  if (
    status.startsWith('failure') ||
    category === 'review-score' ||
    markerIndicatesFailure(scriptResult)
  ) {
    return 'failure';
  }
  return exitCode === 0 ? 'success' : 'failure';
}

function redactMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(redactOutcomeText(JSON.stringify(metadata))) as Record<string, unknown>;
}

export function buildSessionOutcomeInput(input: IOutcomeParserInput): ISessionOutcomeInsertInput {
  const lines = getOutputLines(input.stdout, input.stderr);
  const classification = classifyFailure(input);
  const outcome = determineOutcome(input.exitCode, input.scriptResult, classification.category);
  const attempt = parseAttemptCount(input.scriptResult, lines);
  const retryCount = parseRetryCount(input.scriptResult, attempt);
  const reviewScore = parseOptionalNumber(
    input.scriptResult?.data.final_score ?? input.scriptResult?.data.review_score,
  );
  const failureCategory =
    outcome === 'failure' || outcome === 'timeout' || outcome === 'rate_limited'
      ? classification.category
      : null;

  return {
    projectPath: input.projectPath,
    jobType: input.jobType,
    providerKey: input.providerKey || 'unknown',
    prdFile: input.scriptResult?.data.prd ?? input.scriptResult?.data.prd_file ?? null,
    prNumber: parseFirstPrNumber(input.scriptResult),
    branchName: input.scriptResult?.data.branch ?? null,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    durationSeconds: Math.max(0, Math.round((input.finishedAt - input.startedAt) / 1000)),
    outcome,
    exitCode: input.exitCode,
    attempt,
    retryCount,
    reviewScore,
    ciStatus: failureCategory === 'ci' ? 'fail' : (input.scriptResult?.data.ci_status ?? null),
    failureCategory,
    failureSignature: failureCategory ? classification.failureSignature : null,
    metadata: redactMetadata({
      ...(input.metadata ?? {}),
      scriptStatus: input.scriptResult?.status ?? null,
      scriptData: input.scriptResult?.data ?? {},
      minReviewScore: input.minReviewScore ?? null,
      firstErrorLine: classification.firstErrorLine,
      fileArea: classification.fileArea,
    }),
  };
}
