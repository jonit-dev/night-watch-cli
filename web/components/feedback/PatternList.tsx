import React from 'react';
import { Clock3, PauseCircle, TimerOff } from 'lucide-react';
import type {
  IAugmentationUpdate,
  IFeedbackPattern,
  IPromptAugmentation,
  ITopFailurePattern,
} from '../../api.js';
import Badge from '../ui/Badge.js';
import Button from '../ui/Button.js';

interface IPatternListProps {
  activePatterns: IFeedbackPattern[];
  augmentations: IPromptAugmentation[];
  topFailurePatterns: ITopFailurePattern[];
  updatingAugmentationId?: number | null;
  onAugmentationAction: (id: number, action: NonNullable<IAugmentationUpdate['action']>) => Promise<void> | void;
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatDate(value: number): string {
  return new Date(value).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function getCategoryLabel(category: string | null): string {
  return category?.replace(/_/g, ' ') || 'uncategorized';
}

const PatternList: React.FC<IPatternListProps> = ({
  activePatterns,
  augmentations,
  topFailurePatterns,
  updatingAugmentationId = null,
  onAugmentationAction,
}) => {
  return (
    <div className="space-y-6" data-testid="feedback-pattern-list">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-slate-200">Active Patterns</h3>
            <Badge variant="neutral">{activePatterns.length}</Badge>
          </div>
          {activePatterns.length === 0 ? (
            <p className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-4 text-sm text-slate-500">
              No active feedback patterns.
            </p>
          ) : (
            <div className="divide-y divide-slate-800/70 rounded-lg border border-slate-800">
              {activePatterns.map((pattern) => (
                <div key={pattern.id} className="p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-slate-200" title={pattern.title}>
                        {pattern.title}
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs text-slate-500">{pattern.description}</p>
                    </div>
                    <Badge variant="info" className="shrink-0 capitalize">
                      {pattern.jobType}
                    </Badge>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                    <span className="capitalize">{getCategoryLabel(pattern.category)}</span>
                    <span>{pattern.sampleCount} samples</span>
                    <span>{formatPercent(pattern.confidence)} confidence</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-slate-200">Top Failure Patterns</h3>
            <Badge variant="neutral">{topFailurePatterns.length}</Badge>
          </div>
          {topFailurePatterns.length === 0 ? (
            <p className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-4 text-sm text-slate-500">
              No repeated failure signatures yet.
            </p>
          ) : (
            <div className="divide-y divide-slate-800/70 rounded-lg border border-slate-800">
              {topFailurePatterns.map((pattern) => (
                <div key={pattern.key} className="p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-slate-200" title={pattern.signature ?? pattern.key}>
                        {pattern.signature || getCategoryLabel(pattern.category)}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                        <span className="capitalize">{pattern.jobType}</span>
                        <span className="font-mono">{pattern.providerKey}</span>
                      </div>
                    </div>
                    <Badge variant="warning" className="shrink-0">
                      {pattern.sampleCount}
                    </Badge>
                  </div>
                  <div className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-500">
                    <Clock3 className="h-3 w-3" />
                    <span>Last seen {formatDate(pattern.lastSeenAt)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-slate-200">Active Augmentations</h3>
          <Badge variant={augmentations.length > 0 ? 'success' : 'neutral'}>{augmentations.length}</Badge>
        </div>
        {augmentations.length === 0 ? (
          <p className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-4 text-sm text-slate-500">
            No active prompt augmentations.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-800">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="border-b border-slate-800 bg-slate-900/30 text-[11px] uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">Prompt Snippet</th>
                  <th className="px-4 py-3 font-semibold">Job</th>
                  <th className="px-4 py-3 text-right font-semibold">Use</th>
                  <th className="px-4 py-3 text-right font-semibold">Expires</th>
                  <th className="px-4 py-3 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {augmentations.map((augmentation) => {
                  const isUpdating = updatingAugmentationId === augmentation.id;
                  const successRate =
                    augmentation.appliedCount > 0
                      ? `${Math.round((augmentation.successCount / augmentation.appliedCount) * 100)}%`
                      : 'new';

                  return (
                    <tr key={augmentation.id} className="hover:bg-slate-800/20">
                      <td className="px-4 py-3">
                        <div className="line-clamp-2 max-w-xl text-sm text-slate-300" title={augmentation.promptText}>
                          {augmentation.promptText}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="info" className="capitalize">
                          {augmentation.jobType}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-right text-xs text-slate-400">
                        {augmentation.appliedCount} applied · {successRate}
                      </td>
                      <td className="px-4 py-3 text-right text-xs text-slate-500">
                        {augmentation.expiresAt ? formatDate(augmentation.expiresAt) : 'No expiry'}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={isUpdating}
                            onClick={() => onAugmentationAction(augmentation.id, 'disable')}
                          >
                            <PauseCircle className="mr-1.5 h-3.5 w-3.5" />
                            Disable
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={isUpdating}
                            onClick={() => onAugmentationAction(augmentation.id, 'expire')}
                            className="text-slate-500 hover:text-amber-300"
                          >
                            <TimerOff className="mr-1.5 h-3.5 w-3.5" />
                            Expire
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};

export default PatternList;
