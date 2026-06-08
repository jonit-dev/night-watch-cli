import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { INightWatchConfig, IQueueAnalytics, IQueueStatus, IScheduleInfo } from '../../api';
import Scheduling from '../Scheduling';

function renderScheduling(initialEntry = '/scheduling') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Scheduling />
    </MemoryRouter>,
  );
}

const apiMocks = vi.hoisted(() => ({
  fetchConfig: vi.fn(),
  fetchScheduleInfo: vi.fn(),
  fetchAllConfigs: vi.fn(),
  updateConfig: vi.fn(),
  triggerInstallCron: vi.fn(),
  triggerUninstallCron: vi.fn(),
  triggerJob: vi.fn(),
  triggerClearQueue: vi.fn(),
  toggleRoadmapScanner: vi.fn(),
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
    cronSchedule: '5 * * * *',
    reviewerSchedule: '25 */3 * * *',
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
      slicerSchedule: '35 */6 * * *',
      slicerMaxRuntime: 600,
      priorityMode: 'roadmap-first',
      issueColumn: 'Ready',
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
      schedule: '45 2,10,18 * * *',
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
      createIssues: false,
      targetColumn: 'Draft',
    },
    optimizer: {
      enabled: false,
      schedule: '20 4 * * 2',
      maxRuntime: 0,
      branchPrefix: 'night-watch/optimizer',
      prLabel: 'optimization',
      targetScope: '',
      maxFindingsToInspect: 5,
      verificationCommand: '',
    },
    ux: {
      enabled: false,
      schedule: '0 7 * * 1',
      maxRuntime: 0,
      targetColumn: 'Draft',
      baseUrl: '',
      startUrl: '',
      flows: [],
      autoInstallPlaywright: true,
      maxIssues: 10,
      reportPrompt: '',
    },
    queue: {
      enabled: true,
      mode: 'conservative' as const,
      maxConcurrency: 1,
      maxWaitTime: 7200,
      priority: {
        executor: 50,
        reviewer: 40,
        slicer: 30,
        manager: 25,
        qa: 20,
        optimizer: 15,
        audit: 10,
      },
      providerBuckets: {},
    },
    analytics: {
      enabled: true,
      schedule: '15 3 * * *',
      maxRuntime: 1800,
      lookbackDays: 30,
      targetColumn: 'Draft',
      analysisPrompt: '',
    },
    feedback: {
      enabled: true,
      confidenceThreshold: 0.75,
      augmentationTtlDays: 14,
      maxActiveAugmentations: 3,
      successStreakToExpire: 3,
    },
    merger: {
      enabled: true,
      schedule: '55 */4 * * *',
      maxRuntime: 1800,
      mergeMethod: 'squash',
      minReviewScore: 80,
      branchPatterns: [],
      rebaseBeforeMerge: true,
      maxPrsPerRun: 0,
      ciPolicy: 'fallback-local',
      localCheckCommand: 'yarn install --frozen-lockfile && yarn verify && yarn test',
    },
    manager: {
      enabled: true,
      schedule: '15 7 * * *',
      maxRuntime: 0,
      authority: 'draft',
      outputMode: 'board-draft',
      targetColumn: 'Draft',
      memoryPath: '.night-watch/manager/memory.md',
      docsDir: '.night-watch/manager/docs',
      weeklySummaryEnabled: true,
      weeklySummaryDay: 1,
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
    feedback: {
      ...base.feedback,
      ...(overrides.feedback ?? {}),
    },
    merger: {
      ...base.merger,
      ...(overrides.merger ?? {}),
    },
    manager: {
      ...base.manager,
      ...(overrides.manager ?? {}),
    },
  };
}

function makeScheduleInfo(overrides: Partial<IScheduleInfo> = {}): IScheduleInfo {
  const base: IScheduleInfo = {
    executor: {
      schedule: '5 * * * *',
      installed: true,
      nextRun: '2026-03-06T00:05:00.000Z',
      delayMinutes: 0,
      manualDelayMinutes: 0,
      balancedDelayMinutes: 0,
    },
    reviewer: {
      schedule: '25 */3 * * *',
      installed: true,
      nextRun: '2026-03-06T00:25:00.000Z',
      delayMinutes: 0,
      manualDelayMinutes: 0,
      balancedDelayMinutes: 0,
    },
    qa: {
      schedule: '45 2,10,18 * * *',
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
      schedule: '35 */6 * * *',
      installed: true,
      nextRun: '2026-03-06T00:35:00.000Z',
      delayMinutes: 0,
      manualDelayMinutes: 0,
      balancedDelayMinutes: 0,
    },
    analytics: {
      schedule: '15 3 * * *',
      installed: true,
      nextRun: '2026-03-06T03:15:00.000Z',
      delayMinutes: 0,
      manualDelayMinutes: 0,
      balancedDelayMinutes: 0,
    },
    merger: {
      schedule: '55 */4 * * *',
      installed: true,
      nextRun: '2026-03-06T00:55:00.000Z',
      delayMinutes: 0,
      manualDelayMinutes: 0,
      balancedDelayMinutes: 0,
    },
    manager: {
      schedule: '15 7 * * *',
      installed: true,
      nextRun: '2026-03-06T07:15:00.000Z',
      delayMinutes: 0,
      manualDelayMinutes: 0,
      balancedDelayMinutes: 0,
    },
    paused: false,
    schedulingPriority: 3,
    entries: ['5 * * * * cd /tmp && night-watch run >> /tmp/executor.log 2>&1'],
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
  triggerJob: apiMocks.triggerJob,
  triggerClearQueue: apiMocks.triggerClearQueue,
  toggleRoadmapScanner: apiMocks.toggleRoadmapScanner,
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

describe('Scheduling (Automation) page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentConfig = makeConfig();
    currentScheduleInfo = makeScheduleInfo();
    apiMocks.updateConfig.mockResolvedValue(currentConfig);
    apiMocks.triggerInstallCron.mockResolvedValue({ started: true });
    apiMocks.triggerUninstallCron.mockResolvedValue({ started: true });
    apiMocks.toggleRoadmapScanner.mockResolvedValue(currentConfig);
    apiMocks.fetchAllConfigs.mockResolvedValue([]);
    apiMocks.fetchQueueStatus.mockResolvedValue(makeQueueStatus());
    apiMocks.fetchQueueAnalytics.mockResolvedValue(makeQueueAnalytics());
  });

  it('renders with Overview, Schedules, and Jobs tabs', async () => {
    renderScheduling();

    await waitFor(() => {
      expect(screen.getByText('Automation')).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: 'Overview' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Schedules' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Jobs' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Queue' })).not.toBeInTheDocument();
  });

  it('keeps automation controls on Overview', async () => {
    renderScheduling();

    await waitFor(() => {
      expect(screen.getByText('Automation Controls')).toBeInTheDocument();
    });

    expect(screen.getByLabelText('Scheduling Priority')).toBeInTheDocument();
    expect(screen.getByLabelText('Extra Start Delay')).toBeInTheDocument();
    expect(screen.getByText('Always On (Recommended)')).toBeInTheDocument();
  });

  it('shows schedule template picker on Schedules tab and keeps it cadence-only', async () => {
    renderScheduling();

    fireEvent.click(screen.getByRole('button', { name: 'Schedules' }));

    await waitFor(() => {
      expect(screen.getByText('Always On (Recommended)')).toBeInTheDocument();
      expect(screen.queryByText('PRD Executor')).not.toBeInTheDocument();
    });

    expect(screen.queryByLabelText('Scheduling Priority')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Extra Start Delay')).not.toBeInTheDocument();
    expect(screen.queryByText('Global Queue')).not.toBeInTheDocument();
  });

  it('shows custom cron inputs when switching to Custom mode', async () => {
    renderScheduling();

    fireEvent.click(screen.getByRole('button', { name: 'Schedules' }));
    fireEvent.click(screen.getByRole('button', { name: 'Custom' }));

    await waitFor(() => {
      expect(screen.getByText('PRD Executor')).toBeInTheDocument();
      expect(screen.getByText('Manager')).toBeInTheDocument();
    });
  });

  it('shows job configuration accordion on Jobs tab', async () => {
    renderScheduling();

    fireEvent.click(screen.getByRole('button', { name: 'Jobs' }));

    await waitFor(() => {
      expect(screen.getByText('PRD Executor')).toBeInTheDocument();
      expect(screen.getByText('PR Reviewer')).toBeInTheDocument();
      expect(screen.getByText('Manager')).toBeInTheDocument();
    });
  });

  it('opens the targeted job editor from queue actions', async () => {
    apiMocks.fetchQueueStatus.mockResolvedValue(
      makeQueueStatus({
        items: [
          {
            id: 1,
            jobType: 'reviewer',
            priority: 40,
            status: 'pending',
            enqueuedAt: 1_710_000_000,
            dispatchedAt: null,
            projectPath: '/tmp/night-watch',
            projectName: 'Night Watch',
          },
        ],
      }),
    );

    renderScheduling();

    await waitFor(() => {
      expect(screen.getByText('reviewer')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTitle('Configure Job'));

    const reviewerSection = await waitFor(() => {
      const section = document.getElementById('job-section-reviewer');
      expect(section).not.toBeNull();
      return section as HTMLElement;
    });

    await waitFor(() => {
      expect(within(reviewerSection).getByLabelText('Min Review Score')).toBeVisible();
    });
  });

  it('keeps cadence editing out of the Jobs tab', async () => {
    renderScheduling();

    fireEvent.click(screen.getByRole('button', { name: 'Jobs' }));
    fireEvent.click(screen.getByText('Quality Assurance'));

    const qaSection = await waitFor(() => {
      const section = document.getElementById('job-section-qa');
      expect(section).not.toBeNull();
      return section as HTMLElement;
    });

    await waitFor(() => {
      expect(within(qaSection).getByText('Cadence')).toBeVisible();
      expect(within(qaSection).getByRole('button', { name: 'Open Schedules' })).toBeVisible();
    });

    expect(within(qaSection).queryByLabelText('Schedule')).not.toBeInTheDocument();
  });

  it('supports legacy schedule deep links by opening custom schedule editing', async () => {
    renderScheduling('/scheduling?tab=schedules&jobType=qa');

    await waitFor(() => {
      expect(screen.getByText('Quality Assurance')).toBeInTheDocument();
      expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    });
  });

  it('shows unsaved banner when schedules are modified', async () => {
    renderScheduling();

    fireEvent.click(screen.getByRole('button', { name: 'Schedules' }));
    fireEvent.click(screen.getByRole('button', { name: 'Custom' }));

    await waitFor(() => {
      expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    });
  });

  it('saves and reinstalls cron when Save is clicked', async () => {
    renderScheduling();

    fireEvent.click(screen.getByRole('button', { name: 'Schedules' }));
    fireEvent.click(screen.getByRole('button', { name: 'Custom' }));

    await waitFor(() => {
      expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Save/i }));

    await waitFor(() => {
      expect(apiMocks.updateConfig).toHaveBeenCalled();
      expect(apiMocks.triggerInstallCron).toHaveBeenCalled();
    });
  });

  it('maps legacy queue links to the Overview tab', async () => {
    renderScheduling('/scheduling?tab=queue');

    await waitFor(() => {
      expect(screen.getByText('Automation Controls')).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: 'Overview' })).toBeInTheDocument();
  });
});
