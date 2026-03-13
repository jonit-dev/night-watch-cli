import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Pause,
  Play,
  Clock,
  Check,
  AlertCircle,
  Calendar,
  TestTube2,
  Search,
  ClipboardList,
  BarChart2,
  Plus,
  Trash2,
  Zap,
} from 'lucide-react';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import Input from '../components/ui/Input';
import Select from '../components/ui/Select';
import Switch from '../components/ui/Switch';
import Tabs from '../components/ui/Tabs';
import ScheduleTimeline from '../components/scheduling/ScheduleTimeline.js';
import ProviderLanesChart from '../components/scheduling/ProviderLanesChart.js';
import ProviderBucketSummary from '../components/scheduling/ProviderBucketSummary.js';
import RecentRunsChart from '../components/scheduling/RecentRunsChart.js';
import { useStore } from '../store/useStore';
import type { INightWatchConfig, IQueueAnalytics, IQueueStatus, QueueMode } from '../api';
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
  useApi,
} from '../api';
import {
  cronToHuman,
  isCronEquivalent,
  resolveActiveTemplate,
  formatRelativeTime,
  formatAbsoluteTime,
  isWithin30Minutes,
} from '../utils/cron';
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

interface IProviderBucketEntry {
  key: string;
  maxConcurrency: number;
}

interface IQueueEditState {
  isDirty: boolean;
  enabled: boolean;
  queueMode: QueueMode;
  globalMaxConcurrency: number;
  providerBuckets: IProviderBucketEntry[];
}

interface IAgentInfo {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  enabled: boolean;
  schedule: string;
  nextRun: string | null;
  delayInfo?: {
    delayMinutes: number;
    manualDelayMinutes: number;
    balancedDelayMinutes: number;
  };
}

const Scheduling: React.FC = () => {
  const navigate = useNavigate();
  const { addToast, selectedProjectId, globalModeLoading } = useStore();
  const [activeTab, setActiveTab] = useState('overview');
  const [toggling, setToggling] = useState(false);
  const [saving, setSaving] = useState(false);
  const [triggeringJob, setTriggeringJob] = useState<string | null>(null);

  const [allProjectConfigs, setAllProjectConfigs] = useState<Array<{ projectId: string; config: INightWatchConfig }>>([]);
  const [queueStatus, setQueueStatus] = useState<IQueueStatus | null>(null);
  const [queueAnalytics, setQueueAnalytics] = useState<IQueueAnalytics | null>(null);

  const [editState, setEditState] = useState<IQueueEditState>({
    isDirty: false,
    enabled: true,
    queueMode: 'auto',
    globalMaxConcurrency: 1,
    providerBuckets: [],
  });

  const [newBucketKey, setNewBucketKey] = useState('');
  const [newBucketConcurrency, setNewBucketConcurrency] = useState('1');
  const [showAddBucket, setShowAddBucket] = useState(false);

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

  // Refetch schedule info every 30 seconds for countdown updates
  useEffect(() => {
    const interval = setInterval(() => {
      refetchSchedule();
    }, 30000);
    return () => clearInterval(interval);
  }, [refetchSchedule]);

  // Fetch all project configs for the timeline
  useEffect(() => {
    if (globalModeLoading) return;
    fetchAllConfigs().then(setAllProjectConfigs).catch(console.error);
  }, [selectedProjectId, globalModeLoading]);

  // Fetch queue status and analytics, refresh every 30 seconds
  useEffect(() => {
    if (globalModeLoading) return;
    const fetchDashboard = () => {
      fetchQueueStatus()
        .then(setQueueStatus)
        .catch(() => { /* silently ignore */ });
      fetchQueueAnalytics(24)
        .then(setQueueAnalytics)
        .catch(() => { /* silently ignore */ });
    };
    fetchDashboard();
    const interval = setInterval(fetchDashboard, 30000);
    return () => clearInterval(interval);
  }, [globalModeLoading, selectedProjectId]);
  // Initialize edit state when config loads
  useEffect(() => {
    if (config && !editState.isDirty) {
      const rawBuckets = config.queue?.providerBuckets ?? {};
      setEditState({
        isDirty: false,
        enabled: config.queue?.enabled ?? true,
        queueMode: config.queue?.mode ?? 'auto',
        globalMaxConcurrency: config.queue?.maxConcurrency ?? 1,
        providerBuckets: Object.entries(rawBuckets).map(([key, val]) => ({
          key,
          maxConcurrency: val.maxConcurrency,
        })),
      });
    }
  }, [config, editState.isDirty]);
  const syncScheduleState = () => {
    refetchConfig();
    refetchSchedule();
  };
  const formatErrorMessage = (error: unknown, fallback: string) =>
    error instanceof Error ? error.message : fallback;
  const handlePauseResume = async () => {
    if (!scheduleInfo) return;
    setToggling(true);
    try {
      if (scheduleInfo.paused) {
        // Resume: install cron
        await triggerInstallCron();
        addToast({
          title: 'Schedule Resumed',
          message: 'Cron schedules have been reactivated.',
          type: 'success',
        });
      } else {
        // Pause: uninstall cron
        await triggerUninstallCron();
        addToast({
          title: 'Schedule Paused',
          message: 'Cron schedules have been deactivated.',
          type: 'info',
        });
      }
      syncScheduleState();
    } catch (error) {
      addToast({
        title: 'Action Failed',
        message: formatErrorMessage(error, 'Failed to toggle schedule state'),
        type: 'error',
      });
    } finally {
      setToggling(false);
    }
  };

  const openSettingsTab = (tab: 'jobs' | 'schedules', jobId?: string) => {
    const params = new URLSearchParams({ tab });
    if (tab === 'schedules') {
      params.set('mode', 'custom');
    }
    if (jobId) {
      params.set('jobType', jobId === 'planner' ? 'slicer' : jobId);
    }
    navigate(`/settings?${params.toString()}`);
  };

  const handleTriggerJob = async (jobId: string) => {
    // Map legacy 'planner' ID to registry 'slicer' ID
    const registryId = jobId === 'planner' ? 'slicer' : jobId;
    setTriggeringJob(jobId);
    try {
      await triggerJob(registryId);
      addToast({
        title: 'Job Triggered',
        message: `${jobId[0].toUpperCase() + jobId.slice(1)} job has been queued.`,
        type: 'success',
      });
      refetchSchedule();
    } catch (error) {
      addToast({
        title: 'Trigger Failed',
        message: formatErrorMessage(error, `Failed to trigger ${jobId} job`),
        type: 'error',
      });
    } finally {
      setTriggeringJob(null);
    }
  };

  const handleSaveQueueSettings = async () => {
    if (!config) return;
    setSaving(true);
    try {
      await updateConfig({
        queue: {
          ...config.queue,
          enabled: editState.enabled,
          mode: editState.queueMode,
          maxConcurrency: editState.globalMaxConcurrency,
          providerBuckets: Object.fromEntries(
            editState.providerBuckets.map((b) => [b.key, { maxConcurrency: b.maxConcurrency }]),
          ),
        },
      });
      setEditState((prev) => ({ ...prev, isDirty: false }));
      syncScheduleState();
      addToast({
        title: 'Parallelism Updated',
        message: 'Queue coordination settings were saved.',
        type: 'success',
      });
    } catch (error) {
      addToast({
        title: 'Save Failed',
        message: formatErrorMessage(error, 'Failed to save queue settings'),
        type: 'error',
      });
    } finally {
      setSaving(false);
    }
  };
  const renderNextRun = (nextRunStr: string | null | undefined) => {
    if (!nextRunStr) {
      return <span className="text-slate-500">Not scheduled</span>;
    }
    const nextRun = new Date(nextRunStr);
    const isSoon = isWithin30Minutes(nextRun);
    return (
      <div className="flex items-center space-x-2">
        {isSoon && (
          <span className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
          </span>
        )}
        <div className="text-sm">
          <span className="text-slate-200 font-medium">{formatRelativeTime(nextRun)}</span>
          <span className="text-slate-500 ml-2">({formatAbsoluteTime(nextRun)})</span>
        </div>
      </div>
    );
  };
  const renderDelayNote = (
    jobInfo:
      | {
          delayMinutes: number;
          manualDelayMinutes: number;
          balancedDelayMinutes: number;
        }
      | undefined,
  ) => {
    if (!jobInfo || jobInfo.delayMinutes <= 0) {
      return <div className="text-xs text-slate-500 mt-2">Starts directly at the scheduled time.</div>;
    }
    const parts: string[] = [];
    if (jobInfo.balancedDelayMinutes > 0) {
      parts.push(`auto +${jobInfo.balancedDelayMinutes}m`);
    }
    if (jobInfo.manualDelayMinutes > 0) {
      parts.push(`manual +${jobInfo.manualDelayMinutes}m`);
    }
    return (
      <div className="text-xs text-slate-500 mt-2">
        Delayed after cron fire:
        <span className="text-slate-300"> {parts.join(' - ')}</span>
      </div>
    );
  };
  // Agent definitions — must be above early returns (Rules of Hooks)
  const agents: IAgentInfo[] = useMemo(() => {
    if (!config || !scheduleInfo) return [];
    return [
    {
      id: 'executor',
      name: 'Executor',
      description: 'Creates implementation PRs from PRDs',
      icon: <Clock className="h-4 w-4" />,
      enabled: config?.executorEnabled !== false,
      schedule: scheduleInfo.executor.schedule,
      nextRun: scheduleInfo.executor.nextRun,
      delayInfo: scheduleInfo.executor,
    },
    {
      id: 'reviewer',
      name: 'Reviewer',
      description: 'Reviews PRs and manages merge readiness',
      icon: <Search className="h-4 w-4" />,
      enabled: config?.reviewerEnabled ?? false,
      schedule: scheduleInfo.reviewer.schedule,
      nextRun: scheduleInfo.reviewer.nextRun,
      delayInfo: scheduleInfo.reviewer,
    },
    {
      id: 'qa',
      name: 'QA',
      description: 'Generates and runs quality checks on PRs',
      icon: <TestTube2 className="h-4 w-4" />,
      enabled: config?.qa?.enabled ?? false,
      schedule: scheduleInfo.qa?.schedule,
      nextRun: scheduleInfo.qa?.nextRun,
      delayInfo: scheduleInfo.qa,
    },
    {
      id: 'audit',
      name: 'Auditor',
      description: 'Runs automated audit reports',
      icon: <ClipboardList className="h-4 w-4" />,
      enabled: config?.audit?.enabled ?? false,
      schedule: scheduleInfo.audit?.schedule,
      nextRun: scheduleInfo.audit?.nextRun,
      delayInfo: scheduleInfo.audit,
    },
    {
      id: 'planner',
      name: 'Planner',
      description: 'Creates PRDs from audit findings and pending roadmap items',
      icon: <ClipboardList className="h-4 w-4" />,
      enabled: config?.roadmapScanner?.enabled ?? false,
      schedule:
        scheduleInfo.planner?.schedule ||
        config.roadmapScanner?.slicerSchedule ||
        getDefaultRoadmapScannerConfig().slicerSchedule,
      nextRun: scheduleInfo.planner?.nextRun,
      delayInfo: scheduleInfo.planner,
    },
    {
      id: 'analytics',
      name: 'Analytics',
      description: 'Fetches Amplitude data, analyzes with AI, and creates board issues',
      icon: <BarChart2 className="h-4 w-4" />,
      enabled: config?.analytics?.enabled ?? false,
      schedule:
        scheduleInfo.analytics?.schedule ||
        config.analytics?.schedule ||
        getDefaultAnalyticsConfig().schedule,
      nextRun: scheduleInfo.analytics?.nextRun,
      delayInfo: scheduleInfo.analytics,
    },
    {
      id: 'pr-resolver',
      name: 'PR Resolver',
      description: 'Rebases conflicted PRs and optionally applies AI-powered review fixes',
      icon: <Search className="h-4 w-4" />,
      enabled: config?.prResolver?.enabled ?? getDefaultPrResolverConfig().enabled,
      schedule:
        scheduleInfo.prResolver?.schedule ||
        config.prResolver?.schedule ||
        getDefaultPrResolverConfig().schedule,
      nextRun: scheduleInfo.prResolver?.nextRun,
      delayInfo: scheduleInfo.prResolver,
    },
    {
      id: 'merger',
      name: 'Merger',
      description: 'Repo-wide PR merge orchestrator — merges eligible PRs in FIFO order',
      icon: <Zap className="h-4 w-4" />,
      enabled: config?.merger?.enabled ?? false,
      schedule:
        scheduleInfo.merger?.schedule ||
        config.merger?.schedule ||
        getDefaultMergerConfig().schedule,
      nextRun: scheduleInfo.merger?.nextRun,
      delayInfo: scheduleInfo.merger,
    },
  ]; }, [config, scheduleInfo]);

  if (scheduleLoading || configLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-slate-400">Loading scheduling information...</div>
      </div>
    );
  }
  if (scheduleError || !scheduleInfo || !config) {
    return (
      <div className="flex flex-col items-center justify-center h-full space-y-4">
        <AlertCircle className="h-12 w-12 text-red-400" />
        <div className="text-slate-300">Failed to load schedule information</div>
        <div className="text-sm text-slate-500">{scheduleError?.message || 'Unknown error'}</div>
        <Button onClick={() => { refetchSchedule(); refetchConfig(); }}>Retry</Button>
      </div>
    );
  }

  const isPaused = scheduleInfo.paused;
  const statusColor = isPaused ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' : 'bg-green-500/10 text-green-400 border-green-500/20';
  const statusText = isPaused ? 'Paused' : 'Active';
  const activeTemplate = resolveActiveTemplate(
    config.scheduleBundleId,
    config.cronSchedule,
    config.reviewerSchedule,
    config.qa?.schedule || getDefaultQaConfig().schedule,
    config.audit?.schedule || getDefaultAuditConfig().schedule,
    config.roadmapScanner?.slicerSchedule || getDefaultRoadmapScannerConfig().slicerSchedule,
    config.prResolver?.schedule ?? getDefaultPrResolverConfig().schedule,
    config.merger?.schedule ?? getDefaultMergerConfig().schedule,
  );
  const formatScheduleLabel = (
    job: 'executor' | 'reviewer' | 'qa' | 'audit' | 'slicer' | 'analytics' | 'prResolver' | 'merger',
    configuredCronExpr: string,
    displayedCronExpr: string,
  ): string => {
    if (!activeTemplate || job === 'analytics') {
      return cronToHuman(displayedCronExpr);
    }
    if (!isCronEquivalent(activeTemplate.schedules[job], configuredCronExpr)) {
      return cronToHuman(displayedCronExpr);
    }
    return `${activeTemplate.label} - ${activeTemplate.hints[job]}`;
  };

  const tabs = [
    {
      id: 'overview',
      label: 'Overview',
      content: (
        <div className="space-y-6">
          <Card className={`p-6 border-2 ${statusColor}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-4">
                <Clock className="h-8 w-8" />
                <div>
                  <div className="text-sm text-slate-400">Automation Status</div>
                  <div className="text-2xl font-bold">{statusText}</div>
                  <div className="text-sm text-slate-500 mt-1">
                    Automatic balancing spreads registered projects before queueing overlaps.
                  </div>
                </div>
              </div>
              <Button
                variant={isPaused ? 'primary' : 'outline'}
                size="lg"
                onClick={handlePauseResume}
                loading={toggling}
              >
                {isPaused ? (
                  <>
                    <Play className="h-5 w-5 mr-2" />
                    Resume
                  </>
                ) : (
                  <>
                    <Pause className="h-5 w-5 mr-2" />
                    Pause
                  </>
                )}
              </Button>
            </div>
          </Card>

          <Card className="p-6">
            <h3 className="text-lg font-semibold text-slate-200 mb-4">Agents</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {agents.map((agent) => (
                <div
                  key={agent.id}
                  className={`p-4 rounded-lg border ${agent.enabled ? 'border-slate-800' : 'border-slate-800 opacity-50'}`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      {agent.icon}
                      <div>
                        <h4 className="text-base font-semibold text-slate-200">{agent.name}</h4>
                        <p className="text-xs text-slate-500 mt-1">{agent.description}</p>
                      </div>
                    </div>
                    <span
                      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${
                        agent.enabled
                          ? 'border-green-500/30 bg-green-500/10 text-green-300'
                          : 'border-slate-700 bg-slate-900 text-slate-400'
                      }`}
                    >
                      {agent.enabled ? 'Enabled' : 'Disabled'}
                    </span>
                  </div>

                  <div className="space-y-3 mt-3">
                    <div>
                      <div className="text-sm text-slate-400">Schedule</div>
                      <div className="text-sm text-slate-200 font-medium">
                        {formatScheduleLabel(
                          (agent.id === 'planner'
                            ? 'slicer'
                            : agent.id === 'pr-resolver'
                            ? 'prResolver'
                            : agent.id) as 'executor' | 'reviewer' | 'qa' | 'audit' | 'slicer' | 'analytics' | 'prResolver' | 'merger',
                          agent.id === 'qa'
                            ? config.qa?.schedule || getDefaultQaConfig().schedule
                            : agent.id === 'audit'
                            ? config.audit?.schedule || getDefaultAuditConfig().schedule
                            : agent.id === 'planner'
                            ? config.roadmapScanner?.slicerSchedule || getDefaultRoadmapScannerConfig().slicerSchedule
                            : agent.id === 'analytics'
                            ? config.analytics?.schedule || getDefaultAnalyticsConfig().schedule
                            : agent.id === 'pr-resolver'
                            ? config.prResolver?.schedule || getDefaultPrResolverConfig().schedule
                            : agent.id === 'merger'
                            ? config.merger?.schedule || getDefaultMergerConfig().schedule
                            : agent.id === 'reviewer'
                            ? config.reviewerSchedule || DEFAULT_REVIEWER_SCHEDULE
                            : config.cronSchedule || DEFAULT_EXECUTOR_SCHEDULE,
                          agent.schedule,
                        )}
                      </div>
                    </div>
                    {renderDelayNote(agent.delayInfo)}
                    <div>
                      <div className="text-sm text-slate-400">Next Run</div>
                      {renderNextRun(agent.nextRun)}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className={`flex items-center space-x-2 text-sm ${agent.enabled ? 'text-green-400' : 'text-amber-400'}`}>
                        <Check className="h-4 w-4" />
                        <span>{agent.enabled ? 'Configured in Settings > Jobs' : 'Disabled in Settings > Jobs'}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => openSettingsTab('schedules', agent.id)}
                        className="rounded-md border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:border-slate-600 hover:bg-slate-900"
                      >
                        Edit cadence
                      </button>
                      {['qa', 'audit', 'planner', 'analytics', 'pr-resolver', 'merger'].includes(agent.id) && (
                        <button
                          type="button"
                          onClick={() => openSettingsTab('jobs', agent.id)}
                          className="rounded-md border border-indigo-500/30 bg-indigo-500/10 px-3 py-1.5 text-xs font-medium text-indigo-300 transition-colors hover:border-indigo-400/50 hover:bg-indigo-500/15"
                        >
                          Job settings
                        </button>
                      )}
                      <button
                        disabled={triggeringJob !== null}
                        onClick={() => handleTriggerJob(agent.id)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-green-400 bg-green-500/10 hover:bg-green-500/20 border border-green-500/30 hover:border-green-500/50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      >
                        {triggeringJob === agent.id ? (
                          <div className="h-3 w-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                        ) : (
                          <Play className="h-3 w-3 fill-current" />
                        )}
                        Run now
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      ),
    },
    {
      id: 'cadence',
      label: 'Cadence',
      content: (
        <div className="space-y-6">
          <ScheduleTimeline
            configs={allProjectConfigs}
            currentProjectId={selectedProjectId ?? undefined}
            onEditJob={(_projectId, jobType) => openSettingsTab('schedules', jobType)}
            queueStatus={queueStatus}
            queueAnalytics={queueAnalytics}
          />
          <Card className="p-6 border border-slate-800 bg-slate-950/50">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h3 className="text-lg font-semibold text-slate-200">Cadence is configured in Settings</h3>
                <p className="text-sm text-slate-400 mt-1">
                  Use Settings &gt; Schedules for cron cadence and templates. Use Settings &gt; Jobs for enablement, runtime, resolver, and merger behavior.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => openSettingsTab('schedules')}>
                  Open Schedules
                </Button>
                <Button onClick={() => openSettingsTab('jobs')}>Open Jobs</Button>
              </div>
            </div>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {agents.map((agent) => (
              <Card key={`cadence-${agent.id}`} className="p-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    {agent.icon}
                    <div>
                      <div className="text-sm font-semibold text-slate-200">{agent.name}</div>
                      <div className="text-xs text-slate-500">{agent.description}</div>
                    </div>
                  </div>
                  <span className="text-xs font-mono text-slate-500">{agent.schedule}</span>
                </div>
                <div className="text-sm text-slate-300">{cronToHuman(agent.schedule)}</div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => openSettingsTab('schedules', agent.id)}
                    className="rounded-md border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:border-slate-600 hover:bg-slate-900"
                  >
                    Edit cadence
                  </button>
                  {['qa', 'audit', 'planner', 'analytics', 'pr-resolver', 'merger'].includes(agent.id) && (
                    <button
                      type="button"
                      onClick={() => openSettingsTab('jobs', agent.id)}
                      className="rounded-md border border-indigo-500/30 bg-indigo-500/10 px-3 py-1.5 text-xs font-medium text-indigo-300 transition-colors hover:border-indigo-400/50 hover:bg-indigo-500/15"
                    >
                      Job settings
                    </button>
                  )}
                </div>
              </Card>
            ))}
          </div>
        </div>
      ),
    },
    {
      id: 'crontab',
      label: 'Crontab',
      content: (
        <Card className="p-6">
          <div className="flex items-center space-x-2 mb-4">
            <Calendar className="h-5 w-5 text-slate-400" />
            <h3 className="text-lg font-semibold text-slate-200">Active Crontab Entries</h3>
          </div>
          {scheduleInfo.entries.length === 0 ? (
            <div className="text-slate-500 text-sm">No crontab entries found.</div>
          ) : (
            <div className="space-y-2">
              {scheduleInfo.entries.map((entry, idx) => (
                <div key={idx} className="bg-slate-950/50 rounded-lg p-3 font-mono text-sm text-slate-300 border border-slate-800">
                  {entry}
                </div>
              ))}
            </div>
          )}
        </Card>
      ),
    },
    {
      id: 'parallelism',
      label: 'Parallelism',
      content: (
        <div className="space-y-6">
          <Card className="p-6 space-y-6">
            <div className="flex items-center gap-3">
              <Zap className="h-5 w-5 text-indigo-400" />
              <div>
                <h3 className="text-lg font-medium text-slate-200">Provider Buckets</h3>
                <p className="text-sm text-slate-400">
                  Control how jobs from different AI providers are dispatched concurrently.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="text-sm font-medium text-slate-200">Queue Enabled</div>
                    <p className="text-xs text-slate-400 mt-1">
                      Coordinate overlapping jobs globally instead of dispatching each project independently.
                    </p>
                  </div>
                  <Switch
                    checked={editState.enabled}
                    onChange={(enabled) => setEditState((prev) => ({ ...prev, enabled, isDirty: true }))}
                  />
                </div>
              </div>
              <Select
                label="Dispatch Mode"
                value={editState.queueMode}
                onChange={(val) => {
                  setEditState((prev) => ({ ...prev, queueMode: val as QueueMode, isDirty: true }));
                }}
                options={[
                  { label: 'Auto — detect providers, balance automatically', value: 'auto' },
                  { label: 'Conservative — one job at a time globally', value: 'conservative' },
                  { label: 'Provider-aware — per-bucket concurrency', value: 'provider-aware' },
                ]}
                helperText="Auto (recommended) detects providers and allows cross-provider parallelism with no config. Provider-aware lets you set explicit per-bucket limits."
              />
              <Input
                label="Global Max Concurrency"
                type="number"
                min="1"
                max="20"
                value={String(editState.globalMaxConcurrency)}
                onChange={(e) => {
                  const val = Math.min(20, Math.max(1, Number(e.target.value || 1)));
                  setEditState((prev) => ({ ...prev, globalMaxConcurrency: val, isDirty: true }));
                }}
                helperText="Maximum concurrent jobs across all providers."
              />
            </div>

            {editState.queueMode === 'provider-aware' && (
              <div className="space-y-3 pt-2 border-t border-slate-800">
                <div className="text-sm font-medium text-slate-300">Configured Buckets</div>

                {editState.providerBuckets.length === 0 && (
                  <div className="text-sm text-slate-500">
                    No buckets configured. Add a bucket below to set per-provider concurrency limits.
                  </div>
                )}

                {editState.providerBuckets.map((bucket, idx) => {
                  const inFlight = queueAnalytics?.byProviderBucket?.[bucket.key]?.running ?? 0;
                  return (
                    <div
                      key={bucket.key}
                      className="flex items-center gap-3 p-3 rounded-lg border border-slate-800 bg-slate-950/50"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-mono text-slate-200 truncate">{bucket.key}</div>
                        {inFlight > 0 && (
                          <div className="text-xs text-amber-400 mt-0.5">{inFlight} running</div>
                        )}
                      </div>
                      <div className="w-28 shrink-0">
                        <Input
                          type="number"
                          min="1"
                          max="10"
                          value={String(bucket.maxConcurrency)}
                          aria-label={`Max concurrency for ${bucket.key}`}
                          onChange={(e) => {
                            const val = Math.min(10, Math.max(1, Number(e.target.value || 1)));
                            setEditState((prev) => {
                              const updated = [...prev.providerBuckets];
                              updated[idx] = { ...updated[idx], maxConcurrency: val };
                              return { ...prev, providerBuckets: updated, isDirty: true };
                            });
                          }}
                        />
                      </div>
                      <button
                        type="button"
                        aria-label={`Remove bucket ${bucket.key}`}
                        onClick={() => {
                          setEditState((prev) => ({
                            ...prev,
                            providerBuckets: prev.providerBuckets.filter((_, i) => i !== idx),
                            isDirty: true,
                          }));
                        }}
                        className="p-1.5 rounded text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  );
                })}

                {showAddBucket ? (
                  <div className="flex items-end gap-3 p-3 rounded-lg border border-indigo-500/30 bg-indigo-950/20">
                    <div className="flex-1 min-w-0">
                      <Input
                        label="Bucket Key"
                        placeholder="e.g. claude-native, codex"
                        value={newBucketKey}
                        onChange={(e) => setNewBucketKey(e.target.value)}
                        helperText="Provider bucket key"
                      />
                    </div>
                    <div className="w-28 shrink-0">
                      <Input
                        label="Max Concurrency"
                        type="number"
                        min="1"
                        max="10"
                        value={newBucketConcurrency}
                        onChange={(e) => setNewBucketConcurrency(e.target.value)}
                      />
                    </div>
                    <div className="flex gap-2 pb-0.5">
                      <Button
                        size="sm"
                        onClick={() => {
                          const trimmedKey = newBucketKey.trim();
                          if (!trimmedKey) return;
                          const concurrency = Math.min(10, Math.max(1, Number(newBucketConcurrency || 1)));
                          setEditState((prev) => ({
                            ...prev,
                            providerBuckets: [
                              ...prev.providerBuckets.filter((b) => b.key !== trimmedKey),
                              { key: trimmedKey, maxConcurrency: concurrency },
                            ],
                            isDirty: true,
                          }));
                          setNewBucketKey('');
                          setNewBucketConcurrency('1');
                          setShowAddBucket(false);
                        }}
                        disabled={!newBucketKey.trim()}
                      >
                        Add
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setShowAddBucket(false);
                          setNewBucketKey('');
                          setNewBucketConcurrency('1');
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowAddBucket(true)}
                    className="flex items-center gap-1.5 text-sm text-indigo-400 hover:text-indigo-300 transition-colors"
                  >
                    <Plus className="h-4 w-4" />
                    Add Bucket
                  </button>
                )}
              </div>
            )}
          </Card>

          <div className="flex justify-end pt-4">
            <Button
              variant="ghost"
              onClick={() => {
                if (config) {
                  const resetBuckets = config.queue?.providerBuckets ?? {};
                  setEditState((prev) => ({
                    ...prev,
                    enabled: config.queue?.enabled ?? true,
                    queueMode: config.queue?.mode ?? 'auto',
                    globalMaxConcurrency: config.queue?.maxConcurrency ?? 1,
                    providerBuckets: Object.entries(resetBuckets).map(([key, val]) => ({
                      key,
                      maxConcurrency: val.maxConcurrency,
                    })),
                    isDirty: false,
                  }));
                  setShowAddBucket(false);
                  setNewBucketKey('');
                  setNewBucketConcurrency('1');
                }
              }}
              disabled={!editState.isDirty}
            >
              Reset
            </Button>
            <Button onClick={handleSaveQueueSettings} loading={saving} disabled={!editState.isDirty}>
              <Check className="h-4 w-4 mr-2" />
              Save Queue Settings
            </Button>
          </div>
        </div>
      ),
    },
    {
      id: 'queue',
      label: 'Queue',
      content: (
        <div className="space-y-6">
          {/* Queue Overview Card */}
          <Card className="p-6">
            <h3 className="text-lg font-semibold text-slate-200 mb-4">Queue Overview</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-slate-950/40 rounded-lg p-4 border border-slate-800">
                <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">Running</div>
                <div className="text-2xl font-bold text-green-400">
                  {queueStatus?.running ? 1 : 0}
                </div>
                {queueStatus?.running && (
                  <div className="text-xs text-slate-400 mt-1 truncate" title={queueStatus.running.projectName}>
                    {queueStatus.running.jobType} · {queueStatus.running.projectName}
                  </div>
                )}
              </div>
              <div className="bg-slate-950/40 rounded-lg p-4 border border-slate-800">
                <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">Pending</div>
                <div className="text-2xl font-bold text-blue-400">
                  {queueStatus?.pending.total ?? 0}
                </div>
              </div>
              <div className="bg-slate-950/40 rounded-lg p-4 border border-slate-800">
                <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">Avg Wait</div>
                <div className="text-2xl font-bold text-slate-200">
                  {queueStatus?.averageWaitSeconds != null
                    ? `${Math.floor(queueStatus.averageWaitSeconds / 60)}m`
                    : '—'}
                </div>
              </div>
              <div className="bg-slate-950/40 rounded-lg p-4 border border-slate-800">
                <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">Oldest Pending</div>
                <div className="text-2xl font-bold text-slate-200">
                  {queueStatus?.oldestPendingAge != null
                    ? `${Math.floor(queueStatus.oldestPendingAge / 60)}m`
                    : '—'}
                </div>
              </div>
            </div>
          </Card>

          {/* Provider Lanes */}
          <Card className="p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-semibold text-slate-200">Provider Lanes</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Running and pending jobs grouped by provider bucket
                </p>
              </div>
            </div>
            {queueStatus ? (
              <ProviderLanesChart status={queueStatus} />
            ) : (
              <div className="text-sm text-slate-500 py-2">Loading queue status...</div>
            )}
          </Card>

          {/* Provider Bucket Summary */}
          <Card className="p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-semibold text-slate-200">Provider Buckets</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Running and pending counts per provider bucket
                </p>
              </div>
            </div>
            {queueAnalytics ? (
              <ProviderBucketSummary analytics={queueAnalytics} />
            ) : (
              <div className="text-sm text-slate-500 py-2">Loading analytics...</div>
            )}
          </Card>

          {/* Recent Runs */}
          <Card className="p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-semibold text-slate-200">Recent Runs</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Last 24 hours of job executions
                </p>
              </div>
              {queueAnalytics?.averageWaitSeconds != null && (
                <div className="text-xs text-slate-500">
                  Avg wait: {Math.floor(queueAnalytics.averageWaitSeconds / 60)}m
                </div>
              )}
            </div>
            {queueAnalytics ? (
              <RecentRunsChart analytics={queueAnalytics} />
            ) : (
              <div className="text-sm text-slate-500 py-2">Loading analytics...</div>
            )}
          </Card>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-100">Scheduling</h1>
          <p className="text-sm text-slate-500 mt-1">
            Monitor automation here. Edit cadence and job behavior in Settings.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {activeTemplate && (
            <div className="text-right">
              <div className="text-xs uppercase tracking-wide text-slate-500">Schedule Bundle</div>
              <div className="text-sm font-medium text-indigo-300">{activeTemplate.label}</div>
              <div className="text-xs text-slate-500">
                Priority {scheduleInfo.schedulingPriority}/5 across registered projects
              </div>
            </div>
          )}
          <Button variant="outline" onClick={() => openSettingsTab('schedules')}>
            Open Settings
          </Button>
        </div>
      </div>

      <Tabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />
    </div>
  );
};

export default Scheduling;
