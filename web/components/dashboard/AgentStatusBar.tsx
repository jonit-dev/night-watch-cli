import React from 'react';
import { Play, Square, FileText } from 'lucide-react';
import { IProcessInfo } from '@/api';

interface IAgentStatusBarProps {
  processes: IProcessInfo[];
  activePrd: string | null;
  onCancelProcess: (type: 'run' | 'review') => void;
  onForceClear: () => void;
  onViewLog: () => void;
  cancellingProcess: 'run' | 'review' | null;
  clearingLock: boolean;
}

interface IAgentConfig {
  name: string;
  displayName: string;
  processName: string;
  cancelType?: 'run' | 'review';
  runningLabel: string;
  idleLabel: string;
}

const AGENTS: IAgentConfig[] = [
  { name: 'executor', displayName: 'Executor', processName: 'executor', cancelType: 'run', runningLabel: 'Running', idleLabel: 'Idle' },
  { name: 'reviewer', displayName: 'Reviewer', processName: 'reviewer', cancelType: 'review', runningLabel: 'Running', idleLabel: 'Idle' },
  { name: 'qa', displayName: 'QA', processName: 'qa', runningLabel: 'Running', idleLabel: 'Idle' },
  { name: 'auditor', displayName: 'Auditor', processName: 'audit', runningLabel: 'Running', idleLabel: 'Idle' },
  { name: 'planner', displayName: 'Planner', processName: 'planner', runningLabel: 'Writing PRDs', idleLabel: 'Idle' },
];

const AgentStatusBar: React.FC<IAgentStatusBarProps> = ({
  processes,
  activePrd,
  onCancelProcess,
  onForceClear,
  onViewLog,
  cancellingProcess,
  clearingLock,
}) => {
  const getProcess = (processName: string) => processes.find(p => p.name === processName);

  const truncateText = (text: string, maxLen: number): string => {
    if (text.length <= maxLen) return text;
    return text.slice(0, maxLen - 1) + '...';
  };

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
      {AGENTS.map(agent => {
        const process = getProcess(agent.processName);
        const isRunning = process?.running ?? false;
        const pid = process?.pid;
        const isCancelling = cancellingProcess === agent.cancelType;
        const canCancel = isRunning && agent.cancelType;
        const showForceClear = !isRunning && agent.name === 'executor' && activePrd;

        const statusInfo = isRunning
          ? pid
            ? `PID: ${pid}`
            : agent.runningLabel
          : agent.idleLabel;

        const prdInfo = isRunning && agent.name === 'executor' && activePrd
          ? truncateText(activePrd, 20)
          : null;

        return (
          <div
            key={agent.name}
            className={`flex items-center gap-2 p-2.5 rounded-lg border transition-colors ${
              isRunning
                ? 'bg-green-950/30 border-green-800/50'
                : 'bg-slate-950/50 border-slate-800'
            }`}
          >
            {/* Status Dot */}
            <div
              className={`h-2.5 w-2.5 rounded-full flex-shrink-0 ${
                isRunning
                  ? 'bg-green-500 animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.5)]'
                  : 'bg-slate-700'
              }`}
            />

            {/* Agent Name and Status */}
            <div className="flex-1 min-w-0">
              <div className={`text-sm font-medium ${isRunning ? 'text-slate-200' : 'text-slate-400'}`}>
                {agent.displayName}
              </div>
              <div className="text-xs text-slate-500 truncate">
                {prdInfo ? (
                  <span className="flex items-center gap-1">
                    <FileText className="h-3 w-3 flex-shrink-0" />
                    {prdInfo}
                  </span>
                ) : (
                  statusInfo
                )}
              </div>
            </div>

            {/* Action Button */}
            <div className="flex-shrink-0">
              {canCancel && (
                <button
                  onClick={() => agent.cancelType && onCancelProcess(agent.cancelType)}
                  disabled={isCancelling}
                  className="p-1 text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded transition-colors disabled:opacity-50"
                  title="Stop process"
                >
                  <Square className="h-3.5 w-3.5" />
                </button>
              )}
              {showForceClear && (
                <button
                  onClick={onForceClear}
                  disabled={clearingLock}
                  className="p-1 text-amber-400 hover:text-amber-300 hover:bg-amber-500/10 rounded transition-colors disabled:opacity-50"
                  title="Force clear stale state"
                >
                  <Square className="h-3.5 w-3.5" />
                </button>
              )}
              {!canCancel && !showForceClear && isRunning && (
                <button
                  onClick={onViewLog}
                  className="p-1 text-slate-400 hover:text-slate-300 hover:bg-white/5 rounded transition-colors"
                  title="View log"
                >
                  <FileText className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default AgentStatusBar;
