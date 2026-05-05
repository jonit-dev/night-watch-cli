import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { INightWatchConfig } from '../../api';
import Settings from '../Settings';

const apiMocks = vi.hoisted(() => ({
  fetchConfig: vi.fn(),
  fetchDoctor: vi.fn(),
  fetchGlobalNotifications: vi.fn(),
  updateConfig: vi.fn(),
  triggerInstallCron: vi.fn(),
  removeProject: vi.fn(),
  updateGlobalNotifications: vi.fn(),
  refetchConfig: vi.fn(),
  refetchDoctor: vi.fn(),
}));

let currentConfig: INightWatchConfig;

function makeConfig(overrides: Partial<INightWatchConfig> = {}): INightWatchConfig {
  const base: INightWatchConfig = {
    provider: 'claude',
    defaultBranch: 'main',
    prdDir: 'docs/prds',
    branchPrefix: 'night-watch/',
    branchPatterns: ['night-watch/'],
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
      targetColumn: 'Draft',
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
        qa: 20,
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
    prResolver: {
      enabled: true,
      schedule: '10 */4 * * *',
      maxRuntime: 1800,
      perPrTimeout: 600,
      maxPrsPerRun: 0,
      readyLabel: 'ready',
      branchPatterns: [],
      aiConflictResolution: true,
      aiReviewResolution: true,
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
    },
  };

  return { ...base, ...overrides };
}

vi.mock('../../api', () => ({
  fetchConfig: apiMocks.fetchConfig,
  fetchDoctor: apiMocks.fetchDoctor,
  fetchGlobalNotifications: apiMocks.fetchGlobalNotifications,
  updateConfig: apiMocks.updateConfig,
  triggerInstallCron: apiMocks.triggerInstallCron,
  removeProject: apiMocks.removeProject,
  updateGlobalNotifications: apiMocks.updateGlobalNotifications,
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
    addToast: vi.fn(),
    projectName: 'Night Watch',
    selectedProjectId: null,
    globalModeLoading: false,
    isGlobalMode: false,
    removeProjectFromList: vi.fn(),
  }),
}));

vi.mock('../../hooks/usePresetManagement.js', () => ({
  usePresetManagement: () => ({
    getAllPresets: () => [],
    getPresetOptions: () => [],
    handleEditPreset: vi.fn(),
    handleDeletePreset: vi.fn(),
    handleResetPreset: vi.fn(),
    handleAddPreset: vi.fn(),
    modalState: { isOpen: false, presetId: null, mode: 'create' as const },
    handleModalSave: vi.fn(),
    closeModal: vi.fn(),
  }),
}));

describe('Settings automation redirects', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentConfig = makeConfig();
    apiMocks.fetchGlobalNotifications.mockResolvedValue({ webhook: null });
  });

  it.each([
    '/settings?tab=jobs&jobType=reviewer',
    '/settings?tab=schedules&jobType=qa',
  ])('redirects legacy automation links to the Automation page: %s', async (initialEntry) => {
    render(
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/settings" element={<Settings />} />
          <Route path="/scheduling" element={<div data-testid="automation-route">Automation route</div>} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('automation-route')).toBeInTheDocument();
    });
  });
});
