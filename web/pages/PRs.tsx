import React, { useState } from 'react';
import { ExternalLink, CheckCircle, XCircle, Loader2, AlertCircle, Search } from 'lucide-react';
import { useApi, fetchPrs, triggerReview } from '../api';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import { useStore } from '../store/useStore';

const PRs: React.FC = () => {
  const [selectedPR, setSelectedPR] = useState<number | null>(null);
  const [runningReview, setRunningReview] = useState(false);
  const { addToast, selectedProjectId } = useStore();
  const { data: prs = [], loading, error, refetch } = useApi(fetchPrs, [selectedProjectId]);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'pass': return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'fail': return <XCircle className="h-4 w-4 text-red-500" />;
      case 'pending': return <Loader2 className="h-4 w-4 text-amber-500 animate-spin" />;
      default: return <AlertCircle className="h-4 w-4 text-slate-500" />;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-slate-400">Loading PRs...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full space-y-4">
        <AlertCircle className="h-12 w-12 text-red-400" />
        <div className="text-slate-300">Failed to load PRs</div>
        <div className="text-sm text-slate-500">{error.message}</div>
        <Button onClick={() => refetch()}>Retry</Button>
      </div>
    );
  }

  const handleRunReviewer = async () => {
    setRunningReview(true);
    try {
      const result = await triggerReview();
      addToast({
        title: 'Reviewer Started',
        message: result.pid ? `Started with PID ${result.pid}` : 'Reviewer started',
        type: 'success',
      });
    } catch (reviewError) {
      addToast({
        title: 'Reviewer Failed',
        message: reviewError instanceof Error ? reviewError.message : 'Failed to start reviewer',
        type: 'error',
      });
    } finally {
      setRunningReview(false);
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
         <Button size="sm" onClick={handleRunReviewer} disabled={runningReview}>
           <Search className="h-4 w-4 mr-2" />
           {runningReview ? 'Starting...' : 'Run Reviewer Now'}
         </Button>
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
            {prs.map((pr) => (
              <tr key={pr.number} className="hover:bg-slate-800/50 cursor-pointer transition-colors" onClick={() => setSelectedPR(selectedPR === pr.number ? null : pr.number)}>
                <td className="px-6 py-4">
                  <div className="flex items-center">
                    <span className="text-slate-500 font-mono mr-2">#{pr.number}</span>
                    <span className="font-medium text-slate-200">{pr.title}</span>
                  </div>
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
            {prs.length === 0 && (
              <tr>
                <td colSpan={5} className="px-6 py-12 text-center text-slate-500">
                  No open PRs found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Expanded Details Panel */}
      {selectedPR && (
         <Card className="p-6 bg-slate-900 border-indigo-900/50 animate-in fade-in slide-in-from-top-4 duration-300">
            {(() => {
               const pr = prs.find(p => p.number === selectedPR);
               if (!pr) return null;
               return (
                  <div className="flex items-center justify-between">
                     <div>
                        <h3 className="font-bold text-slate-200">{pr.title}</h3>
                        <p className="text-sm text-slate-400 mt-1">Branch: <span className="font-mono">{pr.branch}</span></p>
                     </div>
                     <div className="flex items-center space-x-4">
                        <div className="text-center">
                           <div className="text-xs text-slate-500">CI Status</div>
                           <div className="flex items-center space-x-1 mt-1">
                              {getStatusIcon(pr.ciStatus)}
                              <span className="text-sm capitalize text-slate-300">{pr.ciStatus}</span>
                           </div>
                        </div>
                        {pr.reviewScore !== null && (
                           <div className="text-center">
                              <div className="text-xs text-slate-500">Review Score</div>
                              <div className={`text-xl font-bold mt-1 ${pr.reviewScore >= 70 ? 'text-green-500' : 'text-red-500'}`}>{pr.reviewScore}</div>
                           </div>
                        )}
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
