import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Activity, CheckCircle, Clock, AlertTriangle, Play, Search as SearchIcon, Calendar, CalendarOff, ArrowRight } from 'lucide-react';
import Card from '../components/ui/Card';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import { MOCK_PRDS, MOCK_PRS } from '../constants';
import { Status } from '../types';

const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const readyPrds = MOCK_PRDS.filter(p => p.status === Status.Ready).length;
  const inProgressPrds = MOCK_PRDS.filter(p => p.status === Status.InProgress);
  const openPrs = MOCK_PRS.length;
  const needsWorkPrs = MOCK_PRS.filter(p => p.reviewScore !== null && p.reviewScore < 70).length;

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
          <p className="text-xs text-slate-500 mt-4">of {MOCK_PRDS.length} total</p>
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
              <h3 className="text-3xl font-bold text-slate-100 mt-1">Active</h3>
            </div>
            <div className="p-2 bg-indigo-500/10 rounded-lg text-indigo-400">
              <Calendar className="h-5 w-5" />
            </div>
          </div>
          <p className="text-xs text-slate-500 mt-4">Next run in 12m 30s</p>
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
           
           <div className="bg-slate-900 rounded-xl p-4 grid grid-cols-4 gap-4 h-64 overflow-hidden border border-slate-800">
              {[Status.Blocked, Status.Ready, Status.InProgress, Status.Done].map(status => (
                <div key={status} className="flex flex-col h-full">
                   <div className="text-xs font-semibold text-slate-500 uppercase mb-3 flex items-center">
                    <span className={`w-2 h-2 rounded-full mr-2 ${
                      status === Status.Ready ? 'bg-green-500' : 
                      status === Status.InProgress ? 'bg-blue-500' :
                      status === Status.Blocked ? 'bg-red-500' : 'bg-slate-600'
                    }`}></span>
                    {status}
                   </div>
                   <div className="flex-1 space-y-2 overflow-y-auto scrollbar-hide">
                      {MOCK_PRDS.filter(p => p.status === status).map(prd => (
                        <Card key={prd.id} className="p-3 shadow-none bg-slate-800 border-slate-700 hover:border-slate-600 hover:shadow-md cursor-pointer transition-all active:scale-95" onClick={() => navigate('/prds')}>
                           <div className="text-xs font-medium text-slate-200 line-clamp-2">{prd.name}</div>
                           <div className="mt-2 flex items-center justify-between">
                             <div className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                               prd.complexity === 'HIGH' ? 'bg-red-500/20 text-red-300' : 
                               prd.complexity === 'MEDIUM' ? 'bg-amber-500/20 text-amber-300' : 'bg-green-500/20 text-green-300'
                             }`}>{prd.complexity}</div>
                             {prd.status === Status.InProgress && (
                               <div className="h-1.5 w-1.5 bg-blue-500 rounded-full animate-pulse"></div>
                             )}
                           </div>
                        </Card>
                      ))}
                      {MOCK_PRDS.filter(p => p.status === status).length === 0 && (
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
          <h2 className="text-lg font-semibold text-slate-200 mb-4">Recent Activity</h2>
          <Card className="h-64 overflow-y-auto">
            <div className="divide-y divide-slate-800">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="p-3 flex items-start space-x-3 hover:bg-slate-800 transition-colors cursor-default">
                  <div className={`mt-0.5 h-2 w-2 rounded-full flex-shrink-0 ${i === 1 ? 'bg-green-500' : i === 2 ? 'bg-red-500' : 'bg-slate-600'}`}></div>
                  <div>
                    <p className="text-sm text-slate-300">
                      {i === 1 ? 'Executor completed PRD-2 successfully' : 
                       i === 2 ? 'Reviewer failed on PR #102' : 
                       'Cron scheduler triggered'}
                    </p>
                    <p className="text-xs text-slate-500 mt-1">{i * 15} minutes ago</p>
                  </div>
                </div>
              ))}
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
                  <div className="h-2.5 w-2.5 bg-green-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.5)]"></div>
                  <div>
                    <div className="font-medium text-slate-200">Executor</div>
                    <div className="text-xs text-slate-500">PID: 12345 • Uptime: 3m 22s</div>
                  </div>
                </div>
                <Button size="sm" variant="ghost">View Log</Button>
             </div>
             <div className="flex items-center justify-between p-3 bg-slate-950/50 rounded-lg border border-slate-800">
                <div className="flex items-center space-x-3">
                  <div className="h-2.5 w-2.5 bg-slate-700 rounded-full"></div>
                  <div>
                    <div className="font-medium text-slate-400">Reviewer</div>
                    <div className="text-xs text-slate-600">Idle</div>
                  </div>
                </div>
                <Button size="sm" variant="ghost" disabled>View Log</Button>
             </div>
          </div>
        </Card>

        {/* Quick Actions */}
        <Card className="p-6">
           <h3 className="text-base font-semibold text-slate-200 mb-4">Quick Actions</h3>
           <div className="grid grid-cols-2 gap-3">
              <Button variant="outline" className="h-auto py-3 flex flex-col items-center justify-center space-y-1 hover:border-indigo-500/50 hover:bg-indigo-500/10 hover:text-indigo-400">
                 <Play className="h-5 w-5 text-indigo-500" />
                 <span className="text-xs font-medium">Run Executor</span>
              </Button>
              <Button variant="outline" className="h-auto py-3 flex flex-col items-center justify-center space-y-1 hover:border-purple-500/50 hover:bg-purple-500/10 hover:text-purple-400">
                 <SearchIcon className="h-5 w-5 text-purple-500" />
                 <span className="text-xs font-medium">Run Reviewer</span>
              </Button>
              <Button variant="outline" className="h-auto py-3 flex flex-col items-center justify-center space-y-1 hover:border-green-500/50 hover:bg-green-500/10 hover:text-green-400">
                 <Calendar className="h-5 w-5 text-green-500" />
                 <span className="text-xs font-medium">Install Cron</span>
              </Button>
              <Button variant="outline" className="h-auto py-3 flex flex-col items-center justify-center space-y-1 hover:border-red-500/50 hover:bg-red-500/10 text-red-400 hover:text-red-300">
                 <CalendarOff className="h-5 w-5" />
                 <span className="text-xs font-medium">Uninstall Cron</span>
              </Button>
           </div>
        </Card>
      </div>
    </div>
  );
};

export default Dashboard;