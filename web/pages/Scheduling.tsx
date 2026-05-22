import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  Pause,
  Play,
  AlertCircle,
  Zap,
  Settings2,
  ListRestart,
  RefreshCw,
  Trash2,
  Search,
  BarChart3,
  Layout,
  GitMerge,
  GitPullRequest,
  ClipboardList,
  Save,
  RotateCcw,
  AlertTriangle,
} from 'lucide-react';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import Select from '../components/ui/Select';
import Switch from '../components/ui/Switch';
import Input from '../components/ui/Input';
import Badge from '../components/ui/Badge';
import Tabs from '../components/ui/Tabs';
import LoadingState from '../components/ui/LoadingState';
import ScheduleTimeline from '../components/scheduling/ScheduleTimeline.js';
import ScheduleConfig from '../components/scheduling/ScheduleConfig.js';
import JobsTab from './settings/JobsTab.js';
import { useStore } from '../store/useStore';
import type {
  IAnalyticsConfig,
  IAuditConfig,
  IFeedbackConfig,
  IJobProviders,
  IManagerConfig,
  IMergerConfig,
  INightWatchConfig,
  IPrResolverConfig,
  IProviderPreset,
  IQaConfig,
  IQueueAnalytics,
  IQueueStatus,
  IRoadmapScannerConfig,
  IUxConfig,
  QueueMode,
} from '../api';
import {
  fetchScheduleInfo,
  fetchConfig,
  fetchAllConfigs,
  fetchQueueStatus,
  fetchQueueAnalytics,
  updateConfig,
  triggerInstallCron,
  triggerUninstallCron,
  triggerJob,
  triggerClearQueue,
  toggleRoadmapScanner,
  useApi,
} from '../api';
import {
  formatRelativeTime,
  getTemplateById,
  resolveActiveTemplate,
  IScheduleTemplate,
} from '../utils/cron';
import {
  DEFAULT_EXECUTOR_SCHEDULE,
  DEFAULT_REVIEWER_SCHEDULE,
  getDefaultAnalyticsConfig,
  getDefaultAuditConfig,
  getDefaultManagerConfig,
  getDefaultMergerConfig,
  getDefaultPrResolverConfig,
  getDefaultQaConfig,
  getDefaultRoadmapScannerConfig,
  getDefaultUxConfig,
} from '../utils/scheduling-defaults.js';
import { BUILT_IN_PRESETS } from '../constants/presets.js';

type AutomationForm = {
  cronSchedule: string;
  reviewerSchedule: string;
  scheduleBundleId: string | null;
  cronScheduleOffset: number;
  schedulingPriority: number;
  executorEnabled: boolean;
  reviewerEnabled: boolean;
  maxRuntime: number;
  reviewerMaxRuntime: number;
  maxRetries: number;
  reviewerMaxRetries: number;
  reviewerRetryDelay: number;
  reviewerMaxPrsPerRun: number;
  minReviewScore: number;
  branchPatterns: string[];
  providerEnv: Record<string, string>;
  jobProviders: IJobProviders;
  providerPresets: Record<string, IProviderPreset>;
  qa: IQaConfig;
  audit: IAuditConfig;
  ux: IUxConfig;
  analytics: IAnalyticsConfig;
  feedback: IFeedbackConfig;
  prResolver: IPrResolverConfig;
  merger: IMergerConfig;
  manager: IManagerConfig;
  roadmapScanner: IRoadmapScannerConfig;
  queue: NonNullable<INightWatchConfig['queue']>;
};

const DEFAULT_QUEUE: NonNullable<INightWatchConfig['queue']> = {
  enabled: true,
  mode: 'conservative' as QueueMode,
  maxConcurrency: 1,
  maxWaitTime: 7200,
  priority: { executor: 50, reviewer: 40, slicer: 30, manager: 25, qa: 20, audit: 10, ux: 10 },
  providerBuckets: {},
};

const JOB_PROVIDER_KEYS: Array<keyof IJobProviders> = [
  'executor',
  'reviewer',
  'qa',
  'audit',
  'ux',
  'slicer',
  'analytics',
  'pr-resolver',
  'merger',
  'manager',
];

const VALID_AUTOMATION_TABS = new Set(['overview', 'schedules', 'jobs']);

const normalizeJobType = (jobId: string | null): string | null => {
  if (!jobId) return null;
  const normalized = jobId === 'planner' ? 'slicer' : jobId;
  return ['executor', 'reviewer', 'qa', 'audit', 'ux', 'slicer', 'analytics', 'pr-resolver', 'merger', 'manager'].includes(normalized)
    ? normalized
    : null;
};

const toAutomationForm = (config: INightWatchConfig): AutomationForm => ({
  cronSchedule: config.cronSchedule || DEFAULT_EXECUTOR_SCHEDULE,
  reviewerSchedule: config.reviewerSchedule || DEFAULT_REVIEWER_SCHEDULE,
  scheduleBundleId: config.scheduleBundleId ?? null,
  cronScheduleOffset: config.cronScheduleOffset ?? 0,
  schedulingPriority: config.schedulingPriority ?? 3,
  executorEnabled: config.executorEnabled ?? true,
  reviewerEnabled: config.reviewerEnabled ?? false,
  maxRuntime: config.maxRuntime ?? 3600,
  reviewerMaxRuntime: config.reviewerMaxRuntime ?? 1800,
  maxRetries: config.maxRetries ?? 3,
  reviewerMaxRetries: config.reviewerMaxRetries ?? 2,
  reviewerRetryDelay: config.reviewerRetryDelay ?? 30,
  reviewerMaxPrsPerRun: config.reviewerMaxPrsPerRun ?? 0,
  minReviewScore: config.minReviewScore ?? 70,
  branchPatterns: config.branchPatterns || [],
  providerEnv: config.providerEnv || {},
  jobProviders: config.jobProviders || {},
  providerPresets: config.providerPresets ?? {},
  qa: config.qa || getDefaultQaConfig(),
  audit: config.audit || getDefaultAuditConfig(),
  ux: config.ux || getDefaultUxConfig(),
  analytics: config.analytics || getDefaultAnalyticsConfig(),
  feedback: config.feedback ?? {
    enabled: true,
    confidenceThreshold: 0.75,
    augmentationTtlDays: 14,
    maxActiveAugmentations: 3,
    successStreakToExpire: 3,
  },
  prResolver: config.prResolver ?? getDefaultPrResolverConfig(),
  merger: config.merger ?? getDefaultMergerConfig(),
  manager: config.manager ?? getDefaultManagerConfig(),
  roadmapScanner: config.roadmapScanner || getDefaultRoadmapScannerConfig(),
  queue: config.queue || DEFAULT_QUEUE,
});

const resolveTemplateForForm = (form: AutomationForm): IScheduleTemplate | undefined =>
  resolveActiveTemplate(
    form.scheduleBundleId,
    form.cronSchedule,
    form.reviewerSchedule,
    form.qa.schedule,
    form.audit.schedule,
    form.ux.schedule,
    form.roadmapScanner.slicerSchedule ?? getDefaultRoadmapScannerConfig().slicerSchedule,
    form.prResolver?.schedule ?? getDefaultPrResolverConfig().schedule,
    form.merger?.schedule ?? getDefaultMergerConfig().schedule,
    form.manager?.schedule ?? getDefaultManagerConfig().schedule,
  );

const normalizeAutomationForm = (
  form: AutomationForm,
): { form: AutomationForm; detectedTemplate: IScheduleTemplate | undefined } => {
  const detectedTemplate = resolveTemplateForForm(form);
  if (!form.scheduleBundleId && detectedTemplate) {
    return {
      form: { ...form, scheduleBundleId: detectedTemplate.id },
      detectedTemplate,
    };
  }
  return { form, detectedTemplate };
};

const Scheduling: React.FC = () => {
  const location = useLocation();
  const { addToast, selectedProjectId, globalModeLoading } = useStore();

  // Overview tab state
  const [toggling, setToggling] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [showQueueSettings, setShowQueueSettings] = useState(false);
  const [triggeringJob, setTriggeringJob] = useState<string | null>(null);
  const [allProjectConfigs, setAllProjectConfigs] = useState<Array<{ projectId: string; config: INightWatchConfig }>>([]);
  const [queueStatus, setQueueStatus] = useState<IQueueStatus | null>(null);
  const [queueAnalytics, setQueueAnalytics] = useState<IQueueAnalytics | null>(null);
  const [liveDataLoading, setLiveDataLoading] = useState(true);

  // Schedules/Jobs form state
  const [activeTab, setActiveTab] = useState<string>('overview');
  const [expandedJob, setExpandedJob] = useState<string | null>(null);
  const [scheduleScrollTarget, setScheduleScrollTarget] = useState<string | null>(null);
  const [form, setForm] = useState<AutomationForm | null>(null);
  const [scheduleMode, setScheduleMode] = useState<'template' | 'custom'>('template');
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [isDirty, setIsDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const initialFormRef = useRef<AutomationForm | null>(null);
  const skipNextFormResetRef = useRef(false);
  const handledSearchRef = useRef<string | null>(null);

  const {
    data: scheduleInfo,
    loading: scheduleLoading,
    error: scheduleError,
    refetch: refetchSchedule,
  } = useApi(fetchScheduleInfo, [selectedProjectId], { enabled: !globalModeLoading });

  const {
    data: config,
    loading: configLoading,
    refetch: refetchConfig,
  } = useApi(fetchConfig, [selectedProjectId], { enabled: !globalModeLoading });

  // Refresh live data every 30 seconds
  useEffect(() => {
    if (globalModeLoading) return;
    let cancelled = false;
    setLiveDataLoading(true);
    setQueueStatus(null);
    setQueueAnalytics(null);
    setAllProjectConfigs([]);

    const fetchData = async (showLoading = false) => {
      if (showLoading) {
        setLiveDataLoading(true);
      }
      refetchSchedule();
      const [nextQueueStatus, nextQueueAnalytics, nextConfigs] = await Promise.all([
        fetchQueueStatus().catch(() => null),
        fetchQueueAnalytics(24).catch(() => null),
        fetchAllConfigs().catch(() => []),
      ]);
      if (cancelled) return;
      setQueueStatus(nextQueueStatus);
      setQueueAnalytics(nextQueueAnalytics);
      setAllProjectConfigs(nextConfigs);
      setLiveDataLoading(false);
    };
    fetchData(true);
    const interval = setInterval(() => {
      fetchData();
    }, 30000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [selectedProjectId, globalModeLoading, refetchSchedule]);

  // Init form from config
  useEffect(() => {
    if (!config) return;
    if (skipNextFormResetRef.current) {
      skipNextFormResetRef.current = false;
      return;
    }
    const { form: nextForm, detectedTemplate } = normalizeAutomationForm(toAutomationForm(config));
    setForm(nextForm);
    initialFormRef.current = nextForm;
    setScheduleMode(detectedTemplate ? 'template' : 'custom');
    setSelectedTemplateId(detectedTemplate?.id ?? '');
    setIsDirty(false);
  }, [config]);

  // Track dirty state
  useEffect(() => {
    if (!form || !initialFormRef.current) return;
    setIsDirty(JSON.stringify(form) !== JSON.stringify(initialFormRef.current));
  }, [form]);

  useEffect(() => {
    if (activeTab !== 'jobs' || !expandedJob) return;
    const timer = window.setTimeout(() => {
      const el = document.getElementById(`job-section-${expandedJob}`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);
    return () => window.clearTimeout(timer);
  }, [activeTab, expandedJob]);

  useEffect(() => {
    if (activeTab !== 'schedules' || scheduleMode !== 'custom' || !scheduleScrollTarget) return;
    const targetId = scheduleScrollTarget;
    const timer = window.setTimeout(() => {
      const el = document.getElementById(`job-schedule-${targetId}`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setScheduleScrollTarget(null);
    }, 100);
    return () => window.clearTimeout(timer);
  }, [activeTab, scheduleMode, scheduleScrollTarget]);

  const updateField = <K extends keyof AutomationForm>(key: K, value: AutomationForm[K]) => {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const switchToTemplateMode = () => {
    setScheduleMode('template');
    if (!form) return;
    const detected = resolveTemplateForForm(form);
    if (detected) {
      setSelectedTemplateId(detected.id);
      updateField('scheduleBundleId', detected.id);
      return;
    }

    const fallbackTemplate = getTemplateById(selectedTemplateId) ?? getTemplateById('always-on');
    if (fallbackTemplate) {
      applyTemplate(fallbackTemplate);
    }
  };

  const switchToCustomMode = () => {
    setScheduleMode('custom');
    updateField('scheduleBundleId', null);
    setSelectedTemplateId('');
  };

  const openScheduleEditor = (jobId: string) => {
    const registryId = normalizeJobType(jobId);
    if (!registryId) return;
    if (scheduleMode !== 'custom') {
      switchToCustomMode();
    }
    setActiveTab('schedules');
    setScheduleScrollTarget(registryId);
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
        ux: { ...prev.ux, schedule: tpl.schedules.ux },
        roadmapScanner: { ...prev.roadmapScanner, slicerSchedule: tpl.schedules.slicer },
        prResolver: { ...prev.prResolver, schedule: tpl.schedules.prResolver },
        merger: { ...prev.merger, schedule: tpl.schedules.merger },
        manager: { ...prev.manager, schedule: tpl.schedules.manager },
      };
    });
  };

  const handleSave = async () => {
    if (!form) return;
    setSaving(true);
    try {
      const cleanedJobProviders: Partial<Record<keyof IJobProviders, string | null>> = {};
      for (const jobType of JOB_PROVIDER_KEYS) {
        const provider = form.jobProviders[jobType];
        if (typeof provider === 'string' && provider.trim().length > 0) {
          cleanedJobProviders[jobType] = provider;
        } else if (config?.jobProviders[jobType]) {
          cleanedJobProviders[jobType] = null;
        }
      }

      const savedConfig = await updateConfig({
        cronSchedule: form.cronSchedule,
        reviewerSchedule: form.reviewerSchedule,
        scheduleBundleId: scheduleMode === 'template' ? form.scheduleBundleId : null,
        cronScheduleOffset: form.cronScheduleOffset,
        schedulingPriority: form.schedulingPriority,
        executorEnabled: form.executorEnabled,
        reviewerEnabled: form.reviewerEnabled,
        maxRuntime: form.maxRuntime,
        reviewerMaxRuntime: form.reviewerMaxRuntime,
        maxRetries: form.maxRetries,
        reviewerMaxRetries: form.reviewerMaxRetries,
        reviewerRetryDelay: form.reviewerRetryDelay,
        reviewerMaxPrsPerRun: form.reviewerMaxPrsPerRun,
        minReviewScore: form.minReviewScore,
        branchPatterns: form.branchPatterns,
        providerEnv: form.providerEnv,
        jobProviders: cleanedJobProviders,
        qa: form.qa,
        audit: form.audit,
        ux: form.ux,
        analytics: form.analytics,
        feedback: form.feedback,
        prResolver: form.prResolver,
        merger: form.merger,
        manager: form.manager,
        roadmapScanner: form.roadmapScanner,
        queue: form.queue,
      });

      const { form: updatedForm } = normalizeAutomationForm(toAutomationForm(savedConfig));
      setForm(updatedForm);
      initialFormRef.current = updatedForm;
      setIsDirty(false);

      let cronInstallFailed = '';
      try {
        await triggerInstallCron();
      } catch (cronErr) {
        cronInstallFailed = cronErr instanceof Error ? cronErr.message : 'Failed to reinstall cron';
      }

      addToast(
        cronInstallFailed
          ? { title: 'Saved (Cron Reinstall Failed)', message: cronInstallFailed, type: 'warning' }
          : { title: 'Saved', message: 'Configuration updated and cron schedules reinstalled.', type: 'success' },
      );

      skipNextFormResetRef.current = true;
      refetchConfig();
    } catch (err) {
      addToast({
        title: 'Save Failed',
        message: err instanceof Error ? err.message : 'Failed to save configuration',
        type: 'error',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    if (initialFormRef.current) {
      setForm(initialFormRef.current);
      const f = initialFormRef.current;
      const detected = resolveTemplateForForm(f);
      setScheduleMode(detected ? 'template' : 'custom');
      setSelectedTemplateId(detected?.id ?? '');
      setIsDirty(false);
    }
  };

  const handleRoadmapToggle = async (enabled: boolean) => {
    try {
      const updatedConfig = await toggleRoadmapScanner(enabled);
      const { form: updatedForm } = normalizeAutomationForm(toAutomationForm(updatedConfig));
      setForm(updatedForm);
      initialFormRef.current = updatedForm;
      setIsDirty(false);
      let cronInstallFailed = '';
      try {
        await triggerInstallCron();
      } catch (cronErr) {
        cronInstallFailed = cronErr instanceof Error ? cronErr.message : 'Failed to reinstall cron';
      }
      addToast(
        cronInstallFailed
          ? { title: 'Saved (Cron Reinstall Failed)', message: cronInstallFailed, type: 'warning' }
          : {
              title: enabled ? 'Roadmap Scanner Enabled' : 'Roadmap Scanner Disabled',
              message: `Roadmap scanner has been ${enabled ? 'enabled' : 'disabled'}.`,
              type: 'success',
            },
      );
      skipNextFormResetRef.current = true;
      refetchConfig();
      refetchSchedule();
    } catch (err) {
      addToast({
        title: 'Toggle Failed',
        message: err instanceof Error ? err.message : 'Failed to toggle roadmap scanner',
        type: 'error',
      });
    }
  };

  const handlePauseResume = async () => {
    if (!scheduleInfo) return;
    setToggling(true);
    try {
      if (scheduleInfo.paused) {
        await triggerInstallCron();
        addToast({ title: 'Schedule Resumed', message: 'Cron schedules are active.', type: 'success' });
      } else {
        await triggerUninstallCron();
        addToast({ title: 'Schedule Paused', message: 'Cron schedules are deactivated.', type: 'info' });
      }
      refetchSchedule();
    } catch (error) {
      addToast({ title: 'Action Failed', message: error instanceof Error ? error.message : 'Toggle failed', type: 'error' });
    } finally {
      setToggling(false);
    }
  };

  const handleClearQueue = async () => {
    if (!window.confirm('Are you sure you want to clear all pending jobs?')) return;
    setClearing(true);
    try {
      const res = await triggerClearQueue();
      addToast({ title: 'Queue Cleared', message: `Removed ${res.cleared} pending jobs.`, type: 'success' });
      fetchQueueStatus().then(setQueueStatus);
    } catch (error) {
      addToast({ title: 'Clear Failed', message: error instanceof Error ? error.message : 'Failed to clear queue', type: 'error' });
    } finally {
      setClearing(false);
    }
  };

  const updateQueueConfig = async (changes: Partial<INightWatchConfig['queue']>) => {
    if (!form) return;
    setSaving(true);
    try {
      const savedConfig = await updateConfig({ queue: { ...form.queue, ...changes } });
      const { form: updatedForm } = normalizeAutomationForm(toAutomationForm(savedConfig));
      setForm(updatedForm);
      initialFormRef.current = updatedForm;
      setIsDirty(false);
      addToast({ title: 'Settings Saved', message: 'Queue configuration updated.', type: 'success' });
      skipNextFormResetRef.current = true;
      refetchConfig();
      refetchSchedule();
    } catch (error) {
      addToast({ title: 'Save Failed', message: error instanceof Error ? error.message : 'Save failed', type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handleTriggerJob = async (jobId: string) => {
    const registryId = jobId === 'planner' ? 'slicer' : jobId;
    setTriggeringJob(jobId);
    try {
      await triggerJob(registryId);
      addToast({ title: 'Job Triggered', message: `${jobId} job queued successfully.`, type: 'success' });
    } catch (error) {
      addToast({ title: 'Trigger Failed', message: error instanceof Error ? error.message : 'Failed to trigger job', type: 'error' });
    } finally {
      setTriggeringJob(null);
    }
  };

  const goToJobSettings = (jobId: string) => {
    const registryId = normalizeJobType(jobId);
    if (!registryId) return;
    setActiveTab('jobs');
    setExpandedJob(registryId);
  };

  useEffect(() => {
    if (!form) return;
    if (handledSearchRef.current === location.search) return;
    handledSearchRef.current = location.search;

    const params = new URLSearchParams(location.search);
    const requestedTab = params.get('tab');
    const normalizedTab = requestedTab === 'queue' ? 'overview' : requestedTab;
    const requestedMode = params.get('mode');
    const requestedJobType = normalizeJobType(params.get('jobType'));

    if (normalizedTab && VALID_AUTOMATION_TABS.has(normalizedTab)) {
      if (normalizedTab === 'jobs') {
        setActiveTab('jobs');
        if (requestedJobType) {
          setExpandedJob(requestedJobType);
        }
        return;
      }

      if (normalizedTab === 'schedules') {
        if (requestedJobType) {
          openScheduleEditor(requestedJobType);
          return;
        }

        setActiveTab('schedules');
        if (requestedMode === 'custom' && scheduleMode !== 'custom') {
          switchToCustomMode();
        }
        if (requestedMode === 'template' && scheduleMode !== 'template') {
          switchToTemplateMode();
        }
        return;
      }

      setActiveTab(normalizedTab);
      return;
    }

    if (requestedMode === 'custom' && scheduleMode !== 'custom') {
      setActiveTab('schedules');
      switchToCustomMode();
    }
    if (requestedMode === 'template' && scheduleMode !== 'template') {
      setActiveTab('schedules');
      switchToTemplateMode();
    }
  }, [location.search, form, scheduleMode]);

  const presetOptions = useMemo(() => {
    const allPresets: Record<string, IProviderPreset> = { ...BUILT_IN_PRESETS, ...(form?.providerPresets ?? {}) };
    return Object.entries(allPresets).map(([id, preset]) => ({
      label: preset.name || id,
      value: id,
    }));
  }, [form?.providerPresets]);

  if (scheduleLoading || configLoading || !form) {
    return (
      <LoadingState
        message="Loading automation"
        detail="Fetching schedules, queue state, and job configuration."
      />
    );
  }

  if (scheduleError || !scheduleInfo || !config) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] space-y-4">
        <AlertCircle className="h-10 w-10 text-red-500" />
        <div className="text-slate-300 font-medium">Failed to load scheduling data</div>
        <Button onClick={() => { refetchSchedule(); refetchConfig(); }}>Retry</Button>
      </div>
    );
  }

  const isPaused = scheduleInfo.paused;
  const activeTemplate = form ? resolveTemplateForForm(form) : undefined;

  const overviewTabContent = (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
      {/* Left Column: Queue Management */}
      <div className="lg:col-span-2 space-y-8">
        {/* Queue Status Card */}
        <Card className="overflow-hidden border-slate-800">
          <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-slate-900/30">
            <div className="flex items-center gap-3">
              <Zap className="h-5 w-5 text-indigo-400" />
              <h3 className="font-semibold text-slate-200">Execution Queue</h3>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClearQueue}
                loading={clearing}
                disabled={!queueStatus?.items.length}
                className="text-slate-500 hover:text-red-400 hover:bg-red-400/10"
              >
                <Trash2 className="h-4 w-4 mr-1.5" />
                Clear
              </Button>
              <div
                className={`p-1.5 rounded-lg cursor-pointer hover:bg-slate-800 transition-colors ${showQueueSettings ? 'text-indigo-400 bg-slate-800' : 'text-slate-500'}`}
                onClick={() => setShowQueueSettings(!showQueueSettings)}
                title="Automation Settings"
              >
                <Settings2 className="h-5 w-5" />
              </div>
            </div>
          </div>

          {/* Automation Settings (Collapsible) */}
          <div className={`transition-all duration-300 overflow-hidden ${showQueueSettings ? 'max-h-[500px]' : 'max-h-0'}`}>
            <div className="p-6 bg-slate-950/40 border-b border-slate-800 grid grid-cols-1 md:grid-cols-2 gap-6">
              <Select
                label="Dispatch Mode"
                value={form?.queue?.mode || 'auto'}
                onChange={(val) => updateQueueConfig({ mode: val as QueueMode })}
                options={[
                  { label: 'Auto (Recommended)', value: 'auto' },
                  { label: 'Conservative (1 at a time)', value: 'conservative' },
                  { label: 'Provider-aware', value: 'provider-aware' },
                ]}
              />
              <Input
                label="Max Concurrency"
                type="number"
                min="1"
                max="20"
                value={String(form?.queue?.maxConcurrency || 1)}
                onChange={(e) => updateQueueConfig({ maxConcurrency: Number(e.target.value) })}
              />
              <div className="md:col-span-2 flex items-center gap-3">
                <Switch
                  label="Coordinator Enabled"
                  checked={form?.queue?.enabled ?? true}
                  onChange={(val) => updateQueueConfig({ enabled: val })}
                />
              </div>
            </div>
          </div>

          {/* Live Queue Table */}
          <div className="p-0">
            {liveDataLoading && !queueStatus ? (
              <LoadingState variant="inline" message="Loading queue" />
            ) : !queueStatus?.items.length ? (
              <div className="py-12 flex flex-col items-center justify-center text-slate-500 text-sm italic">
                <div className="mb-3 p-3 rounded-full bg-slate-900 border border-slate-800">
                  <ListRestart className="h-6 w-6 opacity-30" />
                </div>
                Queue is empty
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold bg-slate-900/20">
                    <tr>
                      <th className="px-6 py-3">Job / Project</th>
                      <th className="px-6 py-3">Status</th>
                      <th className="px-6 py-3">Wait Time</th>
                      <th className="px-6 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/40">
                    {queueStatus.items.map((item) => (
                      <tr key={item.id} className="hover:bg-slate-800/20 transition-colors group">
                        <td className="px-6 py-4">
                          <div className="font-medium text-slate-200">{item.jobType}</div>
                          <div className="text-[11px] text-slate-500 truncate max-w-[200px]" title={item.projectPath}>
                            {item.projectName || item.projectPath}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <Badge variant={item.status === 'running' ? 'info' : 'neutral'} className="text-[10px]">
                            {item.status}
                          </Badge>
                        </td>
                        <td className="px-6 py-4 text-slate-400 font-mono text-xs">
                          {formatRelativeTime(new Date(item.enqueuedAt * 1000))}
                        </td>
                        <td className="px-6 py-4 text-right">
                          <button
                            onClick={() => goToJobSettings(item.jobType)}
                            className="opacity-0 group-hover:opacity-100 p-2 text-slate-500 hover:text-indigo-400 transition-all"
                            title="Configure Job"
                          >
                            <Settings2 className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </Card>

        {/* Timeline Section */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-slate-200">Operational Timeline</h3>
            <div className="text-xs text-slate-500 flex items-center gap-2">
              <RefreshCw className="h-3 w-3 animate-spin-slow" /> Live Update
            </div>
          </div>
          {liveDataLoading && allProjectConfigs.length === 0 ? (
            <LoadingState variant="card" message="Loading timeline" rows={2} />
          ) : (
            <ScheduleTimeline
              configs={allProjectConfigs}
              currentProjectId={selectedProjectId ?? undefined}
              onEditJob={(_projectId, jobType) => goToJobSettings(jobType)}
              queueStatus={queueStatus}
              queueAnalytics={queueAnalytics}
            />
          )}
        </section>

        {/* Execution History */}
        <section className="space-y-4">
          <h3 className="text-lg font-semibold text-slate-200">Execution History (Last 24h)</h3>
          <Card className="border-slate-800 overflow-hidden">
            {liveDataLoading && !queueAnalytics ? (
              <LoadingState variant="inline" message="Loading execution history" />
            ) : !queueAnalytics?.recentRuns.length ? (
              <div className="py-20 text-center text-slate-500 italic text-sm">No recorded runs in the last 24 hours.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold bg-slate-900/20">
                    <tr>
                      <th className="px-6 py-4">Job Type</th>
                      <th className="px-6 py-4">Status</th>
                      <th className="px-6 py-4">Duration</th>
                      <th className="px-6 py-4">Started</th>
                      <th className="px-6 py-4 text-right">Provider</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/40">
                    {queueAnalytics.recentRuns.map((run) => (
                      <tr key={run.id} className="hover:bg-slate-800/10 transition-colors">
                        <td className="px-6 py-4">
                          <span className="font-medium text-slate-300 capitalize">{run.jobType}</span>
                        </td>
                        <td className="px-6 py-4">
                          <Badge
                            variant={run.status === 'finished' ? 'success' : run.status === 'failed' ? 'error' : 'neutral'}
                            className="text-[10px]"
                          >
                            {run.status}
                          </Badge>
                        </td>
                        <td className="px-6 py-4 text-slate-400">
                          {run.durationSeconds ? `${run.durationSeconds}s` : '--'}
                        </td>
                        <td className="px-6 py-4 text-slate-500 text-xs">
                          {formatRelativeTime(new Date(run.startedAt * 1000))}
                        </td>
                        <td className="px-6 py-4 text-right text-slate-500 font-mono text-xs">
                          {run.providerKey || 'default'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </section>
      </div>

      {/* Right Column: Mini Stats & Quick Actions */}
      <div className="space-y-6">
        <Card className="p-5 space-y-4 border-slate-800 bg-slate-900/20">
          <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest">Automation Controls</h4>
          <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
            <div className="text-[10px] text-slate-500 uppercase">Schedule Template</div>
            <div className="mt-1 text-sm font-medium text-slate-200">
              {activeTemplate?.label ?? 'Custom'}
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {activeTemplate?.description ?? 'Custom cron expressions are active for this project.'}
            </p>
          </div>
          <Select
            label="Scheduling Priority"
            value={String(form.schedulingPriority)}
            onChange={(val) => updateField('schedulingPriority', Number(val))}
            options={[
              { label: '1 - Lowest', value: '1' },
              { label: '2 - Low', value: '2' },
              { label: '3 - Balanced', value: '3' },
              { label: '4 - High', value: '4' },
              { label: '5 - Highest', value: '5' },
            ]}
            helperText="Higher-priority projects get earlier balanced start slots and win queue tie-breakers first."
          />
          <Input
            label="Extra Start Delay"
            type="number"
            min="0"
            max="59"
            value={String(form.cronScheduleOffset)}
            onChange={(e) =>
              updateField('cronScheduleOffset', Math.min(59, Math.max(0, Number(e.target.value || 0))))
            }
            helperText="Manual delay in minutes added before cron jobs start. This stacks on top of automatic balancing."
          />
        </Card>

        <Card className="p-5 space-y-4 border-slate-800 bg-slate-900/20">
          <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest">Efficiency Stats</h4>
          <div className="grid grid-cols-1 gap-4">
            <div className="p-4 rounded-xl border border-slate-800 bg-slate-950/40">
              <div className="text-[10px] text-slate-500 uppercase">Avg Wait Time</div>
              <div className="text-xl font-bold text-slate-200 mt-1">
                {queueStatus?.averageWaitSeconds ? (queueStatus.averageWaitSeconds / 60).toFixed(1) : '0'}{' '}
                <span className="text-xs font-normal text-slate-500">min</span>
              </div>
            </div>
            <div className="p-4 rounded-xl border border-slate-800 bg-slate-950/40">
              <div className="text-[10px] text-slate-500 uppercase">Oldest Pending</div>
              <div className="text-xl font-bold text-slate-200 mt-1">
                {queueStatus?.oldestPendingAge ? (queueStatus.oldestPendingAge / 60).toFixed(1) : '0'}{' '}
                <span className="text-xs font-normal text-slate-500">min</span>
              </div>
            </div>
          </div>
        </Card>

        {/* Quick Trigger List */}
        <Card className="divide-y divide-slate-800 border-slate-800">
          <div className="p-4 bg-slate-900/30">
            <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest">Manual Trigger</h4>
          </div>
          <div className="p-2 space-y-1">
            {[
              { id: 'executor', label: 'Run Executor', icon: Play, enabled: form?.executorEnabled !== false },
              { id: 'reviewer', label: 'Run Reviewer', icon: Search, enabled: form?.reviewerEnabled ?? false },
              { id: 'qa', label: 'Run QA', icon: Zap, enabled: form?.qa?.enabled ?? false },
              { id: 'audit', label: 'Run Audit', icon: ListRestart, enabled: form?.audit?.enabled ?? false },
              { id: 'ux', label: 'Run UX', icon: Eye, enabled: form?.ux?.enabled ?? false },
              { id: 'planner', label: 'Run Planner', icon: Layout, enabled: form?.roadmapScanner?.enabled ?? false },
              { id: 'analytics', label: 'Run Analytics', icon: BarChart3, enabled: form?.analytics?.enabled ?? false },
              { id: 'pr-resolver', label: 'Run PR Resolver', icon: GitMerge, enabled: form?.prResolver?.enabled ?? false },
              { id: 'merger', label: 'Run Merger', icon: GitPullRequest, enabled: form?.merger?.enabled ?? false },
              { id: 'manager', label: 'Run Manager', icon: ClipboardList, enabled: form?.manager?.enabled ?? false },
            ].map((job) => (
              <button
                key={job.id}
                onClick={() => handleTriggerJob(job.id)}
                disabled={triggeringJob === job.id || !job.enabled}
                className={`w-full flex items-center justify-between p-3 rounded-lg text-sm transition-colors group disabled:cursor-not-allowed ${
                  job.enabled ? 'text-slate-300 hover:bg-slate-800/40' : 'text-slate-600 opacity-50'
                }`}
              >
                <div className="flex items-center gap-3">
                  <job.icon className={`h-4 w-4 ${job.enabled ? 'text-slate-500 group-hover:text-indigo-400' : 'text-slate-700'}`} />
                  {job.label}
                </div>
                {triggeringJob === job.id ? (
                  <RefreshCw className="h-3 w-3 animate-spin text-indigo-400" />
                ) : job.enabled ? (
                  <Play className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-all fill-current text-indigo-400" />
                ) : (
                  <span className="text-[10px] text-slate-600 uppercase tracking-wider">Off</span>
                )}
              </button>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );

  const schedulesTabContent = form ? (
    <ScheduleConfig
      form={{
        cronSchedule: form.cronSchedule,
        reviewerSchedule: form.reviewerSchedule,
        qa: form.qa,
        audit: form.audit,
        ux: form.ux,
        analytics: form.analytics,
        roadmapScanner: {
          ...form.roadmapScanner,
          slicerSchedule: form.roadmapScanner.slicerSchedule ?? getDefaultRoadmapScannerConfig().slicerSchedule,
        },
        prResolver: form.prResolver,
        merger: form.merger,
        manager: form.manager,
      }}
      scheduleMode={scheduleMode}
      selectedTemplateId={selectedTemplateId}
      onFieldChange={(field, value) => {
        updateField(field as keyof AutomationForm, value as never);
      }}
      onSwitchToTemplate={switchToTemplateMode}
      onSwitchToCustom={switchToCustomMode}
      onApplyTemplate={applyTemplate}
    />
  ) : null;

  const jobsTabContent = form ? (
    <JobsTab
      form={form}
      updateField={updateField as <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => void}
      handleRoadmapToggle={handleRoadmapToggle}
      presetOptions={presetOptions}
      expandedJob={expandedJob}
      onExpandedJobChange={setExpandedJob}
      onOpenSchedule={openScheduleEditor}
    />
  ) : null;

  const tabs = [
    { id: 'overview', label: 'Overview', content: overviewTabContent },
    { id: 'schedules', label: 'Schedules', content: schedulesTabContent },
    { id: 'jobs', label: 'Jobs', content: jobsTabContent },
  ];

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-20">
      {/* Header & Main Toggle */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h2 className="text-2xl font-bold text-slate-100 flex items-center gap-3">
            Automation
            <Badge variant={isPaused ? 'warning' : 'success'} className="px-3 py-1 text-xs uppercase tracking-wider">
              {isPaused ? 'Paused' : 'Active'}
            </Badge>
          </h2>
          <p className="text-sm text-slate-400 mt-1">Manage automation overview, schedules, jobs, and live queue</p>
        </div>

        <Button
          variant={isPaused ? 'primary' : 'outline'}
          size="lg"
          className={isPaused ? 'bg-emerald-600 hover:bg-emerald-700' : 'border-slate-700 hover:bg-slate-800'}
          onClick={handlePauseResume}
          loading={toggling}
        >
          {isPaused ? (
            <><Play className="h-5 w-5 mr-2 fill-current" /> Resume Scheduling</>
          ) : (
            <><Pause className="h-5 w-5 mr-2" /> Pause Scheduling</>
          )}
        </Button>
      </div>

      <Tabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />

      {/* Sticky Save Banner for editable automation settings */}
      {isDirty && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 w-full max-w-2xl px-4 animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div className="bg-slate-900/90 backdrop-blur-md border border-indigo-500/30 rounded-2xl p-4 shadow-2xl flex items-center justify-between shadow-indigo-500/10">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-indigo-500/20 text-indigo-400">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <div className="text-sm font-semibold text-slate-200">Unsaved changes</div>
                <div className="text-[11px] text-slate-400">Save to apply and reinstall cron schedules</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={handleReset} className="text-slate-400">
                <RotateCcw className="h-4 w-4 mr-1.5" />
                Reset
              </Button>
              <Button variant="primary" size="sm" onClick={handleSave} loading={saving}>
                <Save className="h-4 w-4 mr-1.5" />
                Save
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Scheduling;
