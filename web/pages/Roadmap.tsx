import React, { useEffect, useState } from 'react';
import { Map, Play, AlertCircle, CheckCircle, Clock, FileText, Minus } from 'lucide-react';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import Badge from '../components/ui/Badge';
import Switch from '../components/ui/Switch';
import { useStore } from '../store/useStore';
import {
  fetchRoadmap,
  toggleRoadmapScanner,
  triggerRoadmapScan,
  useApi,
  RoadmapStatus,
  RoadmapItem,
} from '../api';

const Roadmap: React.FC = () => {
  const { addToast, selectedProjectId, globalModeLoading } = useStore();
  const [scanning, setScanning] = useState(false);
  const [toggling, setToggling] = useState(false);

  const {
    data: roadmapStatus,
    loading,
    error,
    refetch,
  } = useApi(fetchRoadmap, [selectedProjectId], { enabled: !globalModeLoading });

  // Auto-refresh every 10 seconds when enabled
  useEffect(() => {
    if (!roadmapStatus?.enabled) return;
    const interval = setInterval(() => {
      refetch();
    }, 10000);
    return () => clearInterval(interval);
  }, [roadmapStatus?.enabled, refetch]);

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
          <h1 className="text-3xl font-bold text-slate-100">Roadmap Scanner</h1>
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
  const groupedItems = groupBySection(roadmapStatus.items);

  const lastScanText = roadmapStatus.lastScan
    ? formatTimeAgo(roadmapStatus.lastScan)
    : 'Never';

  const autoScanMinutes = roadmapStatus.autoScanInterval
    ? Math.round(roadmapStatus.autoScanInterval / 60)
    : 5;

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-slate-100">Roadmap Scanner</h1>
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

      {/* Progress Bar */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-slate-300">Progress</h3>
          <span className="text-sm text-slate-400">
            {roadmapStatus.processedItems} / {roadmapStatus.totalItems} items ({progressPercent}%)
          </span>
        </div>
        <div className="w-full h-3 bg-slate-800 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              progressPercent === 100
                ? 'bg-gradient-to-r from-emerald-500 to-emerald-400'
                : 'bg-gradient-to-r from-indigo-600 to-indigo-400'
            }`}
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </Card>

      {/* Items by Section */}
      {Object.entries(groupedItems).map(([section, items]) => (
        <Card key={section} className="p-6">
          <h3 className="text-lg font-semibold text-slate-200 mb-4">{section}</h3>
          <div className="space-y-2">
            {items.map((item) => (
              <RoadmapItemRow key={item.hash} item={item} />
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
};

function RoadmapItemRow({ item }: { item: RoadmapItem }) {
  const isChecked = item.checked;
  const isProcessed = item.processed;

  return (
    <div className={`flex items-center justify-between p-3 rounded-lg border ${
      isChecked
        ? 'bg-slate-950/30 border-slate-800/50'
        : isProcessed
          ? 'bg-emerald-500/5 border-emerald-500/10'
          : 'bg-slate-950/50 border-slate-800'
    }`}>
      <div className="flex items-center space-x-3 min-w-0 flex-1">
        {isChecked ? (
          <Minus className="h-4 w-4 text-slate-600 flex-shrink-0" />
        ) : isProcessed ? (
          <CheckCircle className="h-4 w-4 text-emerald-400 flex-shrink-0" />
        ) : (
          <FileText className="h-4 w-4 text-slate-500 flex-shrink-0" />
        )}
        <div className="min-w-0">
          <div className={`text-sm font-medium truncate ${isChecked ? 'line-through text-slate-600' : 'text-slate-200'}`}>
            {item.title}
          </div>
          {item.description && (
            <div className="text-xs text-slate-500 truncate mt-0.5">{item.description}</div>
          )}
        </div>
      </div>
      <div className="flex-shrink-0 ml-3">
        {isChecked ? (
          <Badge variant="neutral">Skipped</Badge>
        ) : isProcessed ? (
          <Badge variant="success">{item.prdFile || 'Processed'}</Badge>
        ) : (
          <Badge variant="warning">Pending</Badge>
        )}
      </div>
    </div>
  );
}

function getStatusConfig(status: RoadmapStatus['status']) {
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

function groupBySection(items: RoadmapItem[]): Record<string, RoadmapItem[]> {
  const groups: Record<string, RoadmapItem[]> = {};
  for (const item of items) {
    const section = item.section || 'General';
    if (!groups[section]) groups[section] = [];
    groups[section].push(item);
  }
  return groups;
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
