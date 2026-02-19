import React, { useState, useEffect, useMemo } from 'react';
import { LayoutList, LayoutGrid, MoreVertical, Play, AlertCircle, RotateCcw, ArrowUp, ArrowDown, ArrowUpDown, Loader2, Square } from 'lucide-react';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import { useApi, fetchPrds, fetchBoardStatus, PrdWithContent, IBoardIssue, IBoardStatus, triggerRun, retryPrd, useStatusStream, triggerCancel } from '../api';
import { useStore } from '../store/useStore';

type FilterType = 'all' | 'ready' | 'in-progress' | 'blocked' | 'pending-review' | 'done';
type SortField = 'name' | 'status' | 'dependencies';
type SortDirection = 'asc' | 'desc';

// Map API status to UI status
const statusMap: Record<string, string> = {
  'ready': 'Ready',
  'in-progress': 'In Progress',
  'blocked': 'Blocked',
  'pending-review': 'Pending Review',
  'done': 'Done',
};

const statusVariantMap: Record<string, 'success' | 'info' | 'error' | 'warning' | 'neutral'> = {
  'ready': 'success',
  'in-progress': 'info',
  'blocked': 'error',
  'pending-review': 'warning',
  'done': 'neutral',
};

const PRDs: React.FC = () => {
  const [viewMode, setViewMode] = useState<'list' | 'card'>('list');
  const [selectedPRD, setSelectedPRD] = useState<PrdWithContent | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [optimisticStatus, setOptimisticStatus] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<FilterType>('ready');
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [executingPrd, setExecutingPrd] = useState<string | null>(null);
  const [cancellingPrd, setCancellingPrd] = useState<string | null>(null);
  const [retryingPrd, setRetryingPrd] = useState<string | null>(null);

  const { addToast, selectedProjectId, globalModeLoading } = useStore();
  const { data: prdsData, loading, error, refetch } = useApi(fetchPrds, [selectedProjectId], { enabled: !globalModeLoading });
  const prds = prdsData ?? [];
  const { data: boardStatus } = useApi<IBoardStatus | null>(
    () => fetchBoardStatus().catch(() => null),
    [selectedProjectId],
    { enabled: !globalModeLoading },
  );

  // Build a lookup of board issues by normalized title for badge display
  const boardIssueByTitle = React.useMemo(() => {
    const map = new Map<string, IBoardIssue>();
    if (!boardStatus) return map;
    for (const col of Object.values(boardStatus.columns)) {
      for (const issue of col) {
        map.set(issue.title.toLowerCase().trim(), issue);
      }
    }
    return map;
  }, [boardStatus]);

  // Get the first H1 heading from PRD content (used to match board issues)
  const getPrdTitle = (prd: PrdWithContent): string => {
    if (!prd.content) return prd.name;
    const match = prd.content.match(/^#\s+(.+)$/m);
    return match ? match[1].trim() : prd.name;
  };

  const getBoardIssue = (prd: PrdWithContent): IBoardIssue | null => {
    const title = getPrdTitle(prd).toLowerCase().trim();
    return boardIssueByTitle.get(title) ?? null;
  };

  // Merge optimistic status into displayed PRD list
  const displayPrds = prds.map(p =>
    optimisticStatus[p.name] ? { ...p, status: optimisticStatus[p.name] as PrdWithContent['status'] } : p
  );

  // Filter PRDs based on selected filter
  const filteredPrds = useMemo(() => {
    if (filter === 'all') return displayPrds;
    return displayPrds.filter((prd) => prd.status === filter);
  }, [displayPrds, filter]);

  // Sort filtered PRDs
  const sortedPrds = useMemo(() => {
    const sorted = [...filteredPrds].sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case 'name':
          comparison = a.name.localeCompare(b.name);
          break;
        case 'status': {
          // Order: ready < blocked < in-progress < pending-review < done
          const statusOrder: Record<string, number> = { 'ready': 0, 'blocked': 1, 'in-progress': 2, 'pending-review': 3, 'done': 4 };
          comparison = (statusOrder[a.status] ?? 5) - (statusOrder[b.status] ?? 5);
          break;
        }
        case 'dependencies':
          comparison = a.dependencies.length - b.dependencies.length;
          break;
      }
      return sortDirection === 'asc' ? comparison : -comparison;
    });
    return sorted;
  }, [filteredPrds, sortField, sortDirection]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
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

  // Clear optimistic state when prds data arrives (server confirmed real state)
  useEffect(() => {
    // Clear optimistic status for any PRDs that now have real status from server
    if (Object.keys(optimisticStatus).length > 0) {
      const toClear = Object.keys(optimisticStatus).filter(name =>
        prds.some(p => p.name === name && p.status !== 'ready')
      );
      if (toClear.length > 0) {
        setOptimisticStatus(prev => {
          const s = { ...prev };
          for (const name of toClear) {
            delete s[name];
          }
          return s;
        });
      }
    }
  }, [prds, optimisticStatus]);

  // Subscribe to SSE for real-time updates (primary path)
  // When status changes, refetch PRD list to get updated statuses and content
  useStatusStream(() => {
    refetch();
  }, [selectedProjectId, globalModeLoading], { enabled: !globalModeLoading });

  const handleRetry = async () => {
    if (!selectedPRD) return;
    setIsRetrying(true);
    try {
      const result = await retryPrd(selectedPRD.name);
      addToast({
        title: 'PRD Queued',
        message: result.message,
        type: 'success',
      });
      setSelectedPRD(null);
      refetch();
    } catch (retryError) {
      addToast({
        title: 'Retry Failed',
        message: retryError instanceof Error ? retryError.message : 'Failed to retry PRD',
        type: 'error',
      });
    } finally {
      setIsRetrying(false);
    }
  };

  const handleExecuteNow = async () => {
    if (!selectedPRD) return;
    setIsExecuting(true);
    // Optimistic UI update: immediately mark the PRD as "in-progress"
    setOptimisticStatus(prev => ({ ...prev, [selectedPRD.name]: 'in-progress' }));
    try {
      const result = await triggerRun(selectedPRD.name);
      addToast({
        title: 'Executor Started',
        message: result.pid ? `Started with PID ${result.pid}` : 'Executor started',
        type: 'success',
      });
      refetch(); // Will confirm or correct the optimistic state
    } catch (runError) {
      // Revert optimistic state on error
      setOptimisticStatus(prev => {
        const s = { ...prev };
        delete s[selectedPRD.name];
        return s;
      });
      addToast({
        title: 'Executor Failed',
        message: runError instanceof Error ? runError.message : 'Failed to start executor',
        type: 'error',
      });
    } finally {
      setIsExecuting(false);
    }
  };

  // Row-level actions
  const handleExecutePrd = async (prdName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExecutingPrd(prdName);
    // Optimistic UI update
    setOptimisticStatus(prev => ({ ...prev, [prdName]: 'in-progress' }));
    try {
      const result = await triggerRun(prdName);
      addToast({
        title: 'Executor Started',
        message: result.pid ? `Started with PID ${result.pid}` : 'Executor started',
        type: 'success',
      });
      refetch();
    } catch (err) {
      // Revert optimistic state on error
      setOptimisticStatus(prev => {
        const s = { ...prev };
        delete s[prdName];
        return s;
      });
      addToast({
        title: 'Execute Failed',
        message: err instanceof Error ? err.message : 'Failed to start executor',
        type: 'error',
      });
    } finally {
      setExecutingPrd(null);
    }
  };

  const handleStopPrd = async (prdName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setCancellingPrd(prdName);
    try {
      const result = await triggerCancel('run');
      const allOk = result.results.every(r => r.success);
      addToast({
        title: allOk ? 'Process Cancelled' : 'Cancel Failed',
        message: result.results.map(r => r.message).join('; '),
        type: allOk ? 'success' : 'error',
      });
      if (allOk) refetch();
    } catch (err) {
      addToast({
        title: 'Cancel Failed',
        message: err instanceof Error ? err.message : 'Failed to cancel process',
        type: 'error',
      });
    } finally {
      setCancellingPrd(null);
    }
  };

  const handleRetryPrd = async (prdName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setRetryingPrd(prdName);
    try {
      const result = await retryPrd(prdName);
      addToast({
        title: 'PRD Queued',
        message: result.message,
        type: 'success',
      });
      refetch();
    } catch (err) {
      addToast({
        title: 'Retry Failed',
        message: err instanceof Error ? err.message : 'Failed to retry PRD',
        type: 'error',
      });
    } finally {
      setRetryingPrd(null);
    }
  };

  // Poll for PRDs updates as fallback (30s interval - SSE is the fast path)
  useEffect(() => {
    const id = setInterval(() => refetch(), 30000);
    return () => clearInterval(id);
  }, [refetch]);

  // Refetch on window focus
  useEffect(() => {
    const onFocus = () => refetch();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refetch]);

  // Update selectedPRD when its status changes in the displayed list (includes optimistic updates)
  useEffect(() => {
    if (selectedPRD) {
      const updated = displayPrds.find(p => p.name === selectedPRD.name);
      if (updated) setSelectedPRD(updated);
    }
  }, [displayPrds, selectedPRD]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-slate-400">Loading PRDs...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full space-y-4">
        <AlertCircle className="h-12 w-12 text-red-400" />
        <div className="text-slate-300">Failed to load PRDs</div>
        <div className="text-sm text-slate-500">{error.message}</div>
        <Button onClick={() => refetch()}>Retry</Button>
      </div>
    );
  }

  return (
    <div className="space-y-6 h-[calc(100vh-8rem)] flex flex-col">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center space-x-2">
          <Button variant={viewMode === 'list' ? 'secondary' : 'ghost'} size="icon" onClick={() => setViewMode('list')}>
            <LayoutList className="h-4 w-4" />
          </Button>
          <Button variant={viewMode === 'card' ? 'secondary' : 'ghost'} size="icon" onClick={() => setViewMode('card')}>
            <LayoutGrid className="h-4 w-4" />
          </Button>
          <div className="h-6 w-px bg-slate-800 mx-2"></div>
          <div className="flex flex-wrap gap-1">
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
              onClick={() => setFilter('ready')}
              className={`px-3 py-1 rounded-full text-xs font-medium cursor-pointer border transition-colors ${
                filter === 'ready'
                  ? 'bg-green-900/50 text-green-300 border-green-800'
                  : 'text-slate-500 hover:bg-slate-800 hover:text-slate-300 border-transparent'
              }`}
            >
              Ready
            </button>
            <button
              onClick={() => setFilter('in-progress')}
              className={`px-3 py-1 rounded-full text-xs font-medium cursor-pointer border transition-colors ${
                filter === 'in-progress'
                  ? 'bg-blue-900/50 text-blue-300 border-blue-800'
                  : 'text-slate-500 hover:bg-slate-800 hover:text-slate-300 border-transparent'
              }`}
            >
              In Progress
            </button>
            <button
              onClick={() => setFilter('blocked')}
              className={`px-3 py-1 rounded-full text-xs font-medium cursor-pointer border transition-colors ${
                filter === 'blocked'
                  ? 'bg-red-900/50 text-red-300 border-red-800'
                  : 'text-slate-500 hover:bg-slate-800 hover:text-slate-300 border-transparent'
              }`}
            >
              Blocked
            </button>
            <button
              onClick={() => setFilter('pending-review')}
              className={`px-3 py-1 rounded-full text-xs font-medium cursor-pointer border transition-colors ${
                filter === 'pending-review'
                  ? 'bg-amber-900/50 text-amber-300 border-amber-800'
                  : 'text-slate-500 hover:bg-slate-800 hover:text-slate-300 border-transparent'
              }`}
            >
              Pending Review
            </button>
            <button
              onClick={() => setFilter('done')}
              className={`px-3 py-1 rounded-full text-xs font-medium cursor-pointer border transition-colors ${
                filter === 'done'
                  ? 'bg-slate-700/50 text-slate-300 border-slate-600'
                  : 'text-slate-500 hover:bg-slate-800 hover:text-slate-300 border-transparent'
              }`}
            >
              Done
            </button>
          </div>
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto pr-1 pb-10">
        {viewMode === 'list' ? (
          <div className="bg-slate-900 rounded-lg shadow-sm border border-slate-800 overflow-hidden">
            <table className="min-w-full divide-y divide-slate-800">
              <thead className="bg-slate-950/50">
                <tr>
                  <th
                    scope="col"
                    className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider cursor-pointer hover:text-slate-300"
                    onClick={() => handleSort('name')}
                  >
                    <div className="flex items-center space-x-1">
                      <span>Name</span>
                      {getSortIcon('name')}
                    </div>
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider cursor-pointer hover:text-slate-300"
                    onClick={() => handleSort('status')}
                  >
                    <div className="flex items-center space-x-1">
                      <span>Status</span>
                      {getSortIcon('status')}
                    </div>
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider cursor-pointer hover:text-slate-300"
                    onClick={() => handleSort('dependencies')}
                  >
                    <div className="flex items-center space-x-1">
                      <span>Dependencies</span>
                      {getSortIcon('dependencies')}
                    </div>
                  </th>
                  <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {sortedPrds.map((prd) => (
                  <tr key={prd.name} className="hover:bg-slate-800/50 group cursor-pointer transition-colors" onClick={() => setSelectedPRD(prd)}>
                    <td className="px-6 py-4">
                      <div className="flex items-center space-x-2">
                        <div className="text-sm font-medium text-slate-200">{prd.name}</div>
                        {(() => {
                          const boardIssue = getBoardIssue(prd);
                          if (!boardIssue) return null;
                          return (
                            <a
                              href={boardIssue.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={e => e.stopPropagation()}
                              className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-indigo-500/10 text-indigo-400 ring-1 ring-inset ring-indigo-500/20 hover:bg-indigo-500/20 transition-colors"
                              title={`Board: #${boardIssue.number} — ${boardIssue.column}`}
                            >
                              #{boardIssue.number} · {boardIssue.column}
                            </a>
                          );
                        })()}
                      </div>
                      {prd.unmetDependencies.length > 0 && (
                        <div className="text-xs text-amber-400 mt-1">Blocked by: {prd.unmetDependencies.join(', ')}</div>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <Badge variant={statusVariantMap[prd.status]}>{statusMap[prd.status]}</Badge>
                    </td>
                    <td className="px-6 py-4">
                      {prd.dependencies.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {prd.dependencies.map(d => (
                            <span key={d} className="px-2 py-0.5 bg-slate-800 text-slate-400 text-xs rounded border border-slate-700">{d}</span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-sm text-slate-600">None</span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right" onClick={(e) => e.stopPropagation()}>
                      {prd.status === 'ready' || prd.status === 'blocked' ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => handleExecutePrd(prd.name, e)}
                          disabled={executingPrd === prd.name}
                          className="text-green-400 hover:text-green-300"
                          title="Execute PRD"
                        >
                          {executingPrd === prd.name ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Play className="h-4 w-4" />
                          )}
                        </Button>
                      ) : prd.status === 'in-progress' ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => handleStopPrd(prd.name, e)}
                          disabled={cancellingPrd === prd.name}
                          className="text-red-400 hover:text-red-300"
                          title="Stop execution"
                        >
                          {cancellingPrd === prd.name ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Square className="h-4 w-4" />
                          )}
                        </Button>
                      ) : prd.status === 'done' ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => handleRetryPrd(prd.name, e)}
                          disabled={retryingPrd === prd.name}
                          className="text-amber-400 hover:text-amber-300"
                          title="Retry PRD"
                        >
                          {retryingPrd === prd.name ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <RotateCcw className="h-4 w-4" />
                          )}
                        </Button>
                      ) : (
                        <button className="text-slate-500 hover:text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity">
                          <MoreVertical className="h-4 w-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {sortedPrds.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-6 py-12 text-center text-slate-500">
                      {prds.length === 0 ? 'No PRDs found. Create your first PRD to get started.' : `No PRDs match the "${filter}" filter.`}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {sortedPrds.map((prd) => (
              <Card key={prd.name} className="p-5 flex flex-col h-full hover:border-indigo-500/50 transition-colors" onClick={() => setSelectedPRD(prd)}>
                <div className="flex justify-between items-start mb-4">
                  <Badge variant={statusVariantMap[prd.status]}>{statusMap[prd.status]}</Badge>
                  {prd.status === 'in-progress' && (
                    <div className="h-2 w-2 bg-blue-500 rounded-full animate-pulse"></div>
                  )}
                  {prd.status === 'pending-review' && (
                    <div className="h-2 w-2 bg-yellow-500 rounded-full animate-pulse"></div>
                  )}
                </div>
                <div className="flex items-center space-x-2 mb-2">
                  <h3 className="text-lg font-semibold text-slate-200">{prd.name}</h3>
                  {(() => {
                    const boardIssue = getBoardIssue(prd);
                    if (!boardIssue) return null;
                    return (
                      <a
                        href={boardIssue.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={e => e.stopPropagation()}
                        className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-indigo-500/10 text-indigo-400 ring-1 ring-inset ring-indigo-500/20 hover:bg-indigo-500/20 transition-colors flex-shrink-0"
                      >
                        #{boardIssue.number} · {boardIssue.column}
                      </a>
                    );
                  })()}
                </div>
                {prd.content && (
                  <p className="text-sm text-slate-400 flex-1 line-clamp-3">
                    {prd.content.replace(/^#.*\n/, '')}
                  </p>
                )}
                <div className="mt-4 pt-4 border-t border-slate-800">
                  {prd.dependencies.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-2">
                      {prd.dependencies.map(d => (
                        <span key={d} className="px-2 py-0.5 bg-slate-800 text-slate-400 text-xs rounded border border-slate-700">{d}</span>
                      ))}
                    </div>
                  )}
                  {prd.unmetDependencies.length > 0 && (
                    <div className="text-xs text-amber-400 mb-3">
                      Blocked by: {prd.unmetDependencies.join(', ')}
                    </div>
                  )}
                  {/* Card Actions */}
                  <div className="flex justify-end pt-2" onClick={(e) => e.stopPropagation()}>
                    {prd.status === 'ready' || prd.status === 'blocked' ? (
                      <Button
                        size="sm"
                        onClick={(e) => handleExecutePrd(prd.name, e)}
                        disabled={executingPrd === prd.name}
                        className="text-green-400 hover:text-green-300"
                      >
                        {executingPrd === prd.name ? (
                          <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                        ) : (
                          <Play className="h-4 w-4 mr-1" />
                        )}
                        Execute
                      </Button>
                    ) : prd.status === 'in-progress' ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={(e) => handleStopPrd(prd.name, e)}
                        disabled={cancellingPrd === prd.name}
                        className="text-red-400 hover:text-red-300"
                      >
                        {cancellingPrd === prd.name ? (
                          <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                        ) : (
                          <Square className="h-4 w-4 mr-1" />
                        )}
                        Stop
                      </Button>
                    ) : prd.status === 'done' ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={(e) => handleRetryPrd(prd.name, e)}
                        disabled={retryingPrd === prd.name}
                        className="text-amber-400 hover:text-amber-300"
                      >
                        {retryingPrd === prd.name ? (
                          <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                        ) : (
                          <RotateCcw className="h-4 w-4 mr-1" />
                        )}
                        Retry
                      </Button>
                    ) : null}
                  </div>
                </div>
              </Card>
            ))}
            {sortedPrds.length === 0 && (
              <div className="col-span-full text-center py-12 text-slate-500">
                {prds.length === 0 ? 'No PRDs found. Create your first PRD to get started.' : `No PRDs match the "${filter}" filter.`}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Detail Slide-over */}
      {selectedPRD && (
        <div className="fixed inset-0 z-50 flex justify-end">
           <div className="fixed inset-0 bg-black/70 backdrop-blur-sm transition-opacity" onClick={() => setSelectedPRD(null)}></div>
           <div className="relative w-full max-w-xl bg-slate-900 h-full shadow-2xl flex flex-col transform transition-transform animate-in slide-in-from-right duration-300 border-l border-slate-800">
              <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
                 <h2 className="text-lg font-bold text-slate-100 line-clamp-1">{selectedPRD.name}</h2>
                 <button onClick={() => setSelectedPRD(null)} className="p-2 hover:bg-slate-800 rounded-full"><LayoutList className="h-5 w-5 text-slate-500" /></button>
              </div>

              <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
                 <div className="flex items-center space-x-4">
                    <Badge variant={statusVariantMap[selectedPRD.status]} className="text-sm px-3 py-1">{statusMap[selectedPRD.status]}</Badge>
                 </div>

                 {selectedPRD.content && (
                   <div className="prose prose-sm prose-invert max-w-none">
                      <h3 className="uppercase text-xs font-bold text-slate-500 tracking-wider mb-2">Description</h3>
                      <div className="whitespace-pre-wrap text-slate-300 bg-slate-950/50 p-4 rounded-lg border border-slate-800 font-mono text-sm">
                         {selectedPRD.content}
                      </div>
                   </div>
                 )}

                 <div className="space-y-2">
                   <h3 className="uppercase text-xs font-bold text-slate-500 tracking-wider">Dependencies</h3>
                   {selectedPRD.dependencies.length ? (
                     <div className="flex flex-wrap gap-2">
                       {selectedPRD.dependencies.map(d => (
                         <span key={d} className="px-2 py-1 bg-slate-800 text-slate-300 text-xs rounded border border-slate-700">{d}</span>
                       ))}
                     </div>
                   ) : (
                     <p className="text-sm text-slate-500 italic">No dependencies.</p>
                   )}
                   {selectedPRD.unmetDependencies.length > 0 && (
                     <div className="mt-2">
                       <p className="text-sm text-amber-400">Unmet dependencies: {selectedPRD.unmetDependencies.join(', ')}</p>
                     </div>
                   )}
                 </div>
              </div>

              <div className="p-4 border-t border-slate-800 bg-slate-900 flex space-x-3">
                 {selectedPRD.status === 'done' ? (
                   <Button className="flex-1" onClick={handleRetry} disabled={isRetrying}>
                     <RotateCcw className="h-4 w-4 mr-2" />
                     {isRetrying ? 'Moving...' : 'Retry'}
                   </Button>
                 ) : (
                   <Button className="flex-1" onClick={handleExecuteNow} disabled={isExecuting || selectedPRD.status === 'in-progress'}>
                     <Play className="h-4 w-4 mr-2" />
                     {isExecuting ? 'Executing...' : 'Execute Now'}
                   </Button>
                 )}
              </div>
           </div>
        </div>
      )}
    </div>
  );
};

export default PRDs;
