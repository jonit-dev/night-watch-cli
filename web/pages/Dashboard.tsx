import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity,
  ArrowRight,
  Calendar,
  CheckCircle,
  Clock,
  Play,
  Pause,
  RefreshCw,
} from 'lucide-react';
import Card from '../components/ui/Card';
import { useApi, fetchScheduleInfo, fetchBoardStatus, triggerCancel, triggerClearLock, triggerJob, triggerInstallCron, triggerUninstallCron, BOARD_COLUMNS, IBoardStatus, BoardColumnName } from '../api';
import { useStore } from '../store/useStore';
import AgentStatusBar from '../components/dashboard/AgentStatusBar';
import PerformanceDashboard from '../components/feedback/PerformanceDashboard.js';
import LoadingState from '../components/ui/LoadingState';

const BOARD_COLUMN_COLORS: Record<BoardColumnName, string> = {
  'Draft':       'text-slate-400  bg-slate-500/10  ring-slate-500/20',
  'Ready':       'text-green-400  bg-green-500/10  ring-green-500/20',
  'In Progress': 'text-blue-400   bg-blue-500/10   ring-blue-500/20',
  'Review':      'text-amber-400  bg-amber-500/10  ring-amber-500/20',
  'Done':        'text-slate-500  bg-slate-600/10  ring-slate-600/20',
};

const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const [cancellingProcess, setCancellingProcess] = useState<'run' | 'review' | null>(null);
  const [clearingLock, setClearingLock] = useState(false);
  const [triggeringJob, setTriggeringJob] = useState<string | null>(null);
  const [togglingSchedule, setTogglingSchedule] = useState(false);
  const { setProjectName, addToast, selectedProjectId, globalModeLoading, status } = useStore();

  const { data: scheduleInfo, loading: scheduleLoading } = useApi(fetchScheduleInfo, [selectedProjectId], { enabled: !globalModeLoading });
  const { data: boardStatus, loading: boardLoading } = useApi<IBoardStatus | null>(
    () => fetchBoardStatus().catch(() => null),
    [selectedProjectId],
    { enabled: !globalModeLoading },
  );

  // Read status from shared store (synced by useStatusSync in App.tsx)
  const currentStatus = status;

  // Update project name when status loads
  React.useEffect(() => {
    if (currentStatus?.projectName) {
      setProjectName(currentStatus.projectName);
    }
  }, [currentStatus, setProjectName]);

  if (globalModeLoading || !currentStatus || scheduleLoading || boardLoading) {
    return (
      <LoadingState
        message="Loading dashboard"
        detail="Collecting status, schedule, board, and analytics data."
      />
    );
  }

  const openPrs = currentStatus.prs.length;
  const needsWorkPrs = currentStatus.prs.filter(p => p.reviewScore !== null && p.reviewScore < 70).length;

  // Board-derived stats
  const boardReadyCount = boardStatus?.columns['Ready']?.length ?? 0;
  const boardInProgressCount = boardStatus?.columns['In Progress']?.length ?? 0;

  const handleCancelProcess = async (type: 'run' | 'review') => {
    setCancellingProcess(type);
    try {
      const result = await triggerCancel(type);
      const allOk = result.results.every(r => r.success);
      addToast({
        title: allOk ? 'Process Cancelled' : 'Cancel Failed',
        message: result.results.map(r => r.message).join('; '),
        type: allOk ? 'success' : 'error',
      });
    } catch (err) {
      addToast({
        title: 'Cancel Failed',
        message: err instanceof Error ? err.message : 'Failed to cancel process',
        type: 'error',
      });
    } finally {
      setCancellingProcess(null);
      // No refetch needed - status auto-updates via SSE
    }
  };

  const handleForceClear = async () => {
    setClearingLock(true);
    try {
      await triggerClearLock();
      addToast({
        title: 'Lock Cleared',
        message: 'Stale executor state removed',
        type: 'success',
      });
      // No refetch needed - status auto-updates via SSE
    } catch (err) {
      addToast({
        title: 'Clear Failed',
        message: err instanceof Error ? err.message : 'Failed to clear lock',
        type: 'error',
      });
    } finally {
      setClearingLock(false);
    }
  };

  const handleTriggerJob = async (
    job:
      | 'executor'
      | 'reviewer'
      | 'qa'
      | 'audit'
      | 'optimizer'
      | 'ux'
      | 'planner'
      | 'analytics'
      | 'pr-resolver'
      | 'merger'
      | 'manager',
  ) => {
    setTriggeringJob(job);
    try {
      const registryId = job === 'planner' ? 'slicer' : job;
      await triggerJob(registryId);
      addToast({ title: 'Job Triggered', message: `${job[0].toUpperCase() + job.slice(1)} job has been queued.`, type: 'success' });
    } catch (err) {
      addToast({ title: 'Trigger Failed', message: err instanceof Error ? err.message : `Failed to trigger ${job}`, type: 'error' });
    } finally {
      setTriggeringJob(null);
    }
  };

  const handlePauseResume = async () => {
    if (!scheduleInfo) return;
    setTogglingSchedule(true);
    try {
      if (scheduleInfo.paused) {
        await triggerInstallCron();
        addToast({ title: 'Schedule Resumed', message: 'Cron schedules are active.', type: 'success' });
      } else {
        await triggerUninstallCron();
        addToast({ title: 'Schedule Paused', message: 'Cron schedules are deactivated.', type: 'info' });
      }
    } catch (err) {
      addToast({ title: 'Action Failed', message: err instanceof Error ? err.message : 'Toggle failed', type: 'error' });
    } finally {
      setTogglingSchedule(false);
    }
  };

  // Helper to format next run time
  const formatNextRun = (nextRun: string | null | undefined): string => {
    if (!nextRun) return 'Not scheduled';
    try {
      const date = new Date(nextRun);
      const now = new Date();
      const diffMs = date.getTime() - now.getTime();
      const diffMins = Math.floor(diffMs / 60000);

      if (diffMins < 0) return 'Running now...';
      if (diffMins < 60) return `in ${diffMins} min`;
      if (diffMins < 1440) return `in ${Math.floor(diffMins / 60)} hr${diffMins >= 120 ? 's' : ''}`;
      return `in ${Math.floor(diffMins / 1440)} day${diffMins >= 2880 ? 's' : ''}`;
    } catch {
      return 'Unknown';
    }
  };

  // Get next automation run info
  const getNextAutomation = (): { agent: string; time: string } | null => {
    if (scheduleInfo?.paused) return null;

    const candidates: { agent: string; nextRun: string | null }[] = [
      { agent: 'Executor', nextRun: scheduleInfo?.executor.nextRun ?? null },
      { agent: 'Reviewer', nextRun: scheduleInfo?.reviewer.nextRun ?? null },
      { agent: 'QA', nextRun: scheduleInfo?.qa?.nextRun ?? null },
      { agent: 'Auditor', nextRun: scheduleInfo?.audit?.nextRun ?? null },
      { agent: 'Planner', nextRun: scheduleInfo?.planner?.nextRun ?? null },
      { agent: 'Analytics', nextRun: scheduleInfo?.analytics?.nextRun ?? null },
      { agent: 'PR Resolver', nextRun: scheduleInfo?.prResolver?.nextRun ?? null },
      { agent: 'Merger', nextRun: scheduleInfo?.merger?.nextRun ?? null },
      { agent: 'Manager', nextRun: scheduleInfo?.manager?.nextRun ?? null },
    ];

    let earliest: { agent: string; nextRun: string | null } | null = null;
    for (const c of candidates) {
      if (!c.nextRun) continue;
      if (!earliest || new Date(c.nextRun) < new Date(earliest.nextRun!)) {
        earliest = c;
      }
    }

    return earliest ? { agent: earliest.agent, time: formatNextRun(earliest.nextRun) } : null;
  };

  const nextAutomation = getNextAutomation();

  return (
    <div className="space-y-6">
      {/* Top Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-5" onClick={() => navigate('/board')}>
          <div className="flex justify-between items-start">
            <div>
              <p className="text-sm font-medium text-slate-500">Board Ready</p>
              <h3 className="text-3xl font-bold text-slate-100 mt-1">{boardReadyCount}</h3>
            </div>
            <div className="p-2 bg-green-500/10 rounded-lg text-green-400">
              <CheckCircle className="h-5 w-5" />
            </div>
          </div>
          <p className="text-xs text-slate-500 mt-4">issues ready to start</p>
        </Card>

        <Card className="p-5" onClick={() => navigate('/board')}>
          <div className="flex justify-between items-start">
            <div>
              <p className="text-sm font-medium text-slate-500">In Progress</p>
              <h3 className="text-3xl font-bold text-slate-100 mt-1">{boardInProgressCount}</h3>
            </div>
            <div className="p-2 bg-blue-500/10 rounded-lg text-blue-400">
              <Activity className="h-5 w-5" />
            </div>
          </div>
          <p className="text-xs text-slate-500 mt-4">issues in progress</p>
        </Card>

        <Card className="p-5" onClick={() => navigate('/prs')}>
          <div className="flex justify-between items-start">
            <div>
              <p className="text-sm font-medium text-slate-500">Open PRs</p>
              <h3 className="text-3xl font-bold text-slate-100 mt-1">{openPrs}</h3>
            </div>
            <div className="p-2 bg-purple-500/10 rounded-lg text-purple-400">
              <Clock className="h-5 w-5" />
            </div>
          </div>
          <p className={`text-xs mt-4 ${needsWorkPrs > 0 ? 'text-red-400 font-medium' : 'text-slate-500'}`}>
            {needsWorkPrs > 0 ? `${needsWorkPrs} need work` : 'All passing'}
          </p>
        </Card>

        <Card className="p-5">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-sm font-medium text-slate-500">Automation</p>
              <h3 className="text-3xl font-bold text-slate-100 mt-1">
                {scheduleInfo?.paused ? 'Paused' : (currentStatus.crontab.installed ? 'Active' : 'Inactive')}
              </h3>
            </div>
            <button
              onClick={handlePauseResume}
              disabled={togglingSchedule || !scheduleInfo || !currentStatus.crontab.installed}
              title={scheduleInfo?.paused ? 'Resume scheduling' : 'Pause scheduling'}
              className={`p-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                scheduleInfo?.paused
                  ? 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
                  : (currentStatus.crontab.installed ? 'bg-indigo-500/10 text-indigo-400 hover:bg-indigo-500/20' : 'bg-slate-700/50 text-slate-500')
              }`}
            >
              {togglingSchedule ? (
                <RefreshCw className="h-5 w-5 animate-spin" />
              ) : scheduleInfo?.paused ? (
                <Play className="h-5 w-5 fill-current" />
              ) : currentStatus.crontab.installed ? (
                <Pause className="h-5 w-5" />
              ) : (
                <Calendar className="h-5 w-5" />
              )}
            </button>
          </div>
          <p className="text-xs text-slate-500 mt-4">
            {scheduleInfo?.paused
              ? 'All schedules paused'
              : (currentStatus.crontab.installed
                ? `${currentStatus.crontab.entries.length} entr${currentStatus.crontab.entries.length === 1 ? 'y' : 'ies'} installed`
                : 'No crontab entries')
            }
          </p>
        </Card>
      </div>

      {/* Agent Status Bar - Compact process status */}
      <Card className="p-4">
        <AgentStatusBar
          processes={currentStatus.processes}
          activePrd={currentStatus.activePrd}
          onCancelProcess={handleCancelProcess}
          onForceClear={handleForceClear}
          onViewLog={() => navigate('/logs')}
          cancellingProcess={cancellingProcess}
          clearingLock={clearingLock}
          onTriggerJob={handleTriggerJob}
          triggeringJob={triggeringJob}
        />
      </Card>

      {/* Next Automation Teaser / Paused Banner */}
      {nextAutomation ? (
        <div className="flex items-center justify-between px-4 py-3 bg-slate-900/50 rounded-lg border border-slate-800">
          <div className="flex items-center gap-2 text-sm text-slate-400">
            <span>Next automation:</span>
            <span className="text-slate-200 font-medium">{nextAutomation.agent}</span>
            <span>{nextAutomation.time}</span>
          </div>
          <button
            onClick={() => navigate('/scheduling')}
            className="text-sm text-indigo-400 hover:text-indigo-300 flex items-center transition-colors"
          >
            Manage Schedules <ArrowRight className="ml-1 h-3 w-3" />
          </button>
        </div>
      ) : scheduleInfo?.paused ? (
        <div className="flex items-center justify-between px-4 py-3 bg-amber-900/20 rounded-lg border border-amber-800/40">
          <div className="flex items-center gap-2 text-sm text-amber-400">
            <Pause className="h-3.5 w-3.5" />
            <span>Automation is paused</span>
          </div>
          <button
            onClick={handlePauseResume}
            disabled={togglingSchedule}
            className="text-sm text-emerald-400 hover:text-emerald-300 flex items-center transition-colors disabled:opacity-50"
          >
            {togglingSchedule
              ? <RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              : <Play className="h-3.5 w-3.5 mr-1.5 fill-current" />
            }
            Resume
          </button>
        </div>
      ) : null}

      <PerformanceDashboard variant="compact" onViewDetails={() => navigate('/analytics')} />

      {/* Board Widget */}
      <div className="mt-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-slate-200">GitHub Board</h2>
          <button onClick={() => navigate('/board')} className="text-sm text-indigo-400 hover:text-indigo-300 flex items-center transition-colors">
            View board <ArrowRight className="ml-1 h-3 w-3" />
          </button>
        </div>
        <Card className="p-4">
          {boardLoading ? (
            <LoadingState variant="inline" message="Loading board" />
          ) : !boardStatus ? (
            <p className="text-sm text-slate-500 italic">
              Board not configured — run <code className="font-mono bg-slate-800 px-1.5 py-0.5 rounded text-indigo-300 text-xs">night-watch board setup</code> to enable.
            </p>
          ) : (
            <div className="flex flex-wrap gap-3">
              {BOARD_COLUMNS.map(col => {
                const count = boardStatus.columns[col]?.length ?? 0;
                return (
                  <button
                    key={col}
                    onClick={() => navigate('/board')}
                    className={`inline-flex items-center space-x-2 px-3 py-2 rounded-lg ring-1 ring-inset transition-colors hover:opacity-80 ${BOARD_COLUMN_COLORS[col]}`}
                  >
                    <span className="text-xs font-medium">{col}</span>
                    <span className="text-xs font-bold">{count}</span>
                  </button>
                );
              })}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
};

export default Dashboard;
