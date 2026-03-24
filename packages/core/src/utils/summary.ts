/**
 * Summary data aggregator for Night Watch CLI
 * Provides a "morning briefing" combining job runs, PRs, and queue status
 */

import { DEFAULT_SUMMARY_WINDOW_HOURS } from '../constants.js';
import type { IJobRunAnalytics, IQueueEntry } from '../types.js';
import type { IPrInfo } from './status-data.js';
import { collectPrInfo } from './status-data.js';
import { getJobRunsAnalytics, getQueueStatus } from './job-queue.js';

/**
 * Counts of job runs by status
 */
export interface IJobRunCounts {
  total: number;
  succeeded: number;
  failed: number;
  timedOut: number;
  rateLimited: number;
  skipped: number;
}

/**
 * Aggregated summary data for the morning briefing
 */
export interface ISummaryData {
  /** Time window in hours */
  windowHours: number;
  /** Recent job runs within the window */
  jobRuns: IJobRunAnalytics['recentRuns'];
  /** Counts by status */
  counts: IJobRunCounts;
  /** Open PRs matching branch patterns */
  openPrs: IPrInfo[];
  /** Pending queue items */
  pendingQueueItems: IQueueEntry[];
  /** Actionable suggestions for the user */
  actionItems: string[];
}

/**
 * Compute counts by filtering recent runs by status
 */
function computeCounts(runs: IJobRunAnalytics['recentRuns']): IJobRunCounts {
  const counts: IJobRunCounts = {
    total: runs.length,
    succeeded: 0,
    failed: 0,
    timedOut: 0,
    rateLimited: 0,
    skipped: 0,
  };

  for (const run of runs) {
    switch (run.status) {
      case 'success':
        counts.succeeded++;
        break;
      case 'failure':
        counts.failed++;
        break;
      case 'timeout':
        counts.timedOut++;
        break;
      case 'rate_limited':
        counts.rateLimited++;
        break;
      case 'skipped':
        counts.skipped++;
        break;
    }
  }

  return counts;
}

/**
 * Build action items based on failed jobs and failing CI PRs
 */
function buildActionItems(
  counts: IJobRunCounts,
  prs: IPrInfo[],
  pendingItems: IQueueEntry[],
): string[] {
  const items: string[] = [];

  // Failed jobs
  if (counts.failed > 0) {
    items.push(
      `${counts.failed} failed job${counts.failed > 1 ? 's' : ''} — run \`night-watch logs\` to investigate`,
    );
  }

  // Timed out jobs
  if (counts.timedOut > 0) {
    items.push(
      `${counts.timedOut} timed out job${counts.timedOut > 1 ? 's' : ''} — check logs for details`,
    );
  }

  // Rate limited jobs
  if (counts.rateLimited > 0) {
    items.push(
      `${counts.rateLimited} rate-limited job${counts.rateLimited > 1 ? 's' : ''} — consider adjusting schedule`,
    );
  }

  // PRs with failing CI
  const failingCiPrs = prs.filter((pr) => pr.ciStatus === 'fail');
  for (const pr of failingCiPrs) {
    items.push(`PR #${pr.number} has failing CI — check ${pr.url}`);
  }

  // PRs marked ready-to-merge
  const readyToMergePrs = prs.filter((pr) => pr.labels.includes('ready-to-merge'));
  if (readyToMergePrs.length > 0) {
    items.push(
      `${readyToMergePrs.length} PR${readyToMergePrs.length > 1 ? 's' : ''} marked ready-to-merge — review and merge`,
    );
  }

  // Pending queue items (informational)
  if (pendingItems.length > 0) {
    const jobTypes = [...new Set(pendingItems.map((item) => item.jobType))];
    items.push(
      `${pendingItems.length} job${pendingItems.length > 1 ? 's' : ''} pending in queue (${jobTypes.join(', ')})`,
    );
  }

  return items;
}

/**
 * Get aggregated summary data for the "morning briefing"
 *
 * @param projectDir - Absolute path to the project directory
 * @param windowHours - Time window in hours (default: 12)
 * @param branchPatterns - Branch patterns to filter PRs
 * @returns Aggregated summary data
 */
export async function getSummaryData(
  projectDir: string,
  windowHours = DEFAULT_SUMMARY_WINDOW_HOURS,
  branchPatterns: string[] = [],
): Promise<ISummaryData> {
  // Get job runs analytics
  const analytics = getJobRunsAnalytics(windowHours);
  const jobRuns = analytics.recentRuns;
  const counts = computeCounts(jobRuns);

  // Get open PRs
  const openPrs = await collectPrInfo(projectDir, branchPatterns);

  // Get queue status
  const queueStatus = getQueueStatus();
  const pendingQueueItems = queueStatus.items.filter((item) => item.status === 'pending');

  // Build action items
  const actionItems = buildActionItems(counts, openPrs, pendingQueueItems);

  return {
    windowHours,
    jobRuns,
    counts,
    openPrs,
    pendingQueueItems,
    actionItems,
  };
}
