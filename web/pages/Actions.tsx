import React, { useState } from 'react';
import { Play, Search, Calendar, CalendarOff, Terminal as TerminalIcon, XCircle, CheckCircle } from 'lucide-react';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import { MOCK_HISTORY, MOCK_LOGS } from '../constants';

const Actions: React.FC = () => {
  const [isRunning, setIsRunning] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  
  const handleRun = (actionName: string) => {
    setIsRunning(true);
    setLogs([`> Starting ${actionName}...`]);
    
    // Simulate streaming logs
    let i = 0;
    const interval = setInterval(() => {
      if (i >= 5) {
         clearInterval(interval);
         setIsRunning(false);
         setLogs(prev => [...prev, `> ${actionName} completed successfully.`]);
         return;
      }
      setLogs(prev => [...prev, MOCK_LOGS[i] || `> Processing step ${i + 1}...`]);
      i++;
    }, 800);
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
         {[
           { title: 'Execute PRD', icon: Play, desc: 'Pick next eligible PRD and run', action: 'Execute' },
           { title: 'Review PRs', icon: Search, desc: 'Check open PRs for issues', action: 'Review' },
           { title: 'Install Cron', icon: Calendar, desc: 'Setup automated schedule', action: 'Install' },
           { title: 'Uninstall Cron', icon: CalendarOff, desc: 'Remove automation', action: 'Uninstall', danger: true },
         ].map((card, idx) => (
           <Card key={idx} className="p-5 flex flex-col justify-between h-48 hover:border-slate-700 hover:shadow-lg transition-all">
              <div>
                 <div className={`w-10 h-10 rounded-lg flex items-center justify-center mb-4 ${card.danger ? 'bg-red-500/10 text-red-500' : 'bg-indigo-500/10 text-indigo-500'}`}>
                    <card.icon className="h-6 w-6" />
                 </div>
                 <h3 className="font-bold text-slate-100">{card.title}</h3>
                 <p className="text-sm text-slate-400 mt-1 leading-snug">{card.desc}</p>
              </div>
              <Button 
                variant={card.danger ? 'danger' : 'primary'} 
                className="w-full mt-4" 
                size="sm"
                onClick={() => handleRun(card.title)}
                disabled={isRunning}
              >
                {card.action}
              </Button>
           </Card>
         ))}
      </div>

      {/* Live Terminal */}
      <div className="bg-slate-900 rounded-xl overflow-hidden shadow-2xl border border-slate-800">
         <div className="bg-slate-950 px-4 py-2 flex items-center justify-between border-b border-slate-800">
            <div className="flex items-center space-x-2">
               <TerminalIcon className="h-4 w-4 text-slate-500" />
               <span className="text-xs font-mono text-slate-400">Live Output</span>
            </div>
            {isRunning && <span className="text-xs text-green-400 animate-pulse flex items-center"><span className="w-2 h-2 rounded-full bg-green-400 mr-2"></span>Running</span>}
         </div>
         <div className="p-4 font-mono text-sm h-64 overflow-y-auto terminal-scroll text-slate-300 space-y-1 bg-slate-900">
            {logs.length > 0 ? logs.map((log, i) => (
               <div key={i} className="break-all">{log}</div>
            )) : (
               <div className="text-slate-600 italic">Waiting for action...</div>
            )}
            {/* Fake cursor */}
            {isRunning && <div className="w-2 h-4 bg-slate-500 animate-pulse inline-block align-middle ml-1"></div>}
         </div>
      </div>

      {/* History Table */}
      <div>
         <h2 className="text-lg font-semibold text-slate-200 mb-4">Run History</h2>
         <div className="bg-slate-900 rounded-lg shadow-sm border border-slate-800 overflow-hidden">
            <table className="min-w-full divide-y divide-slate-800">
               <thead className="bg-slate-950/50">
                  <tr>
                     <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">Action</th>
                     <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">Status</th>
                     <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">Duration</th>
                     <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">Target</th>
                     <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">Time</th>
                  </tr>
               </thead>
               <tbody className="divide-y divide-slate-800">
                  {MOCK_HISTORY.map(row => (
                     <tr key={row.id} className="hover:bg-slate-800/50 transition-colors">
                        <td className="px-6 py-4 text-sm font-medium text-slate-200">{row.action}</td>
                        <td className="px-6 py-4">
                           <div className="flex items-center space-x-2">
                              {row.status === 'Succeeded' ? <CheckCircle className="h-4 w-4 text-green-500" /> : <XCircle className="h-4 w-4 text-red-500" />}
                              <span className="text-sm text-slate-300">{row.status}</span>
                           </div>
                        </td>
                        <td className="px-6 py-4 text-sm text-slate-500 font-mono">{row.duration}</td>
                        <td className="px-6 py-4 text-sm text-slate-400">{row.target}</td>
                        <td className="px-6 py-4 text-sm text-slate-500">{row.timestamp}</td>
                     </tr>
                  ))}
               </tbody>
            </table>
         </div>
      </div>
    </div>
  );
};

export default Actions;