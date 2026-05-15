import React from 'react';
import { AlertCircle, ArrowRight, RefreshCw, TrendingDown, TrendingUp } from 'lucide-react';
import {
  fetchFeedbackPatterns,
  fetchFeedbackSummary,
  IAugmentationUpdate,
  IFeedbackPatterns,
  IFeedbackSummary,
  updateFeedbackAugmentation,
  useApi,
} from '../../api.js';
import { useStore } from '../../store/useStore.js';
import Badge from '../ui/Badge.js';
import Button from '../ui/Button.js';
import Card from '../ui/Card.js';
import PatternList from './PatternList.js';

function formatPercent(value: number | null): string {
  return value === null ? '—' : `${Math.round(value * 100)}%`;
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return '—';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

function getSortedEntries(values: Record<string, number>, limit: number): Array<[string, number]> {
  return Object.entries(values)
    .sort(([, a], [, b]) => b - a)
    .slice(0, limit);
}

function getBreakdownEntries(values: IFeedbackSummary['windows']['last30Days']['byJobType']): Array<[string, string]> {
  return Object.entries(values)
    .sort(([, a], [, b]) => b.totalCount - a.totalCount)
    .slice(0, 5)
    .map(([key, summary]) => [key, `${formatPercent(summary.successRate)} · ${summary.totalCount} runs`]);
}

function getTrendLabel(last7Rate: number | null, last30Rate: number | null): string {
  if (last7Rate === null || last30Rate === null) return 'Waiting for comparable data';
  const delta = Math.round((last7Rate - last30Rate) * 100);
  if (delta === 0) return 'Flat vs 30 days';
  return `${delta > 0 ? '+' : ''}${delta} pts vs 30 days`;
}

function getTrendVariant(last7Rate: number | null, last30Rate: number | null): 'success' | 'warning' | 'neutral' {
  if (last7Rate === null || last30Rate === null) return 'neutral';
  if (last7Rate >= last30Rate) return 'success';
  return 'warning';
}

interface IMetricProps {
  label: string;
  value: string;
  detail: string;
}

const Metric: React.FC<IMetricProps> = ({ label, value, detail }) => (
  <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-4">
    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</div>
    <div className="mt-2 text-2xl font-bold text-slate-100">{value}</div>
    <div className="mt-1 text-xs text-slate-500">{detail}</div>
  </div>
);

interface IPerformanceDashboardProps {
  variant?: 'compact' | 'full';
  onViewDetails?: () => void;
}

const PerformanceDashboard: React.FC<IPerformanceDashboardProps> = ({ variant = 'full', onViewDetails }) => {
  const { addToast, selectedProjectId, globalModeLoading } = useStore();
  const [updatingAugmentationId, setUpdatingAugmentationId] = React.useState<number | null>(null);
  const isCompact = variant === 'compact';

  const {
    data: summary,
    loading: summaryLoading,
    error: summaryError,
    refetch: refetchSummary,
  } = useApi<IFeedbackSummary>(fetchFeedbackSummary, [selectedProjectId], { enabled: !globalModeLoading });

  const {
    data: patterns,
    loading: patternsLoading,
    error: patternsError,
    refetch: refetchPatterns,
  } = useApi<IFeedbackPatterns>(fetchFeedbackPatterns, [selectedProjectId], {
    enabled: !globalModeLoading && !isCompact,
  });

  const handleRefresh = () => {
    refetchSummary();
    if (!isCompact) {
      refetchPatterns();
    }
  };

  const handleAugmentationAction = async (id: number, action: NonNullable<IAugmentationUpdate['action']>) => {
    setUpdatingAugmentationId(id);
    try {
      await updateFeedbackAugmentation(id, { action });
      addToast({
        title: action === 'expire' ? 'Augmentation Expired' : 'Augmentation Disabled',
        message: 'Prompt augmentation state was updated.',
        type: 'success',
      });
      handleRefresh();
    } catch (err) {
      addToast({
        title: 'Update Failed',
        message: err instanceof Error ? err.message : 'Failed to update augmentation',
        type: 'error',
      });
    } finally {
      setUpdatingAugmentationId(null);
    }
  };

  const loading = summaryLoading || (!isCompact && patternsLoading);
  const error = summaryError || (!isCompact ? patternsError : null);
  const last7 = summary?.windows.last7Days ?? null;
  const last30 = summary?.windows.last30Days ?? null;
  const activePatterns = (patterns?.patterns ?? [])
    .filter((pattern) => pattern.status === 'active')
    .sort((a, b) => b.confidence - a.confidence || b.sampleCount - a.sampleCount)
    .slice(0, 5);
  const topFailurePatterns = patterns?.topFailurePatterns.slice(0, 5) ?? [];
  const categoryEntries = getSortedEntries(last30?.byFailureCategory ?? {}, 5);
  const maxCategoryCount = Math.max(...categoryEntries.map(([, count]) => count), 1);
  const hasRecordedOutcomes = (last30?.totalCount ?? 0) > 0 || (last7?.totalCount ?? 0) > 0;
  const trendVariant = getTrendVariant(last7?.successRate ?? null, last30?.successRate ?? null);
  const trendIcon =
    trendVariant === 'success' ? (
      <TrendingUp className="h-4 w-4" />
    ) : trendVariant === 'warning' ? (
      <TrendingDown className="h-4 w-4" />
    ) : null;

  return (
    <section className="space-y-4" aria-labelledby="feedback-performance-heading">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 id="feedback-performance-heading" className="text-lg font-semibold text-slate-200">
            {isCompact ? 'Basic Analytics' : 'Analytics'}
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            {isCompact
              ? 'High-level job health. Full breakdowns live in Analytics.'
              : 'Outcome trends, repeated failures, provider breakdowns, and prompt augmentations.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isCompact && onViewDetails ? (
            <Button variant="outline" size="sm" onClick={onViewDetails}>
              View analytics
              <ArrowRight className="ml-1.5 h-4 w-4" />
            </Button>
          ) : null}
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={loading}>
            <RefreshCw className={`mr-1.5 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      <Card className="p-5">
        {loading && !summary ? (
          <div className="py-10 text-center text-sm text-slate-500">Loading analytics...</div>
        ) : error ? (
          <div className="flex items-center gap-3 rounded-lg border border-red-900/50 bg-red-950/20 p-4 text-sm text-red-300">
            <AlertCircle className="h-5 w-5 shrink-0" />
            <span>{error.message}</span>
          </div>
        ) : !summary || !hasRecordedOutcomes ? (
          <div className="py-10 text-center">
            <div className="text-sm font-medium text-slate-300">No feedback outcomes recorded yet.</div>
            <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
              This panel will populate after executor, reviewer, QA, audit, planner, or merge jobs complete.
            </p>
          </div>
        ) : isCompact ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <Metric
              label="7 Day Success"
              value={formatPercent(last7?.successRate ?? null)}
              detail={`${last7?.successCount ?? 0} of ${last7?.totalCount ?? 0} completed`}
            />
            <Metric
              label="30 Day Success"
              value={formatPercent(last30?.successRate ?? null)}
              detail={getTrendLabel(last7?.successRate ?? null, last30?.successRate ?? null)}
            />
            <Metric
              label="Failures"
              value={String((last30?.failureCount ?? 0) + (last30?.timeoutCount ?? 0))}
              detail="Last 30 days"
            />
            <Metric
              label="Avg Duration"
              value={formatDuration(last30?.averageDurationSeconds ?? null)}
              detail="Last 30 days"
            />
          </div>
        ) : (
          <div className="space-y-6">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
              <Metric
                label="7 Day Success"
                value={formatPercent(last7?.successRate ?? null)}
                detail={`${last7?.successCount ?? 0} of ${last7?.totalCount ?? 0} completed`}
              />
              <Metric
                label="30 Day Success"
                value={formatPercent(last30?.successRate ?? null)}
                detail={`${last30?.successCount ?? 0} of ${last30?.totalCount ?? 0} completed`}
              />
              <Metric
                label="Failure Load"
                value={String((last30?.failureCount ?? 0) + (last30?.timeoutCount ?? 0))}
                detail={`${last30?.rateLimitedCount ?? 0} rate limited`}
              />
              <Metric
                label="Avg Duration"
                value={formatDuration(last30?.averageDurationSeconds ?? null)}
                detail="Last 30 days"
              />
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-slate-200">Success-Rate Trend</h3>
                  <Badge variant={trendVariant} className="gap-1">
                    {trendIcon}
                    {getTrendLabel(last7?.successRate ?? null, last30?.successRate ?? null)}
                  </Badge>
                </div>
                <div className="space-y-3">
                  {[
                    { label: 'Last 7 days', value: last7?.successRate ?? 0 },
                    { label: 'Last 30 days', value: last30?.successRate ?? 0 },
                  ].map((row) => (
                    <div key={row.label} className="space-y-1">
                      <div className="flex justify-between text-xs">
                        <span className="text-slate-400">{row.label}</span>
                        <span className="font-mono text-slate-300">{formatPercent(row.value)}</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-slate-900">
                        <div
                          className="h-full rounded-full bg-emerald-500"
                          style={{ width: `${Math.max(4, Math.round(row.value * 100))}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-slate-200">Failure Categories</h3>
                  <Badge variant="neutral">{categoryEntries.length}</Badge>
                </div>
                {categoryEntries.length === 0 ? (
                  <p className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-4 text-sm text-slate-500">
                    No categorized failures in the last 30 days.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {categoryEntries.map(([category, count]) => (
                      <div key={category} className="space-y-1">
                        <div className="flex justify-between gap-3 text-xs">
                          <span className="truncate capitalize text-slate-400">{category.replace(/_/g, ' ')}</span>
                          <span className="font-mono text-slate-300">{count}</span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-slate-900">
                          <div
                            className="h-full rounded-full bg-red-500"
                            style={{ width: `${Math.max(8, Math.round((count / maxCategoryCount) * 100))}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-slate-200">Job Breakdown</h3>
                  <Badge variant="neutral">{Object.keys(last30?.byJobType ?? {}).length}</Badge>
                </div>
                {getBreakdownEntries(last30?.byJobType ?? {}).length === 0 ? (
                  <p className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-4 text-sm text-slate-500">
                    No job-specific outcomes in the last 30 days.
                  </p>
                ) : (
                  <div className="divide-y divide-slate-800/70 rounded-lg border border-slate-800">
                    {getBreakdownEntries(last30?.byJobType ?? {}).map(([jobType, detail]) => (
                      <div key={jobType} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                        <span className="capitalize text-slate-300">{jobType}</span>
                        <span className="text-xs text-slate-500">{detail}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-slate-200">Provider Breakdown</h3>
                  <Badge variant="neutral">{Object.keys(last30?.byProvider ?? {}).length}</Badge>
                </div>
                {getBreakdownEntries(last30?.byProvider ?? {}).length === 0 ? (
                  <p className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-4 text-sm text-slate-500">
                    No provider-specific outcomes in the last 30 days.
                  </p>
                ) : (
                  <div className="divide-y divide-slate-800/70 rounded-lg border border-slate-800">
                    {getBreakdownEntries(last30?.byProvider ?? {}).map(([provider, detail]) => (
                      <div key={provider} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                        <span className="font-mono text-slate-300">{provider}</span>
                        <span className="text-xs text-slate-500">{detail}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </Card>

      {!isCompact ? (
        <Card className="p-5">
          <PatternList
            activePatterns={activePatterns}
            augmentations={summary?.activeAugmentations ?? []}
            topFailurePatterns={topFailurePatterns}
            updatingAugmentationId={updatingAugmentationId}
            onAugmentationAction={handleAugmentationAction}
          />
        </Card>
      ) : null}
    </section>
  );
};

export default PerformanceDashboard;
