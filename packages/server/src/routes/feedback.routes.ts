/**
 * Feedback routes: /api/feedback/*
 */

import { Request, Response, Router } from 'express';

import {
  IFeedbackPattern,
  IPromptAugmentation,
  ISessionOutcome,
  ISessionOutcomeSummary,
  JobType,
  PromptAugmentationStatus,
  SessionOutcomeStatus,
  getRepositories,
  getValidJobTypes,
} from '@night-watch/core';

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_DAYS = [7, 30] as const;
const VALID_AUGMENTATION_STATUSES: PromptAugmentationStatus[] = [
  'active',
  'paused',
  'expired',
  'archived',
];

interface IFeedbackRoutesContext {
  getProjectDir: (req: Request) => string;
  pathPrefix: string;
}

interface IFeedbackBreakdownSummary {
  totalCount: number;
  successCount: number;
  failureCount: number;
  timeoutCount: number;
  rateLimitedCount: number;
  skippedCount: number;
  successRate: number | null;
}

interface IFeedbackWindowSummary extends ISessionOutcomeSummary {
  days: number;
  fromFinishedAt: number;
  toFinishedAt: number;
  successRate: number | null;
  byJobType: Record<string, IFeedbackBreakdownSummary>;
  byProvider: Record<string, IFeedbackBreakdownSummary>;
}

interface IFeedbackSummaryResponse {
  projectPath: string;
  windows: {
    last7Days: IFeedbackWindowSummary;
    last30Days: IFeedbackWindowSummary;
  };
  activeAugmentations: IPromptAugmentation[];
}

interface ITopFailurePattern {
  key: string;
  jobType: JobType;
  providerKey: string;
  category: string | null;
  signature: string | null;
  sampleCount: number;
  lastSeenAt: number;
}

interface IFeedbackPatternsResponse {
  projectPath: string;
  patterns: IFeedbackPattern[];
  topFailurePatterns: ITopFailurePattern[];
}

interface IAugmentationPatchBody {
  action?: 'enable' | 'disable' | 'expire';
  enabled?: boolean;
  status?: PromptAugmentationStatus;
}

function emptyBreakdown(): IFeedbackBreakdownSummary {
  return {
    totalCount: 0,
    successCount: 0,
    failureCount: 0,
    timeoutCount: 0,
    rateLimitedCount: 0,
    skippedCount: 0,
    successRate: null,
  };
}

function applyOutcome(summary: IFeedbackBreakdownSummary, outcome: SessionOutcomeStatus): void {
  summary.totalCount += 1;
  if (outcome === 'success') summary.successCount += 1;
  if (outcome === 'failure') summary.failureCount += 1;
  if (outcome === 'timeout') summary.timeoutCount += 1;
  if (outcome === 'rate_limited') summary.rateLimitedCount += 1;
  if (outcome === 'skipped') summary.skippedCount += 1;
}

function finalizeBreakdown(summary: IFeedbackBreakdownSummary): IFeedbackBreakdownSummary {
  return {
    ...summary,
    successRate: summary.totalCount > 0 ? summary.successCount / summary.totalCount : null,
  };
}

function summarizeOutcomesBy(
  outcomes: ISessionOutcome[],
  getKey: (outcome: ISessionOutcome) => string,
): Record<string, IFeedbackBreakdownSummary> {
  const grouped: Record<string, IFeedbackBreakdownSummary> = {};
  for (const outcome of outcomes) {
    const key = getKey(outcome);
    grouped[key] ??= emptyBreakdown();
    applyOutcome(grouped[key], outcome.outcome);
  }

  return Object.fromEntries(
    Object.entries(grouped).map(([key, summary]) => [key, finalizeBreakdown(summary)]),
  );
}

function buildWindowSummary(projectPath: string, days: number): IFeedbackWindowSummary {
  const repo = getRepositories().sessionOutcomes;
  const toFinishedAt = Date.now();
  const fromFinishedAt = toFinishedAt - days * DAY_MS;
  const base = repo.querySummary({ projectPath, fromFinishedAt, toFinishedAt });
  const outcomes = repo.queryOutcomes({ projectPath, fromFinishedAt, toFinishedAt, limit: 500 });

  const byJobType = Object.fromEntries(
    getValidJobTypes()
      .map((jobType) => {
        const summary = repo.querySummary({ projectPath, jobType, fromFinishedAt, toFinishedAt });
        return [
          jobType,
          finalizeBreakdown({
            totalCount: summary.totalCount,
            successCount: summary.successCount,
            failureCount: summary.failureCount,
            timeoutCount: summary.timeoutCount,
            rateLimitedCount: summary.rateLimitedCount,
            skippedCount: summary.skippedCount,
          }),
        ] as const;
      })
      .filter(([, summary]) => summary.totalCount > 0),
  );

  return {
    ...base,
    days,
    fromFinishedAt,
    toFinishedAt,
    successRate: base.totalCount > 0 ? base.successCount / base.totalCount : null,
    byJobType,
    byProvider: summarizeOutcomesBy(outcomes, (outcome) => outcome.providerKey),
  };
}

function getActiveAugmentations(projectPath: string): IPromptAugmentation[] {
  return getRepositories().sessionOutcomes.listAugmentations({
    projectPath,
    status: 'active',
    includeExpired: false,
    limit: 250,
  });
}

function buildFailurePatterns(projectPath: string): ITopFailurePattern[] {
  const outcomes = getRepositories().sessionOutcomes.queryOutcomes({
    projectPath,
    outcome: 'failure',
    limit: 500,
  });
  const patterns = new Map<string, ITopFailurePattern>();

  for (const outcome of outcomes) {
    const key = [
      outcome.jobType,
      outcome.providerKey,
      outcome.failureCategory ?? 'uncategorized',
      outcome.failureSignature ?? 'unknown',
    ].join(':');
    const current = patterns.get(key);
    if (current) {
      current.sampleCount += 1;
      current.lastSeenAt = Math.max(current.lastSeenAt, outcome.finishedAt);
      continue;
    }

    patterns.set(key, {
      key,
      jobType: outcome.jobType,
      providerKey: outcome.providerKey,
      category: outcome.failureCategory,
      signature: outcome.failureSignature,
      sampleCount: 1,
      lastSeenAt: outcome.finishedAt,
    });
  }

  return [...patterns.values()]
    .sort((a, b) => b.sampleCount - a.sampleCount || b.lastSeenAt - a.lastSeenAt)
    .slice(0, 10);
}

function resolveAugmentationStatus(body: IAugmentationPatchBody): PromptAugmentationStatus | null {
  if (body.action === 'enable') return 'active';
  if (body.action === 'disable') return 'paused';
  if (body.action === 'expire') return 'expired';
  if (body.enabled === true) return 'active';
  if (body.enabled === false) return 'paused';
  if (body.status && VALID_AUGMENTATION_STATUSES.includes(body.status)) return body.status;
  return null;
}

function createFeedbackRouteHandlers(ctx: IFeedbackRoutesContext): Router {
  const router = Router({ mergeParams: true });
  const p = ctx.pathPrefix;

  router.get(`/${p}summary`, (req: Request, res: Response): void => {
    try {
      const projectPath = ctx.getProjectDir(req);
      const response: IFeedbackSummaryResponse = {
        projectPath,
        windows: {
          last7Days: buildWindowSummary(projectPath, WINDOW_DAYS[0]),
          last30Days: buildWindowSummary(projectPath, WINDOW_DAYS[1]),
        },
        activeAugmentations: getActiveAugmentations(projectPath),
      };
      res.json(response);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.get(`/${p}patterns`, (req: Request, res: Response): void => {
    try {
      const projectPath = ctx.getProjectDir(req);
      const response: IFeedbackPatternsResponse = {
        projectPath,
        patterns: getRepositories().sessionOutcomes.listPatterns({ projectPath, limit: 25 }),
        topFailurePatterns: buildFailurePatterns(projectPath),
      };
      res.json(response);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.patch(`/${p}augmentations/:id`, (req: Request, res: Response): void => {
    try {
      const id = parseInt(req.params.id as string, 10);
      if (!Number.isInteger(id) || id <= 0) {
        res.status(400).json({ error: 'Invalid augmentation id' });
        return;
      }

      const status = resolveAugmentationStatus(req.body as IAugmentationPatchBody);
      if (!status) {
        res.status(400).json({ error: 'Expected action, enabled, or status update' });
        return;
      }

      const projectPath = ctx.getProjectDir(req);
      const augmentation = getRepositories().sessionOutcomes.updateAugmentationStatus(
        id,
        status,
        projectPath,
      );
      if (!augmentation) {
        res.status(404).json({ error: 'Augmentation not found' });
        return;
      }

      res.json({ augmentation });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  return router;
}

export interface IFeedbackRoutesDeps {
  projectDir: string;
}

export function createFeedbackRoutes(deps: IFeedbackRoutesDeps): Router {
  return createFeedbackRouteHandlers({
    getProjectDir: () => deps.projectDir,
    pathPrefix: '',
  });
}

export function createProjectFeedbackRoutes(): Router {
  return createFeedbackRouteHandlers({
    getProjectDir: (req) => req.projectDir!,
    pathPrefix: 'feedback/',
  });
}
