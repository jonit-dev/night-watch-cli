import React from 'react';
import { Loader2 } from 'lucide-react';
import Card from './Card';

interface ILoadingStateProps {
  message?: string;
  detail?: string;
  variant?: 'page' | 'card' | 'inline';
  rows?: number;
}

const LoadingBars: React.FC<{ rows: number }> = ({ rows }) => (
  <div className="mt-6 w-full max-w-xl space-y-3" aria-hidden="true">
    {Array.from({ length: rows }).map((_, index) => (
      <div key={index} className="h-3 overflow-hidden rounded-full bg-slate-900/80 ring-1 ring-white/5">
        <div
          className="h-full w-1/2 animate-pulse rounded-full bg-gradient-to-r from-slate-800 via-indigo-500/30 to-slate-800"
          style={{ animationDelay: `${index * 120}ms` }}
        />
      </div>
    ))}
  </div>
);

const LoadingContent: React.FC<Required<Pick<ILoadingStateProps, 'message' | 'rows'>> & Pick<ILoadingStateProps, 'detail'>> = ({
  message,
  detail,
  rows,
}) => (
  <div className="flex flex-col items-center justify-center text-center">
    <div className="relative mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-indigo-400/20 bg-indigo-500/10 text-indigo-300 shadow-[0_0_30px_-12px_rgba(99,102,241,0.9)]">
      <Loader2 className="h-5 w-5 animate-spin" />
    </div>
    <div className="text-sm font-medium text-slate-200">{message}</div>
    {detail ? <div className="mt-1 max-w-md text-xs text-slate-500">{detail}</div> : null}
    {rows > 0 ? <LoadingBars rows={rows} /> : null}
  </div>
);

const LoadingState: React.FC<ILoadingStateProps> = ({
  message = 'Loading...',
  detail,
  variant = 'page',
  rows = 3,
}) => {
  const content = <LoadingContent message={message} detail={detail} rows={rows} />;

  if (variant === 'inline') {
    return (
      <div className="flex min-h-24 items-center justify-center py-6">
        <LoadingContent message={message} detail={detail} rows={0} />
      </div>
    );
  }

  if (variant === 'card') {
    return (
      <Card className="p-8">
        {content}
      </Card>
    );
  }

  return (
    <div className="flex min-h-[420px] items-center justify-center">
      <Card className="w-full max-w-2xl p-10">
        {content}
      </Card>
    </div>
  );
};

export default LoadingState;
