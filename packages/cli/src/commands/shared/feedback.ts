import {
  INightWatchConfig,
  IScriptResult,
  JobType,
  analyzeFeedbackOutcome,
  buildSessionOutcomeInput,
  getRepositories,
  isFeedbackPromptEnabled,
  resolveJobProvider,
} from '@night-watch/core';

export interface IRecordJobOutcomeInput {
  config: INightWatchConfig;
  exitCode: number;
  finishedAt: number;
  jobType: JobType;
  metadata?: Record<string, unknown>;
  minReviewScore?: number;
  projectDir: string;
  providerKey?: string;
  scriptResult?: IScriptResult | null;
  startedAt: number;
  stderr?: string;
  stdout?: string;
}

export function getFeedbackAnalysisOptions(config: INightWatchConfig) {
  const feedback = config.feedback ?? {
    augmentationTtlDays: 14,
    confidenceThreshold: 0.75,
    maxActiveAugmentations: 3,
    successStreakToExpire: 3,
  };
  return {
    augmentationTtlMs: feedback.augmentationTtlDays * 24 * 60 * 60 * 1000,
    confidenceThreshold: feedback.confidenceThreshold,
    maxActiveAugmentations: feedback.maxActiveAugmentations,
    successStreakToExpire: feedback.successStreakToExpire,
  };
}

export function isFeedbackEnabled(config: INightWatchConfig): boolean {
  return config.feedback?.enabled !== false && isFeedbackPromptEnabled();
}

export function recordJobOutcome(input: IRecordJobOutcomeInput): void {
  const repository = getRepositories().sessionOutcomes;
  const storedOutcome = repository.insertOutcome(
    buildSessionOutcomeInput({
      exitCode: input.exitCode,
      finishedAt: input.finishedAt,
      jobType: input.jobType,
      metadata: input.metadata,
      minReviewScore: input.minReviewScore,
      projectPath: input.projectDir,
      providerKey: input.providerKey ?? resolveJobProvider(input.config, input.jobType),
      scriptResult: input.scriptResult,
      startedAt: input.startedAt,
      stderr: input.stderr,
      stdout: input.stdout,
    }),
  );

  if (isFeedbackEnabled(input.config)) {
    analyzeFeedbackOutcome(repository, storedOutcome, getFeedbackAnalysisOptions(input.config));
  }
}
