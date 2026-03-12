import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { INightWatchConfig, IRoadmapScannerConfig } from '../../api';
import Settings from '../Settings';

function renderSettings() {
  return render(<MemoryRouter><Settings /></MemoryRouter>);
}

const apiMocks = vi.hoisted(() => ({
  fetchConfig: vi.fn(),
  fetchDoctor: vi.fn(),
  fetchAllConfigs: vi.fn(),
  updateConfig: vi.fn(),
  triggerInstallCron: vi.fn(),
  toggleRoadmapScanner: vi.fn(),
  refetchConfig: vi.fn(),
  refetchDoctor: vi.fn(),
}));

const storeMocks = vi.hoisted(() => ({
  addToast: vi.fn(),
}));

let currentConfig: INightWatchConfig;

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

vi.mock('../../api', () => ({
  fetchConfig: apiMocks.fetchConfig,
  fetchDoctor: apiMocks.fetchDoctor,
  fetchAllConfigs: apiMocks.fetchAllConfigs,
  updateConfig: apiMocks.updateConfig,
  triggerInstallCron: apiMocks.triggerInstallCron,
  toggleRoadmapScanner: apiMocks.toggleRoadmapScanner,
  useApi: (fetchFn: unknown) => {
    if (fetchFn === apiMocks.fetchConfig) {
      return {
        data: currentConfig,
        loading: false,
        error: null,
        refetch: apiMocks.refetchConfig,
      };
    }
    if (fetchFn === apiMocks.fetchDoctor) {
      return {
        data: [],
        loading: false,
        error: null,
        refetch: apiMocks.refetchDoctor,
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
    projectName: 'Night Watch',
    selectedProjectId: null,
    globalModeLoading: false,
  }),
}));

describe('Settings schedules mode sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentConfig = makeConfig();
    apiMocks.updateConfig.mockResolvedValue(currentConfig);
    apiMocks.triggerInstallCron.mockResolvedValue({ started: true });
    apiMocks.toggleRoadmapScanner.mockResolvedValue(currentConfig);
    apiMocks.fetchAllConfigs.mockResolvedValue([]);
  });

  it('initializes schedule tab in template mode for a known bundle', async () => {
    renderSettings();

    fireEvent.click(screen.getByRole('button', { name: 'Schedules' }));

    await waitFor(() => {
      expect(screen.getByText('Always On (Recommended)')).toBeInTheDocument();
      expect(screen.queryByText('PRD Execution Schedule')).not.toBeInTheDocument();
    });
  });

  it('switches to custom mode when config reload no longer matches a template', async () => {
    const { rerender } = renderSettings();
    fireEvent.click(screen.getByRole('button', { name: 'Schedules' }));

    await waitFor(() => {
      expect(screen.getByText('Always On (Recommended)')).toBeInTheDocument();
    });

    currentConfig = makeConfig({
      reviewerSchedule: '0 * * * *',
    });
    rerender(<MemoryRouter><Settings /></MemoryRouter>);

    await waitFor(() => {
      expect(screen.getByText('PRD Execution Schedule')).toBeInTheDocument();
      expect(screen.queryByText('Night Surge')).not.toBeInTheDocument();
    });
  });

  it('persists scheduleBundleId when saving in template mode', async () => {
    renderSettings();

    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => {
      expect(apiMocks.updateConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          scheduleBundleId: 'always-on',
        }),
      );
    });
  });

  it('clears scheduleBundleId when switching to custom mode and saving', async () => {
    renderSettings();

    fireEvent.click(screen.getByRole('button', { name: 'Schedules' }));
    fireEvent.click(screen.getByRole('button', { name: 'Custom' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => {
      expect(apiMocks.updateConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          scheduleBundleId: null,
        }),
      );
    });
  });

  it('recomputes template mode after reset', async () => {
    renderSettings();

    fireEvent.click(screen.getByRole('button', { name: 'Schedules' }));
    fireEvent.click(screen.getByRole('button', { name: 'Custom' }));

    await waitFor(() => {
      expect(screen.getByText('PRD Execution Schedule')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));

    await waitFor(() => {
      expect(screen.getByText('Always On (Recommended)')).toBeInTheDocument();
      expect(screen.queryByText('PRD Execution Schedule')).not.toBeInTheDocument();
    });
  });

  it('rebinds scheduleBundleId when switching back to template mode', async () => {
    renderSettings();

    fireEvent.click(screen.getByRole('button', { name: 'Schedules' }));
    fireEvent.click(screen.getByRole('button', { name: 'Custom' }));
    fireEvent.click(screen.getByRole('button', { name: 'Template' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => {
      expect(apiMocks.updateConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          scheduleBundleId: 'always-on',
        }),
      );
    });
  });

  it('reinstalls cron when planner is toggled from settings', async () => {
    const disabledConfig = makeConfig({
      roadmapScanner: {
        enabled: false,
        roadmapPath: 'ROADMAP.md',
        autoScanInterval: 300,
        slicerSchedule: '35 */6 * * *',
        slicerMaxRuntime: 600,
        priorityMode: 'roadmap-first',
        issueColumn: 'Draft',
      },
    });
    apiMocks.toggleRoadmapScanner.mockResolvedValue(disabledConfig);

    renderSettings();

    fireEvent.click(screen.getByRole('button', { name: 'Jobs' }));
    fireEvent.click(screen.getByLabelText('Enable planner'));

    await waitFor(() => {
      expect(apiMocks.toggleRoadmapScanner).toHaveBeenCalledWith(false);
      expect(apiMocks.triggerInstallCron).toHaveBeenCalledTimes(1);
      expect(storeMocks.addToast).toHaveBeenCalledWith({
        title: 'Roadmap Scanner Disabled',
        message: 'Roadmap scanner has been disabled.',
        type: 'success',
      });
    });
  });

  it('shows a warning when planner toggle saves but cron reinstall fails', async () => {
    const disabledConfig = makeConfig({
      roadmapScanner: {
        enabled: false,
        roadmapPath: 'ROADMAP.md',
        autoScanInterval: 300,
        slicerSchedule: '35 */6 * * *',
        slicerMaxRuntime: 600,
        priorityMode: 'roadmap-first',
        issueColumn: 'Draft',
      },
    });
    apiMocks.toggleRoadmapScanner.mockResolvedValue(disabledConfig);
    apiMocks.triggerInstallCron.mockRejectedValue(new Error('cron install failed'));

    renderSettings();

    fireEvent.click(screen.getByRole('button', { name: 'Jobs' }));
    fireEvent.click(screen.getByLabelText('Enable planner'));

    await waitFor(() => {
      expect(apiMocks.toggleRoadmapScanner).toHaveBeenCalledWith(false);
      expect(apiMocks.triggerInstallCron).toHaveBeenCalledTimes(1);
      expect(storeMocks.addToast).toHaveBeenCalledWith({
        title: 'Planner Saved (Cron Reinstall Failed)',
        message: 'cron install failed',
        type: 'warning',
      });
    });
  });

  it('shows rate limit fallback preset selectors in AI & Runtime tab', async () => {
    currentConfig = makeConfig({ provider: 'codex' });

    renderSettings();
    fireEvent.click(screen.getByRole('button', { name: 'AI & Runtime' }));

    await waitFor(() => {
      expect(screen.getByText(/Rate Limit Fallback/i)).toBeInTheDocument();
      expect(screen.getAllByText(/Primary Fallback Preset/i).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/Secondary Fallback Preset/i).length).toBeGreaterThan(0);
    });
  });

  it('clears a reviewer provider override when switching back to global', async () => {
    currentConfig = makeConfig({
      jobProviders: { reviewer: 'codex' },
    });
    apiMocks.updateConfig.mockImplementation(async (changes) => {
      currentConfig = makeConfig({
        jobProviders: changes.jobProviders ?? {},
      });
      return currentConfig;
    });

    renderSettings();
    fireEvent.click(screen.getByRole('button', { name: 'AI & Runtime' }));

    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[2], { target: { value: '' } });

    await waitFor(() => {
      expect(apiMocks.updateConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          jobProviders: { reviewer: null },
        }),
      );
    });

    await waitFor(() => {
      expect((screen.getAllByRole('combobox')[2] as HTMLSelectElement).value).toBe('');
    });
  });
});
