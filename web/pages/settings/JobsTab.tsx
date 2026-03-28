import React from 'react';
import {
  IAnalyticsConfig,
  IQaConfig,
  IAuditConfig,
  IMergerConfig,
  IPrResolverConfig,
  IRoadmapScannerConfig,
  MergeMethod,
  QaArtifacts,
} from '../../api';
import TagInput from '../../components/settings/TagInput.js';
import Card from '../../components/ui/Card';
import Input from '../../components/ui/Input';
import Select from '../../components/ui/Select';
import Switch from '../../components/ui/Switch';
import { cronToHuman } from '../../utils/cron.js';

interface IConfigFormJobs {
  qa: IQaConfig;
  audit: IAuditConfig;
  analytics: IAnalyticsConfig;
  prResolver: IPrResolverConfig;
  merger: IMergerConfig;
  roadmapScanner: IRoadmapScannerConfig;
  providerEnv: Record<string, string>;
}

interface IJobsTabProps {
  form: IConfigFormJobs;
  updateField: <K extends keyof IConfigFormJobs>(key: K, value: IConfigFormJobs[K]) => void;
  handleRoadmapToggle: (enabled: boolean) => Promise<void>;
  onManageSchedule: (jobType: 'qa' | 'audit' | 'analytics' | 'slicer' | 'pr-resolver' | 'merger') => void;
}

const ScheduleOwnerNotice: React.FC<{
  schedule: string;
  onManage: () => void;
}> = ({ schedule, onManage }) => (
  <div className="flex items-start justify-between gap-4 p-4 rounded-xl border border-slate-800 bg-slate-950/50">
    <div>
      <div className="text-xs uppercase tracking-wide text-slate-500">Managed in Schedules</div>
      <div className="text-sm font-medium text-slate-200 mt-1">{cronToHuman(schedule)}</div>
      <div className="text-xs font-mono text-slate-500 mt-1">{schedule}</div>
    </div>
    <button
      type="button"
      onClick={onManage}
      className="shrink-0 rounded-md border border-indigo-500/30 bg-indigo-500/10 px-3 py-1.5 text-xs font-medium text-indigo-300 transition-colors hover:border-indigo-400/50 hover:bg-indigo-500/15"
    >
      Manage schedule
    </button>
  </div>
);

const JobsTab: React.FC<IJobsTabProps> = ({
  form,
  updateField,
  handleRoadmapToggle,
  onManageSchedule,
}) => {
  return (
    <div className="space-y-6">
      {/* QA */}
      <div id="job-section-qa">
        <Card className="p-6 space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-medium text-slate-200">Quality Assurance</h3>
              <p className="text-sm text-slate-400">Automated UI testing using Playwright</p>
            </div>
            <Switch
              checked={form.qa.enabled}
              onChange={(checked) => updateField('qa', { ...form.qa, enabled: checked })}
            />
          </div>
          {form.qa.enabled && (
            <div className="space-y-6 pt-4 border-t border-slate-800">
              <ScheduleOwnerNotice
                schedule={form.qa.schedule}
                onManage={() => onManageSchedule('qa')}
              />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Input
                  label="Max Runtime"
                  type="number"
                  value={String(form.qa.maxRuntime)}
                  onChange={(e) => updateField('qa', { ...form.qa, maxRuntime: Number(e.target.value || 0) })}
                  rightIcon={<span className="text-xs">sec</span>}
                  helperText="Maximum runtime for QA tasks (default: 3600 seconds)"
                />
                <Select
                  label="Artifacts"
                  value={form.qa.artifacts}
                  onChange={(val) => updateField('qa', { ...form.qa, artifacts: val as QaArtifacts })}
                  options={[
                    { label: 'Screenshots', value: 'screenshot' },
                    { label: 'Videos', value: 'video' },
                    { label: 'Both', value: 'both' },
                  ]}
                  helperText="What artifacts to capture for UI tests"
                />
                <Input
                  label="Skip Label"
                  value={form.qa.skipLabel}
                  onChange={(e) => updateField('qa', { ...form.qa, skipLabel: e.target.value })}
                  helperText="GitHub label to skip QA (PRs with this label are excluded)"
                />
              </div>
              <TagInput
                label="QA Branch Patterns"
                value={form.qa.branchPatterns}
                onChange={(patterns) => updateField('qa', { ...form.qa, branchPatterns: patterns })}
                placeholder="e.g., qa/, test/"
                helpText="Branch patterns to match for QA (defaults to top-level branchPatterns if empty)"
              />
              <div className="flex items-center justify-between p-3 rounded-md border border-slate-800 bg-slate-950/40">
                <div>
                  <span className="text-sm font-medium text-slate-200">Auto-install Playwright</span>
                  <p className="text-xs text-slate-500 mt-1">
                    Automatically install Playwright browsers if missing during QA run
                  </p>
                </div>
                <Switch
                  checked={form.qa.autoInstallPlaywright}
                  onChange={(checked) => updateField('qa', { ...form.qa, autoInstallPlaywright: checked })}
                />
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* Audit */}
      <div id="job-section-audit">
        <Card className="p-6 space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-medium text-slate-200">Code Audit</h3>
              <p className="text-sm text-slate-400">Automated code quality and security audits</p>
            </div>
            <Switch
              checked={form.audit.enabled}
              onChange={(checked) => updateField('audit', { ...form.audit, enabled: checked })}
            />
          </div>
          {form.audit.enabled && (
            <div className="space-y-6 pt-4 border-t border-slate-800">
              <ScheduleOwnerNotice
                schedule={form.audit.schedule}
                onManage={() => onManageSchedule('audit')}
              />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Input
                  label="Max Runtime"
                  type="number"
                  value={String(form.audit.maxRuntime)}
                  onChange={(e) =>
                    updateField('audit', { ...form.audit, maxRuntime: Number(e.target.value || 0) })
                  }
                  rightIcon={<span className="text-xs">sec</span>}
                  helperText="Maximum runtime for audit tasks (default: 1800 seconds)"
                />
                <Select
                  label="Target Column"
                  value={form.audit.targetColumn}
                  onChange={(value) =>
                    updateField('audit', {
                      ...form.audit,
                      targetColumn: value as IAuditConfig['targetColumn'],
                    })
                  }
                  options={[
                    { value: 'Draft', label: 'Draft' },
                    { value: 'Ready', label: 'Ready' },
                    { value: 'In Progress', label: 'In Progress' },
                    { value: 'Review', label: 'Review' },
                    { value: 'Done', label: 'Done' },
                  ]}
                  helperText="Board column for created audit issues"
                />
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* Analytics */}
      <div id="job-section-analytics">
        <Card className="p-6 space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-medium text-slate-200">Analytics (Amplitude)</h3>
              <p className="text-sm text-slate-400">Fetch Amplitude data, analyze with AI, and create board issues</p>
            </div>
            <Switch
              checked={form.analytics.enabled}
              onChange={(checked) => updateField('analytics', { ...form.analytics, enabled: checked })}
            />
          </div>
          {form.analytics.enabled && (
            <div className="space-y-6 pt-4 border-t border-slate-800">
              <ScheduleOwnerNotice
                schedule={form.analytics.schedule}
                onManage={() => onManageSchedule('analytics')}
              />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Input
                  label="Amplitude API Key"
                  value={form.providerEnv?.AMPLITUDE_API_KEY ?? ''}
                  onChange={(e) =>
                    updateField('providerEnv', {
                      ...form.providerEnv,
                      AMPLITUDE_API_KEY: e.target.value,
                    })
                  }
                  placeholder="Required"
                  helperText="Your Amplitude project API key"
                />
                <Input
                  label="Amplitude Secret Key"
                  type="password"
                  value={form.providerEnv?.AMPLITUDE_SECRET_KEY ?? ''}
                  onChange={(e) =>
                    updateField('providerEnv', {
                      ...form.providerEnv,
                      AMPLITUDE_SECRET_KEY: e.target.value,
                    })
                  }
                  placeholder="Required"
                  helperText="Your Amplitude secret key"
                />
                <Input
                  label="Max Runtime"
                  type="number"
                  value={String(form.analytics.maxRuntime)}
                  onChange={(e) =>
                    updateField('analytics', {
                      ...form.analytics,
                      maxRuntime: Number(e.target.value || 0),
                    })
                  }
                  rightIcon={<span className="text-xs">sec</span>}
                  helperText="Maximum runtime for analytics job (default: 900 seconds)"
                />
                <Input
                  label="Lookback Days"
                  type="number"
                  min="1"
                  max="90"
                  value={String(form.analytics.lookbackDays)}
                  onChange={(e) =>
                    updateField('analytics', {
                      ...form.analytics,
                      lookbackDays: Math.max(1, Math.min(90, Number(e.target.value || 7))),
                    })
                  }
                  helperText="Number of days to look back in Amplitude (1-90)"
                />
                <Select
                  label="Target Column"
                  value={form.analytics.targetColumn}
                  onChange={(value) =>
                    updateField('analytics', {
                      ...form.analytics,
                      targetColumn: value as IAnalyticsConfig['targetColumn'],
                    })
                  }
                  options={[
                    { value: 'Draft', label: 'Draft' },
                    { value: 'Ready', label: 'Ready' },
                    { value: 'In Progress', label: 'In Progress' },
                    { value: 'Review', label: 'Review' },
                    { value: 'Done', label: 'Done' },
                  ]}
                  helperText="Board column for created issues"
                />
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-slate-400 mb-1.5">
                    Analysis Prompt (optional)
                  </label>
                  <textarea
                    rows={4}
                    value={form.analytics.analysisPrompt ?? ''}
                    onChange={(e) =>
                      updateField('analytics', {
                        ...form.analytics,
                        analysisPrompt: e.target.value,
                      })
                    }
                    placeholder="Custom prompt for AI analysis. Leave empty to use default."
                    className="w-full bg-slate-950/50 border border-white/10 text-slate-200 rounded-lg px-3 py-2.5 text-sm placeholder-slate-600 focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/20 resize-y"
                  />
                  <p className="mt-1.5 text-xs text-slate-500">
                    Custom prompt for AI analysis. Leave empty to use default.
                  </p>
                </div>
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* Planner */}
      <div id="job-section-slicer">
        <Card className="p-6 space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-medium text-slate-200">Planner</h3>
              <p className="text-sm text-slate-400">
                Generate one PRD per run using ROADMAP.md first, then audit findings when roadmap work is exhausted
              </p>
            </div>
            <Switch
              checked={form.roadmapScanner.enabled}
              aria-label="Enable planner"
              onChange={handleRoadmapToggle}
            />
          </div>
          {form.roadmapScanner.enabled && (
            <div className="space-y-6 pt-4 border-t border-slate-800">
              <ScheduleOwnerNotice
                schedule={form.roadmapScanner.slicerSchedule}
                onManage={() => onManageSchedule('slicer')}
              />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Input
                  label="Roadmap File Path"
                  value={form.roadmapScanner.roadmapPath}
                  onChange={(e) =>
                    updateField('roadmapScanner', {
                      ...form.roadmapScanner,
                      roadmapPath: e.target.value,
                    })
                  }
                  helperText="Primary planning source (relative to project root)."
                />
                <Input
                  label="Planner Max Runtime"
                  type="number"
                  value={String(form.roadmapScanner.slicerMaxRuntime || '')}
                  onChange={(e) =>
                    updateField('roadmapScanner', {
                      ...form.roadmapScanner,
                      slicerMaxRuntime: Number(e.target.value || 0),
                    })
                  }
                  rightIcon={<span className="text-xs">sec</span>}
                  helperText="Maximum runtime for planner tasks"
                />
                <Select
                  label="Planner Priority Mode"
                  value={form.roadmapScanner.priorityMode || 'roadmap-first'}
                  onChange={(val) =>
                    updateField('roadmapScanner', {
                      ...form.roadmapScanner,
                      priorityMode: val === 'audit-first' ? 'audit-first' : 'roadmap-first',
                    })
                  }
                  options={[
                    { label: 'Roadmap first (recommended)', value: 'roadmap-first' },
                    { label: 'Audit first', value: 'audit-first' },
                  ]}
                  helperText="Choose whether planner consumes roadmap items or audit findings first."
                />
                <Select
                  label="Planner Issue Column"
                  value={form.roadmapScanner.issueColumn || 'Ready'}
                  onChange={(val) =>
                    updateField('roadmapScanner', {
                      ...form.roadmapScanner,
                      issueColumn: val === 'Draft' ? 'Draft' : 'Ready',
                    })
                  }
                  options={[
                    { label: 'Ready (default)', value: 'Ready' },
                    { label: 'Draft', value: 'Draft' },
                  ]}
                  helperText="Column where planner-created issues are added after PRD generation."
                />
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* PR Resolver */}
      <div id="job-section-pr-resolver">
        <Card className="p-6 space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-medium text-slate-200">PR Resolver</h3>
              <p className="text-sm text-slate-400">
                Repo-wide conflict resolver that rebases PRs and can optionally apply review feedback
              </p>
            </div>
            <Switch
              checked={form.prResolver.enabled}
              onChange={(checked) =>
                updateField('prResolver', { ...form.prResolver, enabled: checked })
              }
            />
          </div>
          {form.prResolver.enabled && (
            <div className="space-y-6 pt-4 border-t border-slate-800">
              <ScheduleOwnerNotice
                schedule={form.prResolver.schedule}
                onManage={() => onManageSchedule('pr-resolver')}
              />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Input
                  label="Max Runtime"
                  type="number"
                  value={String(form.prResolver.maxRuntime)}
                  onChange={(e) =>
                    updateField('prResolver', {
                      ...form.prResolver,
                      maxRuntime: Number(e.target.value || 0),
                    })
                  }
                  rightIcon={<span className="text-xs">sec</span>}
                  helperText="Maximum runtime for the resolver (default: 3600 seconds)"
                />
                <Input
                  label="Per-PR Timeout"
                  type="number"
                  value={String(form.prResolver.perPrTimeout)}
                  onChange={(e) =>
                    updateField('prResolver', {
                      ...form.prResolver,
                      perPrTimeout: Math.max(0, Number(e.target.value || 0)),
                    })
                  }
                  rightIcon={<span className="text-xs">sec</span>}
                  helperText="Maximum time spent resolving a single PR"
                />
                <Input
                  label="Max PRs Per Run"
                  type="number"
                  min="0"
                  value={String(form.prResolver.maxPrsPerRun)}
                  onChange={(e) =>
                    updateField('prResolver', {
                      ...form.prResolver,
                      maxPrsPerRun: Math.max(0, Number(e.target.value || 0)),
                    })
                  }
                  helperText="Maximum PRs to process per run (0 = unlimited)"
                />
                <Input
                  label="Ready Label"
                  value={form.prResolver.readyLabel}
                  onChange={(e) =>
                    updateField('prResolver', {
                      ...form.prResolver,
                      readyLabel: e.target.value,
                    })
                  }
                  helperText="GitHub label applied when a PR ends conflict-free"
                />
              </div>
              <TagInput
                label="Branch Patterns"
                value={form.prResolver.branchPatterns}
                onChange={(patterns) =>
                  updateField('prResolver', { ...form.prResolver, branchPatterns: patterns })
                }
                placeholder="e.g., feat/, night-watch/"
                helpText="Branch patterns to filter PRs (empty = all open PRs)"
              />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="flex items-center justify-between p-3 rounded-md border border-slate-800 bg-slate-950/40">
                  <div>
                    <span className="text-sm font-medium text-slate-200">AI conflict resolution</span>
                    <p className="text-xs text-slate-500 mt-1">
                      Use the configured provider when git cannot auto-resolve a rebase
                    </p>
                  </div>
                  <Switch
                    checked={form.prResolver.aiConflictResolution}
                    onChange={(checked) =>
                      updateField('prResolver', {
                        ...form.prResolver,
                        aiConflictResolution: checked,
                      })
                    }
                  />
                </div>
                <div className="flex items-center justify-between p-3 rounded-md border border-slate-800 bg-slate-950/40">
                  <div>
                    <span className="text-sm font-medium text-slate-200">AI review resolution</span>
                    <p className="text-xs text-slate-500 mt-1">
                      Optionally implement open review comments after conflict resolution
                    </p>
                  </div>
                  <Switch
                    checked={form.prResolver.aiReviewResolution}
                    onChange={(checked) =>
                      updateField('prResolver', {
                        ...form.prResolver,
                        aiReviewResolution: checked,
                      })
                    }
                  />
                </div>
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* Merge Orchestrator */}
      <div id="job-section-merger">
        <Card className="p-6 space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-medium text-slate-200">Merge Orchestrator</h3>
              <p className="text-sm text-slate-400">Repo-wide PR merge coordinator — scans, rebases, and merges in FIFO order</p>
            </div>
            <Switch
              checked={form.merger.enabled}
              onChange={(checked) => updateField('merger', { ...form.merger, enabled: checked })}
            />
          </div>
          {form.merger.enabled && (
            <div className="space-y-6 pt-4 border-t border-slate-800">
              <ScheduleOwnerNotice
                schedule={form.merger.schedule}
                onManage={() => onManageSchedule('merger')}
              />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Input
                  label="Max Runtime"
                  type="number"
                  value={String(form.merger.maxRuntime)}
                  onChange={(e) => updateField('merger', { ...form.merger, maxRuntime: Number(e.target.value || 0) })}
                  rightIcon={<span className="text-xs">sec</span>}
                  helperText="Maximum runtime (default: 1800 seconds)"
                />
                <Select
                  label="Merge Method"
                  value={form.merger.mergeMethod}
                  onChange={(val) => updateField('merger', { ...form.merger, mergeMethod: val as MergeMethod })}
                  options={[
                    { label: 'Squash', value: 'squash' },
                    { label: 'Merge', value: 'merge' },
                    { label: 'Rebase', value: 'rebase' },
                  ]}
                  helperText="Git merge method for eligible PRs"
                />
                <Input
                  label="Min Review Score"
                  type="number"
                  min="0"
                  max="100"
                  value={String(form.merger.minReviewScore)}
                  onChange={(e) => updateField('merger', { ...form.merger, minReviewScore: Math.max(0, Math.min(100, Number(e.target.value || 0))) })}
                  helperText="Minimum review score required (0-100)"
                />
                <Input
                  label="Max PRs Per Run"
                  type="number"
                  min="0"
                  value={String(form.merger.maxPrsPerRun)}
                  onChange={(e) => updateField('merger', { ...form.merger, maxPrsPerRun: Math.max(0, Number(e.target.value || 0)) })}
                  helperText="Maximum PRs to merge per run (0 = unlimited)"
                />
              </div>
              <TagInput
                label="Branch Patterns"
                value={form.merger.branchPatterns}
                onChange={(patterns) => updateField('merger', { ...form.merger, branchPatterns: patterns })}
                placeholder="e.g., feat/, night-watch/"
                helpText="Branch patterns to filter eligible PRs (empty = use top-level patterns)"
              />
              <div className="flex items-center justify-between p-3 rounded-md border border-slate-800 bg-slate-950/40">
                <div>
                  <span className="text-sm font-medium text-slate-200">Rebase before merge</span>
                  <p className="text-xs text-slate-500 mt-1">
                    Rebase each PR against its base branch before merging
                  </p>
                </div>
                <Switch
                  checked={form.merger.rebaseBeforeMerge}
                  onChange={(checked) => updateField('merger', { ...form.merger, rebaseBeforeMerge: checked })}
                />
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
};

export default JobsTab;
