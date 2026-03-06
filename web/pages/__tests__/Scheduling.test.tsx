import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { INightWatchConfig, IScheduleInfo } from '../../api';
import Scheduling from '../Scheduling';

const apiMocks = vi.hoisted(() => ({
  fetchConfig: vi.fn(),
  fetchScheduleInfo: vi.fn(),
  updateConfig: vi.fn(),
  triggerInstallCron: vi.fn(),
  triggerUninstallCron: vi.fn(),
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
  updateConfig: apiMocks.updateConfig,
  triggerInstallCron: apiMocks.triggerInstallCron,
  triggerUninstallCron: apiMocks.triggerUninstallCron,
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

describe('Scheduling page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentConfig = makeConfig();
    currentScheduleInfo = makeScheduleInfo();
    apiMocks.updateConfig.mockResolvedValue(currentConfig);
    apiMocks.triggerInstallCron.mockResolvedValue({ started: true });
    apiMocks.triggerUninstallCron.mockResolvedValue({ started: true });
  });

  it('shows schedule bundle and bundle-aware labels when template matches', () => {
    render(<Scheduling />);

    expect(screen.getByText('Schedule Bundle')).toBeInTheDocument();
    expect(screen.getByText('Always On (Recommended)')).toBeInTheDocument();
    expect(screen.getByText('Always On (Recommended) • Every 3h at :05')).toBeInTheDocument();
  });

  it('falls back to generic cron labels when schedules are mixed/custom', () => {
    currentConfig = makeConfig({
      reviewerSchedule: '0 * * * *',
    });
    currentScheduleInfo = makeScheduleInfo({
      reviewer: {
        schedule: '0 * * * *',
        installed: true,
        nextRun: '2026-03-06T01:00:00.000Z',
      },
    });

    render(<Scheduling />);

    expect(screen.queryByText('Schedule Bundle')).not.toBeInTheDocument();
    expect(screen.getByText('Balanced (recommended)')).toBeInTheDocument();
  });

  it('keeps bundle labeling when matching cron values include extra whitespace', () => {
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
      },
      reviewer: {
        schedule: currentConfig.reviewerSchedule,
        installed: true,
        nextRun: '2026-03-06T00:25:00.000Z',
      },
    });

    render(<Scheduling />);

    expect(screen.getByText('Schedule Bundle')).toBeInTheDocument();
    expect(screen.getByText('Always On (Recommended) • Every 3h at :05')).toBeInTheDocument();
  });

  it('saves edited schedules and reinstalls cron', async () => {
    render(<Scheduling />);

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

  it('shows effective schedules and offset note when cronScheduleOffset is active', () => {
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

    render(<Scheduling />);

    expect(screen.getAllByText(/Delayed after cron fire:/)).not.toHaveLength(0);
    expect(screen.getAllByText(/manual \+30m/)).not.toHaveLength(0);
    expect(screen.getByText('Always On (Recommended) • Every 3h at :05')).toBeInTheDocument();
    expect(screen.getByText('5 */3 * * *')).toBeInTheDocument();
  });

  it('warns and refetches when cron reinstall fails after saving schedules', async () => {
    apiMocks.triggerInstallCron.mockRejectedValue(new Error('cron install failed'));

    render(<Scheduling />);

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

  it('warns and refetches when a job toggle saves but cron reinstall fails', async () => {
    apiMocks.triggerInstallCron.mockRejectedValue(new Error('cron install failed'));

    render(<Scheduling />);

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
});
