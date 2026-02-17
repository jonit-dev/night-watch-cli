import React, { useState } from 'react';
import { Play, Search, Calendar, CalendarOff, Terminal as TerminalIcon, XCircle, CheckCircle, AlertCircle } from 'lucide-react';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import { useStore } from '../store/useStore';
import { triggerRun, triggerReview, triggerInstallCron, triggerUninstallCron } from '../api';

type ActionStatus = 'idle' | 'running' | 'success' | 'error';

interface ActionState {
  status: ActionStatus;
  message: string;
  pid?: number;
}

const Actions: React.FC = () => {
  const [actionStates, setActionStates] = useState<Record<string, ActionState>>({});
  const [logs, setLogs] = useState<string[]>([]);
  const { addToast } = useStore();

  const handleAction = async (
    actionKey: string,
    actionName: string,
    triggerFn: () => Promise<{ started: boolean; pid?: number; error?: string }>
  ) => {
    setActionStates(prev => ({ ...prev, [actionKey]: { status: 'running', message: `Starting ${actionName}...` } }));
    setLogs([`> Starting ${actionName}...`]);

    try {
      const result = await triggerFn();

      if (result.started) {
        setActionStates(prev => ({
          ...prev,
          [actionKey]: { status: 'success', message: `${actionName} started successfully`, pid: result.pid }
        }));
        setLogs(prev => [...prev, `> ${actionName} started successfully.`, `> PID: ${result.pid}`, `> Process is running in background.`]);
        addToast({ title: 'Action Started', message: `${actionName} is now running`, type: 'success' });
      } else {
        throw new Error(result.error || 'Action failed to start');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setActionStates(prev => ({
        ...prev,
        [actionKey]: { status: 'error', message: errorMessage }
      }));
      setLogs(prev => [...prev, `> ${actionName} failed: ${errorMessage}`]);
      addToast({ title: 'Action Failed', message: errorMessage, type: 'error' });
    }
  };

  const actions = [
    { key: 'run', title: 'Execute PRD', icon: Play, desc: 'Pick next eligible PRD and run', action: 'Execute', trigger: () => handleAction('run', 'Executor', triggerRun) },
    { key: 'review', title: 'Review PRs', icon: Search, desc: 'Check open PRs for issues', action: 'Review', trigger: () => handleAction('review', 'Reviewer', triggerReview) },
    { key: 'install', title: 'Install Cron', icon: Calendar, desc: 'Setup automated schedule', action: 'Install', trigger: () => handleAction('install', 'Cron', triggerInstallCron) },
    { key: 'uninstall', title: 'Uninstall Cron', icon: CalendarOff, desc: 'Remove automation', action: 'Uninstall', danger: true, trigger: () => handleAction('uninstall', 'Cron', triggerUninstallCron) },
  ];

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
         {actions.map((card) => {
           const state = actionStates[card.key];
           const isRunning = state?.status === 'running';
           const isSuccess = state?.status === 'success';
           const isError = state?.status === 'error';

           return (
             <Card key={card.key} className={`p-5 flex flex-col justify-between h-48 transition-all ${isSuccess ? 'border-green-500/50' : isError ? 'border-red-500/50' : 'hover:border-slate-700 hover:shadow-lg'}`}>
                <div>
                   <div className={`w-10 h-10 rounded-lg flex items-center justify-center mb-4 ${card.danger ? 'bg-red-500/10 text-red-500' : 'bg-indigo-500/10 text-indigo-500'}`}>
                      <card.icon className="h-6 w-6" />
                   </div>
                   <h3 className="font-bold text-slate-100">{card.title}</h3>
                   <p className="text-sm text-slate-400 mt-1 leading-snug">{card.desc}</p>
                   {state && (
                     <div className="mt-2 text-xs">
                       {isRunning && <span className="text-blue-400 animate-pulse">{state.message}</span>}
                       {isSuccess && <span className="text-green-400">{state.message}</span>}
                       {isError && <span className="text-red-400">{state.message}</span>}
                     </div>
                   )}
                </div>
                <Button
                  variant={card.danger ? 'danger' : 'primary'}
                  className="w-full mt-4"
                  size="sm"
                  onClick={card.trigger}
                  disabled={isRunning}
                >
                  {isRunning ? 'Running...' : card.action}
                </Button>
             </Card>
           );
         })}
      </div>

      {/* Live Terminal */}
      <div className="bg-slate-900 rounded-xl overflow-hidden shadow-2xl border border-slate-800">
         <div className="bg-slate-950 px-4 py-2 flex items-center justify-between border-b border-slate-800">
            <div className="flex items-center space-x-2">
               <TerminalIcon className="h-4 w-4 text-slate-500" />
               <span className="text-xs font-mono text-slate-400">Live Output</span>
            </div>
            {(Object.values(actionStates) as ActionState[]).some(s => s.status === 'running') && (
              <span className="text-xs text-green-400 animate-pulse flex items-center"><span className="w-2 h-2 rounded-full bg-green-400 mr-2"></span>Running</span>
            )}
         </div>
         <div className="p-4 font-mono text-sm h-64 overflow-y-auto terminal-scroll text-slate-300 space-y-1 bg-slate-900">
            {logs.length > 0 ? logs.map((log, i) => (
               <div key={i} className="break-all">{log}</div>
            )) : (
               <div className="text-slate-600 italic">Waiting for action...</div>
            )}
            {/* Fake cursor */}
            {(Object.values(actionStates) as ActionState[]).some(s => s.status === 'running') && <div className="w-2 h-4 bg-slate-500 animate-pulse inline-block align-middle ml-1"></div>}
         </div>
      </div>

      {/* Info Card */}
      <Card className="p-6 bg-slate-900 border-slate-800">
         <h2 className="text-lg font-semibold text-slate-200 mb-4">About Actions</h2>
         <div className="space-y-4 text-sm text-slate-400">
            <div>
               <h3 className="font-medium text-slate-200 mb-1">Execute PRD</h3>
               <p>The executor picks the next eligible PRD (ready status, no unmet dependencies) and runs it through the AI provider to generate code changes.</p>
            </div>
            <div>
               <h3 className="font-medium text-slate-200 mb-1">Review PRs</h3>
               <p>The reviewer checks open PRs against night-watch branch patterns and analyzes them for code quality, security issues, and potential improvements.</p>
            </div>
            <div>
               <h3 className="font-medium text-slate-200 mb-1">Cron Actions</h3>
               <p>Install or remove crontab entries for automated execution. The executor and reviewer can run on schedules defined in your configuration.</p>
            </div>
         </div>
      </Card>
    </div>
  );
};

export default Actions;
