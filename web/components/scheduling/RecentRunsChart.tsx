import React from 'react';
import type { IQueueAnalytics } from '../../api.js';

interface IRecentRunsChartProps {
  analytics: IQueueAnalytics;
}

const STATUS_STYLES: Record<string, string> = {
  success: 'bg-green-500/10 text-green-400 ring-green-500/20',
  running: 'bg-blue-500/10 text-blue-400 ring-blue-500/20',
  queued: 'bg-slate-500/10 text-slate-400 ring-slate-500/20',
  failure: 'bg-red-500/10 text-red-400 ring-red-500/20',
  timeout: 'bg-orange-500/10 text-orange-400 ring-orange-500/20',
  rate_limited: 'bg-yellow-500/10 text-yellow-400 ring-yellow-500/20',
  skipped: 'bg-slate-500/10 text-slate-500 ring-slate-500/20',
};

const JOB_TYPE_DOT: Record<string, string> = {
  executor: 'bg-blue-500',
  reviewer: 'bg-green-500',
  qa: 'bg-purple-500',
  audit: 'bg-orange-500',
  slicer: 'bg-yellow-500',
};

function formatDuration(seconds: number | null): string {
  if (seconds === null) return '—';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

function formatStartTime(ts: number): string {
  const d = new Date(ts * 1000);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function getStatusStyle(status: string): string {
  return STATUS_STYLES[status] ?? 'bg-slate-500/10 text-slate-400 ring-slate-500/20';
}

function isHighlighted(status: string): boolean {
  return status === 'failure' || status === 'timeout' || status === 'rate_limited';
}

const RecentRunsChart: React.FC<IRecentRunsChartProps> = ({ analytics }) => {
  const runs = analytics.recentRuns.slice(0, 20);

  if (runs.length === 0) {
    return (
      <div className="text-sm text-slate-500 py-2">No recent runs in this window.</div>
    );
  }

  return (
    <div className="overflow-x-auto" data-testid="recent-runs-chart">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="border-b border-slate-800">
            <th className="text-left py-2 pr-3 font-medium text-slate-500 whitespace-nowrap">Job</th>
            <th className="text-left py-2 pr-3 font-medium text-slate-500 whitespace-nowrap">Provider</th>
            <th className="text-left py-2 pr-3 font-medium text-slate-500 whitespace-nowrap">Status</th>
            <th className="text-left py-2 pr-3 font-medium text-slate-500 whitespace-nowrap">Start</th>
            <th className="text-right py-2 pr-3 font-medium text-slate-500 whitespace-nowrap">Duration</th>
            <th className="text-right py-2 font-medium text-slate-500 whitespace-nowrap">Wait</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => {
            const highlighted = isHighlighted(run.status);
            const dotColor = JOB_TYPE_DOT[run.jobType] ?? 'bg-slate-500';
            return (
              <tr
                key={run.id}
                className={`border-b border-slate-800/40 hover:bg-slate-800/20 transition-colors ${
                  highlighted ? 'bg-red-900/5' : ''
                }`}
                data-testid={`run-row-${run.id}`}
              >
                <td className="py-1.5 pr-3">
                  <div className="flex items-center gap-1.5">
                    <div className={`h-1.5 w-1.5 rounded-full shrink-0 ${dotColor}`} />
                    <span className={`font-medium ${highlighted ? 'text-red-300' : 'text-slate-300'}`}>
                      {run.jobType}
                    </span>
                  </div>
                </td>
                <td className="py-1.5 pr-3">
                  <span
                    className="text-slate-500 font-mono truncate block max-w-[100px]"
                    title={run.providerKey}
                  >
                    {run.providerKey}
                  </span>
                </td>
                <td className="py-1.5 pr-3">
                  <span
                    className={`inline-flex items-center px-1.5 py-0.5 rounded ring-1 ring-inset text-[11px] font-medium ${getStatusStyle(run.status)}`}
                    data-testid={`run-status-${run.id}`}
                  >
                    {run.status}
                  </span>
                </td>
                <td className="py-1.5 pr-3 text-slate-500 font-mono whitespace-nowrap">
                  {formatStartTime(run.startedAt)}
                </td>
                <td className="py-1.5 pr-3 text-right text-slate-400 font-mono whitespace-nowrap">
                  {formatDuration(run.durationSeconds)}
                </td>
                <td className="py-1.5 text-right font-mono whitespace-nowrap">
                  {run.throttledCount > 0 ? (
                    <span className="text-yellow-400" title={`Throttled ${run.throttledCount}x`}>
                      {formatDuration(run.waitSeconds)}
                      <span className="ml-1 text-[10px]">⚡{run.throttledCount}</span>
                    </span>
                  ) : (
                    <span className="text-slate-500">{formatDuration(run.waitSeconds)}</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export default RecentRunsChart;
