/**
 * Deterministic feedback pattern detection from stored session outcomes.
 */

import type { ISessionOutcomeRepository } from '@/storage/repositories/interfaces.js';
import type { IFeedbackPattern, IPromptAugmentation, ISessionOutcome, JobType } from '@/types.js';

const DEFAULT_CONFIDENCE_THRESHOLD = 0.75;
const DEFAULT_AUGMENTATION_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const DEFAULT_MAX_ACTIVE_AUGMENTATIONS = 3;
const DEFAULT_SUCCESS_STREAK_TO_EXPIRE = 3;
const RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const STALE_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_PATTERN_TEXT_LENGTH = 180;
const MAX_SIGNATURE_PROMPT_LENGTH = 90;

export interface IFeedbackPatternAnalysisOptions {
  augmentationTtlMs?: number;
  confidenceThreshold?: number;
  maxActiveAugmentations?: number;
  now?: number;
  successStreakToExpire?: number;
}

export interface IFeedbackPatternAnalysisResult {
  augmentation: IPromptAugmentation | null;
  expiredAugmentationIds: number[];
  pattern: IFeedbackPattern | null;
}

interface IFailureStreakStats {
  failureStreak: number;
  signatureStreak: number;
}

function isFailureOutcome(outcome: ISessionOutcome): boolean {
  return (
    outcome.outcome === 'failure' ||
    outcome.outcome === 'timeout' ||
    outcome.outcome === 'rate_limited'
  );
}

function truncateText(value: string, maxLength = MAX_PATTERN_TEXT_LENGTH): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 3).trimEnd()}...`;
}

function getStringMetadata(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function getFileArea(outcome: ISessionOutcome): string {
  return getStringMetadata(outcome.metadata, 'fileArea') ?? 'unknown area';
}

function countRecentStreaks(
  repository: ISessionOutcomeRepository,
  outcome: ISessionOutcome,
): IFailureStreakStats {
  const recentOutcomes = repository.queryOutcomes({
    projectPath: outcome.projectPath,
    jobType: outcome.jobType,
    limit: 25,
  });

  let failureStreak = 0;
  let signatureStreak = 0;

  for (const recentOutcome of recentOutcomes) {
    if (!isFailureOutcome(recentOutcome)) {
      break;
    }
    failureStreak += 1;

    if (recentOutcome.failureSignature === outcome.failureSignature) {
      signatureStreak += 1;
    } else {
      break;
    }
  }

  return { failureStreak, signatureStreak };
}

function countSuccessStreak(
  repository: ISessionOutcomeRepository,
  projectPath: string,
  jobType: JobType,
): number {
  const recentOutcomes = repository.queryOutcomes({ projectPath, jobType, limit: 25 });
  let successStreak = 0;
  for (const outcome of recentOutcomes) {
    if (outcome.outcome !== 'success') {
      break;
    }
    successStreak += 1;
  }
  return successStreak;
}

function calculateRecencyScore(now: number, lastSeenAt: number): number {
  const ageMs = Math.max(0, now - lastSeenAt);
  if (ageMs <= RECENT_WINDOW_MS) {
    return 1;
  }
  if (ageMs <= STALE_WINDOW_MS) {
    return 0.5;
  }
  return 0.15;
}

function calculateConfidence(
  sampleCount: number,
  lastSeenAt: number,
  failureStreak: number,
  signatureStreak: number,
  now: number,
): number {
  const sampleScore = Math.min(1, sampleCount / 2);
  const streakScore = Math.min(1, Math.max(failureStreak, signatureStreak) / 2);
  const recencyScore = calculateRecencyScore(now, lastSeenAt);
  const confidence = sampleScore * 0.45 + streakScore * 0.35 + recencyScore * 0.2;
  return Math.round(Math.min(1, confidence) * 100) / 100;
}

function buildPatternTitle(outcome: ISessionOutcome): string {
  const category = outcome.failureCategory ?? 'unknown';
  return truncateText(`Repeated ${category} failure in ${getFileArea(outcome)}`, 120);
}

function buildPatternDescription(outcome: ISessionOutcome, sampleCount: number): string {
  return truncateText(
    `Failure signature has appeared ${sampleCount} times for ${outcome.jobType} sessions.`,
  );
}

function buildAugmentationPrompt(pattern: IFeedbackPattern, outcome: ISessionOutcome): string {
  const category = outcome.failureCategory ?? pattern.category;
  const fileArea = getFileArea(outcome);
  const signature = truncateText(
    outcome.failureSignature ?? pattern.patternKey,
    MAX_SIGNATURE_PROMPT_LENGTH,
  );
  const confidencePercent = Math.round(pattern.confidence * 100);

  const actionByCategory: Record<string, string> = {
    ci: 'Check failing CI details before broad edits and prioritize the repeated failure area.',
    conflict: 'Check merge conflicts before editing and resolve the repeated conflict area first.',
    eslint: 'Run lint early and fix the repeated ESLint issue before final verification.',
    'rate-limit':
      'Avoid unnecessary provider calls and continue with local evidence when rate limits appear.',
    'review-score':
      'Read prior low-score review feedback before declaring the PR ready and address repeated concerns.',
    test: 'Run the targeted test area early and fix the repeated failure before final verification.',
    timeout: 'Keep the work scoped and verify incrementally because prior sessions timed out.',
    typescript:
      'Run typecheck early and fix the repeated TypeScript issue before final verification.',
    unknown: 'Investigate the repeated failure signature before making broad changes.',
  };

  return truncateText(
    `${actionByCategory[category] ?? actionByCategory.unknown} Area: ${fileArea}. Provenance: pattern #${pattern.id}, samples=${pattern.sampleCount}, confidence=${confidencePercent}%, signature="${signature}".`,
    320,
  );
}

function expireStaleAugmentations(
  repository: ISessionOutcomeRepository,
  projectPath: string,
  jobType: JobType,
  now: number,
): number[] {
  const expired: number[] = [];
  const activeAugmentations = repository.listAugmentations({
    includeExpired: true,
    jobType,
    projectPath,
    status: 'active',
  });

  for (const augmentation of activeAugmentations) {
    if (augmentation.expiresAt != null && augmentation.expiresAt <= now) {
      repository.updateAugmentationStatus(augmentation.id, 'expired', projectPath);
      expired.push(augmentation.id);
    }
  }

  return expired;
}

function expireAugmentationsAfterSuccessStreak(
  repository: ISessionOutcomeRepository,
  projectPath: string,
  jobType: JobType,
  successStreakToExpire: number,
  now: number,
): number[] {
  if (successStreakToExpire <= 0) {
    return [];
  }

  const successStreak = countSuccessStreak(repository, projectPath, jobType);
  if (successStreak < successStreakToExpire) {
    return [];
  }

  const expired: number[] = [];
  const activeAugmentations = repository.listActiveAugmentations(projectPath, jobType, now);
  for (const augmentation of activeAugmentations) {
    repository.updateAugmentationStatus(augmentation.id, 'expired', projectPath);
    expired.push(augmentation.id);
  }
  return expired;
}

function enforceAugmentationCap(
  repository: ISessionOutcomeRepository,
  projectPath: string,
  jobType: JobType,
  maxActiveAugmentations: number,
  now: number,
): number[] {
  if (maxActiveAugmentations < 1) {
    return repository.listActiveAugmentations(projectPath, jobType, now).map((augmentation) => {
      repository.updateAugmentationStatus(augmentation.id, 'expired', projectPath);
      return augmentation.id;
    });
  }

  const activeAugmentations = repository.listActiveAugmentations(projectPath, jobType, now);
  if (activeAugmentations.length <= maxActiveAugmentations) {
    return [];
  }

  const activePatterns = repository.listPatterns({
    jobType,
    projectPath,
    status: 'active',
    limit: 100,
  });
  const confidenceByPatternId = new Map(
    activePatterns.map((pattern) => [pattern.id, pattern.confidence]),
  );
  const keepIds = new Set(
    activeAugmentations
      .slice()
      .sort((left, right) => {
        const leftConfidence =
          left.patternId == null ? 0 : (confidenceByPatternId.get(left.patternId) ?? 0);
        const rightConfidence =
          right.patternId == null ? 0 : (confidenceByPatternId.get(right.patternId) ?? 0);
        if (leftConfidence !== rightConfidence) {
          return rightConfidence - leftConfidence;
        }
        if (left.createdAt !== right.createdAt) {
          return right.createdAt - left.createdAt;
        }
        return right.id - left.id;
      })
      .slice(0, maxActiveAugmentations)
      .map((augmentation) => augmentation.id),
  );

  const expired: number[] = [];
  for (const augmentation of activeAugmentations) {
    if (!keepIds.has(augmentation.id)) {
      repository.updateAugmentationStatus(augmentation.id, 'expired', projectPath);
      expired.push(augmentation.id);
    }
  }
  return expired;
}

function findActiveAugmentationForPattern(
  repository: ISessionOutcomeRepository,
  projectPath: string,
  jobType: JobType,
  patternId: number,
  now: number,
): IPromptAugmentation | null {
  return (
    repository
      .listActiveAugmentations(projectPath, jobType, now)
      .find((augmentation) => augmentation.patternId === patternId) ?? null
  );
}

export function analyzeFeedbackOutcome(
  repository: ISessionOutcomeRepository,
  outcome: ISessionOutcome,
  options: IFeedbackPatternAnalysisOptions = {},
): IFeedbackPatternAnalysisResult {
  const now = options.now ?? outcome.finishedAt ?? Date.now();
  const expiredAugmentationIds = expireStaleAugmentations(
    repository,
    outcome.projectPath,
    outcome.jobType,
    now,
  );

  if (!isFailureOutcome(outcome) || !outcome.failureSignature || !outcome.failureCategory) {
    expiredAugmentationIds.push(
      ...expireAugmentationsAfterSuccessStreak(
        repository,
        outcome.projectPath,
        outcome.jobType,
        options.successStreakToExpire ?? DEFAULT_SUCCESS_STREAK_TO_EXPIRE,
        now,
      ),
    );
    return { augmentation: null, expiredAugmentationIds, pattern: null };
  }

  const existingPattern =
    repository
      .listPatterns({
        jobType: outcome.jobType,
        projectPath: outcome.projectPath,
        limit: 100,
      })
      .find((pattern) => pattern.patternKey === outcome.failureSignature) ?? null;
  const sampleCount = (existingPattern?.sampleCount ?? 0) + 1;
  const streakStats = countRecentStreaks(repository, outcome);
  const confidence = calculateConfidence(
    sampleCount,
    outcome.finishedAt,
    streakStats.failureStreak,
    streakStats.signatureStreak,
    now,
  );
  const status =
    confidence >= (options.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD)
      ? 'active'
      : (existingPattern?.status ?? 'observing');

  const pattern = repository.upsertPattern({
    category: outcome.failureCategory,
    confidence,
    description: buildPatternDescription(outcome, sampleCount),
    jobType: outcome.jobType,
    lastSeenAt: outcome.finishedAt,
    metadata: {
      confidenceInputs: {
        failureStreak: streakStats.failureStreak,
        recencyScore: calculateRecencyScore(now, outcome.finishedAt),
        sampleCount,
        signatureStreak: streakStats.signatureStreak,
      },
      failureSignature: outcome.failureSignature,
      fileArea: getFileArea(outcome),
      firstErrorLine: getStringMetadata(outcome.metadata, 'firstErrorLine'),
      lastOutcomeId: outcome.id,
    },
    patternKey: outcome.failureSignature,
    projectPath: outcome.projectPath,
    sampleCount,
    status,
    title: buildPatternTitle(outcome),
  });

  let augmentation: IPromptAugmentation | null = null;
  if (pattern.status === 'active') {
    augmentation = findActiveAugmentationForPattern(
      repository,
      outcome.projectPath,
      outcome.jobType,
      pattern.id,
      now,
    );

    if (!augmentation) {
      augmentation = repository.createAugmentation({
        expiresAt: now + (options.augmentationTtlMs ?? DEFAULT_AUGMENTATION_TTL_MS),
        jobType: outcome.jobType,
        patternId: pattern.id,
        projectPath: outcome.projectPath,
        promptText: buildAugmentationPrompt(pattern, outcome),
        status: 'active',
      });
    }
  }

  expiredAugmentationIds.push(
    ...enforceAugmentationCap(
      repository,
      outcome.projectPath,
      outcome.jobType,
      options.maxActiveAugmentations ?? DEFAULT_MAX_ACTIVE_AUGMENTATIONS,
      now,
    ),
  );

  return { augmentation, expiredAugmentationIds, pattern };
}
