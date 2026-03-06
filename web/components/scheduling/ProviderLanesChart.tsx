import React from 'react';
import type { IQueueStatus } from '../../api.js';

interface IProviderLanesChartProps {
  status: IQueueStatus;
}

const JOB_TYPE_COLORS: Record<string, { bg: string; text: string; border: string; lightBg: string }> = {
  executor: { bg: 'bg-blue-500', text: 'text-blue-100', border: 'border-blue-500/60', lightBg: 'bg-blue-500/20' },
  reviewer: { bg: 'bg-green-500', text: 'text-green-100', border: 'border-green-500/60', lightBg: 'bg-green-500/20' },
  qa: { bg: 'bg-purple-500', text: 'text-purple-100', border: 'border-purple-500/60', lightBg: 'bg-purple-500/20' },
  audit: { bg: 'bg-orange-500', text: 'text-orange-100', border: 'border-orange-500/60', lightBg: 'bg-orange-500/20' },
  slicer: { bg: 'bg-yellow-500', text: 'text-yellow-100', border: 'border-yellow-500/60', lightBg: 'bg-yellow-500/20' },
};

const DEFAULT_COLOR = {
  bg: 'bg-slate-500',
  text: 'text-slate-100',
  border: 'border-slate-500/60',
  lightBg: 'bg-slate-500/20',
};

function getJobColor(jobType: string) {
  return JOB_TYPE_COLORS[jobType] ?? DEFAULT_COLOR;
}

interface ILaneJob {
  id: number;
  jobType: string;
  projectName: string;
  isRunning: boolean;
}

const ProviderLanesChart: React.FC<IProviderLanesChartProps> = ({ status }) => {
  // Build per-bucket lanes from items + running entry
  const buckets = new Map<string, ILaneJob[]>();

  const allItems = status.items ?? [];

  // Add running item first
  if (status.running) {
    const key = status.running.providerKey ?? 'default';
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push({
      id: status.running.id,
      jobType: status.running.jobType,
      projectName: status.running.projectName,
      isRunning: true,
    });
  }

  // Add pending items
  for (const item of allItems) {
    if (item.status === 'running') continue; // already handled above
    const key = item.providerKey ?? 'default';
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push({
      id: item.id,
      jobType: item.jobType,
      projectName: item.projectName,
      isRunning: false,
    });
  }

  if (buckets.size === 0) {
    return (
      <div className="text-sm text-slate-500 py-2">No active provider lanes.</div>
    );
  }

  return (
    <div className="space-y-3" data-testid="provider-lanes-chart">
      {Array.from(buckets.entries()).map(([bucketKey, jobs]) => (
        <div key={bucketKey} className="flex items-center gap-3 min-h-[2.5rem]">
          {/* Bucket label */}
          <div className="w-36 shrink-0">
            <span
              className="text-xs font-mono text-slate-400 truncate block"
              title={bucketKey}
              data-testid={`provider-lane-label-${bucketKey}`}
            >
              {bucketKey}
            </span>
          </div>

          {/* Job blocks */}
          <div className="flex flex-wrap gap-1.5 flex-1">
            {jobs.map((job) => {
              const color = getJobColor(job.jobType);
              if (job.isRunning) {
                return (
                  <div
                    key={job.id}
                    className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium ${color.bg} ${color.text} ring-1 ring-white/10`}
                    title={`${job.jobType} — ${job.projectName} (running)`}
                    data-testid="job-block-running"
                  >
                    <span className="relative flex h-1.5 w-1.5">
                      <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${color.bg} opacity-75`} />
                      <span className={`relative inline-flex rounded-full h-1.5 w-1.5 bg-white`} />
                    </span>
                    {job.jobType}
                  </div>
                );
              }
              return (
                <div
                  key={job.id}
                  className={`inline-flex items-center px-2 py-1 rounded text-[11px] font-medium border ${color.lightBg} ${color.border} text-slate-300`}
                  title={`${job.jobType} — ${job.projectName} (pending)`}
                  data-testid="job-block-pending"
                >
                  {job.jobType}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {/* Legend */}
      <div className="flex flex-wrap gap-3 pt-1 border-t border-slate-800/60">
        {Object.entries(JOB_TYPE_COLORS).map(([type, color]) => (
          <div key={type} className="flex items-center gap-1">
            <div className={`h-2 w-2 rounded-sm ${color.bg}`} />
            <span className="text-[11px] text-slate-500">{type}</span>
          </div>
        ))}
        <div className="flex items-center gap-2 ml-auto">
          <div className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] bg-slate-500 text-slate-100 ring-1 ring-white/10">
            <span className="h-1.5 w-1.5 rounded-full bg-white inline-block" />
            running
          </div>
          <div className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] border border-slate-500/60 bg-slate-500/20 text-slate-300">
            pending
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProviderLanesChart;
