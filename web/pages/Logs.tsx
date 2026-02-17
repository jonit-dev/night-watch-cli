import React, { useState } from 'react';
import { Download, Trash2, Pause, Play, Search, ArrowDownCircle } from 'lucide-react';
import Button from '../components/ui/Button';
import { MOCK_LOGS } from '../constants';

const Logs: React.FC = () => {
  const [autoScroll, setAutoScroll] = useState(true);
  const [filter, setFilter] = useState('');

  const filteredLogs = MOCK_LOGS.filter(log => log.toLowerCase().includes(filter.toLowerCase()));

  // Duplicate logs to make it look fuller
  const displayLogs = [...filteredLogs, ...filteredLogs, ...filteredLogs];

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)]">
      {/* Controls */}
      <div className="flex items-center justify-between mb-4 bg-slate-900 p-2 rounded-lg border border-slate-800 shadow-sm">
         <div className="flex items-center space-x-2">
            <div className="relative group">
               <input 
                 type="text" 
                 placeholder="Filter logs..." 
                 className="pl-9 pr-4 py-1.5 rounded-md border border-slate-700 bg-slate-950 text-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent w-64 placeholder:text-slate-600"
                 value={filter}
                 onChange={(e) => setFilter(e.target.value)}
               />
               <Search className="absolute left-2.5 top-2 h-4 w-4 text-slate-500 group-focus-within:text-indigo-400" />
            </div>
            <div className="h-6 w-px bg-slate-700 mx-2"></div>
            <div className="flex space-x-1">
               <button className="px-3 py-1.5 rounded text-sm font-medium bg-slate-800 text-slate-200 shadow-sm border border-slate-700">Executor</button>
               <button className="px-3 py-1.5 rounded text-sm font-medium text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition-colors">Reviewer</button>
            </div>
         </div>
         <div className="flex items-center space-x-2">
            <Button size="sm" variant="ghost" onClick={() => setAutoScroll(!autoScroll)}>
               {autoScroll ? <Pause className="h-4 w-4 mr-2" /> : <Play className="h-4 w-4 mr-2" />}
               {autoScroll ? 'Pause' : 'Resume'}
            </Button>
            <Button size="sm" variant="ghost">
               <Download className="h-4 w-4 mr-2" />
               Export
            </Button>
            <Button size="sm" variant="ghost" className="text-red-500 hover:bg-red-500/10 hover:text-red-400">
               <Trash2 className="h-4 w-4 mr-2" />
               Clear
            </Button>
         </div>
      </div>

      {/* Terminal View */}
      <div className="flex-1 bg-slate-900 rounded-xl overflow-hidden shadow-inner border border-slate-800 flex flex-col relative">
         {/* Stats Bar */}
         <div className="bg-slate-950/50 backdrop-blur text-xs text-slate-500 px-4 py-1.5 flex justify-between border-b border-slate-800">
            <span>File: executor.log</span>
            <span>24.5 KB • 1,204 lines</span>
         </div>
         
         {/* Content */}
         <div className="flex-1 overflow-y-auto p-4 font-mono text-sm terminal-scroll bg-slate-900">
            {displayLogs.map((log, idx) => {
               const isError = log.includes('[ERROR]');
               const isWarn = log.includes('[WARN]');
               return (
                 <div key={idx} className={`leading-6 hover:bg-slate-800/50 px-2 rounded -mx-2 ${isError ? 'text-red-400' : isWarn ? 'text-amber-400' : 'text-slate-300'}`}>
                    <span className="text-slate-600 select-none w-10 inline-block text-right mr-4 text-xs opacity-50">{idx + 1}</span>
                    {log}
                 </div>
               );
            })}
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