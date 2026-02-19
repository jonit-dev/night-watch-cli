import React, { useState, useMemo } from 'react';
import { ExternalLink, CheckCircle, XCircle, Loader2, AlertCircle, Search, ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';
import { useApi, fetchPrs, triggerReview } from '../api';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import { useStore } from '../store/useStore';

type FilterType = 'all' | 'needs-work' | 'pending' | 'passed';
type SortField = 'number' | 'title' | 'branch' | 'ciStatus' | 'reviewScore';
type SortDirection = 'asc' | 'desc';

const PRs: React.FC = () => {
  const [selectedPR, setSelectedPR] = useState<number | null>(null);
  const [runningReview, setRunningReview] = useState(false);
  const [filter, setFilter] = useState<FilterType>('all');
  const [sortField, setSortField] = useState<SortField>('number');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const { addToast, selectedProjectId, globalModeLoading } = useStore();
  const { data: prsData, loading, error, refetch } = useApi(fetchPrs, [selectedProjectId], { enabled: !globalModeLoading });
  const prs = prsData ?? [];

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'pass': return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'fail': return <XCircle className="h-4 w-4 text-red-500" />;
      case 'pending': return <Loader2 className="h-4 w-4 text-amber-500 animate-spin" />;
      default: return <AlertCircle className="h-4 w-4 text-slate-500" />;
    }
  };

  const getStatusTooltip = (status: string): string => {
    switch (status) {
      case 'pass': return 'All CI checks passed';
      case 'fail': return 'One or more CI checks failed';
      case 'pending': return 'CI checks are still running';
      default: return 'No CI data available';
    }
  };

  const getReviewScoreTooltip = (score: number | null): string => {
    if (score === null) return 'No review decision yet';
    if (score === 100) return 'PR has been approved';
    if (score === 0) return 'Changes have been requested';
    return `Review score: ${score}`;
  };

  // Filter PRs based on selected filter
  const filteredPrs = useMemo(() => {
    return prs.filter((pr) => {
      switch (filter) {
        case 'needs-work':
          // CI failed or changes requested (reviewScore === 0)
          return pr.ciStatus === 'fail' || pr.reviewScore === 0;
        case 'pending':
          // CI pending or review not yet done
          return pr.ciStatus === 'pending' || pr.ciStatus === 'unknown' || pr.reviewScore === null;
        case 'passed':
          // CI passed and approved (reviewScore === 100)
          return pr.ciStatus === 'pass' && pr.reviewScore === 100;
        case 'all':
        default:
          return true;
      }
    });
  }, [prs, filter]);

  // Sort filtered PRs
  const sortedPrs = useMemo(() => {
    const sorted = [...filteredPrs].sort((a, b) => {
      let comparison = 0;

      switch (sortField) {
        case 'number':
          comparison = a.number - b.number;
          break;
        case 'title':
          comparison = a.title.localeCompare(b.title);
          break;
        case 'branch':
          comparison = a.branch.localeCompare(b.branch);
          break;
        case 'ciStatus': {
          // Order: fail < pending < unknown < pass
          const statusOrder = { fail: 0, pending: 1, unknown: 2, pass: 3 };
          comparison = (statusOrder[a.ciStatus] ?? 2) - (statusOrder[b.ciStatus] ?? 2);
          break;
        }
        case 'reviewScore': {
          // Null values should sort to end
          const aScore = a.reviewScore ?? -1;
          const bScore = b.reviewScore ?? -1;
          comparison = aScore - bScore;
          break;
        }
      }

      return sortDirection === 'asc' ? comparison : -comparison;
    });

    return sorted;
  }, [filteredPrs, sortField, sortDirection]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  const getSortIcon = (field: SortField) => {
    if (sortField !== field) {
      return <ArrowUpDown className="h-3 w-3 text-slate-600" />;
    }
    return sortDirection === 'asc'
      ? <ArrowUp className="h-3 w-3 text-indigo-400" />
      : <ArrowDown className="h-3 w-3 text-indigo-400" />;
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
             <button
               onClick={() => setFilter('all')}
               className={`px-3 py-1 rounded-full text-xs font-medium cursor-pointer border transition-colors ${
                 filter === 'all'
                   ? 'bg-slate-800 text-slate-200 border-slate-700'
                   : 'text-slate-500 hover:bg-slate-800 hover:text-slate-300 border-transparent'
               }`}
             >
               All
             </button>
             <button
               onClick={() => setFilter('needs-work')}
               className={`px-3 py-1 rounded-full text-xs font-medium cursor-pointer border transition-colors ${
                 filter === 'needs-work'
                   ? 'bg-red-900/50 text-red-300 border-red-800'
                   : 'text-slate-500 hover:bg-slate-800 hover:text-slate-300 border-transparent'
               }`}
             >
               Needs Work
             </button>
             <button
               onClick={() => setFilter('pending')}
               className={`px-3 py-1 rounded-full text-xs font-medium cursor-pointer border transition-colors ${
                 filter === 'pending'
                   ? 'bg-amber-900/50 text-amber-300 border-amber-800'
                   : 'text-slate-500 hover:bg-slate-800 hover:text-slate-300 border-transparent'
               }`}
             >
               Pending
             </button>
             <button
               onClick={() => setFilter('passed')}
               className={`px-3 py-1 rounded-full text-xs font-medium cursor-pointer border transition-colors ${
                 filter === 'passed'
                   ? 'bg-green-900/50 text-green-300 border-green-800'
                   : 'text-slate-500 hover:bg-slate-800 hover:text-slate-300 border-transparent'
               }`}
             >
               Passed
             </button>
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
              <th
                className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider cursor-pointer hover:text-slate-300"
                onClick={() => handleSort('number')}
              >
                <div className="flex items-center space-x-1">
                  <span>Title</span>
                  {getSortIcon('number')}
                </div>
              </th>
              <th
                className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider cursor-pointer hover:text-slate-300"
                onClick={() => handleSort('branch')}
              >
                <div className="flex items-center space-x-1">
                  <span>Branch</span>
                  {getSortIcon('branch')}
                </div>
              </th>
              <th
                className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider cursor-pointer hover:text-slate-300"
                onClick={() => handleSort('ciStatus')}
              >
                <div className="flex items-center space-x-1">
                  <span>CI Status</span>
                  {getSortIcon('ciStatus')}
                </div>
              </th>
              <th
                className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider cursor-pointer hover:text-slate-300"
                onClick={() => handleSort('reviewScore')}
              >
                <div className="flex items-center space-x-1">
                  <span>Review Score</span>
                  {getSortIcon('reviewScore')}
                </div>
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {sortedPrs.map((pr) => (
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
                   <div className="flex items-center space-x-2" title={getStatusTooltip(pr.ciStatus)}>
                      {getStatusIcon(pr.ciStatus)}
                      <span className="text-sm capitalize text-slate-400">{pr.ciStatus}</span>
                   </div>
                </td>
                <td className="px-6 py-4">
                  {pr.reviewScore !== null ? (
                    <div className="flex items-center space-x-2" title={getReviewScoreTooltip(pr.reviewScore)}>
                       <div className="w-24 h-2 bg-slate-800 rounded-full overflow-hidden">
                          <div
                            className={`h-full ${pr.reviewScore >= 70 ? 'bg-green-500' : 'bg-red-500'}`}
                            style={{ width: `${pr.reviewScore}%` }}
                          />
                       </div>
                       <span className={`text-sm font-bold ${pr.reviewScore >= 70 ? 'text-green-500' : 'text-red-500'}`}>{pr.reviewScore}</span>
                    </div>
                  ) : (
                    <span className="text-slate-600 text-sm" title="No review decision yet">—</span>
                  )}
                </td>
                <td className="px-6 py-4 text-right">
                   <a href={pr.url} target="_blank" rel="noopener noreferrer" className="text-slate-500 hover:text-indigo-400" onClick={(e) => e.stopPropagation()}>
                      <ExternalLink className="h-4 w-4" />
                   </a>
                </td>
              </tr>
            ))}
            {sortedPrs.length === 0 && (
              <tr>
                <td colSpan={5} className="px-6 py-12 text-center text-slate-500">
                  {prs.length === 0 ? 'No open PRs found.' : `No PRs match the "${filter}" filter.`}
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
                        <div className="text-center" title={getStatusTooltip(pr.ciStatus)}>
                           <div className="text-xs text-slate-500">CI Status</div>
                           <div className="flex items-center space-x-1 mt-1">
                              {getStatusIcon(pr.ciStatus)}
                              <span className="text-sm capitalize text-slate-300">{pr.ciStatus}</span>
                           </div>
                        </div>
                        {pr.reviewScore !== null && (
                           <div className="text-center" title={getReviewScoreTooltip(pr.reviewScore)}>
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
