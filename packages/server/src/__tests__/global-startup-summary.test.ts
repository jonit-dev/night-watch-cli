import { describe, expect, it } from 'vitest';

import type { INightWatchConfig, ISessionOutcomeSummary } from '@night-watch/core/types.js';
import type { IRegistryEntry } from '@night-watch/core/utils/registry.js';
import type { IStatusSnapshot } from '@night-watch/core/utils/status-data.js';

import {
  buildProjectStartupSummary,
  formatProjectStartupSummaryLine,
} from '../global-startup-summary.js';
import type { IProjectStartupSummary } from '../global-startup-summary.js';

function makeConfig(overrides: Partial<INightWatchConfig> = {}): INightWatchConfig {
  return {
    executorEnabled: true,
    pausedJobs: {},
    provider: 'codex',
    ...overrides,
  } as INightWatchConfig;
}

function makeSnapshot(overrides: Partial<IStatusSnapshot> = {}): IStatusSnapshot {
  return {
    activePrd: null,
    config: makeConfig(),
    crontab: { entries: [], installed: true },
    logs: [],
    processes: [{ name: 'executor', pid: null, running: false }],
    projectDir: '/work/project',
    projectName: 'project',
    prds: [
      { dependencies: [], name: 'ready-one', status: 'ready', unmetDependencies: [] },
      { dependencies: [], name: 'done-one', status: 'done', unmetDependencies: [] },
    ],
    prs: [
      {
        branch: 'night-watch/one',
        ciStatus: 'fail',
        labels: [],
        number: 1,
        reviewScore: null,
        title: 'one',
        url: 'https://example.com/1',
      },
      {
        branch: 'night-watch/two',
        ciStatus: 'pending',
        labels: [],
        number: 2,
        reviewScore: null,
        title: 'two',
        url: 'https://example.com/2',
      },
    ],
    timestamp: new Date(),
    ...overrides,
  };
}

function makeOutcomeSummary(
  overrides: Partial<ISessionOutcomeSummary> = {},
): ISessionOutcomeSummary {
  return {
    averageDurationSeconds: null,
    byFailureCategory: {},
    byOutcome: {},
    failureCount: 1,
    rateLimitedCount: 0,
    skippedCount: 0,
    successCount: 3,
    timeoutCount: 0,
    totalCount: 4,
    ...overrides,
  };
}

describe('global startup summary', () => {
  it('builds compact project metrics from a snapshot and recent outcomes', () => {
    const entry: IRegistryEntry = { name: 'project', path: '/work/project' };

    const summary = buildProjectStartupSummary(
      entry,
      makeConfig(),
      makeSnapshot(),
      makeOutcomeSummary(),
    );

    expect(summary).toMatchObject({
      cronInstalled: true,
      failedPrs: 1,
      failureRate: 25,
      name: 'project',
      openPrs: 2,
      path: '/work/project',
      pendingPrs: 1,
      provider: 'codex',
      readyPrds: 1,
      runningProcesses: [],
      status: 'active',
    });
  });

  it('marks a project as running when any watched process is active', () => {
    const summary = buildProjectStartupSummary(
      { name: 'project', path: '/work/project' },
      makeConfig({ executorEnabled: false, pausedJobs: { executor: true } }),
      makeSnapshot({ processes: [{ name: 'reviewer', pid: 42, running: true }] }),
      makeOutcomeSummary({ totalCount: 0 }),
    );

    expect(summary.status).toBe('running');
    expect(summary.failureRate).toBeNull();
    expect(summary.runningProcesses).toEqual(['reviewer']);
  });

  it('formats a readable one-line summary without color when requested', () => {
    const line = formatProjectStartupSummaryLine(
      {
        cronInstalled: false,
        failedPrs: 1,
        failureRate: null,
        name: 'project',
        openPrs: 2,
        path: '/work/project',
        pendingPrs: 1,
        provider: 'codex',
        readyPrds: 3,
        runningProcesses: [],
        status: 'paused',
      },
      { color: false },
    );

    expect(line).toBe(
      '  ○ paused  project ready 3 PRs 2 (1 fail, 1 pending) fail n/a provider codex cron off /work/project',
    );
  });

  it('formats per-project startup errors without throwing', () => {
    const summary: IProjectStartupSummary = {
      cronInstalled: false,
      failedPrs: 0,
      failureRate: null,
      name: 'broken',
      openPrs: 0,
      path: '/missing/project',
      pendingPrs: 0,
      provider: 'n/a',
      readyPrds: 0,
      runningProcesses: [],
      status: 'error',
      error: 'night-watch.config.json not found',
    };

    expect(formatProjectStartupSummaryLine(summary, { color: false })).toBe(
      '  x error broken night-watch.config.json not found /missing/project',
    );
  });
});
