import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Activity, CheckCircle, Clock, ArrowRight, AlertCircle, Calendar, XCircle, TestTube2 } from 'lucide-react';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import { useApi, fetchStatus, fetchScheduleInfo, fetchBoardStatus, triggerCancel, triggerClearLock, useStatusStream, BOARD_COLUMNS, IBoardStatus, BoardColumnName } from '../api';
import { useStore } from '../store/useStore';
import type { IStatusSnapshot } from '@shared/types';

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
  const [streamedStatus, setStreamedStatus] = useState<IStatusSnapshot | null>(null);
  const { setProjectName, addToast, selectedProjectId, globalModeLoading } = useStore();
  const { data: status, loading, error, refetch } = useApi(fetchStatus, [selectedProjectId], { enabled: !globalModeLoading });
  const { data: scheduleInfo } = useApi(fetchScheduleInfo, [selectedProjectId], { enabled: !globalModeLoading });
  const { data: boardStatus } = useApi<IBoardStatus | null>(
    () => fetchBoardStatus().catch(() => null),
    [selectedProjectId],
    { enabled: !globalModeLoading },
  );

  // Subscribe to SSE for real-time updates (primary path)
  useStatusStream((snapshot) => {
    setStreamedStatus(snapshot);
  }, [selectedProjectId, globalModeLoading], { enabled: !globalModeLoading });

  // Use streamed status when available, fall back to polled status
  const currentStatus = streamedStatus || status;

  // Update project name when status loads
  React.useEffect(() => {
    if (currentStatus?.projectName) {
      setProjectName(currentStatus.projectName);
    }
  }, [currentStatus, setProjectName]);

  // Poll for status updates as fallback (30s interval - SSE is the fast path)
  useEffect(() => {
    const interval = setInterval(() => {
      refetch();
    }, 30000);
    return () => clearInterval(interval);
  }, [refetch]);

  // Refetch on window focus
  useEffect(() => {
    const onFocus = () => refetch();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refetch]);

  if (globalModeLoading || loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-slate-400">Loading...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full space-y-4">
        <AlertCircle className="h-12 w-12 text-red-400" />
        <div className="text-slate-300">Failed to load dashboard data</div>
        <div className="text-sm text-slate-500">{error.message}</div>
        <Button onClick={() => refetch()}>Retry</Button>
      </div>
    );
  }

  if (!currentStatus) {
    return null;
  }

  const openPrs = currentStatus.prs.length;
  const needsWorkPrs = currentStatus.prs.filter(p => p.reviewScore !== null && p.reviewScore < 70).length;

  // Board-derived stats
  const boardReadyCount = boardStatus?.columns['Ready']?.length ?? 0;
  const boardInProgressCount = boardStatus?.columns['In Progress']?.length ?? 0;

  const executorProcess = currentStatus.processes.find(p => p.name === 'executor');
  const reviewerProcess = currentStatus.processes.find(p => p.name === 'reviewer');
  const qaProcess = currentStatus.processes.find(p => p.name === 'qa');

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
      refetch();
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
      refetch();
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

  // Helper to format next run time
  const formatNextRun = (nextRun: string | null | undefined): string => {
    if (!nextRun) return 'Not scheduled';
    try {
      const date = new Date(nextRun);
      const now = new Date();
      const diffMs = date.getTime() - now.getTime();
      const diffMins = Math.floor(diffMs / 60000);

      if (diffMins < 0) return 'Running now...';
      if (diffMins < 60) return `In ${diffMins} min`;
      if (diffMins < 1440) return `In ${Math.floor(diffMins / 60)} hr${diffMins >= 120 ? 's' : ''}`;
      return `In ${Math.floor(diffMins / 1440)} day${diffMins >= 2880 ? 's' : ''}`;
    } catch {
      return 'Unknown';
    }
  };

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
              <p className="text-sm font-medium text-slate-500">Cron Status</p>
              <h3 className="text-3xl font-bold text-slate-100 mt-1">
                {currentStatus.crontab.installed ? 'Active' : 'Inactive'}
              </h3>
            </div>
            <div className={`p-2 rounded-lg ${currentStatus.crontab.installed ? 'bg-indigo-500/10 text-indigo-400' : 'bg-slate-700/50 text-slate-500'}`}>
              <Calendar className="h-5 w-5" />
            </div>
          </div>
          <p className="text-xs text-slate-500 mt-4">
            {currentStatus.crontab.installed
              ? `${currentStatus.crontab.entries.length} entr${currentStatus.crontab.entries.length === 1 ? 'y' : 'ies'} installed`
              : 'No crontab entries'
            }
          </p>
        </Card>
      </div>

      {/* System Status */}
      <Card className="p-6">
        <h2 className="text-base font-semibold text-slate-200 mb-4">System Status</h2>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <p className="text-xs font-medium text-slate-500 uppercase mb-1">Project</p>
            <p className="text-sm text-slate-200">{currentStatus.projectName}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500 uppercase mb-1">Provider</p>
            <p className="text-sm text-slate-200 capitalize">{currentStatus.config.provider}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500 uppercase mb-1">Last Updated</p>
            <p className="text-sm text-slate-200">{new Date(currentStatus.timestamp).toLocaleString()}</p>
          </div>
        </div>
      </Card>

      {/* Bottom Section */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

        {/* Process Status */}
        <Card className="p-6">
          <h3 className="text-base font-semibold text-slate-200 mb-4">Process Status</h3>
          <div className="space-y-4">
             <div className="flex items-center justify-between p-3 bg-slate-950/50 rounded-lg border border-slate-800">
                <div className="flex items-center space-x-3">
                  <div className={`h-2.5 w-2.5 rounded-full ${executorProcess?.running ? 'bg-green-500 animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.5)]' : 'bg-slate-700'}`}></div>
                  <div>
                    <div className={`font-medium ${executorProcess?.running ? 'text-slate-200' : 'text-slate-400'}`}>Executor</div>
                    <div className="text-xs text-slate-500">
                      {executorProcess?.running
                        ? `PID: ${executorProcess.pid} • ${currentStatus.activePrd ?? 'Running'}`
                        : 'Idle'
                      }
                    </div>
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  {executorProcess?.running && (
                    <Button size="sm" variant="ghost" className="text-red-400 hover:text-red-300" onClick={() => handleCancelProcess('run')} disabled={cancellingProcess === 'run'}>
                      <XCircle className="h-4 w-4 mr-1" />
                      {cancellingProcess === 'run' ? 'Stopping...' : 'Stop'}
                    </Button>
                  )}
                  {!executorProcess?.running && currentStatus.activePrd && (
                    <Button size="sm" variant="ghost" className="text-amber-400 hover:text-amber-300" onClick={handleForceClear} disabled={clearingLock}>
                      {clearingLock ? 'Clearing...' : 'Force Clear'}
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => navigate('/logs')}>View Log</Button>
                </div>
             </div>
             <div className="flex items-center justify-between p-3 bg-slate-950/50 rounded-lg border border-slate-800">
                <div className="flex items-center space-x-3">
                  <div className={`h-2.5 w-2.5 rounded-full ${reviewerProcess?.running ? 'bg-green-500 animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.5)]' : 'bg-slate-700'}`}></div>
                  <div>
                    <div className={`font-medium ${reviewerProcess?.running ? 'text-slate-200' : 'text-slate-400'}`}>Reviewer</div>
                    <div className="text-xs text-slate-500">
                      {reviewerProcess?.running
                        ? `PID: ${reviewerProcess.pid} • Running`
                        : 'Idle'
                      }
                    </div>
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  {reviewerProcess?.running && (
                    <Button size="sm" variant="ghost" className="text-red-400 hover:text-red-300" onClick={() => handleCancelProcess('review')} disabled={cancellingProcess === 'review'}>
                      <XCircle className="h-4 w-4 mr-1" />
                      {cancellingProcess === 'review' ? 'Stopping...' : 'Stop'}
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => navigate('/logs')} disabled={!reviewerProcess?.running}>View Log</Button>
                </div>
             </div>
             <div className="flex items-center justify-between p-3 bg-slate-950/50 rounded-lg border border-slate-800">
                <div className="flex items-center space-x-3">
                  <div className={`h-2.5 w-2.5 rounded-full ${qaProcess?.running ? 'bg-green-500 animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.5)]' : 'bg-slate-700'}`}></div>
                  <div>
                    <div className={`font-medium ${qaProcess?.running ? 'text-slate-200' : 'text-slate-400'}`}>QA</div>
                    <div className="text-xs text-slate-500">
                      {qaProcess?.running
                        ? `PID: ${qaProcess.pid} • Running`
                        : 'Idle'
                      }
                    </div>
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  <Button size="sm" variant="ghost" onClick={() => navigate('/logs')}>View Log</Button>
                </div>
             </div>
          </div>
        </Card>

        {/* Scheduling Summary */}
        <Card className="p-6">
           <div className="flex items-center justify-between mb-4">
             <h3 className="text-base font-semibold text-slate-200">Scheduling</h3>
             <button onClick={() => navigate('/scheduling')} className="text-sm text-indigo-400 hover:text-indigo-300 flex items-center transition-colors">
               Manage Schedules <ArrowRight className="ml-1 h-3 w-3" />
             </button>
           </div>
           <div className="space-y-3">
             <div className="flex items-center justify-between p-3 bg-slate-950/50 rounded-lg border border-slate-800">
                <div className="flex items-center space-x-3">
                  <div className={`p-1.5 rounded-md ${scheduleInfo?.executor.installed ? 'bg-indigo-500/10 text-indigo-400' : 'bg-slate-800 text-slate-500'}`}>
                    <Calendar className="h-4 w-4" />
                  </div>
                  <div>
                    <div className={`text-sm font-medium ${scheduleInfo?.executor.installed ? 'text-slate-200' : 'text-slate-500'}`}>Executor</div>
                    <div className="text-xs text-slate-500">
                      {scheduleInfo?.paused ? 'Paused' : formatNextRun(scheduleInfo?.executor.nextRun)}
                    </div>
                  </div>
                </div>
             </div>
             <div className="flex items-center justify-between p-3 bg-slate-950/50 rounded-lg border border-slate-800">
                <div className="flex items-center space-x-3">
                  <div className={`p-1.5 rounded-md ${scheduleInfo?.reviewer.installed ? 'bg-purple-500/10 text-purple-400' : 'bg-slate-800 text-slate-500'}`}>
                    <Clock className="h-4 w-4" />
                  </div>
                  <div>
                    <div className={`text-sm font-medium ${scheduleInfo?.reviewer.installed ? 'text-slate-200' : 'text-slate-500'}`}>Reviewer</div>
                    <div className="text-xs text-slate-500">
                      {scheduleInfo?.paused ? 'Paused' : formatNextRun(scheduleInfo?.reviewer.nextRun)}
                    </div>
                  </div>
                </div>
             </div>
             <div className="flex items-center justify-between p-3 bg-slate-950/50 rounded-lg border border-slate-800">
                <div className="flex items-center space-x-3">
                  <div className={`p-1.5 rounded-md ${scheduleInfo?.qa?.installed ? 'bg-green-500/10 text-green-400' : 'bg-slate-800 text-slate-500'}`}>
                    <TestTube2 className="h-4 w-4" />
                  </div>
                  <div>
                    <div className={`text-sm font-medium ${scheduleInfo?.qa?.installed ? 'text-slate-200' : 'text-slate-500'}`}>QA</div>
                    <div className="text-xs text-slate-500">
                      {scheduleInfo?.paused ? 'Paused' : formatNextRun(scheduleInfo?.qa?.nextRun)}
                    </div>
                  </div>
                </div>
             </div>
           </div>
        </Card>
      </div>

      {/* Board Widget */}
      <div className="mt-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-slate-200">GitHub Board</h2>
          <button onClick={() => navigate('/board')} className="text-sm text-indigo-400 hover:text-indigo-300 flex items-center transition-colors">
            View board <ArrowRight className="ml-1 h-3 w-3" />
          </button>
        </div>
        <Card className="p-4">
          {!boardStatus ? (
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
