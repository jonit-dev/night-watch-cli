import React from 'react';
import type { IQueueAnalytics } from '../../api.js';

interface IQueuePressureBarsProps {
  analytics: IQueueAnalytics;
}

function PressureBar({ label, value, max, colorClass }: {
  label: string;
  value: number;
  max: number;
  colorClass: string;
}) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;

  return (
    <div className="space-y-0.5">
      <div className="flex justify-between items-center">
        <span className="text-[11px] text-slate-500">{label}</span>
        <span className="text-[11px] text-slate-400 font-mono">{value.toFixed(1)}</span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-slate-800 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${colorClass}`}
          style={{ width: `${pct}%` }}
          data-testid={`pressure-bar-${label.toLowerCase().replace(/\s+/g, '-')}`}
        />
      </div>
    </div>
  );
}

const QueuePressureBars: React.FC<IQueuePressureBarsProps> = ({ analytics }) => {
  const buckets = Object.entries(analytics.byProviderBucket);

  if (buckets.length === 0) {
    return (
      <div className="text-sm text-slate-500 py-2">No provider bucket data available.</div>
    );
  }

  // Calculate relative max values for bar scaling
  const maxAi = Math.max(...buckets.map(([, b]) => b.totalAiPressure), 1);
  const maxRuntime = Math.max(...buckets.map(([, b]) => b.totalRuntimePressure), 1);

  return (
    <div className="space-y-4" data-testid="queue-pressure-bars">
      {buckets.map(([bucket, data]) => (
        <div key={bucket} className="space-y-2">
          <div className="flex items-center justify-between">
            <span
              className="text-xs font-mono text-slate-300 truncate max-w-[70%]"
              title={bucket}
              data-testid={`pressure-bucket-${bucket}`}
            >
              {bucket}
            </span>
            <div className="flex items-center gap-2 text-[11px] text-slate-500">
              <span>{data.running} running</span>
              <span className="text-slate-700">·</span>
              <span>{data.pending} pending</span>
            </div>
          </div>

          <div className="space-y-1.5 pl-1">
            <PressureBar
              label="AI Pressure"
              value={data.totalAiPressure}
              max={maxAi}
              colorClass="bg-indigo-500"
            />
            <PressureBar
              label="Runtime Pressure"
              value={data.totalRuntimePressure}
              max={maxRuntime}
              colorClass="bg-amber-500"
            />
          </div>
        </div>
      ))}
    </div>
  );
};

export default QueuePressureBars;
