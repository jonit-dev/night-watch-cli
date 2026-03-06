import React from 'react';
import type { IQueueAnalytics } from '../../api.js';

interface IProviderBucketSummaryProps {
  analytics: IQueueAnalytics;
}

const ProviderBucketSummary: React.FC<IProviderBucketSummaryProps> = ({ analytics }) => {
  const buckets = Object.entries(analytics.byProviderBucket).filter(([bucket]) => bucket !== '__unassigned__');

  if (buckets.length === 0) {
    return (
      <div className="text-sm text-slate-500 py-2">No provider bucket data available.</div>
    );
  }

  return (
    <div className="space-y-2" data-testid="provider-bucket-summary">
      {buckets.map(([bucket, data]) => (
        <div
          key={bucket}
          className="flex items-center justify-between py-2 px-3 rounded-md bg-slate-950/40 border border-slate-800"
          data-testid={`provider-bucket-${bucket}`}
        >
          <span
            className="text-xs font-mono text-slate-300 truncate max-w-[60%]"
            title={bucket}
          >
            {bucket}
          </span>
          <div className="flex items-center gap-3 text-xs text-slate-400 shrink-0">
            <span>
              <span className="text-slate-200 font-medium">{data.running}</span>
              {' running'}
            </span>
            <span className="text-slate-700">/</span>
            <span>
              <span className="text-slate-200 font-medium">{data.pending}</span>
              {' pending'}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
};

export default ProviderBucketSummary;
