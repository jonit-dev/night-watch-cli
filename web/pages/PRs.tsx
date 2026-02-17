import React, { useState } from 'react';
import { ExternalLink, CheckCircle, XCircle, Loader2, AlertCircle } from 'lucide-react';
import { MOCK_PRS } from '../constants';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';

const PRs: React.FC = () => {
  const [selectedPR, setSelectedPR] = useState<string | null>(null);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'success': return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'failure': return <XCircle className="h-4 w-4 text-red-500" />;
      case 'pending': return <Loader2 className="h-4 w-4 text-amber-500 animate-spin" />;
      default: return <AlertCircle className="h-4 w-4 text-slate-500" />;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
         <div className="flex space-x-1">
             <span className="px-3 py-1 bg-slate-800 text-slate-200 rounded-full text-xs font-medium cursor-pointer border border-slate-700">All</span>
             <span className="px-3 py-1 text-slate-500 hover:bg-slate-800 hover:text-slate-300 rounded-full text-xs font-medium cursor-pointer transition-colors">Needs Work</span>
             <span className="px-3 py-1 text-slate-500 hover:bg-slate-800 hover:text-slate-300 rounded-full text-xs font-medium cursor-pointer transition-colors">Pending</span>
         </div>
      </div>

      <div className="bg-slate-900 rounded-lg shadow-sm border border-slate-800 overflow-hidden">
        <table className="min-w-full divide-y divide-slate-800">
          <thead className="bg-slate-950/50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Title</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Branch</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">CI Status</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Review Score</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {MOCK_PRS.map((pr) => (
              <tr key={pr.id} className="hover:bg-slate-800/50 cursor-pointer transition-colors" onClick={() => setSelectedPR(selectedPR === pr.id ? null : pr.id)}>
                <td className="px-6 py-4">
                  <div className="flex items-center">
                    <span className="text-slate-500 font-mono mr-2">#{pr.number}</span>
                    <span className="font-medium text-slate-200">{pr.title}</span>
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">by {pr.author} • {pr.updated}</div>
                </td>
                <td className="px-6 py-4">
                   <span className="px-2 py-1 bg-slate-800 text-slate-400 border border-slate-700 rounded text-xs font-mono">{pr.branch}</span>
                </td>
                <td className="px-6 py-4">
                   <div className="flex items-center space-x-2">
                      {getStatusIcon(pr.ciStatus)}
                      <span className="text-sm capitalize text-slate-400">{pr.ciStatus}</span>
                   </div>
                </td>
                <td className="px-6 py-4">
                  {pr.reviewScore !== null ? (
                    <div className="flex items-center space-x-2">
                       <div className="w-24 h-2 bg-slate-800 rounded-full overflow-hidden">
                          <div 
                            className={`h-full ${pr.reviewScore >= 70 ? 'bg-green-500' : 'bg-red-500'}`} 
                            style={{ width: `${pr.reviewScore}%` }}
                          />
                       </div>
                       <span className={`text-sm font-bold ${pr.reviewScore >= 70 ? 'text-green-500' : 'text-red-500'}`}>{pr.reviewScore}</span>
                    </div>
                  ) : (
                    <span className="text-slate-600 text-sm">—</span>
                  )}
                </td>
                <td className="px-6 py-4 text-right">
                   <a href="#" className="text-slate-500 hover:text-indigo-400" onClick={(e) => e.stopPropagation()}>
                      <ExternalLink className="h-4 w-4" />
                   </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Expanded Details Panel */}
      {selectedPR && (
         <Card className="p-6 bg-slate-900 border-indigo-900/50 animate-in fade-in slide-in-from-top-4 duration-300">
            {(() => {
               const pr = MOCK_PRS.find(p => p.id === selectedPR);
               if (!pr) return null;
               return (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                     <div className="col-span-2 space-y-4">
                        <h3 className="font-bold text-slate-200">Description</h3>
                        <p className="text-sm text-slate-400">{pr.body}</p>
                        
                        <div className="grid grid-cols-3 gap-4 pt-4">
                           <div className="bg-slate-950/50 p-3 rounded border border-slate-800">
                              <div className="text-xs text-slate-500">Files Changed</div>
                              <div className="text-xl font-bold text-slate-200">{pr.filesChanged}</div>
                           </div>
                           <div className="bg-slate-950/50 p-3 rounded border border-slate-800">
                              <div className="text-xs text-slate-500">Additions</div>
                              <div className="text-xl font-bold text-green-500">+{pr.additions}</div>
                           </div>
                           <div className="bg-slate-950/50 p-3 rounded border border-slate-800">
                              <div className="text-xs text-slate-500">Deletions</div>
                              <div className="text-xl font-bold text-red-500">-{pr.deletions}</div>
                           </div>
                        </div>
                     </div>
                     <div className="space-y-4">
                        <h3 className="font-bold text-slate-200">Checks</h3>
                        <div className="space-y-2">
                           {pr.checks.map((check, idx) => (
                              <div key={idx} className="flex items-center justify-between p-2 bg-slate-950/50 rounded border border-slate-800 text-sm">
                                 <span className="text-slate-300">{check.name}</span>
                                 {getStatusIcon(check.status)}
                              </div>
                           ))}
                        </div>
                        <Button className="w-full mt-4">Run Reviewer Now</Button>
                     </div>
                  </div>
               );
            })()}
         </Card>
      )}
    </div>
  );
};

export default PRs;