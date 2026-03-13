import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { INightWatchConfig, IQueueAnalytics, IQueueStatus, IScheduleInfo } from '../../api';
import Scheduling from '../Scheduling';

function renderScheduling() {
  return render(<MemoryRouter><Scheduling /></MemoryRouter>);
}

const apiMocks = vi.hoisted(() => ({
  fetchConfig: vi.fn(),
  fetchScheduleInfo: vi.fn(),
  fetchAllConfigs: vi.fn(),
  updateConfig: vi.fn(),
  triggerInstallCron: vi.fn(),
  triggerUninstallCron: vi.fn(),
  fetchQueueStatus: vi.fn(),
  fetchQueueAnalytics: vi.fn(),
  refetchConfig: vi.fn(),
  refetchSchedule: vi.fn(),
}));

const storeMocks = vi.hoisted(() => ({
  addToast: vi.fn(),
}));

let currentConfig: INightWatchConfig;
let currentScheduleInfo: IScheduleInfo;

function makeConfig(overrides: Partial<INightWatchConfig> = {}): INightWatchConfig {
  const base: INightWatchConfig = {
    provider: 'claude',
    defaultBranch: 'main',
    prdDir: 'docs/prds',
    branchPrefix: 'night-watch/',
    branchPatterns: ['night-watch/', 'feat/'],
    executorEnabled: true,
    reviewerEnabled: true,
    minReviewScore: 80,
    maxRuntime: 7200,
    reviewerMaxRuntime: 3600,
    maxLogSize: 524288,
    cronSchedule: '5 */3 * * *',
    reviewerSchedule: '25 */6 * * *',
    scheduleBundleId: 'always-on',
    cronScheduleOffset: 0,
    schedulingPriority: 3,
    maxRetries: 3,
    reviewerMaxRetries: 2,
    reviewerRetryDelay: 30,
    reviewerMaxPrsPerRun: 0,
    providerEnv: {},
    notifications: { webhooks: [] },
    prdPriority: [],
    roadmapScanner: {
      enabled: true,
      roadmapPath: 'ROADMAP.md',
      autoScanInterval: 300,
      slicerSchedule: '35 */12 * * *',
      slicerMaxRuntime: 600,
      priorityMode: 'roadmap-first',
      issueColumn: 'Draft',
    },
    templatesDir: '.night-watch/templates',
    boardProvider: { enabled: true, provider: 'github' },
    jobProviders: {},
    autoMerge: false,
    autoMergeMethod: 'squash',
    fallbackOnRateLimit: true,
    claudeModel: 'sonnet',
    qa: {
      enabled: true,
      schedule: '45 2,14 * * *',
      maxRuntime: 3600,
      branchPatterns: [],
      artifacts: 'both',
      skipLabel: 'skip-qa',
      autoInstallPlaywright: true,
    },
    audit: {
      enabled: true,
      schedule: '50 3 * * 1',
      maxRuntime: 1800,
    },
    queue: {
      enabled: true,
      maxConcurrency: 1,
      maxWaitTime: 7200,
      priority: {
        executor: 50,
        reviewer: 40,
        slicer: 30,
        qa: 20,
        audit: 10,
      },
    },
    analytics: {
      enabled: true,
      schedule: '15 3 * * *',
      maxRuntime: 1800,
      lookbackDays: 30,
      targetColumn: 'Draft',
      analysisPrompt: '',
    },
  };

  return {
    ...base,
    ...overrides,
    roadmapScanner: {
      ...base.roadmapScanner,
      ...(overrides.roadmapScanner ?? {}),
    },
    qa: {
      ...base.qa,
      ...(overrides.qa ?? {}),
    },
    audit: {
      ...base.audit,
      ...(overrides.audit ?? {}),
    },
    analytics: {
      ...base.analytics,
      ...(overrides.analytics ?? {}),
    },
  };
}

function makeScheduleInfo(overrides: Partial<IScheduleInfo> = {}): IScheduleInfo {
  const base: IScheduleInfo = {
    executor: {
      schedule: '5 */3 * * *',
      installed: true,
      nextRun: '2026-03-06T00:05:00.000Z',
      delayMinutes: 0,
      manualDelayMinutes: 0,
      balancedDelayMinutes: 0,
    },
    reviewer: {
      schedule: '25 */6 * * *',
      installed: true,
      nextRun: '2026-03-06T00:25:00.000Z',
      delayMinutes: 0,
      manualDelayMinutes: 0,
      balancedDelayMinutes: 0,
    },
    qa: {
      schedule: '45 2,14 * * *',
      installed: true,
      nextRun: '2026-03-06T02:45:00.000Z',
      delayMinutes: 0,
      manualDelayMinutes: 0,
      balancedDelayMinutes: 0,
    },
    audit: {
      schedule: '50 3 * * 1',
      installed: true,
      nextRun: '2026-03-09T03:50:00.000Z',
      delayMinutes: 0,
      manualDelayMinutes: 0,
      balancedDelayMinutes: 0,
    },
    planner: {
      schedule: '35 */12 * * *',
      installed: true,
      nextRun: '2026-03-06T00:35:00.000Z',
      delayMinutes: 0,
      manualDelayMinutes: 0,
      balancedDelayMinutes: 0,
    },
    paused: false,
    schedulingPriority: 3,
    entries: ['5 */3 * * * cd /tmp && night-watch run >> /tmp/executor.log 2>&1'],
  };

  return { ...base, ...overrides };
}

vi.mock('../../api', () => ({
  fetchConfig: apiMocks.fetchConfig,
  fetchScheduleInfo: apiMocks.fetchScheduleInfo,
  fetchAllConfigs: apiMocks.fetchAllConfigs,
  updateConfig: apiMocks.updateConfig,
  triggerInstallCron: apiMocks.triggerInstallCron,
  triggerUninstallCron: apiMocks.triggerUninstallCron,
  fetchQueueStatus: apiMocks.fetchQueueStatus,
  fetchQueueAnalytics: apiMocks.fetchQueueAnalytics,
  useApi: (fetchFn: unknown) => {
    if (fetchFn === apiMocks.fetchConfig) {
      return {
        data: currentConfig,
        loading: false,
        error: null,
        refetch: apiMocks.refetchConfig,
      };
    }
    if (fetchFn === apiMocks.fetchScheduleInfo) {
      return {
        data: currentScheduleInfo,
        loading: false,
        error: null,
        refetch: apiMocks.refetchSchedule,
      };
    }
    return {
      data: null,
      loading: false,
      error: null,
      refetch: vi.fn(),
    };
  },
}));

vi.mock('../../store/useStore', () => ({
  useStore: () => ({
    addToast: storeMocks.addToast,
    selectedProjectId: null,
    globalModeLoading: false,
  }),
}));

function makeQueueStatus(overrides: Partial<IQueueStatus> = {}): IQueueStatus {
  const base: IQueueStatus = {
    enabled: true,
    running: null,
    pending: { total: 0, byType: {}, byProviderBucket: {} },
    items: [],
    averageWaitSeconds: null,
    oldestPendingAge: null,
  };
  return { ...base, ...overrides };
}

function makeQueueAnalytics(overrides: Partial<IQueueAnalytics> = {}): IQueueAnalytics {
  const base: IQueueAnalytics = {
    recentRuns: [],
    byProviderBucket: {},
    averageWaitSeconds: null,
    oldestPendingAge: null,
  };
  return { ...base, ...overrides };
}

describe('Scheduling page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentConfig = makeConfig();
    currentScheduleInfo = makeScheduleInfo();
    apiMocks.updateConfig.mockResolvedValue(currentConfig);
    apiMocks.triggerInstallCron.mockResolvedValue({ started: true });
    apiMocks.triggerUninstallCron.mockResolvedValue({ started: true });
    apiMocks.fetchAllConfigs.mockResolvedValue([]);
    apiMocks.fetchQueueStatus.mockResolvedValue(makeQueueStatus());
    apiMocks.fetchQueueAnalytics.mockResolvedValue(makeQueueAnalytics());
  });

  it('keeps cron controls available after dashboard refresh', async () => {
    renderScheduling();

    // Navigate to the Schedules tab first
    fireEvent.click(screen.getByRole('button', { name: 'Schedules' }));

    // Job Schedules heading is visible in template mode
    expect(screen.getByText('Job Schedules')).toBeInTheDocument();

    // Switch to custom mode to reveal cron inputs
    fireEvent.click(screen.getByRole('button', { name: 'Custom' }));

    // Cron controls are now visible
    expect(screen.getByText('PRD Execution Schedule')).toBeInTheDocument();
    expect(screen.getByText('PR Review Schedule')).toBeInTheDocument();

    // Wait a bit for any async operations
    await waitFor(() => {
      expect(screen.getByText('PRD Execution Schedule')).toBeInTheDocument();
    });

    // Cron controls still present after async ops
    expect(screen.getByText('PRD Execution Schedule')).toBeInTheDocument();
    expect(screen.getByText('Job Schedules')).toBeInTheDocument();
  });
});
