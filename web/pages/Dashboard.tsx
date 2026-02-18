import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Activity, CheckCircle, Clock, ArrowRight, AlertCircle, Calendar, XCircle } from 'lucide-react';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import { useApi, fetchStatus, fetchScheduleInfo, triggerCancel } from '../api';
import { useStore } from '../store/useStore';

// Map API status to UI status
const statusMap: Record<string, string> = {
  'ready': 'Ready',
  'in-progress': 'In Progress',
  'blocked': 'Blocked',
  'pending-review': 'Pending Review',
  'done': 'Done',
};

const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const [cancellingProcess, setCancellingProcess] = useState<'run' | 'review' | null>(null);
  const { setProjectName, addToast, selectedProjectId, globalModeLoading } = useStore();
  const { data: status, loading, error, refetch } = useApi(fetchStatus, [selectedProjectId], { enabled: !globalModeLoading });
  const { data: scheduleInfo } = useApi(fetchScheduleInfo, [selectedProjectId], { enabled: !globalModeLoading });

  // Update project name when status loads
  React.useEffect(() => {
    if (status?.projectName) {
      setProjectName(status.projectName);
    }
  }, [status, setProjectName]);

  // Poll for status updates every 10 seconds
  React.useEffect(() => {
    const interval = setInterval(() => {
      refetch();
    }, 10000);
    return () => clearInterval(interval);
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

  if (!status) {
    return null;
  }

  const readyPrds = status.prds.filter(p => p.status === 'ready').length;
  const inProgressPrds = status.prds.filter(p => p.status === 'in-progress');
  const openPrs = status.prs.length;
  const needsWorkPrs = status.prs.filter(p => p.reviewScore !== null && p.reviewScore < 70).length;

  const executorProcess = status.processes.find(p => p.name === 'executor');
  const reviewerProcess = status.processes.find(p => p.name === 'reviewer');

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
      if (allOk) refetch();
    } catch (err) {
      addToast({
        title: 'Cancel Failed',
        message: err instanceof Error ? err.message : 'Failed to cancel process',
        type: 'error',
      });
    } finally {
      setCancellingProcess(null);
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
        <Card className="p-5" onClick={() => navigate('/prds')}>
          <div className="flex justify-between items-start">
            <div>
              <p className="text-sm font-medium text-slate-500">PRDs Ready</p>
              <h3 className="text-3xl font-bold text-slate-100 mt-1">{readyPrds}</h3>
            </div>
            <div className="p-2 bg-green-500/10 rounded-lg text-green-400">
              <CheckCircle className="h-5 w-5" />
            </div>
          </div>
          <p className="text-xs text-slate-500 mt-4">of {status.prds.length} total</p>
        </Card>

        <Card className="p-5" onClick={() => navigate('/prds')}>
          <div className="flex justify-between items-start">
            <div>
              <p className="text-sm font-medium text-slate-500">In Progress</p>
              <h3 className="text-3xl font-bold text-slate-100 mt-1">{inProgressPrds.length}</h3>
            </div>
            <div className="p-2 bg-blue-500/10 rounded-lg text-blue-400">
              <Activity className="h-5 w-5" />
            </div>
          </div>
          <p className="text-xs text-slate-500 mt-4 truncate">
            {inProgressPrds.length === 1 ? inProgressPrds[0].name : `${inProgressPrds.length} active`}
          </p>
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
                {status.crontab.installed ? 'Active' : 'Inactive'}
              </h3>
            </div>
            <div className={`p-2 rounded-lg ${status.crontab.installed ? 'bg-indigo-500/10 text-indigo-400' : 'bg-slate-700/50 text-slate-500'}`}>
              <Calendar className="h-5 w-5" />
            </div>
          </div>
          <p className="text-xs text-slate-500 mt-4">
            {status.crontab.installed
              ? `${status.crontab.entries.length} entr${status.crontab.entries.length === 1 ? 'y' : 'ies'} installed`
              : 'No crontab entries'
            }
          </p>
        </Card>
      </div>

      {/* Middle Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Kanban Preview */}
        <div className="lg:col-span-2">
           <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-slate-200">PRD Pipeline</h2>
            <button onClick={() => navigate('/prds')} className="text-sm text-indigo-400 hover:text-indigo-300 flex items-center transition-colors">
              View all <ArrowRight className="ml-1 h-3 w-3" />
            </button>
           </div>

           <div className="bg-slate-900 rounded-xl p-4 grid grid-cols-5 gap-3 h-64 overflow-hidden border border-slate-800">
              {(['blocked', 'ready', 'in-progress', 'pending-review', 'done'] as const).map(apiStatus => (
                <div key={apiStatus} className="flex flex-col h-full">
                   <div className="text-xs font-semibold text-slate-500 uppercase mb-3 flex items-center">
                    <span className={`w-2 h-2 rounded-full mr-2 flex-shrink-0 ${
                      apiStatus === 'ready' ? 'bg-green-500' :
                      apiStatus === 'in-progress' ? 'bg-blue-500' :
                      apiStatus === 'pending-review' ? 'bg-yellow-500' :
                      apiStatus === 'blocked' ? 'bg-red-500' : 'bg-slate-600'
                    }`}></span>
                    <span className="truncate">{statusMap[apiStatus]}</span>
                   </div>
                   <div className="flex-1 space-y-2 overflow-y-auto scrollbar-hide">
                      {status.prds.filter(p => p.status === apiStatus).map(prd => (
                        <Card key={prd.name} className="p-3 shadow-none bg-slate-800 border-slate-700 hover:border-slate-600 hover:shadow-md cursor-pointer transition-all active:scale-95" onClick={() => navigate('/prds')}>
                           <div className="text-xs font-medium text-slate-200 line-clamp-2">{prd.name}</div>
                           {prd.unmetDependencies.length > 0 && (
                             <div className="mt-2 text-[10px] text-amber-400">
                               Blocked by: {prd.unmetDependencies.join(', ')}
                             </div>
                           )}
                           {prd.status === 'in-progress' && (
                             <div className="h-1.5 w-1.5 bg-blue-500 rounded-full animate-pulse mt-2"></div>
                           )}
                           {prd.status === 'pending-review' && (
                             <div className="h-1.5 w-1.5 bg-yellow-500 rounded-full animate-pulse mt-2"></div>
                           )}
                        </Card>
                      ))}
                      {status.prds.filter(p => p.status === apiStatus).length === 0 && (
                        <div className="h-full border-2 border-dashed border-slate-800 rounded-lg flex items-center justify-center">
                          <span className="text-xs text-slate-600">Empty</span>
                        </div>
                      )}
                   </div>
                </div>
              ))}
           </div>
        </div>

        {/* Recent Activity */}
        <div className="lg:col-span-1">
          <h2 className="text-lg font-semibold text-slate-200 mb-4">System Status</h2>
          <Card className="h-64 overflow-y-auto">
            <div className="p-4 space-y-4">
              <div>
                <p className="text-xs font-medium text-slate-500 uppercase mb-1">Project</p>
                <p className="text-sm text-slate-200">{status.projectName}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500 uppercase mb-1">Provider</p>
                <p className="text-sm text-slate-200 capitalize">{status.config.provider}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500 uppercase mb-1">PRD Directory</p>
                <p className="text-sm text-slate-200">{status.config.prdDir}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500 uppercase mb-1">Last Updated</p>
                <p className="text-sm text-slate-200">{new Date(status.timestamp).toLocaleString()}</p>
              </div>
            </div>
          </Card>
        </div>
      </div>

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
                        ? `PID: ${executorProcess.pid} • Running`
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
           </div>
        </Card>
      </div>
    </div>
  );
};

export default Dashboard;
