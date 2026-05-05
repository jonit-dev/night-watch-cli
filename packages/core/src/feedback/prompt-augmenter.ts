/**
 * Prompt augmentation helpers for active project feedback snippets.
 */

import type { ISessionOutcomeRepository } from '@/storage/repositories/interfaces.js';
import type { IPromptAugmentation, JobType } from '@/types.js';

const DEFAULT_MAX_ACTIVE_AUGMENTATIONS = 3;
const MAX_SNIPPET_LENGTH = 260;
const DISABLED_VALUES = new Set(['0', 'false', 'no', 'off', 'disabled']);

export interface IPromptAugmenterOptions {
  feedbackEnabled?: boolean;
  markApplied?: boolean;
  maxActiveAugmentations?: number;
  now?: number;
}

export interface IProjectFeedbackPromptResult {
  augmentationIds: number[];
  promptBlock: string;
}

function isActiveAt(augmentation: IPromptAugmentation, now: number): boolean {
  return (
    augmentation.status === 'active' &&
    (augmentation.expiresAt == null || augmentation.expiresAt > now)
  );
}

function normalizeMaxActive(value: number | undefined): number {
  if (value == null || !Number.isFinite(value)) {
    return DEFAULT_MAX_ACTIVE_AUGMENTATIONS;
  }
  return Math.max(0, Math.floor(value));
}

function truncateSnippet(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= MAX_SNIPPET_LENGTH) {
    return normalized;
  }
  return `${normalized.slice(0, MAX_SNIPPET_LENGTH - 3).trimEnd()}...`;
}

export function isFeedbackPromptEnabled(): boolean {
  const raw = process.env.NW_FEEDBACK_ENABLED ?? process.env.NW_FEEDBACK_PROMPT_ENABLED;
  if (!raw) {
    return true;
  }
  return !DISABLED_VALUES.has(raw.trim().toLowerCase());
}

export function selectPromptAugmentations(
  augmentations: IPromptAugmentation[],
  options: IPromptAugmenterOptions = {},
): IPromptAugmentation[] {
  if (options.feedbackEnabled === false) {
    return [];
  }

  const now = options.now ?? Date.now();
  const maxActive = normalizeMaxActive(options.maxActiveAugmentations);
  if (maxActive === 0) {
    return [];
  }

  return augmentations
    .filter((augmentation) => isActiveAt(augmentation, now))
    .sort((left, right) => {
      if (left.createdAt !== right.createdAt) {
        return left.createdAt - right.createdAt;
      }
      return left.id - right.id;
    })
    .slice(0, maxActive);
}

export function renderProjectFeedbackBlock(
  augmentations: IPromptAugmentation[],
  options: IPromptAugmenterOptions = {},
): string {
  const selected = selectPromptAugmentations(augmentations, options);
  if (selected.length === 0) {
    return '';
  }

  const lines = [
    '## Project Feedback',
    'The following short notes come from repeated recent Night Watch failures. Treat them as targeted guardrails, not as replacements for the main task instructions.',
    '',
    ...selected.map((augmentation) => `- ${truncateSnippet(augmentation.promptText)}`),
  ];

  return lines.join('\n');
}

export function buildProjectFeedbackPromptBlock(
  repository: ISessionOutcomeRepository,
  projectPath: string,
  jobType: JobType,
  options: IPromptAugmenterOptions = {},
): IProjectFeedbackPromptResult {
  const enabled = options.feedbackEnabled ?? isFeedbackPromptEnabled();
  if (!enabled) {
    return { augmentationIds: [], promptBlock: '' };
  }

  const now = options.now ?? Date.now();
  const activeAugmentations = repository.listActiveAugmentations(projectPath, jobType, now);
  const selected = selectPromptAugmentations(activeAugmentations, {
    ...options,
    feedbackEnabled: enabled,
    now,
  });
  const promptBlock = renderProjectFeedbackBlock(selected, {
    ...options,
    feedbackEnabled: enabled,
    now,
  });

  if (options.markApplied === true && promptBlock.length > 0) {
    for (const augmentation of selected) {
      repository.incrementAugmentationCounts(augmentation.id);
    }
  }

  return {
    augmentationIds: selected.map((augmentation) => augmentation.id),
    promptBlock,
  };
}
