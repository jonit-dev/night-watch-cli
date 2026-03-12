import { AlertCircle, AlertTriangle, RotateCcw, Save } from 'lucide-react';
import React from 'react';
import {
  ClaudeModel,
  fetchConfig,
  fetchDoctor,
  IAnalyticsConfig,
  IAuditConfig,
  IBoardProviderConfig,
  IJobProviders,
  INightWatchConfig,
  INotificationConfig,
  IProviderPreset,
  IQaConfig,
  IRoadmapScannerConfig,
  MergeMethod,
  triggerInstallCron,
  toggleRoadmapScanner,
  updateConfig,
  useApi,
} from '../api';
import WebhookEditor from '../components/settings/WebhookEditor.js';
import TagInput from '../components/settings/TagInput.js';
import PresetFormModal from '../components/providers/PresetFormModal.js';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import { IScheduleTemplate, resolveActiveTemplate } from '../utils/cron.js';
import Input from '../components/ui/Input';
import Select from '../components/ui/Select';
import Switch from '../components/ui/Switch';
import Tabs from '../components/ui/Tabs';
import { useStore } from '../store/useStore';
import ScheduleConfig from '../components/scheduling/ScheduleConfig.js';
import GeneralTab from './settings/GeneralTab.js';
import AiRuntimeTab from './settings/AiRuntimeTab.js';
import JobsTab from './settings/JobsTab.js';

/** Built-in preset IDs that cannot be deleted */
const BUILT_IN_PRESET_IDS = ['claude', 'claude-sonnet-4-6', 'claude-opus-4-6', 'codex', 'glm-47', 'glm-5'];
const JOB_PROVIDER_KEYS: Array<keyof IJobProviders> = ['executor', 'reviewer', 'qa', 'audit', 'slicer'];

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
  autoMerge: boolean;
  autoMergeMethod: MergeMethod;
  fallbackOnRateLimit: boolean;
  primaryFallbackModel: ClaudeModel;
  secondaryFallbackModel: ClaudeModel;
  primaryFallbackPreset: string;
  secondaryFallbackPreset: string;
  claudeModel: ClaudeModel;
  qa: IQaConfig;
  audit: IAuditConfig;
  analytics: IAnalyticsConfig;
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
  autoMerge: config.autoMerge ?? false,
  autoMergeMethod: config.autoMergeMethod ?? 'squash',
  fallbackOnRateLimit: config.fallbackOnRateLimit ?? true,
  primaryFallbackModel: config.primaryFallbackModel ?? config.claudeModel ?? 'sonnet',
  secondaryFallbackModel:
    config.secondaryFallbackModel ?? config.primaryFallbackModel ?? config.claudeModel ?? 'sonnet',
  primaryFallbackPreset: config.primaryFallbackPreset ?? '',
  secondaryFallbackPreset: config.secondaryFallbackPreset ?? '',
  claudeModel: config.primaryFallbackModel ?? config.claudeModel ?? 'sonnet',
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
  queue: config.queue || {
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
  );

  if (detected) {
    return { mode: 'template', selectedTemplateId: detected.id };
  }

  return { mode: 'custom', selectedTemplateId: '' };
};

const Settings: React.FC = () => {
  const { addToast, projectName, selectedProjectId, globalModeLoading } = useStore();
  const [saving, setSaving] = React.useState(false);
  const [form, setForm] = React.useState<ConfigForm | null>(null);
  // Prevents refetchConfig from overwriting the form after a save (form was already set from PUT response)
  const skipNextFormResetRef = React.useRef(false);
  // Tracks when jobProviders was changed by user (to trigger auto-save)
  const jobProvidersChangedRef = React.useRef(false);
  const [scheduleMode, setScheduleMode] = React.useState<'template' | 'custom'>('template');
  const [selectedTemplateId, setSelectedTemplateId] = React.useState<string>('always-on');
  const [activeSettingsTab, setActiveSettingsTab] = React.useState<string>('general');

  // Preset modal state
  const [presetModalOpen, setPresetModalOpen] = React.useState(false);
  const [editingPresetId, setEditingPresetId] = React.useState<string | null>(null);
  const [editingPreset, setEditingPreset] = React.useState<IProviderPreset | null>(null);
  const [deleteWarning, setDeleteWarning] = React.useState<{
    presetId: string;
    presetName: string;
    references: string[];
  } | null>(null);

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

  const handleEditJob = (projectId: string, jobType: string) => {
    if (projectId === projectName || projectId === 'current') {
      const jobsTabTypes = ['qa', 'audit', 'slicer', 'analytics'];
      if (jobsTabTypes.includes(jobType)) {
        setActiveSettingsTab('jobs');
        setTimeout(() => {
          const el = document.getElementById(`job-section-${jobType}`);
          if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            el.classList.add('ring-2', 'ring-indigo-500', 'ring-offset-2', 'ring-offset-slate-900', 'rounded-lg');
            setTimeout(
              () => el.classList.remove('ring-2', 'ring-indigo-500', 'ring-offset-2', 'ring-offset-slate-900'),
              2000,
            );
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
        const el = document.getElementById(idMap[jobType] || '');
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.classList.add('ring-2', 'ring-indigo-500', 'ring-offset-2', 'ring-offset-slate-900', 'rounded-lg');
          setTimeout(
            () => el.classList.remove('ring-2', 'ring-indigo-500', 'ring-offset-2', 'ring-offset-slate-900'),
            2000,
          );
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

  const updateField = <K extends keyof ConfigForm>(key: K, value: ConfigForm[K]) => {
    setForm((prev) => {
      if (!prev) {
        return prev;
      }
      return { ...prev, [key]: value };
    });
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
        autoMerge: form.autoMerge,
        autoMergeMethod: form.autoMergeMethod,
        fallbackOnRateLimit: form.fallbackOnRateLimit,
        primaryFallbackModel: form.primaryFallbackModel,
        secondaryFallbackModel: form.secondaryFallbackModel,
        primaryFallbackPreset: form.primaryFallbackPreset || undefined,
        secondaryFallbackPreset: form.secondaryFallbackPreset || undefined,
        claudeModel: form.primaryFallbackModel,
        qa: form.qa,
        audit: form.audit,
        analytics: form.analytics,
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

  // Get all available presets (built-in + custom)
  const getAllPresets = (): Record<string, IProviderPreset> => {
    const builtIn: Record<string, IProviderPreset> = {
      claude: {
        name: 'Claude',
        command: 'claude',
        promptFlag: '-p',
        autoApproveFlag: '--dangerously-skip-permissions',
      },
      'claude-sonnet-4-6': {
        name: 'Claude Sonnet 4.6',
        command: 'claude',
        promptFlag: '-p',
        autoApproveFlag: '--dangerously-skip-permissions',
        modelFlag: '--model',
        model: 'claude-sonnet-4-6',
      },
      'claude-opus-4-6': {
        name: 'Claude Opus 4.6',
        command: 'claude',
        promptFlag: '-p',
        autoApproveFlag: '--dangerously-skip-permissions',
        modelFlag: '--model',
        model: 'claude-opus-4-6',
      },
      codex: { name: 'Codex', command: 'codex', subcommand: 'exec', autoApproveFlag: '--yolo', workdirFlag: '-C' },
      'glm-47': {
        name: 'GLM-4.7',
        command: 'claude',
        promptFlag: '-p',
        autoApproveFlag: '--dangerously-skip-permissions',
        modelFlag: '--model',
        model: 'glm-4.7',
        envVars: {
          ANTHROPIC_BASE_URL: 'https://api.z.ai/api/anthropic',
          API_TIMEOUT_MS: '3000000',
          ANTHROPIC_DEFAULT_OPUS_MODEL: 'glm-4.7',
          ANTHROPIC_DEFAULT_SONNET_MODEL: 'glm-4.7',
        },
      },
      'glm-5': {
        name: 'GLM-5',
        command: 'claude',
        promptFlag: '-p',
        autoApproveFlag: '--dangerously-skip-permissions',
        modelFlag: '--model',
        model: 'glm-5',
        envVars: {
          ANTHROPIC_BASE_URL: 'https://api.z.ai/api/anthropic',
          API_TIMEOUT_MS: '3000000',
          ANTHROPIC_DEFAULT_OPUS_MODEL: 'glm-5',
          ANTHROPIC_DEFAULT_SONNET_MODEL: 'glm-5',
        },
      },
    };
    return { ...builtIn, ...form?.providerPresets };
  };

  // Get preset options for select dropdowns (includes built-ins)
  const getPresetOptions = (_customPresets: Record<string, IProviderPreset>): Array<{ label: string; value: string }> => {
    const allPresets = getAllPresets();
    return Object.entries(allPresets).map(([id, preset]) => ({
      label: preset.name,
      value: id,
    }));
  };

  // Check if a preset is referenced by any job assignment
  const getPresetReferences = (presetId: string, formData: ConfigForm): string[] => {
    const references: string[] = [];

    // Check global provider
    if (formData.provider === presetId) {
      references.push('Global Provider');
    }

    // Check job providers
    const jobLabels: Record<string, string> = {
      executor: 'Executor',
      reviewer: 'Reviewer',
      qa: 'QA',
      audit: 'Audit',
      slicer: 'Planner',
    };

    for (const [jobType, provider] of Object.entries(formData.jobProviders)) {
      if (provider === presetId) {
        references.push(jobLabels[jobType] ?? jobType);
      }
    }

    return references;
  };

  // Open preset modal for adding new preset
  const handleAddPreset = () => {
    setEditingPresetId(null);
    setEditingPreset(null);
    setPresetModalOpen(true);
  };

  // Open preset modal for editing existing preset
  const handleEditPreset = (presetId: string) => {
    const allPresets = getAllPresets();
    const preset = allPresets[presetId];
    if (preset) {
      setEditingPresetId(presetId);
      setEditingPreset(preset);
      setPresetModalOpen(true);
    }
  };

  // Save preset (add or update) — immediately persists to server
  const handleSavePreset = async (presetId: string, preset: IProviderPreset) => {
    if (!form) return;

    const isNew = !editingPresetId;
    const updatedPresets = { ...form.providerPresets, [presetId]: preset };
    updateField('providerPresets', updatedPresets);

    try {
      await updateConfig({ providerPresets: { [presetId]: preset } });
      addToast({
        title: isNew ? 'Preset Added' : 'Preset Updated',
        message: isNew
          ? `${preset.name} has been added. You can now assign it to jobs.`
          : `${preset.name} has been saved.`,
        type: 'success',
      });
    } catch (err) {
      addToast({
        title: 'Save Failed',
        message: err instanceof Error ? err.message : 'Failed to save preset',
        type: 'error',
      });
      // Revert local state on failure
      updateField('providerPresets', form.providerPresets);
    }
  };

  // Delete preset with protection check
  const handleDeletePreset = (presetId: string) => {
    if (!form) return;

    // Prevent deletion of built-in presets
    if (BUILT_IN_PRESET_IDS.includes(presetId)) {
      addToast({
        title: 'Cannot Delete',
        message: 'Built-in presets cannot be deleted.',
        type: 'error',
      });
      return;
    }

    // Check if preset is in use
    const references = getPresetReferences(presetId, form);
    if (references.length > 0) {
      setDeleteWarning({
        presetId,
        presetName: getAllPresets()[presetId]?.name ?? presetId,
        references,
      });
      return;
    }

    // Safe to delete
    const updatedPresets = { ...form.providerPresets };
    delete updatedPresets[presetId];
    updateField('providerPresets', updatedPresets);

    addToast({
      title: 'Preset Deleted',
      message: `${getAllPresets()[presetId]?.name ?? presetId} has been removed.`,
      type: 'success',
    });
  };

  // Reset built-in preset to defaults
  const handleResetPreset = (presetId: string) => {
    if (!form) return;

    // Remove any custom override for this preset
    const updatedPresets = { ...form.providerPresets };
    delete updatedPresets[presetId];
    updateField('providerPresets', updatedPresets);

    addToast({
      title: 'Preset Reset',
      message: `${presetId} has been reset to built-in defaults.`,
      type: 'success',
    });
  };

  // Confirm deletion despite warnings
  const handleConfirmDelete = () => {
    if (!deleteWarning || !form) return;

    const { presetId } = deleteWarning;
    const updatedPresets = { ...form.providerPresets };
    delete updatedPresets[presetId];
    updateField('providerPresets', updatedPresets);

    // Also clear any job assignments that reference this preset
    const newJobProviders = { ...form.jobProviders };
    for (const key of Object.keys(newJobProviders)) {
      if (newJobProviders[key as keyof IJobProviders] === presetId) {
        delete newJobProviders[key as keyof IJobProviders];
      }
    }
    updateField('jobProviders', newJobProviders);

    // Clear global provider if it was this preset
    if (form.provider === presetId) {
      updateField('provider', 'claude');
    }

    setDeleteWarning(null);
    addToast({
      title: 'Preset Deleted',
      message: `${deleteWarning.presetName} has been removed and all references cleared.`,
      type: 'success',
    });
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
          getAllPresets={getAllPresets}
          getPresetOptions={getPresetOptions}
          handleEditPreset={handleEditPreset}
          handleDeletePreset={handleDeletePreset}
          handleResetPreset={handleResetPreset}
          handleAddPreset={handleAddPreset}
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
        <ScheduleConfig
          form={{
            cronSchedule: form.cronSchedule,
            reviewerSchedule: form.reviewerSchedule,
            qa: form.qa,
            audit: form.audit,
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
          />
        </Card>
      ),
    },
    {
      id: 'roadmap',
      label: 'Planner',
      content: (
        <Card className="p-6 space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-medium text-slate-200">Planner</h3>
              <p className="text-sm text-slate-400">
                Generate one PRD per run using ROADMAP.md first, then audit findings when roadmap work is exhausted
              </p>
            </div>
            <Switch
              checked={form.roadmapScanner.enabled}
              aria-label="Enable planner"
              onChange={handleRoadmapToggle}
            />
          </div>
        </Card>
      ),
    },
    {
      id: 'integrations',
      label: 'Integrations',
      content: (
        <div className="space-y-6">
          <Card className="p-6 space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-medium text-slate-200">Board Provider</h3>
                <p className="text-sm text-slate-400">
                  Track PRDs and their status using GitHub Projects or local SQLite
                </p>
              </div>
              <Switch
                checked={form.boardProvider.enabled}
                onChange={(checked) => updateField('boardProvider', { ...form.boardProvider, enabled: checked })}
              />
            </div>
            {form.boardProvider.enabled && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-slate-800">
                <Select
                  label="Board Provider"
                  value={form.boardProvider.provider}
                  onChange={(val) =>
                    updateField('boardProvider', {
                      ...form.boardProvider,
                      provider: val as 'github' | 'local',
                    })
                  }
                  options={[
                    { label: 'GitHub Projects', value: 'github' },
                    { label: 'Local (SQLite)', value: 'local' },
                  ]}
                />
                {form.boardProvider.provider === 'github' && (
                  <>
                    <Input
                      label="Project Number"
                      type="number"
                      value={String(form.boardProvider.projectNumber || '')}
                      onChange={(e) =>
                        updateField('boardProvider', {
                          ...form.boardProvider,
                          projectNumber: e.target.value ? Number(e.target.value) : undefined,
                        })
                      }
                      helperText="GitHub Projects V2 project number"
                    />
                    <Input
                      label="Repository"
                      value={form.boardProvider.repo || ''}
                      onChange={(e) =>
                        updateField('boardProvider', {
                          ...form.boardProvider,
                          repo: e.target.value || undefined,
                        })
                      }
                      helperText="owner/repo (auto-detected if empty)"
                    />
                  </>
                )}
                {form.boardProvider.provider === 'local' && (
                  <div className="md:col-span-2">
                    <p className="text-sm text-slate-400">
                      Local board uses SQLite for storage — no additional configuration needed.
                    </p>
                  </div>
                )}
              </div>
            )}
          </Card>

          <Card className="p-6">
            <h3 className="text-lg font-medium text-slate-200 mb-2">Notification Webhooks</h3>
            <WebhookEditor
              notifications={form.notifications}
              onChange={(notifications) => updateField('notifications', notifications)}
            />
          </Card>
        </div>
      ),
    },
    {
      id: 'advanced',
      label: 'Advanced',
      content: (
        <Card className="p-6 space-y-6">
          <h3 className="text-lg font-medium text-slate-200">Advanced Settings</h3>
          <p className="text-sm text-slate-400">Templates, retry policy, and PRD execution priority</p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Input
              label="Templates Directory"
              value={form.templatesDir}
              onChange={(e) => updateField('templatesDir', e.target.value)}
              helperText="Directory for custom template overrides"
            />
            <Input
              label="Max Retries"
              type="number"
              min="1"
              value={String(form.maxRetries)}
              onChange={(e) => {
                const val = Math.max(1, Number(e.target.value || 1));
                updateField('maxRetries', val);
              }}
              helperText="Retry attempts for rate-limited API calls"
            />
          </div>

          <div className="pt-4 border-t border-slate-800 space-y-4">
            <TagInput
              label="PRD Priority"
              value={form.prdPriority}
              onChange={(priority) => updateField('prdPriority', priority)}
              placeholder="e.g., feature-x"
              helpText="PRDs matching these names are executed first"
            />
          </div>
        </Card>
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

      {/* Preset Form Modal */}
      <PresetFormModal
        isOpen={presetModalOpen}
        onClose={() => {
          setPresetModalOpen(false);
          setEditingPresetId(null);
          setEditingPreset(null);
        }}
        onSave={handleSavePreset}
        presetId={editingPresetId}
        preset={editingPreset}
        isBuiltIn={editingPresetId ? BUILT_IN_PRESET_IDS.includes(editingPresetId) : false}
        existingIds={Object.keys(getAllPresets())}
      />

      {/* Delete Warning Modal */}
      {deleteWarning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setDeleteWarning(null)}
            aria-hidden="true"
          />
          <div className="relative w-full max-w-md transform rounded-xl bg-slate-900 border border-slate-800 shadow-2xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <AlertTriangle className="h-6 w-6 text-amber-400" />
              <h3 className="text-lg font-semibold text-slate-100">Cannot Delete Preset</h3>
            </div>
            <p className="text-sm text-slate-300 mb-4">
              <strong>{deleteWarning.presetName}</strong> is currently assigned to the following jobs:
            </p>
            <ul className="list-disc list-inside text-sm text-slate-400 mb-4">
              {deleteWarning.references.map((ref) => (
                <li key={ref}>{ref}</li>
              ))}
            </ul>
            <p className="text-sm text-slate-400 mb-6">
              Please remove these assignments before deleting the preset, or use &quot;Force Delete&quot; to remove
              the preset and clear all references.
            </p>
            <div className="flex justify-end gap-3">
              <Button variant="ghost" onClick={() => setDeleteWarning(null)}>
                Cancel
              </Button>
              <Button variant="secondary" onClick={handleConfirmDelete} className="bg-red-600 hover:bg-red-700">
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
