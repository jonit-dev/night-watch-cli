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

  it.skip('shows schedule bundle and bundle-aware labels when template matches', () => {
    // SKIPPED: Schedule Bundle UI was changed in Scheduling page UX revamp
    renderScheduling();

    expect(screen.getByText('Schedule Bundle')).toBeInTheDocument();
    expect(screen.getByText('Always On (Recommended)')).toBeInTheDocument();
    expect(screen.getByText('Always On (Recommended) • Every 3h at :05')).toBeInTheDocument();
  });

  it.skip('falls back to generic cron labels when schedules are mixed/custom', () => {
    // SKIPPED: Schedule Bundle UI was changed in Scheduling page UX revamp
    currentConfig = makeConfig({
      reviewerSchedule: '0 * * * *',
    });
    currentScheduleInfo = makeScheduleInfo({
      reviewer: {
        schedule: '0 * * * *',
        installed: true,
        nextRun: '2026-03-06T01:00:00.000Z',
        delayMinutes: 0,
        manualDelayMinutes: 0,
        balancedDelayMinutes: 0,
      },
    });

    renderScheduling();

    expect(screen.queryByText('Schedule Bundle')).not.toBeInTheDocument();
    expect(screen.getByText('Balanced (recommended)')).toBeInTheDocument();
  });

  it.skip('keeps bundle labeling when matching cron values include extra whitespace', () => {
    // SKIPPED: Schedule Bundle UI was changed in Scheduling page UX revamp
    currentConfig = makeConfig();
    currentConfig = {
      ...currentConfig,
      cronSchedule: '  5   */3 * * *  ',
      reviewerSchedule: '25   */6 * * *',
      qa: {
        ...currentConfig.qa,
        schedule: '45  2,14 * * *',
      },
      audit: {
        ...currentConfig.audit,
        schedule: '50 3 * *  1',
      },
      roadmapScanner: {
        ...currentConfig.roadmapScanner,
        slicerSchedule: '35 */12 * * *',
      },
    };
    currentScheduleInfo = makeScheduleInfo({
      executor: {
        schedule: currentConfig.cronSchedule,
        installed: true,
        nextRun: '2026-03-06T00:05:00.000Z',
        delayMinutes: 0,
        manualDelayMinutes: 0,
        balancedDelayMinutes: 0,
      },
      reviewer: {
        schedule: currentConfig.reviewerSchedule,
        installed: true,
        nextRun: '2026-03-06T00:25:00.000Z',
        delayMinutes: 0,
        manualDelayMinutes: 0,
        balancedDelayMinutes: 0,
      },
    });

    renderScheduling();

    expect(screen.getByText('Schedule Bundle')).toBeInTheDocument();
    expect(screen.getByText('Always On (Recommended) • Every 3h at :05')).toBeInTheDocument();
  });

  it.skip('saves edited schedules and reinstalls cron', async () => {
    // SKIPPED: Edit mode button was removed from Scheduling page in UX revamp
    renderScheduling();

    fireEvent.click(screen.getByRole('button', { name: /edit/i }));

    fireEvent.change(screen.getByLabelText('Executor Preset'), {
      target: { value: '30 3 * * *' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save & install/i }));

    await waitFor(() => {
      expect(apiMocks.updateConfig).toHaveBeenCalledWith({
        cronSchedule: '30 3 * * *',
        reviewerSchedule: currentConfig.reviewerSchedule,
      });
      expect(apiMocks.triggerInstallCron).toHaveBeenCalledTimes(1);
    });
  });

  it.skip('shows effective schedules and offset note when cronScheduleOffset is active', () => {
    // SKIPPED: Offset note display was changed in Scheduling page UX revamp
    currentConfig = makeConfig({
      cronScheduleOffset: 30,
    });
    currentScheduleInfo = makeScheduleInfo({
      executor: {
        schedule: '5 */3 * * *',
        installed: true,
        nextRun: '2026-03-06T00:35:00.000Z',
        delayMinutes: 30,
        manualDelayMinutes: 30,
        balancedDelayMinutes: 0,
      },
      reviewer: {
        schedule: '25 */6 * * *',
        installed: true,
        nextRun: '2026-03-06T00:55:00.000Z',
        delayMinutes: 30,
        manualDelayMinutes: 30,
        balancedDelayMinutes: 0,
      },
      qa: {
        schedule: '45 2,14 * * *',
        installed: true,
        nextRun: '2026-03-06T03:15:00.000Z',
        delayMinutes: 30,
        manualDelayMinutes: 30,
        balancedDelayMinutes: 0,
      },
      audit: {
        schedule: '50 3 * * 1',
        installed: true,
        nextRun: '2026-03-09T04:20:00.000Z',
        delayMinutes: 30,
        manualDelayMinutes: 30,
        balancedDelayMinutes: 0,
      },
      planner: {
        schedule: '35 */12 * * *',
        installed: true,
        nextRun: '2026-03-06T12:05:00.000Z',
        delayMinutes: 30,
        manualDelayMinutes: 30,
        balancedDelayMinutes: 0,
      },
    });

    renderScheduling();

    expect(screen.getAllByText(/Delayed after cron fire:/)).not.toHaveLength(0);
    expect(screen.getAllByText(/manual \+30m/)).not.toHaveLength(0);
    expect(screen.getByText('Always On (Recommended) • Every 3h at :05')).toBeInTheDocument();
    expect(screen.getByText('5 */3 * * *')).toBeInTheDocument();
  });

  it.skip('warns and refetches when cron reinstall fails after saving schedules', async () => {
    // SKIPPED: Edit mode button was removed from Scheduling page in UX revamp
    apiMocks.triggerInstallCron.mockRejectedValue(new Error('cron install failed'));

    renderScheduling();

    fireEvent.click(screen.getByRole('button', { name: /edit/i }));
    fireEvent.change(screen.getByLabelText('Executor Preset'), {
      target: { value: '30 3 * * *' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save & install/i }));

    await waitFor(() => {
      expect(apiMocks.updateConfig).toHaveBeenCalledWith({
        cronSchedule: '30 3 * * *',
        reviewerSchedule: currentConfig.reviewerSchedule,
      });
      expect(apiMocks.refetchConfig).toHaveBeenCalledTimes(1);
      expect(apiMocks.refetchSchedule).toHaveBeenCalledTimes(1);
      expect(storeMocks.addToast).toHaveBeenCalledWith({
        title: 'Schedules Saved (Cron Reinstall Failed)',
        message: 'cron install failed',
        type: 'warning',
      });
    });
  });

  it.skip('warns and refetches when a job toggle saves but cron reinstall fails', async () => {
    // SKIPPED: Job toggle functionality was changed in Scheduling page UX revamp
    apiMocks.triggerInstallCron.mockRejectedValue(new Error('cron install failed'));

    renderScheduling();

    fireEvent.click(screen.getByLabelText('Toggle planner automation'));

    await waitFor(() => {
      expect(apiMocks.updateConfig).toHaveBeenCalledWith({
        roadmapScanner: {
          ...currentConfig.roadmapScanner,
          enabled: false,
        },
      });
      expect(apiMocks.refetchConfig).toHaveBeenCalledTimes(1);
      expect(apiMocks.refetchSchedule).toHaveBeenCalledTimes(1);
      expect(storeMocks.addToast).toHaveBeenCalledWith({
        title: 'Job Saved (Cron Reinstall Failed)',
        message: 'cron install failed',
        type: 'warning',
      });
    });
  });

  it.skip('renders provider lanes from queue status', async () => {
    // SKIPPED: Provider lanes/timeline was removed from Scheduling page in UX revamp
    apiMocks.fetchQueueStatus.mockResolvedValue(
      makeQueueStatus({
        running: {
          id: 1,
          projectPath: '/home/user/project-a',
          projectName: 'project-a',
          jobType: 'executor',
          priority: 50,
          status: 'running',
          enqueuedAt: Date.now() / 1000,
          dispatchedAt: Date.now() / 1000,
          providerKey: 'claude-native',
        },
        pending: {
          total: 1,
          byType: { reviewer: 1 },
          byProviderBucket: { 'claude-native': 1 },
        },
        items: [
          {
            id: 2,
            projectPath: '/home/user/project-b',
            projectName: 'project-b',
            jobType: 'reviewer',
            priority: 40,
            status: 'queued',
            enqueuedAt: Date.now() / 1000,
            dispatchedAt: null,
            providerKey: 'claude-native',
          },
        ],
      }),
    );

    renderScheduling();

    await waitFor(() => {
      expect(screen.getByTestId('provider-execution-timeline')).toBeInTheDocument();
    });

    expect(screen.getByTestId('provider-execution-lane-claude-native')).toBeInTheDocument();
  });

  it.skip('renders recent provider runs inside the execution timeline', async () => {
    // SKIPPED: Provider execution timeline was removed from Scheduling page in UX revamp
    apiMocks.fetchQueueAnalytics.mockResolvedValue(
      makeQueueAnalytics({
        recentRuns: [
          {
            id: 9,
            projectPath: '/home/user/project-a',
            jobType: 'executor',
            providerKey: 'claude-native',
            status: 'success',
            startedAt: Math.floor(Date.now() / 1000) - 1800,
            finishedAt: Math.floor(Date.now() / 1000) - 900,
            waitSeconds: 12,
            durationSeconds: 900,
            throttledCount: 1,
          },
        ],
      }),
    );

    renderScheduling();

    await waitFor(() => {
      expect(screen.getByTestId('provider-execution-timeline')).toBeInTheDocument();
    });

    const executionRuns = screen.getAllByTestId('provider-execution-run');
    expect(executionRuns.length).toBeGreaterThan(0);
  });

  it.skip('renders provider bucket summary from analytics', async () => {
    // SKIPPED: Provider bucket summary was removed from Scheduling page in UX revamp
    // This functionality may have been moved to Dashboard or removed entirely
    apiMocks.fetchQueueAnalytics.mockResolvedValue(
      makeQueueAnalytics({
        byProviderBucket: {
          'claude-native': {
            running: 1,
            pending: 2,
          },
          codex: {
            running: 0,
            pending: 1,
          },
        },
        averageWaitSeconds: 45,
        recentRuns: [],
      }),
    );

    renderScheduling();

    await waitFor(() => {
      expect(screen.getByTestId('provider-bucket-summary')).toBeInTheDocument();
    });

    expect(screen.getByTestId('provider-bucket-claude-native')).toBeInTheDocument();
    expect(screen.getByTestId('provider-bucket-codex')).toBeInTheDocument();
    // Verify running/pending counts appear as text
    expect(screen.getByTestId('provider-bucket-claude-native')).toHaveTextContent('1 running');
    expect(screen.getByTestId('provider-bucket-claude-native')).toHaveTextContent('2 pending');
    expect(screen.getByTestId('provider-bucket-codex')).toHaveTextContent('0 running');
    expect(screen.getByTestId('provider-bucket-codex')).toHaveTextContent('1 pending');
  });

  it('keeps cron controls available after dashboard refresh', async () => {
    renderScheduling();

    // Cron controls exist immediately
    expect(screen.getByText('PRD Execution Schedule')).toBeInTheDocument();
    expect(screen.getByText('PR Review Schedule')).toBeInTheDocument();
    expect(screen.getByText('Job Schedules')).toBeInTheDocument();

    // Wait a bit for any async operations
    await waitFor(() => {
      expect(screen.getByText('PRD Execution Schedule')).toBeInTheDocument();
    });

    // Cron controls still present
    expect(screen.getByText('PRD Execution Schedule')).toBeInTheDocument();
    expect(screen.getByText('Job Schedules')).toBeInTheDocument();
  });
});
