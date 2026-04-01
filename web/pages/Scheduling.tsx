import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Pause,
  Play,
  Clock,
  AlertCircle,
  Zap,
  ChevronDown,
  ChevronUp,
  Settings2,
  ListRestart,
  RefreshCw,
  Trash2,
  Search,
  BarChart3,
  Layout,
  GitMerge,
  GitPullRequest,
} from 'lucide-react';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import Select from '../components/ui/Select';
import Switch from '../components/ui/Switch';
import Input from '../components/ui/Input';
import Badge from '../components/ui/Badge';
import ScheduleTimeline from '../components/scheduling/ScheduleTimeline.js';
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
  triggerClearQueue,
  useApi,
} from '../api';
import {
  formatRelativeTime,
} from '../utils/cron';

const Scheduling: React.FC = () => {
  const navigate = useNavigate();
  const { addToast, selectedProjectId, globalModeLoading } = useStore();
  const [toggling, setToggling] = useState(false);
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [showQueueSettings, setShowQueueSettings] = useState(false);
  const [triggeringJob, setTriggeringJob] = useState<string | null>(null);

  const [allProjectConfigs, setAllProjectConfigs] = useState<Array<{ projectId: string; config: INightWatchConfig }>>([]);
  const [queueStatus, setQueueStatus] = useState<IQueueStatus | null>(null);
  const [queueAnalytics, setQueueAnalytics] = useState<IQueueAnalytics | null>(null);

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

  // Refresh data every 30 seconds
  useEffect(() => {
    if (globalModeLoading) return;
    const fetchData = () => {
      refetchSchedule();
      refetchConfig();
      fetchQueueStatus().then(setQueueStatus).catch(() => {});
      fetchQueueAnalytics(24).then(setQueueAnalytics).catch(() => {});
      fetchAllConfigs().then(setAllProjectConfigs).catch(() => {});
    };
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [selectedProjectId, globalModeLoading, refetchSchedule, refetchConfig]);

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
    if (!config) return;
    setSaving(true);
    try {
      await updateConfig({
        queue: {
          ...config.queue,
          ...changes,
        },
      });
      addToast({ title: 'Settings Saved', message: 'Queue configuration updated.', type: 'success' });
      refetchConfig();
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
    const registryId = jobId === 'planner' ? 'slicer' : jobId;
    navigate(`/settings?tab=jobs&jobType=${registryId}`);
  };

  if (scheduleLoading || configLoading) {
    return <div className="flex items-center justify-center min-h-[400px] text-slate-500">Loading automation state...</div>;
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

  return (
    <div className="max-w-6xl mx-auto space-y-8 pb-20">
      {/* Header & Main Toggle */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h2 className="text-2xl font-bold text-slate-100 flex items-center gap-3">
            Automation Control
            <Badge variant={isPaused ? 'warning' : 'success'} className="px-3 py-1 text-xs uppercase tracking-wider">
              {isPaused ? 'Paused' : 'Active'}
            </Badge>
          </h2>
          <p className="text-sm text-slate-400 mt-1">Managed cron triggers and global job queue</p>
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
                  title="Queue Settings"
                >
                  <Settings2 className="h-5 w-5" />
                </div>
              </div>
            </div>

            {/* Queue Settings (Collapsible) */}
            <div className={`transition-all duration-300 overflow-hidden ${showQueueSettings ? 'max-h-[500px]' : 'max-h-0'}`}>
              <div className="p-6 bg-slate-950/40 border-b border-slate-800 grid grid-cols-1 md:grid-cols-2 gap-6">
                <Select
                  label="Dispatch Mode"
                  value={config.queue?.mode || 'auto'}
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
                  value={String(config.queue?.maxConcurrency || 1)}
                  onChange={(e) => updateQueueConfig({ maxConcurrency: Number(e.target.value) })}
                />
                <div className="md:col-span-2 flex items-center gap-3">
                   <Switch
                    label="Coordinator Enabled"
                    checked={config.queue?.enabled ?? true}
                    onChange={(val) => updateQueueConfig({ enabled: val })}
                  />
                </div>
              </div>
            </div>

            {/* Live Queue Table */}
            <div className="p-0">
               {!queueStatus?.items.length ? (
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
            <ScheduleTimeline
              configs={allProjectConfigs}
              currentProjectId={selectedProjectId ?? undefined}
              onEditJob={(_projectId, jobType) => goToJobSettings(jobType)}
              queueStatus={queueStatus}
              queueAnalytics={queueAnalytics}
            />
          </section>
        </div>

        {/* Right Column: Mini Stats & Quick Actions */}
        <div className="space-y-6">
          <Card className="p-5 space-y-4 border-slate-800 bg-slate-900/20">
            <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest">Efficiency Stats</h4>
            <div className="grid grid-cols-1 gap-4">
              <div className="p-4 rounded-xl border border-slate-800 bg-slate-950/40">
                <div className="text-[10px] text-slate-500 uppercase">Avg Wait Time</div>
                <div className="text-xl font-bold text-slate-200 mt-1">
                  {queueStatus?.averageWaitSeconds ? (queueStatus.averageWaitSeconds / 60).toFixed(1) : '0'} <span className="text-xs font-normal text-slate-500">min</span>
                </div>
              </div>
              <div className="p-4 rounded-xl border border-slate-800 bg-slate-950/40">
                <div className="text-[10px] text-slate-500 uppercase">Oldest Pending</div>
                <div className="text-xl font-bold text-slate-200 mt-1">
                   {queueStatus?.oldestPendingAge ? (queueStatus.oldestPendingAge / 60).toFixed(1) : '0'} <span className="text-xs font-normal text-slate-500">min</span>
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
                { id: 'executor', label: 'Run Executor', icon: Play, enabled: config.executorEnabled !== false },
                { id: 'reviewer', label: 'Run Reviewer', icon: Search, enabled: config.reviewerEnabled ?? false },
                { id: 'qa', label: 'Run QA', icon: Zap, enabled: config.qa?.enabled ?? false },
                { id: 'audit', label: 'Run Audit', icon: ListRestart, enabled: config.audit?.enabled ?? false },
                { id: 'planner', label: 'Run Planner', icon: Layout, enabled: config.roadmapScanner?.enabled ?? false },
                { id: 'analytics', label: 'Run Analytics', icon: BarChart3, enabled: config.analytics?.enabled ?? false },
                { id: 'pr-resolver', label: 'Run PR Resolver', icon: GitMerge, enabled: config.prResolver?.enabled ?? false },
                { id: 'merger', label: 'Run Merger', icon: GitPullRequest, enabled: config.merger?.enabled ?? false },
              ].map(job => (
                <button
                  key={job.id}
                  onClick={() => handleTriggerJob(job.id)}
                  disabled={triggeringJob === job.id || !job.enabled}
                  className={`w-full flex items-center justify-between p-3 rounded-lg text-sm transition-colors group disabled:cursor-not-allowed ${
                    job.enabled
                      ? 'text-slate-300 hover:bg-slate-800/40'
                      : 'text-slate-600 opacity-50'
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
            <div className="p-4">
               <Button variant="outline" size="sm" className="w-full" onClick={() => navigate('/settings?tab=jobs')}>
                 Advanced Settings
               </Button>
            </div>
          </Card>
        </div>
      </div>

      {/* Audit / Recent History Section (Bottom) */}
      <section className="space-y-4">
        <h3 className="text-lg font-semibold text-slate-200">Execution History (Last 24h)</h3>
        <Card className="border-slate-800 overflow-hidden">
           {!queueAnalytics?.recentRuns.length ? (
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
  );
};

export default Scheduling;
