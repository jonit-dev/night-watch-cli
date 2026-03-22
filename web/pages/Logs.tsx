import React, { useState, useEffect, useRef } from 'react';
import { Pause, Play, ArrowDownCircle, AlertCircle } from 'lucide-react';
import Button from '../components/ui/Button.js';
import LogFilterBar from '../components/LogFilterBar.js';
import { useApi, fetchLogs } from '../api.js';
import { useStore } from '../store/useStore.js';
import { JOB_DEFINITIONS } from '../utils/jobs.js';

type LogName = string;

const Logs: React.FC = () => {
  const [autoScroll, setAutoScroll] = useState(true);
  const [activeLog, setActiveLog] = useState<LogName>('executor');
  const scrollRef = useRef<HTMLDivElement>(null);
  const { selectedProjectId, globalModeLoading } = useStore();
  const status = useStore((s) => s.status);

  // New filter state
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [errorsOnly, setErrorsOnly] = useState(false);

  const { data: logData, loading: logLoading, error: logError, refetch: refetchLogs } = useApi(
    () => fetchLogs(activeLog, 500),
    [activeLog, selectedProjectId],
    { enabled: !globalModeLoading }
  );

  const logs = logData?.lines || [];

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  // Auto-refresh while auto-scroll is enabled to simulate a live tail view.
  useEffect(() => {
    if (!autoScroll) {
      return;
    }
    const intervalId = window.setInterval(() => {
      refetchLogs();
    }, 3000);
    return () => window.clearInterval(intervalId);
  }, [autoScroll, activeLog, refetchLogs]);

  // Handle agent selection - also switch the log file
  const handleSelectAgent = (agent: string | null) => {
    setSelectedAgent(agent);
    if (agent) {
      setActiveLog(agent);
    }
    setSearchTerm('');
  };

  // Parse log line to extract agent name from [agent-name] prefix
  const parseLogAgent = (log: string): string | null => {
    const match = log.match(/\[(\w+)\]/);
    if (match) {
      const agentName = match[1].toLowerCase();
      // Check if it matches one of our known agents
      const knownAgent = JOB_DEFINITIONS.find(
        (j) => j.processName.toLowerCase() === agentName || j.label.toLowerCase() === agentName
      );
      return knownAgent?.processName ?? null;
    }
    return null;
  };

  // Filter logs based on selected agent, search term, and errors only
  const filteredLogs = logs.filter((log) => {
    // Agent filter - check if log contains the agent prefix
    if (selectedAgent) {
      const logAgent = parseLogAgent(log);
      // Also check if the log line contains the selected agent name anywhere
      const containsAgent = log.toLowerCase().includes(selectedAgent.toLowerCase());
      if (logAgent !== selectedAgent && !containsAgent) {
        return false;
      }
    }

    // Search term filter
    if (searchTerm && !log.toLowerCase().includes(searchTerm.toLowerCase())) {
      return false;
    }

    // Errors only filter
    if (errorsOnly) {
      const hasError = log.includes('[ERROR]') ||
                     log.includes('[error]') ||
                     log.includes('error:') ||
                     log.includes('Error:') ||
                     log.includes('failed') ||
                     log.includes('Failed') ||
                     log.includes('exception') ||
                     log.includes('Exception');
      if (!hasError) {
        return false;
      }
    }

    return true;
  });

  const getProcessStatus = (logName: LogName) => {
    if (!status?.processes) return false;
    const process = status.processes.find(p => p.name === logName);
    return process?.running ?? false;
  };

  if (logError) {
    return (
      <div className="flex flex-col items-center justify-center h-full space-y-4">
        <AlertCircle className="h-12 w-12 text-red-400" />
        <div className="text-slate-300">Failed to load logs</div>
        <div className="text-sm text-slate-500">{logError.message}</div>
        <Button onClick={() => refetchLogs()}>Retry</Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)]">
      {/* Filter Bar */}
      <div className="mb-4 bg-slate-900 p-4 rounded-lg border border-slate-800 shadow-sm">
        <LogFilterBar
          selectedAgent={selectedAgent}
          onSelectAgent={handleSelectAgent}
          searchTerm={searchTerm}
          onSearchChange={setSearchTerm}
          errorsOnly={errorsOnly}
          onErrorsOnlyChange={setErrorsOnly}
        />
      </div>

      {/* Controls */}
      <div className="flex items-center justify-end mb-4 bg-slate-900 p-2 rounded-lg border border-slate-800 shadow-sm">
         <div className="flex items-center space-x-2">
            <Button size="sm" variant="ghost" onClick={() => refetchLogs()}>
               <ArrowDownCircle className="h-4 w-4 mr-2" />
               Refresh
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setAutoScroll(!autoScroll)}>
               {autoScroll ? <Pause className="h-4 w-4 mr-2" /> : <Play className="h-4 w-4 mr-2" />}
               {autoScroll ? 'Pause' : 'Resume'}
            </Button>
         </div>
      </div>

      {/* Terminal View */}
      <div className="flex-1 bg-slate-900 rounded-xl overflow-hidden shadow-inner border border-slate-800 flex flex-col relative">
         {/* Stats Bar */}
         <div className="bg-slate-950/50 backdrop-blur text-xs text-slate-500 px-4 py-1.5 flex justify-between border-b border-slate-800">
            <span>File: {activeLog}.log</span>
            <span>{filteredLogs.length} lines {searchTerm || errorsOnly || selectedAgent ? `(filtered from ${logs.length})` : ''}</span>
         </div>

         {/* Content */}
         <div
           ref={scrollRef}
           className="flex-1 overflow-y-auto p-4 font-mono text-sm terminal-scroll bg-slate-900"
         >
            {logLoading ? (
              <div className="flex items-center justify-center h-full text-slate-500">Loading logs...</div>
            ) : filteredLogs.length === 0 ? (
              <div className="flex items-center justify-center h-full text-slate-500">
                {searchTerm || errorsOnly ? 'No logs match your filters' : 'No logs yet — logs will appear after the first run'}
              </div>
            ) : (
              filteredLogs.map((log, idx) => {
                 const isError = log.includes('[ERROR]') || log.includes('[error]') || log.includes('error:');
                 const isWarn = log.includes('[WARN]') || log.includes('[warning]');
                 return (
                   <div key={idx} className={`leading-6 hover:bg-slate-800/50 px-2 rounded -mx-2 ${isError ? 'text-red-400' : isWarn ? 'text-amber-400' : 'text-slate-300'}`}>
                      <span className="text-slate-600 select-none w-10 inline-block text-right mr-4 text-xs opacity-50">{idx + 1}</span>
                      {log}
                   </div>
                 );
              })
            )}
            {autoScroll && <div className="h-4" />} {/* Spacer for auto-scroll */}
         </div>

         {/* Auto-scroll indicator */}
         {!autoScroll && (
            <div className="absolute bottom-4 right-4 bg-indigo-600 text-white px-3 py-1.5 rounded-full shadow-lg shadow-indigo-900/40 text-xs font-medium flex items-center cursor-pointer hover:bg-indigo-500 transition-colors" onClick={() => setAutoScroll(true)}>
               <ArrowDownCircle className="h-4 w-4 mr-2" />
               Scroll to bottom
            </div>
         )}
      </div>
    </div>
  );
};

export default Logs;
