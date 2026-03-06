import React, { useEffect, useState, useMemo } from 'react';
import {
  Map,
  Play,
  AlertCircle,
  CheckCircle,
  Clock,
  ExternalLink,
  Filter,
} from 'lucide-react';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import Badge from '../components/ui/Badge';
import Switch from '../components/ui/Switch';
import { useStore } from '../store/useStore';
import {
  fetchRoadmap,
  fetchBoardStatus,
  toggleRoadmapScanner,
  triggerRoadmapScan,
  useApi,
  IRoadmapStatus,
  IRoadmapItem,
} from '../api';
import {
  CATEGORY_COLORS,
  HORIZON_LABELS,
  PIPELINE_STAGE_CONFIG,
  type CategoryLabel,
  type HorizonLabel,
  type PipelineStage,
  type IEnrichedRoadmapItem,
  type IRoadmapFilters,
  DEFAULT_FILTERS,
  enrichRoadmapItems,
  groupItemsByHorizon,
  getPipelineSummary,
  filterItems,
  isAuditFinding,
} from '../utils/roadmap-helpers';

const Roadmap: React.FC = () => {
  const { addToast, selectedProjectId, globalModeLoading } = useStore();
  const [scanning, setScanning] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<IRoadmapFilters>(DEFAULT_FILTERS);

  const {
    data: roadmapStatus,
    loading,
    error,
    refetch,
  } = useApi(fetchRoadmap, [selectedProjectId], { enabled: !globalModeLoading });

  const {
    data: boardStatus,
  } = useApi(fetchBoardStatus, [selectedProjectId], { enabled: !globalModeLoading });

  // Auto-refresh every 10 seconds when enabled
  useEffect(() => {
    if (!roadmapStatus?.enabled) return;
    const interval = setInterval(() => {
      refetch();
    }, 10000);
    return () => clearInterval(interval);
  }, [roadmapStatus?.enabled, refetch]);

  // Enrich items with mapping and board data
  const enrichedItems = useMemo(() => {
    if (!roadmapStatus?.items) return [];
    const boardIssues = boardStatus
      ? Object.values(boardStatus.columns).flat()
      : [];
    return enrichRoadmapItems(roadmapStatus.items, boardIssues);
  }, [roadmapStatus?.items, boardStatus]);

  // Separate audit findings
  const { auditItems, roadmapItems } = useMemo(() => {
    const audit: IEnrichedRoadmapItem[] = [];
    const roadmap: IEnrichedRoadmapItem[] = [];
    for (const item of enrichedItems) {
      if (isAuditFinding(item)) {
        audit.push(item);
      } else {
        roadmap.push(item);
      }
    }
    return { auditItems: audit, roadmapItems: roadmap };
  }, [enrichedItems]);

  // Apply filters
  const filteredItems = useMemo(() => {
    return filterItems(roadmapItems, filters);
  }, [roadmapItems, filters]);

  const filteredAuditItems = useMemo(() => {
    return filterItems(auditItems, filters);
  }, [auditItems, filters]);

  // Group items by horizon
  const groupedItems = useMemo(() => {
    return groupItemsByHorizon(filteredItems);
  }, [filteredItems]);

  // Pipeline summary
  const pipelineSummary = useMemo(() => {
    return getPipelineSummary(enrichedItems);
  }, [enrichedItems]);

  const handleToggle = async (enabled: boolean) => {
    setToggling(true);
    try {
      await toggleRoadmapScanner(enabled);
      addToast({
        title: enabled ? 'Scanner Enabled' : 'Scanner Disabled',
        message: enabled ? 'Roadmap scanner is now active.' : 'Roadmap scanner has been paused.',
        type: enabled ? 'success' : 'info',
      });
      refetch();
    } catch (err) {
      addToast({
        title: 'Toggle Failed',
        message: err instanceof Error ? err.message : 'Failed to toggle scanner',
        type: 'error',
      });
    } finally {
      setToggling(false);
    }
  };

  const handleScan = async () => {
    setScanning(true);
    try {
      const result = await triggerRoadmapScan();
      if (result.created.length > 0) {
        addToast({
          title: 'Scan Complete',
          message: `Created ${result.created.length} PRD(s): ${result.created.join(', ')}`,
          type: 'success',
        });
      } else {
        addToast({
          title: 'Scan Complete',
          message: 'No new PRDs to create.',
          type: 'info',
        });
      }
      if (result.errors.length > 0) {
        addToast({
          title: 'Scan Errors',
          message: result.errors.join('; '),
          type: 'warning',
        });
      }
      refetch();
    } catch (err) {
      addToast({
        title: 'Scan Failed',
        message: err instanceof Error ? err.message : 'Failed to scan roadmap',
        type: 'error',
      });
    } finally {
      setScanning(false);
    }
  };

  const toggleFilter = (
    type: 'categories' | 'horizons' | 'stages',
    value: CategoryLabel | HorizonLabel | PipelineStage,
  ) => {
    setFilters(prev => {
      const newSet = new Set(prev[type]);
      if (newSet.has(value as never)) {
        newSet.delete(value as never);
      } else {
        newSet.add(value as never);
      }
      return { ...prev, [type]: newSet };
    });
  };

  const clearFilters = () => {
    setFilters(DEFAULT_FILTERS);
  };

  const hasActiveFilters =
    filters.categories.size > 0 ||
    filters.horizons.size > 0 ||
    filters.stages.size > 0 ||
    filters.search.length > 0;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-slate-400">Loading roadmap scanner...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full space-y-4">
        <AlertCircle className="h-12 w-12 text-red-400" />
        <div className="text-slate-300">Failed to load roadmap data</div>
        <div className="text-sm text-slate-500">{error.message}</div>
        <Button onClick={() => refetch()}>Retry</Button>
      </div>
    );
  }

  if (!roadmapStatus) return null;

  // Empty state: no ROADMAP.md
  if (roadmapStatus.status === 'no-roadmap') {
    return (
      <div className="space-y-6 max-w-6xl mx-auto">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold text-slate-100">Roadmap</h1>
        </div>
        <Card className="p-12">
          <div className="flex flex-col items-center text-center space-y-4">
            <div className="p-4 bg-slate-800 rounded-full">
              <Map className="h-10 w-10 text-slate-500" />
            </div>
            <h2 className="text-xl font-semibold text-slate-200">No ROADMAP.md Found</h2>
            <p className="text-slate-400 max-w-md">
              Create a <code className="text-indigo-400 bg-indigo-500/10 px-1.5 py-0.5 rounded text-sm">ROADMAP.md</code> in
              your project root with checklist items (<code className="text-slate-300 text-sm">- [ ] Feature</code>) or
              heading-based items (<code className="text-slate-300 text-sm">### Feature</code>) to get started.
            </p>
          </div>
        </Card>
      </div>
    );
  }

  const progressPercent = roadmapStatus.totalItems > 0
    ? Math.round((roadmapStatus.processedItems / roadmapStatus.totalItems) * 100)
    : 0;

  const statusConfig = getStatusConfig(roadmapStatus.status);

  const lastScanText = roadmapStatus.lastScan
    ? formatTimeAgo(roadmapStatus.lastScan)
    : 'Never';

  const autoScanMinutes = roadmapStatus.autoScanInterval
    ? Math.round(roadmapStatus.autoScanInterval / 60)
    : 5;

  const horizonOrder: HorizonLabel[] = ['short-term', 'medium-term', 'long-term'];

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-slate-100">Roadmap</h1>
        <div className="flex items-center space-x-4">
          <Switch
            label={roadmapStatus.enabled ? 'Enabled' : 'Disabled'}
            checked={roadmapStatus.enabled}
            onChange={handleToggle}
            disabled={toggling}
          />
          <Button
            onClick={handleScan}
            loading={scanning}
            disabled={!roadmapStatus.enabled || roadmapStatus.status === 'complete'}
          >
            <Play className="h-4 w-4 mr-2" />
            Scan Now
          </Button>
        </div>
      </div>

      {/* Status Banner */}
      <Card className={`p-6 border-2 ${statusConfig.borderColor}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <statusConfig.icon className={`h-8 w-8 ${statusConfig.textColor}`} />
            <div>
              <div className="text-sm text-slate-400">Scanner Status</div>
              <div className={`text-2xl font-bold ${statusConfig.textColor}`}>{statusConfig.label}</div>
            </div>
          </div>
          <div className="text-right text-sm text-slate-400 space-y-1">
            <div>Last scan: <span className="text-slate-300">{lastScanText}</span></div>
            {roadmapStatus.enabled && roadmapStatus.status !== 'complete' && (
              <div>Auto-scan: <span className="text-slate-300">every {autoScanMinutes} min</span></div>
            )}
            {roadmapStatus.enabled && roadmapStatus.status === 'complete' && (
              <div className="text-emerald-400">Auto-scan paused - all items sliced</div>
            )}
          </div>
        </div>
      </Card>

      {/* Progress Bar + Pipeline Summary */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-slate-300">Progress</h3>
          <span className="text-sm text-slate-400">
            {roadmapStatus.processedItems} / {roadmapStatus.totalItems} items ({progressPercent}%)
          </span>
        </div>
        <div className="w-full h-3 bg-slate-800 rounded-full overflow-hidden mb-4">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              progressPercent === 100
                ? 'bg-gradient-to-r from-emerald-500 to-emerald-400'
                : 'bg-gradient-to-r from-indigo-600 to-indigo-400'
            }`}
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        {/* Pipeline Summary Bar */}
        <div className="flex items-center justify-between pt-2 border-t border-slate-800">
          <span className="text-xs text-slate-500">Pipeline:</span>
          <div className="flex items-center space-x-4">
            {(Object.keys(PIPELINE_STAGE_CONFIG) as PipelineStage[]).map(stage => {
              const config = PIPELINE_STAGE_CONFIG[stage];
              const count = pipelineSummary[stage];
              if (count === 0) return null;
              const Icon = config.icon;
              return (
                <div key={stage} className="flex items-center space-x-1.5">
                  <Icon className={`h-3.5 w-3.5 ${config.color}`} />
                  <span className="text-xs text-slate-400">{count}</span>
                </div>
              );
            })}
          </div>
        </div>
      </Card>

      {/* Filter Bar */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="flex items-center space-x-2 text-sm text-slate-400 hover:text-slate-300 transition-colors"
          >
            <Filter className="h-4 w-4" />
            <span>Filters</span>
            {hasActiveFilters && (
              <span className="bg-indigo-500/20 text-indigo-400 text-xs px-1.5 py-0.5 rounded-full">
                Active
              </span>
            )}
          </button>
          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
            >
              Clear all
            </button>
          )}
        </div>

        {showFilters && (
          <div className="space-y-3 pt-3 border-t border-slate-800">
            {/* Search */}
            <div>
              <input
                type="text"
                placeholder="Search items..."
                value={filters.search}
                onChange={e => setFilters(prev => ({ ...prev, search: e.target.value }))}
                className="w-full bg-slate-950/50 border border-white/10 text-slate-200 rounded-lg px-3 py-2 text-sm placeholder-slate-600 focus:outline-none focus:border-indigo-500/50"
              />
            </div>

            {/* Horizon Pills */}
            <div>
              <span className="text-xs text-slate-500 block mb-1.5">Horizon</span>
              <div className="flex flex-wrap gap-1.5">
                {horizonOrder.map(h => (
                  <button
                    key={h}
                    onClick={() => toggleFilter('horizons', h)}
                    className={`text-xs px-2.5 py-1 rounded-md border transition-colors ${
                      filters.horizons.has(h)
                        ? 'bg-indigo-500/20 border-indigo-500/30 text-indigo-300'
                        : 'bg-slate-800/50 border-slate-700 text-slate-400 hover:border-slate-600'
                    }`}
                  >
                    {HORIZON_LABELS[h]}
                  </button>
                ))}
              </div>
            </div>

            {/* Stage Pills */}
            <div>
              <span className="text-xs text-slate-500 block mb-1.5">Stage</span>
              <div className="flex flex-wrap gap-1.5">
                {(Object.keys(PIPELINE_STAGE_CONFIG) as PipelineStage[]).map(s => {
                  const config = PIPELINE_STAGE_CONFIG[s];
                  return (
                    <button
                      key={s}
                      onClick={() => toggleFilter('stages', s)}
                      className={`text-xs px-2.5 py-1 rounded-md border transition-colors flex items-center space-x-1 ${
                        filters.stages.has(s)
                          ? 'bg-indigo-500/20 border-indigo-500/30 text-indigo-300'
                          : 'bg-slate-800/50 border-slate-700 text-slate-400 hover:border-slate-600'
                      }`}
                    >
                      <config.icon className={`h-3 w-3 ${config.color}`} />
                      <span>{config.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Category Pills */}
            <div>
              <span className="text-xs text-slate-500 block mb-1.5">Category</span>
              <div className="flex flex-wrap gap-1.5">
                {(Object.keys(CATEGORY_COLORS) as CategoryLabel[]).map(c => {
                  const colors = CATEGORY_COLORS[c];
                  return (
                    <button
                      key={c}
                      onClick={() => toggleFilter('categories', c)}
                      className={`text-xs px-2.5 py-1 rounded-md border transition-colors ${
                        filters.categories.has(c)
                          ? `${colors.bg} ${colors.text} border-current/30`
                          : 'bg-slate-800/50 border-slate-700 text-slate-400 hover:border-slate-600'
                      }`}
                    >
                      {c}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </Card>

      {/* Horizon Lanes */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {horizonOrder.map(horizon => {
          const horizonGroups = groupedItems[horizon];
          const categories = Object.keys(horizonGroups) as (CategoryLabel | 'other')[];
          const itemCount = categories.reduce(
            (sum, cat) => sum + horizonGroups[cat].length,
            0,
          );
          const processedCount = categories.reduce(
            (sum, cat) =>
              sum +
              horizonGroups[cat].filter(
                i => i.pipelineStage === 'done' || i.pipelineStage === 'active',
              ).length,
            0,
          );
          const horizonProgress = itemCount > 0 ? Math.round((processedCount / itemCount) * 100) : 0;

          return (
            <Card key={horizon} className="p-4">
              {/* Horizon Header */}
              <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-800">
                <div>
                  <h2 className="text-sm font-semibold text-slate-200">{HORIZON_LABELS[horizon]}</h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {itemCount} item{itemCount !== 1 ? 's' : ''} • {horizonProgress}% progress
                  </p>
                </div>
                <div className="w-16 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-indigo-500 rounded-full transition-all"
                    style={{ width: `${horizonProgress}%` }}
                  />
                </div>
              </div>

              {/* Category Groups */}
              <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
                {categories.length === 0 ? (
                  <div className="text-sm text-slate-600 text-center py-8">
                    No items
                  </div>
                ) : (
                  categories.map(category => {
                    const items = horizonGroups[category];
                    if (items.length === 0) return null;

                    const categoryColors = category !== 'other' ? CATEGORY_COLORS[category] : null;

                    return (
                      <div key={category}>
                        {/* Category Header */}
                        <div className="flex items-center space-x-2 mb-2">
                          {categoryColors ? (
                            <span className={`text-xs font-medium px-2 py-0.5 rounded ${categoryColors.bg} ${categoryColors.text}`}>
                              {category}
                            </span>
                          ) : (
                            <span className="text-xs font-medium px-2 py-0.5 rounded bg-slate-700/50 text-slate-400">
                              Other
                            </span>
                          )}
                          <span className="text-xs text-slate-600">{items.length}</span>
                        </div>

                        {/* Items */}
                        <div className="space-y-1.5">
                          {items.map(item => (
                            <RoadmapItemRow key={item.hash} item={item} />
                          ))}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </Card>
          );
        })}
      </div>

      {/* Unmapped Items */}
      {groupedItems.unmapped && Object.keys(groupedItems.unmapped).length > 0 && (
        <Card className="p-4">
          <div className="flex items-center space-x-2 mb-4">
            <AlertCircle className="h-4 w-4 text-slate-500" />
            <h3 className="text-sm font-semibold text-slate-300">Unmapped Items</h3>
            <span className="text-xs text-slate-600">
              {Object.values(groupedItems.unmapped).flat().length}
            </span>
          </div>
          <div className="space-y-1.5">
            {Object.values(groupedItems.unmapped)
              .flat()
              .map(item => (
                <RoadmapItemRow key={item.hash} item={item} />
              ))}
          </div>
        </Card>
      )}

      {/* Audit Findings Section */}
      {filteredAuditItems.length > 0 && (
        <Card className="p-4">
          <div className="flex items-center space-x-2 mb-4">
            <AlertCircle className="h-4 w-4 text-amber-500" />
            <h3 className="text-sm font-semibold text-slate-300">Audit Findings</h3>
            <span className="text-xs text-slate-600">{filteredAuditItems.length}</span>
          </div>
          <div className="space-y-1.5">
            {filteredAuditItems.map(item => (
              <RoadmapItemRow key={item.hash} item={item} />
            ))}
          </div>
        </Card>
      )}
    </div>
  );
};

// ==================== Roadmap Item Row ====================

interface RoadmapItemRowProps {
  item: IEnrichedRoadmapItem;
}

function RoadmapItemRow({ item }: RoadmapItemRowProps) {
  const stageConfig = PIPELINE_STAGE_CONFIG[item.pipelineStage];
  const StageIcon = stageConfig.icon;

  return (
    <div
      className={`flex items-center justify-between p-3 rounded-lg border transition-colors ${
        item.pipelineStage === 'done'
          ? 'bg-slate-950/30 border-slate-800/50'
          : item.pipelineStage === 'active'
            ? 'bg-emerald-500/5 border-emerald-500/10'
            : 'bg-slate-950/50 border-slate-800'
      }`}
    >
      <div className="flex items-center space-x-3 min-w-0 flex-1">
        <StageIcon className={`h-4 w-4 flex-shrink-0 ${stageConfig.color}`} />
        <div className="min-w-0">
          <div
            className={`text-sm font-medium truncate ${
              item.pipelineStage === 'done' ? 'line-through text-slate-600' : 'text-slate-200'
            }`}
          >
            {item.title}
          </div>
          {item.description && (
            <div className="text-xs text-slate-500 truncate mt-0.5">{item.description}</div>
          )}
        </div>
      </div>
      <div className="flex-shrink-0 ml-3 flex items-center space-x-2">
        {/* Board Issue Link */}
        {item.boardIssue && (
          <a
            href={item.boardIssue.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors flex items-center space-x-1"
          >
            <span>#{item.boardIssue.number}</span>
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
        {/* PRD File */}
        {item.prdFile && !item.boardIssue && (
          <span className="text-xs text-slate-500">{item.prdFile}</span>
        )}
        {/* Pipeline Stage Badge */}
        <Badge variant={stageConfig.badge} className="text-[10px]">
          {stageConfig.label}
        </Badge>
      </div>
    </div>
  );
}

// ==================== Helpers ====================

function getStatusConfig(status: IRoadmapStatus['status']) {
  switch (status) {
    case 'complete':
      return {
        label: 'Complete',
        icon: CheckCircle,
        textColor: 'text-emerald-400',
        borderColor: 'border-emerald-500/20 bg-emerald-500/5',
      };
    case 'idle':
      return {
        label: 'Idle',
        icon: Clock,
        textColor: 'text-blue-400',
        borderColor: 'border-blue-500/20 bg-blue-500/5',
      };
    case 'scanning':
      return {
        label: 'Scanning',
        icon: Play,
        textColor: 'text-indigo-400',
        borderColor: 'border-indigo-500/20 bg-indigo-500/5',
      };
    case 'disabled':
      return {
        label: 'Disabled',
        icon: AlertCircle,
        textColor: 'text-slate-400',
        borderColor: 'border-slate-500/20 bg-slate-500/5',
      };
    default:
      return {
        label: 'No Roadmap',
        icon: AlertCircle,
        textColor: 'text-slate-500',
        borderColor: 'border-slate-500/20',
      };
  }
}

function formatTimeAgo(isoString: string): string {
  try {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} min ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours} hr ago`;
    return `${Math.floor(diffHours / 24)} day(s) ago`;
  } catch {
    return 'Unknown';
  }
}

export default Roadmap;
