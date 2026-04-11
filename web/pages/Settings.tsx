import { AlertCircle, AlertTriangle, RotateCcw, Save, Trash2 } from 'lucide-react';
import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  ClaudeModel,
  fetchConfig,
  fetchDoctor,
  fetchGlobalNotifications,
  IAnalyticsConfig,
  IAuditConfig,
  IBoardProviderConfig,
  IJobProviders,
  IMergerConfig,
  INightWatchConfig,
  INotificationConfig,
  IPrResolverConfig,
  IProviderPreset,
  IProviderScheduleOverride,
  IQaConfig,
  IRoadmapScannerConfig,
  IWebhookConfig,
  removeProject,
  triggerInstallCron,
  updateConfig,
  updateGlobalNotifications,
  useApi,
} from '../api';
import WebhookEditor from '../components/settings/WebhookEditor.js';
import PresetFormModal from '../components/providers/PresetFormModal.js';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import Badge from '../components/ui/Badge.js';
import Tabs from '../components/ui/Tabs';
import { useStore } from '../store/useStore';
import ProjectTab from './settings/ProjectTab.js';
import AiProvidersTab from './settings/AiProvidersTab.js';
import IntegrationsTab from './settings/IntegrationsTab.js';
import { usePresetManagement } from '../hooks/usePresetManagement.js';
import { BUILT_IN_PRESET_IDS } from '../constants/presets.js';
import {
  DEFAULT_EXECUTOR_SCHEDULE,
  DEFAULT_REVIEWER_SCHEDULE,
  getDefaultAnalyticsConfig,
  getDefaultAuditConfig,
  getDefaultMergerConfig,
  getDefaultPrResolverConfig,
  getDefaultQaConfig,
  getDefaultRoadmapScannerConfig,
} from '../utils/scheduling-defaults.js';

const JOB_PROVIDER_KEYS: Array<keyof IJobProviders> = [
  'executor',
  'reviewer',
  'qa',
  'audit',
  'slicer',
  'analytics',
  'pr-resolver',
  'merger',
];

type ConfigForm = {
  provider: INightWatchConfig['provider'];
  providerLabel: string;
  providerPresets: Record<string, IProviderPreset>;
  defaultBranch: string;
  prdDir: string;
  branchPrefix: string;
  branchPatterns: string[];
  gitPushNoVerify: boolean;
  executorEnabled: boolean;
  reviewerEnabled: boolean;
  minReviewScore: number;
  maxRuntime: number;
  reviewerMaxRuntime: number;
  maxLogSize: number;
  cronSchedule: string;
  reviewerSchedule: string;
  scheduleBundleId: string | null;
  cronScheduleOffset: number;
  schedulingPriority: number;
  maxRetries: number;
  reviewerMaxRetries: number;
  reviewerRetryDelay: number;
  reviewerMaxPrsPerRun: number;
  providerEnv: Record<string, string>;
  notifications: INotificationConfig;
  prdPriority: string[];
  roadmapScanner: IRoadmapScannerConfig;
  templatesDir: string;
  boardProvider: IBoardProviderConfig;
  jobProviders: IJobProviders;
  fallbackOnRateLimit: boolean;
  primaryFallbackModel: ClaudeModel | '';
  secondaryFallbackModel: ClaudeModel | '';
  primaryFallbackPreset: string;
  secondaryFallbackPreset: string;
  claudeModel: ClaudeModel | '';
  providerScheduleOverrides: IProviderScheduleOverride[];
  qa: IQaConfig;
  audit: IAuditConfig;
  analytics: IAnalyticsConfig;
  prResolver: IPrResolverConfig;
  merger: IMergerConfig;
  queue: INightWatchConfig['queue'];
};

const toFormState = (config: INightWatchConfig): ConfigForm => {
  const primaryFallbackModel =
    config.primaryFallbackModel !== undefined
      ? (config.primaryFallbackModel ?? '')
      : (config.claudeModel ?? '');
  const secondaryFallbackModel =
    config.secondaryFallbackModel !== undefined
      ? (config.secondaryFallbackModel ?? '')
      : config.primaryFallbackModel !== undefined
        ? (config.primaryFallbackModel ?? '')
        : (config.claudeModel ?? '');

  return {
    provider: config.provider,
    providerLabel: config.providerLabel ?? '',
    providerPresets: config.providerPresets ?? {},
    defaultBranch: config.defaultBranch,
    prdDir: config.prdDir || 'docs/prds',
    branchPrefix: config.branchPrefix,
    branchPatterns: config.branchPatterns || [],
    gitPushNoVerify: config.gitPushNoVerify ?? false,
    executorEnabled: config.executorEnabled ?? true,
    reviewerEnabled: config.reviewerEnabled,
    minReviewScore: config.minReviewScore,
    maxRuntime: config.maxRuntime,
    reviewerMaxRuntime: config.reviewerMaxRuntime,
    maxLogSize: config.maxLogSize,
    cronSchedule: config.cronSchedule || DEFAULT_EXECUTOR_SCHEDULE,
    reviewerSchedule: config.reviewerSchedule || DEFAULT_REVIEWER_SCHEDULE,
    scheduleBundleId: config.scheduleBundleId ?? null,
    cronScheduleOffset: config.cronScheduleOffset ?? 0,
    schedulingPriority: config.schedulingPriority ?? 3,
    maxRetries: config.maxRetries ?? 3,
    reviewerMaxRetries: config.reviewerMaxRetries ?? 2,
    reviewerRetryDelay: config.reviewerRetryDelay ?? 30,
    reviewerMaxPrsPerRun: config.reviewerMaxPrsPerRun ?? 0,
    providerEnv: config.providerEnv || {},
    notifications: config.notifications || { webhooks: [] },
    prdPriority: config.prdPriority || [],
    roadmapScanner: config.roadmapScanner || getDefaultRoadmapScannerConfig(),
    templatesDir: config.templatesDir || '.night-watch/templates',
    boardProvider: config.boardProvider || { enabled: true, provider: 'github' },
    jobProviders: config.jobProviders || {},
    fallbackOnRateLimit: config.fallbackOnRateLimit ?? true,
    primaryFallbackModel,
    secondaryFallbackModel,
    primaryFallbackPreset: config.primaryFallbackPreset ?? '',
    secondaryFallbackPreset: config.secondaryFallbackPreset ?? '',
    claudeModel: primaryFallbackModel,
    providerScheduleOverrides: config.providerScheduleOverrides ?? [],
    qa: config.qa || getDefaultQaConfig(),
    audit: config.audit || getDefaultAuditConfig(),
    analytics: config.analytics || getDefaultAnalyticsConfig(),
    prResolver: config.prResolver ?? getDefaultPrResolverConfig(),
    merger: config.merger ?? getDefaultMergerConfig(),
    queue: config.queue || {
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
  };
};


const Settings: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { addToast, projectName, selectedProjectId, globalModeLoading, isGlobalMode, removeProjectFromList } = useStore();
  const [saving, setSaving] = React.useState(false);
  const [removeModalOpen, setRemoveModalOpen] = React.useState(false);
  const [removing, setRemoving] = React.useState(false);
  const [form, setForm] = React.useState<ConfigForm | null>(null);
  const [globalWebhook, setGlobalWebhook] = React.useState<IWebhookConfig | null | undefined>(undefined);
  const initialFormRef = React.useRef<ConfigForm | null>(null);
  const [isDirty, setIsDirty] = React.useState(false);
  // Prevents refetchConfig from overwriting the form after a save (form was already set from PUT response)
  const skipNextFormResetRef = React.useRef(false);
  // Tracks when jobProviders was changed by user (to trigger auto-save)
  const jobProvidersChangedRef = React.useRef(false);
  const [activeSettingsTab, setActiveSettingsTab] = React.useState<string>('project');
  const legacyAutomationTab = React.useMemo(() => {
    const tab = new URLSearchParams(location.search).get('tab');
    return tab === 'jobs' || tab === 'schedules' ? tab : null;
  }, [location.search]);

  const {
    data: config,
    loading: configLoading,
    error: configError,
    refetch: refetchConfig,
  } = useApi(fetchConfig, [selectedProjectId], { enabled: !globalModeLoading });
  const {
    data: doctorChecksData,
    loading: doctorLoading,
    refetch: refetchDoctor,
  } = useApi(fetchDoctor, [selectedProjectId], { enabled: !globalModeLoading });
  const doctorChecks = doctorChecksData ?? [];

  const updateField = <K extends keyof ConfigForm>(key: K, value: ConfigForm[K]) => {
    setForm((prev) => {
      if (!prev) {
        return prev;
      }
      return { ...prev, [key]: value };
    });
  };

  // Preset management hook
  const presetManagement = usePresetManagement(
    form?.providerPresets ?? {},
    form?.provider ?? 'claude',
    form?.jobProviders ?? {},
    updateField,
  );

  React.useEffect(() => {
    fetchGlobalNotifications().then((cfg) => setGlobalWebhook(cfg.webhook)).catch(() => {
      // server unavailable — leave as undefined so globe buttons stay hidden
    });
  }, [selectedProjectId]);

  // Deep linking: switch tab based on URL param
  React.useEffect(() => {
    if (!legacyAutomationTab) return;
    navigate({ pathname: '/scheduling', search: location.search }, { replace: true });
  }, [legacyAutomationTab, location.search, navigate]);

  React.useEffect(() => {
    if (legacyAutomationTab) return;
    const params = new URLSearchParams(location.search);
    const tab = params.get('tab');

    if (tab) {
      const tabMigration: Record<string, string> = {
        providers: 'ai-providers',
        runtime: 'ai-providers',
        'ai-runtime': 'ai-providers',
        notifications: 'integrations',
        general: 'project',
        advanced: 'project',
      };
      setActiveSettingsTab(tabMigration[tab] ?? tab);
    }
  }, [legacyAutomationTab, location.search]);

  React.useEffect(() => {
    if (config) {
      if (skipNextFormResetRef.current) {
        skipNextFormResetRef.current = false;
        return;
      }
      const initial = toFormState(config);
      setForm(initial);
      initialFormRef.current = initial;
      setIsDirty(false);
    }
  }, [config]);

  // Track dirty state
  React.useEffect(() => {
    if (!form || !initialFormRef.current) return;
    const currentStr = JSON.stringify(form);
    const initialStr = JSON.stringify(initialFormRef.current);
    setIsDirty(currentStr !== initialStr);
  }, [form]);

  // Auto-save when jobProviders changes from user input
  React.useEffect(() => {
    if (form && jobProvidersChangedRef.current) {
      jobProvidersChangedRef.current = false;
      handleSave();
    }
  }, [form?.jobProviders]);

  const handleSave = async () => {
    if (!form) {
      return;
    }

    const shouldReinstallCron =
      form.cronSchedule !== config?.cronSchedule ||
      form.reviewerSchedule !== config?.reviewerSchedule ||
      form.cronScheduleOffset !== (config?.cronScheduleOffset ?? 0) ||
      form.schedulingPriority !== (config?.schedulingPriority ?? 3) ||
      form.executorEnabled !== (config?.executorEnabled ?? true) ||
      form.reviewerEnabled !== (config?.reviewerEnabled ?? true) ||
      form.queue.enabled !== (config?.queue?.enabled ?? true) ||
      form.qa.enabled !== (config?.qa.enabled ?? true) ||
      form.qa.schedule !== config?.qa.schedule ||
      form.audit.enabled !== (config?.audit.enabled ?? true) ||
      form.audit.schedule !== config?.audit.schedule ||
      form.analytics.enabled !== (config?.analytics?.enabled ?? false) ||
      form.analytics.schedule !== (config?.analytics?.schedule ?? getDefaultAnalyticsConfig().schedule) ||
      form.prResolver.enabled !== (config?.prResolver?.enabled ?? getDefaultPrResolverConfig().enabled) ||
      form.prResolver.schedule !==
        (config?.prResolver?.schedule ?? getDefaultPrResolverConfig().schedule) ||
      form.merger.enabled !== (config?.merger?.enabled ?? false) ||
      form.merger.schedule !== (config?.merger?.schedule ?? getDefaultMergerConfig().schedule) ||
      form.roadmapScanner.enabled !== (config?.roadmapScanner?.enabled ?? true) ||
      (form.roadmapScanner.slicerSchedule || getDefaultRoadmapScannerConfig().slicerSchedule) !==
        (config?.roadmapScanner?.slicerSchedule || getDefaultRoadmapScannerConfig().slicerSchedule);

    // Send explicit nulls for cleared overrides so the backend can reliably remove
    // stale assignments even if it applies partial-merge semantics.
    const cleanedJobProviders: Partial<Record<keyof IJobProviders, string | null>> = {};
    for (const jobType of JOB_PROVIDER_KEYS) {
      const provider = form.jobProviders[jobType];
      if (typeof provider === 'string' && provider.trim().length > 0) {
        cleanedJobProviders[jobType] = provider;
      } else if (config?.jobProviders[jobType]) {
        cleanedJobProviders[jobType] = null;
      }
    }

    setSaving(true);
    try {
      const primaryFallbackModel = form.primaryFallbackModel || null;
      const secondaryFallbackModel = form.secondaryFallbackModel || null;

      const savedConfig = await updateConfig({
        provider: form.provider,
        providerLabel: form.providerLabel.trim(),
        providerPresets: Object.keys(form.providerPresets).length > 0 ? form.providerPresets : undefined,
        defaultBranch: form.defaultBranch,
        prdDir: form.prdDir,
        branchPrefix: form.branchPrefix,
        branchPatterns: form.branchPatterns,
        gitPushNoVerify: form.gitPushNoVerify,
        executorEnabled: form.executorEnabled,
        reviewerEnabled: form.reviewerEnabled,
        minReviewScore: form.minReviewScore,
        maxRuntime: form.maxRuntime,
        reviewerMaxRuntime: form.reviewerMaxRuntime,
        maxLogSize: form.maxLogSize,
        cronSchedule: form.cronSchedule,
        reviewerSchedule: form.reviewerSchedule,
        scheduleBundleId: form.scheduleBundleId,
        cronScheduleOffset: form.cronScheduleOffset,
        schedulingPriority: form.schedulingPriority,
        maxRetries: form.maxRetries,
        reviewerMaxRetries: form.reviewerMaxRetries,
        reviewerRetryDelay: form.reviewerRetryDelay,
        reviewerMaxPrsPerRun: form.reviewerMaxPrsPerRun,
        providerEnv: form.providerEnv,
        notifications: form.notifications,
        prdPriority: form.prdPriority,
        roadmapScanner: form.roadmapScanner,
        templatesDir: form.templatesDir,
        boardProvider: form.boardProvider,
        jobProviders: cleanedJobProviders,
        fallbackOnRateLimit: form.fallbackOnRateLimit,
        primaryFallbackModel,
        secondaryFallbackModel,
        primaryFallbackPreset: form.primaryFallbackPreset || undefined,
        secondaryFallbackPreset: form.secondaryFallbackPreset || undefined,
        claudeModel: primaryFallbackModel,
        providerScheduleOverrides: form.providerScheduleOverrides,
        qa: form.qa,
        audit: form.audit,
        analytics: form.analytics,
        prResolver: form.prResolver,
        merger: form.merger,
        queue: form.queue,
      });

      // Update form directly from server response to ensure it reflects persisted values
      const updatedForm = toFormState(savedConfig);
      setForm(updatedForm);
      initialFormRef.current = updatedForm;
      setIsDirty(false);

      let cronInstallFailedMessage = '';
      if (shouldReinstallCron) {
        try {
          await triggerInstallCron();
        } catch (cronErr) {
          cronInstallFailedMessage =
            cronErr instanceof Error ? cronErr.message : 'failed to reinstall cron schedules';
        }
      }

      if (cronInstallFailedMessage) {
        addToast({
          title: 'Settings Saved (Cron Reinstall Failed)',
          message: cronInstallFailedMessage,
          type: 'warning',
        });
      } else {
        addToast({
          title: 'Settings Saved',
          message: shouldReinstallCron
            ? 'Configuration updated and cron schedules reinstalled.'
            : 'Configuration updated successfully.',
          type: 'success',
        });
      }

      // Sync useApi's internal config state but skip the form reset (already done above)
      skipNextFormResetRef.current = true;
      refetchConfig();
      refetchDoctor();
    } catch (saveError) {
      addToast({
        title: 'Save Failed',
        message: saveError instanceof Error ? saveError.message : 'Failed to save configuration',
        type: 'error',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    if (initialFormRef.current) {
      setForm(initialFormRef.current);
      setIsDirty(false);
      addToast({
        title: 'Reset Complete',
        message: 'Unsaved changes were discarded.',
        type: 'info',
      });
    }
  };

  const handleSetGlobal = async (webhook: IWebhookConfig) => {
    if (globalWebhook !== null && globalWebhook !== undefined) {
      if (!window.confirm('Replace existing global channel?')) return;
    }
    try {
      const cfg = await updateGlobalNotifications({ webhook });
      setGlobalWebhook(cfg.webhook);
    } catch (err) {
      addToast({
        title: 'Failed to set global channel',
        message: err instanceof Error ? err.message : 'Unknown error',
        type: 'error',
      });
    }
  };

  const handleUnsetGlobal = async () => {
    try {
      await updateGlobalNotifications({ webhook: null });
      setGlobalWebhook(null);
    } catch (err) {
      addToast({
        title: 'Failed to unset global channel',
        message: err instanceof Error ? err.message : 'Unknown error',
        type: 'error',
      });
    }
  };

  const handleRemoveProject = async () => {
    if (!selectedProjectId) return;
    setRemoving(true);
    try {
      await removeProject(selectedProjectId);
      removeProjectFromList(selectedProjectId);
      setRemoveModalOpen(false);
      addToast({
        title: 'Project Removed',
        message: 'Cron jobs uninstalled and all project data removed from the database.',
        type: 'success',
      });
    } catch (err) {
      addToast({
        title: 'Remove Failed',
        message: err instanceof Error ? err.message : 'Failed to remove project',
        type: 'error',
      });
    } finally {
      setRemoving(false);
    }
  };

  if (legacyAutomationTab) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-slate-400">Opening automation...</div>
      </div>
    );
  }

  if (configLoading || !form) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-slate-400">Loading settings...</div>
      </div>
    );
  }

  if (configError) {
    return (
      <div className="flex flex-col items-center justify-center h-full space-y-4">
        <AlertCircle className="h-12 w-12 text-red-400" />
        <div className="text-slate-300">Failed to load settings</div>
        <div className="text-sm text-slate-500">{configError.message}</div>
        <Button onClick={() => refetchConfig()}>Retry</Button>
      </div>
    );
  }

  const tabs = [
    {
      id: 'project',
      label: 'Project',
      content: (
        <ProjectTab
          form={form}
          updateField={updateField as <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => void}
          projectName={projectName}
          doctorChecks={doctorChecks}
          doctorLoading={doctorLoading}
        />
      ),
    },
    {
      id: 'ai-providers',
      label: 'AI Providers',
      content: (
        <AiProvidersTab
          form={form}
          updateField={updateField as <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => void}
          getAllPresets={presetManagement.getAllPresets}
          getPresetOptions={presetManagement.getPresetOptions}
          handleEditPreset={presetManagement.handleEditPreset}
          handleDeletePreset={presetManagement.handleDeletePreset}
          handleResetPreset={presetManagement.handleResetPreset}
          handleAddPreset={presetManagement.handleAddPreset}
        />
      ),
    },
    {
      id: 'integrations',
      label: 'Integrations',
      content: (
        <IntegrationsTab
          form={form}
          updateField={updateField as <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => void}
          globalWebhook={globalWebhook}
          onSetGlobal={handleSetGlobal}
          onUnsetGlobal={handleUnsetGlobal}
        />
      ),
    },
  ];

  return (
    <div className="max-w-4xl mx-auto pb-32">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-slate-100">Settings</h2>
          <p className="text-sm text-slate-500 mt-1">Configure project automation, providers, and integrations</p>
        </div>
        {isDirty && (
          <Badge variant="warning" className="animate-pulse">
            <AlertTriangle className="h-3 w-3 mr-1" />
            Unsaved Changes
          </Badge>
        )}
      </div>

      <Tabs tabs={tabs} activeTab={activeSettingsTab} onChange={setActiveSettingsTab} />

      {/* Sticky Save Banner */}
      {isDirty && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 w-full max-w-2xl px-4 animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div className="bg-slate-900/90 backdrop-blur-md border border-indigo-500/30 rounded-2xl p-4 shadow-2xl flex items-center justify-between shadow-indigo-500/10">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-indigo-500/20 text-indigo-400">
                <AlertCircle className="h-5 w-5" />
              </div>
              <div>
                <div className="text-sm font-semibold text-slate-200">You have unsaved changes</div>
                <div className="text-[11px] text-slate-400">Save your configuration to apply changes</div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Button variant="ghost" size="sm" className="text-slate-400 hover:text-slate-300" onClick={handleReset}>
                <RotateCcw className="h-4 w-4 mr-2" />
                Discard
              </Button>
              <Button size="sm" className="bg-indigo-600 hover:bg-indigo-500 shadow-lg shadow-indigo-500/20" onClick={handleSave} loading={saving}>
                <Save className="h-4 w-4 mr-2" />
                Save Changes
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Danger Zone (global mode only) */}
      {isGlobalMode && selectedProjectId && (
        <div className="mt-10 rounded-lg border border-red-900/50 bg-red-950/20 p-6">
          <h3 className="text-lg font-medium text-red-400 mb-2">Danger Zone</h3>
          <p className="text-sm text-slate-400 mb-4">
            Remove this project from Night Watch. This will uninstall cron jobs and delete all
            project data from the database. Files on disk will not be touched.
          </p>
          <Button
            variant="secondary"
            className="bg-red-600 hover:bg-red-700 text-white"
            onClick={() => setRemoveModalOpen(true)}
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Remove Project
          </Button>
        </div>
      )}

      {/* Remove Project Confirmation Modal */}
      {removeModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => !removing && setRemoveModalOpen(false)}
            aria-hidden="true"
          />
          <div className="relative w-full max-w-md transform rounded-xl bg-slate-900 border border-slate-800 shadow-2xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <AlertTriangle className="h-6 w-6 text-red-400" />
              <h3 className="text-lg font-semibold text-slate-100">Remove {projectName}?</h3>
            </div>
            <p className="text-sm text-slate-300 mb-6">
              This will uninstall cron jobs and remove all Night Watch data for this project
              from the database. The project files on disk will not be deleted.
            </p>
            <div className="flex justify-end gap-3">
              <Button variant="ghost" onClick={() => setRemoveModalOpen(false)} disabled={removing}>
                Cancel
              </Button>
              <Button
                variant="secondary"
                className="bg-red-600 hover:bg-red-700"
                onClick={handleRemoveProject}
                loading={removing}
              >
                Remove
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Preset Form Modal */}
      <PresetFormModal
        isOpen={presetManagement.presetModalOpen}
        onClose={() => {
          presetManagement.setPresetModalOpen(false);
        }}
        onSave={presetManagement.handleSavePreset}
        presetId={presetManagement.editingPresetId}
        preset={presetManagement.editingPreset}
        isBuiltIn={presetManagement.editingPresetId ? (BUILT_IN_PRESET_IDS as readonly string[]).includes(presetManagement.editingPresetId) : false}
        existingIds={Object.keys(presetManagement.getAllPresets())}
      />

      {/* Delete Warning Modal */}
      {presetManagement.deleteWarning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => presetManagement.setDeleteWarning(null)}
            aria-hidden="true"
          />
          <div className="relative w-full max-w-md transform rounded-xl bg-slate-900 border border-slate-800 shadow-2xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <AlertTriangle className="h-6 w-6 text-amber-400" />
              <h3 className="text-lg font-semibold text-slate-100">Cannot Delete Preset</h3>
            </div>
            <p className="text-sm text-slate-300 mb-4">
              <strong>{presetManagement.deleteWarning.presetName}</strong> is currently assigned to the following jobs:
            </p>
            <ul className="list-disc list-inside text-sm text-slate-400 mb-4">
              {presetManagement.deleteWarning.references.map((ref) => (
                <li key={ref}>{ref}</li>
              ))}
            </ul>
            <p className="text-sm text-slate-400 mb-6">
              Please remove these assignments before deleting the preset, or use &quot;Force Delete&quot; to remove
              the preset and clear all references.
            </p>
            <div className="flex justify-end gap-3">
              <Button variant="ghost" onClick={() => presetManagement.setDeleteWarning(null)}>
                Cancel
              </Button>
              <Button variant="secondary" onClick={presetManagement.handleConfirmDelete} className="bg-red-600 hover:bg-red-700">
                Force Delete
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Settings;
