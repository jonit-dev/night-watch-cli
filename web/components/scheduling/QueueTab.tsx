import React from 'react';
import { AlertCircle } from 'lucide-react';
import Card from '../ui/Card.js';
import type { IQueueAnalytics, IQueueStatus } from '../../api.js';
import ProviderLanesChart from './ProviderLanesChart.js';
import ProviderBucketSummary from './ProviderBucketSummary.js';
import RecentRunsChart from './RecentRunsChart.js';

interface IQueueTabProps {
  queueStatus: IQueueStatus | null;
  queueAnalytics: IQueueAnalytics | null;
  queueStatusError: Error | null;
  queueAnalyticsError: Error | null;
}

const QueueTab: React.FC<IQueueTabProps> = ({
  queueStatus,
  queueAnalytics,
  queueStatusError,
  queueAnalyticsError,
}) => {
  return (
    <div className="space-y-6">
      {/* Queue Overview Card */}
      <Card className="p-6">
        <h3 className="text-lg font-semibold text-slate-200 mb-4">Queue Overview</h3>
        {queueStatusError ? (
          <div className="flex items-center gap-2 text-red-400 py-4">
            <AlertCircle className="h-4 w-4" />
            <span className="text-sm">Failed to load queue status</span>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-slate-950/40 rounded-lg p-4 border border-slate-800">
              <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">Running</div>
              <div className="text-2xl font-bold text-green-400">
                {queueStatus?.running ? 1 : 0}
              </div>
              {queueStatus?.running && (
                <div className="text-xs text-slate-400 mt-1 truncate" title={queueStatus.running.projectName}>
                  {queueStatus.running.jobType} · {queueStatus.running.projectName}
                </div>
              )}
            </div>
            <div className="bg-slate-950/40 rounded-lg p-4 border border-slate-800">
              <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">Pending</div>
              <div className="text-2xl font-bold text-blue-400">
                {queueStatus?.pending.total ?? 0}
              </div>
            </div>
            <div className="bg-slate-950/40 rounded-lg p-4 border border-slate-800">
              <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">Avg Wait</div>
              <div className="text-2xl font-bold text-slate-200">
                {queueStatus?.averageWaitSeconds != null
                  ? `${Math.floor(queueStatus.averageWaitSeconds / 60)}m`
                  : '—'}
              </div>
            </div>
            <div className="bg-slate-950/40 rounded-lg p-4 border border-slate-800">
              <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">Oldest Pending</div>
              <div className="text-2xl font-bold text-slate-200">
                {queueStatus?.oldestPendingAge != null
                  ? `${Math.floor(queueStatus.oldestPendingAge / 60)}m`
                  : '—'}
              </div>
            </div>
          </div>
        )}
      </Card>

      {/* Provider Lanes */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-slate-200">Provider Lanes</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Running and pending jobs grouped by provider bucket
            </p>
          </div>
        </div>
        {queueStatusError ? (
          <div className="flex items-center gap-2 text-red-400 py-2">
            <AlertCircle className="h-4 w-4" />
            <span className="text-sm">Failed to load queue status</span>
          </div>
        ) : queueStatus ? (
          <ProviderLanesChart status={queueStatus} />
        ) : (
          <div className="text-sm text-slate-500 py-2">Loading queue status...</div>
        )}
      </Card>

      {/* Provider Bucket Summary */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-slate-200">Provider Buckets</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Running and pending counts per provider bucket
            </p>
          </div>
        </div>
        {queueAnalyticsError ? (
          <div className="flex items-center gap-2 text-red-400 py-2">
            <AlertCircle className="h-4 w-4" />
            <span className="text-sm">Failed to load analytics</span>
          </div>
        ) : queueAnalytics ? (
          <ProviderBucketSummary analytics={queueAnalytics} />
        ) : (
          <div className="text-sm text-slate-500 py-2">Loading analytics...</div>
        )}
      </Card>

      {/* Recent Runs */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-slate-200">Recent Runs</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Last 24 hours of job executions
            </p>
          </div>
          {queueAnalytics?.averageWaitSeconds != null && (
            <div className="text-xs text-slate-500">
              Avg wait: {Math.floor(queueAnalytics.averageWaitSeconds / 60)}m
            </div>
          )}
        </div>
        {queueAnalyticsError ? (
          <div className="flex items-center gap-2 text-red-400 py-2">
            <AlertCircle className="h-4 w-4" />
            <span className="text-sm">Failed to load analytics</span>
          </div>
        ) : queueAnalytics ? (
          <RecentRunsChart analytics={queueAnalytics} />
        ) : (
          <div className="text-sm text-slate-500 py-2">Loading analytics...</div>
        )}
      </Card>
    </div>
  );
};

export default QueueTab;
