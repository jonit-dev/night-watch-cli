import { AlertCircle, AlertTriangle, RotateCcw, Save, Trash2 } from 'lucide-react';
import React from 'react';
import {
  ClaudeModel,
  fetchAllConfigs,
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
  IProviderPreset,
  IProviderScheduleOverride,
  IQaConfig,
  IRoadmapScannerConfig,
  IWebhookConfig,
  removeProject,
  triggerInstallCron,
  toggleRoadmapScanner,
  updateConfig,
  updateGlobalNotifications,
  useApi,
} from '../api';
import WebhookEditor from '../components/settings/WebhookEditor.js';
import PresetFormModal from '../components/providers/PresetFormModal.js';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import { IScheduleTemplate, resolveActiveTemplate } from '../utils/cron.js';
import Tabs from '../components/ui/Tabs';
import { useStore } from '../store/useStore';
import GeneralTab from './settings/GeneralTab.js';
import AiRuntimeTab from './settings/AiRuntimeTab.js';
import JobsTab from './settings/JobsTab.js';
import SchedulesTab from './settings/SchedulesTab.js';
import IntegrationsTab from './settings/IntegrationsTab.js';
import AdvancedTab from './settings/AdvancedTab.js';
import { usePresetManagement } from '../hooks/usePresetManagement.js';
import { BUILT_IN_PRESET_IDS } from '../constants/presets.js';

const JOB_PROVIDER_KEYS: Array<keyof IJobProviders> = ['executor', 'reviewer', 'qa', 'audit', 'slicer', 'analytics'];

type ConfigForm = {
  provider: INightWatchConfig['provider'];
  providerLabel: string;
  providerPresets: Record<string, IProviderPreset>;
  defaultBranch: string;
  prdDir: string;
  branchPrefix: string;
  branchPatterns: string[];
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
  primaryFallbackModel: ClaudeModel;
  secondaryFallbackModel: ClaudeModel;
  primaryFallbackPreset: string;
  secondaryFallbackPreset: string;
  claudeModel: ClaudeModel;
  providerScheduleOverrides: IProviderScheduleOverride[];
  qa: IQaConfig;
  audit: IAuditConfig;
  analytics: IAnalyticsConfig;
  merger: IMergerConfig;
  queue: INightWatchConfig['queue'];
};

const toFormState = (config: INightWatchConfig): ConfigForm => ({
  provider: config.provider,
  providerLabel: config.providerLabel ?? '',
  providerPresets: config.providerPresets ?? {},
  defaultBranch: config.defaultBranch,
  prdDir: config.prdDir || 'docs/prds',
  branchPrefix: config.branchPrefix,
  branchPatterns: config.branchPatterns || [],
  executorEnabled: config.executorEnabled ?? true,
  reviewerEnabled: config.reviewerEnabled,
  minReviewScore: config.minReviewScore,
  maxRuntime: config.maxRuntime,
  reviewerMaxRuntime: config.reviewerMaxRuntime,
  maxLogSize: config.maxLogSize,
  cronSchedule: config.cronSchedule || '5 */3 * * *',
  reviewerSchedule: config.reviewerSchedule || '25 */6 * * *',
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
  roadmapScanner: {
    enabled: config.roadmapScanner?.enabled ?? true,
    roadmapPath: config.roadmapScanner?.roadmapPath ?? 'ROADMAP.md',
    autoScanInterval: config.roadmapScanner?.autoScanInterval ?? 300,
    slicerSchedule: config.roadmapScanner?.slicerSchedule ?? '35 */12 * * *',
    slicerMaxRuntime: config.roadmapScanner?.slicerMaxRuntime ?? 600,
    priorityMode: config.roadmapScanner?.priorityMode ?? 'roadmap-first',
    issueColumn: config.roadmapScanner?.issueColumn ?? 'Draft',
  },
  templatesDir: config.templatesDir || '.night-watch/templates',
  boardProvider: config.boardProvider || { enabled: true, provider: 'github' },
  jobProviders: config.jobProviders || {},
  fallbackOnRateLimit: config.fallbackOnRateLimit ?? true,
  primaryFallbackModel: config.primaryFallbackModel ?? config.claudeModel ?? 'sonnet',
  secondaryFallbackModel:
    config.secondaryFallbackModel ?? config.primaryFallbackModel ?? config.claudeModel ?? 'sonnet',
  primaryFallbackPreset: config.primaryFallbackPreset ?? '',
  secondaryFallbackPreset: config.secondaryFallbackPreset ?? '',
  claudeModel: config.primaryFallbackModel ?? config.claudeModel ?? 'sonnet',
  providerScheduleOverrides: config.providerScheduleOverrides ?? [],
  qa: config.qa || {
    enabled: true,
    schedule: '45 2,14 * * *',
    maxRuntime: 3600,
    branchPatterns: [],
    artifacts: 'both',
    skipLabel: 'skip-qa',
    autoInstallPlaywright: true,
  },
  audit: config.audit || {
    enabled: true,
    schedule: '50 3 * * 1',
    maxRuntime: 1800,
  },
  analytics: config.analytics || {
    enabled: false,
    schedule: '0 6 * * 1',
    maxRuntime: 900,
    lookbackDays: 7,
    targetColumn: 'Draft',
    analysisPrompt: '',
  },
  merger: config.merger ?? {
    enabled: false,
    schedule: '55 */4 * * *',
    maxRuntime: 1800,
    mergeMethod: 'squash',
    minReviewScore: 80,
    branchPatterns: [],
    rebaseBeforeMerge: true,
    maxPrsPerRun: 0,
  },
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
});

type ScheduleUiState = {
  mode: 'template' | 'custom';
  selectedTemplateId: string;
};

const resolveScheduleUiState = (form: ConfigForm): ScheduleUiState => {
  const detected = resolveActiveTemplate(
    form.scheduleBundleId,
    form.cronSchedule,
    form.reviewerSchedule,
    form.qa.schedule,
    form.audit.schedule,
    form.roadmapScanner.slicerSchedule ?? '35 */12 * * *',
    form.merger?.schedule ?? '55 */4 * * *',
  );

  if (detected) {
    return { mode: 'template', selectedTemplateId: detected.id };
  }

  return { mode: 'custom', selectedTemplateId: '' };
};

const Settings: React.FC = () => {
  const { addToast, projectName, selectedProjectId, globalModeLoading, isGlobalMode, removeProjectFromList } = useStore();
  const [saving, setSaving] = React.useState(false);
  const [removeModalOpen, setRemoveModalOpen] = React.useState(false);
  const [removing, setRemoving] = React.useState(false);
  const [form, setForm] = React.useState<ConfigForm | null>(null);
  const [allProjectConfigs, setAllProjectConfigs] = React.useState<Array<{ projectId: string; config: INightWatchConfig }>>([]);
  const [globalWebhook, setGlobalWebhook] = React.useState<IWebhookConfig | null | undefined>(undefined);
  // Prevents refetchConfig from overwriting the form after a save (form was already set from PUT response)
  const skipNextFormResetRef = React.useRef(false);
  // Tracks when jobProviders was changed by user (to trigger auto-save)
  const jobProvidersChangedRef = React.useRef(false);
  const [scheduleMode, setScheduleMode] = React.useState<'template' | 'custom'>('template');
  const [selectedTemplateId, setSelectedTemplateId] = React.useState<string>('always-on');
  const [activeSettingsTab, setActiveSettingsTab] = React.useState<string>('general');
  const [highlightedSection, setHighlightedSection] = React.useState<string | null>(null);

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
    fetchAllConfigs().then(setAllProjectConfigs).catch(console.error);
    fetchGlobalNotifications().then((cfg) => setGlobalWebhook(cfg.webhook)).catch(() => {
      // server unavailable — leave as undefined so globe buttons stay hidden
    });
  }, [selectedProjectId]);

  React.useEffect(() => {
    const params = new URLSearchParams(location.search);
    const tab = params.get('tab');
    const mode = params.get('mode');

    if (tab) {
      const tabMigration: Record<string, string> = {
        providers: 'ai-runtime',
        runtime: 'ai-runtime',
        roadmap: 'jobs',
        qa: 'jobs',
        audit: 'jobs',
        analytics: 'jobs',
        board: 'integrations',
        notifications: 'integrations',
      };
      setActiveSettingsTab(tabMigration[tab] ?? tab);
    }
    if (mode === 'custom') {
      setScheduleMode('custom');
    } else if (mode === 'template') {
      setScheduleMode('template');
    }

    const jobTypeParam = params.get('jobType');
    if (jobTypeParam) {
      // Small delay to ensure the tab and mode have settled
      setTimeout(() => {
        handleEditJob('current', jobTypeParam);
      }, 300);
    }
  }, [location.search, config]); // config dependency ensures we wait for data before trying to scroll

  const applyScheduleUiState = React.useCallback((formState: ConfigForm) => {
    const scheduleUiState = resolveScheduleUiState(formState);
    setScheduleMode(scheduleUiState.mode);
    setSelectedTemplateId(scheduleUiState.selectedTemplateId);
  }, []);

  React.useEffect(() => {
    if (config) {
      if (skipNextFormResetRef.current) {
        skipNextFormResetRef.current = false;
      } else {
        const newForm = toFormState(config);
        setForm(newForm);
        applyScheduleUiState(newForm);
      }
    }
  }, [config, applyScheduleUiState]);

  // Auto-save when jobProviders changes from user input
  React.useEffect(() => {
    if (form && jobProvidersChangedRef.current) {
      jobProvidersChangedRef.current = false;
      handleSave();
    }
  }, [form?.jobProviders]);

  // Clear highlight after timeout
  React.useEffect(() => {
    if (highlightedSection) {
      const timer = setTimeout(() => setHighlightedSection(null), 2000);
      return () => clearTimeout(timer);
    }
  }, [highlightedSection]);

  const handleEditJob = (projectId: string, jobType: string) => {
    if (projectId === projectName || projectId === 'current') {
      const jobsTabTypes = ['qa', 'audit', 'slicer', 'analytics', 'merger'];
      if (jobsTabTypes.includes(jobType)) {
        setActiveSettingsTab('jobs');
        setTimeout(() => {
          const el = document.getElementById(`job-section-${jobType}`);
          if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            setHighlightedSection(`job-section-${jobType}`);
          }
        }, 50);
        return;
      }

      // executor / reviewer → schedules tab
      if (scheduleMode !== 'custom') {
        switchToCustomMode();
      }
      setActiveSettingsTab('schedules');
      setTimeout(() => {
        const idMap: Record<string, string> = {
          executor: 'job-schedule-executor',
          reviewer: 'job-schedule-reviewer',
        };
        const sectionId = idMap[jobType] || '';
        const el = document.getElementById(sectionId);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          setHighlightedSection(sectionId);
        }
      }, 50);
    } else {
      addToast({
        title: 'Project Switch Required',
        message: `To edit ${projectId}, please switch to that project in the sidebar.`,
        type: 'info',
      });
    }
  };

  const switchToTemplateMode = () => {
    setScheduleMode('template');
    if (!form) {
      return;
    }

    const scheduleUiState = resolveScheduleUiState(form);
    if (scheduleUiState.mode === 'template') {
      setSelectedTemplateId(scheduleUiState.selectedTemplateId);
      updateField('scheduleBundleId', scheduleUiState.selectedTemplateId);
    }
  };

  const switchToCustomMode = () => {
    setScheduleMode('custom');
    updateField('scheduleBundleId', null);
    setSelectedTemplateId('');
  };

  const applyTemplate = (tpl: IScheduleTemplate) => {
    setSelectedTemplateId(tpl.id);
    setForm((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        cronSchedule: tpl.schedules.executor,
        reviewerSchedule: tpl.schedules.reviewer,
        scheduleBundleId: tpl.id,
        qa: { ...prev.qa, schedule: tpl.schedules.qa },
        audit: { ...prev.audit, schedule: tpl.schedules.audit },
        roadmapScanner: { ...prev.roadmapScanner, slicerSchedule: tpl.schedules.slicer },
        merger: { ...prev.merger, schedule: tpl.schedules.merger },
        fallbackOnRateLimit: true,
      };
    });
  };

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
      form.analytics.schedule !== (config?.analytics?.schedule ?? '0 6 * * 1') ||
      form.merger.enabled !== (config?.merger?.enabled ?? false) ||
      form.merger.schedule !== (config?.merger?.schedule ?? '55 */4 * * *') ||
      form.roadmapScanner.enabled !== (config?.roadmapScanner?.enabled ?? true) ||
      (form.roadmapScanner.slicerSchedule || '35 */12 * * *') !==
        (config?.roadmapScanner?.slicerSchedule || '35 */12 * * *');

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
      const savedConfig = await updateConfig({
        provider: form.provider,
        providerLabel: form.providerLabel.trim(),
        providerPresets: Object.keys(form.providerPresets).length > 0 ? form.providerPresets : undefined,
        defaultBranch: form.defaultBranch,
        prdDir: form.prdDir,
        branchPrefix: form.branchPrefix,
        branchPatterns: form.branchPatterns,
        executorEnabled: form.executorEnabled,
        reviewerEnabled: form.reviewerEnabled,
        minReviewScore: form.minReviewScore,
        maxRuntime: form.maxRuntime,
        reviewerMaxRuntime: form.reviewerMaxRuntime,
        maxLogSize: form.maxLogSize,
        cronSchedule: form.cronSchedule,
        reviewerSchedule: form.reviewerSchedule,
        scheduleBundleId: scheduleMode === 'template' ? form.scheduleBundleId : null,
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
        primaryFallbackModel: form.primaryFallbackModel,
        secondaryFallbackModel: form.secondaryFallbackModel,
        primaryFallbackPreset: form.primaryFallbackPreset || undefined,
        secondaryFallbackPreset: form.secondaryFallbackPreset || undefined,
        claudeModel: form.primaryFallbackModel,
        providerScheduleOverrides: form.providerScheduleOverrides,
        qa: form.qa,
        audit: form.audit,
        analytics: form.analytics,
        merger: form.merger,
        queue: form.queue,
      });

      // Update form directly from server response to ensure it reflects persisted values
      const updatedForm = toFormState(savedConfig);
      setForm(updatedForm);
      applyScheduleUiState(updatedForm);

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
    if (config) {
      const resetForm = toFormState(config);
      setForm(resetForm);
      applyScheduleUiState(resetForm);
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

  const handleRoadmapToggle = async (enabled: boolean) => {
    try {
      const updatedConfig = await toggleRoadmapScanner(enabled);
      updateField('roadmapScanner', updatedConfig.roadmapScanner);

      let cronInstallFailedMessage = '';
      try {
        await triggerInstallCron();
      } catch (cronErr) {
        cronInstallFailedMessage =
          cronErr instanceof Error ? cronErr.message : 'Failed to reinstall cron schedules';
      }

      addToast(
        cronInstallFailedMessage
          ? {
              title: 'Planner Saved (Cron Reinstall Failed)',
              message: cronInstallFailedMessage,
              type: 'warning',
            }
          : {
              title: enabled ? 'Roadmap Scanner Enabled' : 'Roadmap Scanner Disabled',
              message: `Roadmap scanner has been ${enabled ? 'enabled' : 'disabled'}.`,
              type: 'success',
            },
      );
    } catch (err) {
      addToast({
        title: 'Toggle Failed',
        message: err instanceof Error ? err.message : 'Failed to toggle roadmap scanner',
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

  const highlightClass = 'ring-2 ring-indigo-500 ring-offset-2 ring-offset-slate-900 rounded-lg';

  const tabs = [
    {
      id: 'general',
      label: 'General',
      content: (
        <GeneralTab
          form={form}
          updateField={updateField as <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => void}
          projectName={projectName}
          doctorChecks={doctorChecks}
          doctorLoading={doctorLoading}
        />
      ),
    },
    {
      id: 'ai-runtime',
      label: 'AI & Runtime',
      content: (
        <AiRuntimeTab
          form={form}
          updateField={updateField as <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => void}
          jobProvidersChangedRef={jobProvidersChangedRef}
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
      id: 'jobs',
      label: 'Jobs',
      content: (
        <JobsTab
          form={form}
          updateField={updateField as <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => void}
          handleRoadmapToggle={handleRoadmapToggle}
        />
      ),
    },
    {
      id: 'schedules',
      label: 'Schedules',
      content: (
        <SchedulesTab
          form={{
            cronSchedule: form.cronSchedule,
            reviewerSchedule: form.reviewerSchedule,
            qa: form.qa,
            audit: form.audit,
            analytics: form.analytics,
            roadmapScanner: {
              enabled: form.roadmapScanner.enabled,
              slicerSchedule: form.roadmapScanner.slicerSchedule || '35 */12 * * *',
            },
            scheduleBundleId: form.scheduleBundleId,
            schedulingPriority: form.schedulingPriority,
            cronScheduleOffset: form.cronScheduleOffset,
            globalQueueEnabled: form.queue.enabled,
          }}
          scheduleMode={scheduleMode}
          selectedTemplateId={selectedTemplateId}
          onFieldChange={(field, value) => {
            if (field === 'globalQueueEnabled') {
              updateField('queue', { ...form.queue, enabled: value as boolean });
            } else {
              updateField(field as keyof ConfigForm, value as ConfigForm[keyof ConfigForm]);
            }
          }}
          onSwitchToTemplate={switchToTemplateMode}
          onSwitchToCustom={switchToCustomMode}
          onApplyTemplate={applyTemplate}
          allProjectConfigs={allProjectConfigs}
          currentProjectId={selectedProjectId}
          onEditJob={handleEditJob}
        />
      ),
    },
    {
      id: 'notifications',
      label: 'Notifications',
      content: (
        <Card className="p-6">
          <h3 className="text-lg font-medium text-slate-200 mb-2">Notification Webhooks</h3>
          <WebhookEditor
            notifications={form.notifications}
            onChange={(notifications) => updateField('notifications', notifications)}
            globalWebhook={globalWebhook}
            onSetGlobal={handleSetGlobal}
            onUnsetGlobal={handleUnsetGlobal}
          />
        </Card>
      ),
    },
    {
      id: 'integrations',
      label: 'Integrations',
      content: (
        <IntegrationsTab
          form={form}
          updateField={updateField as <K extends 'boardProvider' | 'notifications'>(key: K, value: ConfigForm[K]) => void}
        />
      ),
    },
    {
      id: 'advanced',
      label: 'Advanced',
      content: (
        <AdvancedTab
          form={form}
          updateField={updateField as <K extends 'templatesDir' | 'maxRetries' | 'prdPriority'>(key: K, value: ConfigForm[K]) => void}
        />
      ),
    },
  ];

  return (
    <div className="max-w-4xl mx-auto pb-10">
      <h2 className="text-2xl font-bold text-slate-100 mb-6">Settings</h2>

      <Tabs tabs={tabs} activeTab={activeSettingsTab} onChange={setActiveSettingsTab} />

      <div className="flex items-center justify-end space-x-4 pt-6 mt-6 border-t border-slate-800">
        <Button variant="ghost" className="text-slate-400 hover:text-slate-300" onClick={handleReset}>
          <RotateCcw className="h-4 w-4 mr-2" />
          Reset
        </Button>
        <Button onClick={handleSave} loading={saving}>
          <Save className="h-4 w-4 mr-2" />
          Save Changes
        </Button>
      </div>

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
