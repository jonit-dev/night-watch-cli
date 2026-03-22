import React from 'react';
import { Search, AlertTriangle } from 'lucide-react';
import { JOB_DEFINITIONS } from '../../utils/jobs.js';
import { useStore } from '../../store/useStore.js';

interface ILogFilterBarProps {
  selectedAgent: string | null;
  onSelectAgent: (agent: string | null) => void;
  searchTerm: string;
  onSearchChange: (term: string) => void;
  errorsOnly: boolean;
  onErrorsOnlyChange: (enabled: boolean) => void;
}

const LogFilterBar: React.FC<ILogFilterBarProps> = (props) => {
  const {
    selectedAgent,
    onSelectAgent,
    searchTerm,
    onSearchChange,
    errorsOnly,
    onErrorsOnlyChange,
  } = props;

  const status = useStore((s) => s.status);

  // Get running status for each agent
  const getProcessStatus = (processName: string): boolean => {
    if (!status?.processes) return false;
    const process = status.processes.find((p) => p.name === processName);
    return process?.running ?? false;
  };

  return (
    <div className="space-y-3">
      {/* Agent pills row */}
      <div className="flex flex-wrap items-center gap-2">
        {/* All option */}
        <button
          onClick={() => onSelectAgent(null)}
          className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
            selectedAgent === null
              ? 'bg-slate-700 text-slate-200 shadow-sm'
              : 'bg-slate-800/50 text-slate-400 hover:bg-slate-700/50 hover:text-slate-300'
          }`}
        >
          All
        </button>

        {/* Agent pills */}
        {JOB_DEFINITIONS.map((job) => {
          const isSelected = selectedAgent === job.processName;
          const isRunning = getProcessStatus(job.processName);

          return (
            <button
              key={job.id}
              onClick={() => onSelectAgent(job.processName)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all flex items-center gap-2 ${
                isSelected
                  ? `${job.color.bg} text-white shadow-sm`
                  : 'bg-slate-800/50 text-slate-400 hover:bg-slate-700/50 hover:text-slate-300'
              }`}
            >
              <span>{job.label}</span>
              {isRunning && (
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Search and errors toggle row */}
      <div className="flex items-center gap-4">
        {/* Search input */}
        <div className="relative flex-1 max-w-md">
          <input
            type="text"
            placeholder="Filter log lines..."
            value={searchTerm}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full pl-9 pr-4 py-1.5 rounded-md border border-slate-700 bg-slate-950 text-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent placeholder:text-slate-600"
          />
          <Search className="absolute left-2.5 top-2 h-4 w-4 text-slate-500" />
        </div>

        {/* Errors only toggle */}
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={errorsOnly}
            onChange={(e) => onErrorsOnlyChange(e.target.checked)}
            className="h-4 w-4 rounded border-slate-600 bg-slate-800 text-indigo-500 focus:ring-indigo-500 focus:ring-1"
          />
          <span className="text-sm text-slate-400 flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5" />
            Errors only
          </span>
        </label>
      </div>
    </div>
  );
};

export default LogFilterBar;
