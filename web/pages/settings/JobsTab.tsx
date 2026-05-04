import React from 'react';
import {
  BarChart3,
  CheckCircle2,
  Eye,
  GitMerge,
  GitPullRequest,
  Layout,
  Play,
  Search,
  Sparkles,
} from 'lucide-react';
import {
  IAnalyticsConfig,
  IQaConfig,
  IAuditConfig,
  IMergerConfig,
  IPrResolverConfig,
  IRoadmapScannerConfig,
  IJobProviders,
  MergeMethod,
  QaArtifacts,
  INightWatchConfig,
} from '../../api';
import TagInput from '../../components/settings/TagInput.js';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import Select from '../../components/ui/Select';
import Switch from '../../components/ui/Switch';
import JobAccordion from '../../components/settings/JobAccordion';
import { cronToHuman } from '../../utils/cron.js';

type JobKey =
  | 'executor'
  | 'reviewer'
  | 'qa'
  | 'audit'
  | 'slicer'
  | 'analytics'
  | 'pr-resolver'
  | 'merger';

interface IConfigFormJobs {
  executorEnabled: boolean;
  reviewerEnabled: boolean;
  cronSchedule: string;
  reviewerSchedule: string;
  maxRuntime: number;
  reviewerMaxRuntime: number;
  maxRetries: number;
  reviewerMaxRetries: number;
  reviewerRetryDelay: number;
  reviewerMaxPrsPerRun: number;
  minReviewScore: number;
  branchPatterns: string[];
  qa: IQaConfig;
  audit: IAuditConfig;
  analytics: IAnalyticsConfig;
  prResolver: IPrResolverConfig;
  merger: IMergerConfig;
  roadmapScanner: IRoadmapScannerConfig;
  providerEnv: Record<string, string>;
  jobProviders: IJobProviders;
  scheduleBundleId: string | null;
  schedulingPriority: number;
  cronScheduleOffset: number;
  queue: INightWatchConfig['queue'];
}

interface IJobsTabProps {
  form: IConfigFormJobs;
  updateField: <K extends keyof IConfigFormJobs>(key: K, value: IConfigFormJobs[K]) => void;
  handleRoadmapToggle: (enabled: boolean) => Promise<void>;
  presetOptions: Array<{ label: string; value: string }>;
  expandedJob: string | null;
  onExpandedJobChange: (jobId: string | null) => void;
  onOpenSchedule: (jobId: JobKey) => void;
}

const CadencePanel: React.FC<{ summary: string; onOpen: () => void }> = ({ summary, onOpen }) => (
  <div className="flex flex-col gap-4 rounded-xl border border-slate-800 bg-slate-950/50 p-4 md:flex-row md:items-center md:justify-between">
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Cadence</div>
      <div className="mt-1 text-sm font-medium text-slate-200">{summary}</div>
      <p className="mt-1 text-xs text-slate-500">Managed centrally in Automation &gt; Schedules.</p>
    </div>
    <Button variant="outline" size="sm" onClick={onOpen} className="border-slate-700 text-slate-300 hover:bg-slate-800">
      Open Schedules
    </Button>
  </div>
);

const JobsTab: React.FC<IJobsTabProps> = ({
  form,
  updateField,
  handleRoadmapToggle,
  presetOptions,
  expandedJob,
  onExpandedJobChange,
  onOpenSchedule,
}) => {
  const updateJobProvider = (jobKey: keyof IJobProviders, value: string) => {
    const newJobProviders = { ...form.jobProviders };
    if (value === '') {
      delete newJobProviders[jobKey];
    } else {
      newJobProviders[jobKey] = value;
    }
    updateField('jobProviders', newJobProviders);
  };

  const providerOptionsWithDefault = [
    { label: 'Use Global (default)', value: '' },
    ...presetOptions,
  ];

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <div className="flex items-center justify-between pb-2 border-b border-slate-800/50">
          <div>
            <h3 className="text-lg font-medium text-slate-200">Prompt Augmentation</h3>
            <p className="text-sm text-slate-400 mt-1">
              Tune how feedback patterns become prompt snippets once the config schema supports these fields.
            </p>
          </div>
          <div className="hidden rounded-lg bg-amber-500/10 p-2 text-amber-400 sm:block">
            <Sparkles className="h-5 w-5" />
          </div>
        </div>
        <div className="rounded-xl border border-amber-900/40 bg-amber-950/10 p-4">
          <div className="mb-4 text-sm text-amber-300">
            Prompt augmentation controls are read-only because the Night Watch config schema does not expose persistent
            augmentation settings yet.
          </div>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <div className="flex items-center justify-between rounded-md border border-slate-800 bg-slate-950/40 p-3">
              <div>
                <span className="text-sm font-medium text-slate-200">Enable prompt augmentation</span>
                <p className="mt-0.5 text-xs text-slate-500">Requires schema support before it can be saved.</p>
              </div>
              <Switch checked={false} disabled />
            </div>
            <Input
              label="Activation Threshold"
              type="number"
              min="0"
              max="1"
              step="0.05"
              value="0.75"
              disabled
              helperText="Minimum confidence required before a snippet can activate."
            />
            <Input
              label="TTL"
              type="number"
              min="1"
              value="14"
              disabled
              rightIcon={<span className="text-xs">days</span>}
              helperText="How long an augmentation remains active before expiry."
            />
            <Input
              label="Max Snippets Per Job"
              type="number"
              min="1"
              value="3"
              disabled
              helperText="Maximum active augmentation snippets applied to each job prompt."
            />
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex items-center justify-between pb-2 border-b border-slate-800/50">
          <div>
            <h3 className="text-lg font-medium text-slate-200">Job Configurations</h3>
            <p className="text-sm text-slate-400 mt-1">
              Enable jobs, choose providers, and tune runtime behavior. Cadence stays in Automation &gt; Schedules.
            </p>
          </div>
          <span className="text-xs text-slate-500">8 total jobs</span>
        </div>

        {/* PRD Executor */}
        <JobAccordion
          id="job-section-executor"
          title="PRD Executor"
          icon={Play}
          description="Executes PRDs to generate code and create PRs"
          enabled={form.executorEnabled}
          onToggle={(checked) => updateField('executorEnabled', checked)}
          expanded={expandedJob === 'executor'}
          onExpandChange={(expanded) => onExpandedJobChange(expanded ? 'executor' : null)}
          scheduleSummary={cronToHuman(form.cronSchedule)}
          providerLabel={form.jobProviders.executor ? presetOptions.find(p => p.value === form.jobProviders.executor)?.label : 'Global'}
        >
          <div className="space-y-6">
            <CadencePanel summary={cronToHuman(form.cronSchedule)} onOpen={() => onOpenSchedule('executor')} />
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <Select
                label="Provider"
                value={form.jobProviders.executor ?? ''}
                onChange={(val) => updateJobProvider('executor', val)}
                options={providerOptionsWithDefault}
              />
              <Input
                label="Max Runtime"
                type="number"
                value={String(form.maxRuntime)}
                onChange={(e) => updateField('maxRuntime', Number(e.target.value || 0))}
                rightIcon={<span className="text-xs">sec</span>}
                helperText="Maximum runtime for executor tasks"
              />
            </div>
          </div>
        </JobAccordion>

        {/* PR Reviewer */}
        <JobAccordion
          id="job-section-reviewer"
          title="PR Reviewer"
          icon={Eye}
          description="Reviews PRs and provides feedback or automated fixes"
          enabled={form.reviewerEnabled}
          onToggle={(checked) => updateField('reviewerEnabled', checked)}
          expanded={expandedJob === 'reviewer'}
          onExpandChange={(expanded) => onExpandedJobChange(expanded ? 'reviewer' : null)}
          scheduleSummary={cronToHuman(form.reviewerSchedule)}
          providerLabel={form.jobProviders.reviewer ? presetOptions.find(p => p.value === form.jobProviders.reviewer)?.label : 'Global'}
        >
          <div className="space-y-6">
            <CadencePanel summary={cronToHuman(form.reviewerSchedule)} onOpen={() => onOpenSchedule('reviewer')} />
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <Select
                label="Provider"
                value={form.jobProviders.reviewer ?? ''}
                onChange={(val) => updateJobProvider('reviewer', val)}
                options={providerOptionsWithDefault}
              />
              <Input
                label="Max Runtime"
                type="number"
                value={String(form.reviewerMaxRuntime)}
                onChange={(e) => updateField('reviewerMaxRuntime', Number(e.target.value || 0))}
                rightIcon={<span className="text-xs">sec</span>}
              />
              <Input
                label="Min Review Score"
                type="number"
                min="0"
                max="100"
                value={String(form.minReviewScore)}
                onChange={(e) => updateField('minReviewScore', Number(e.target.value || 0))}
                helperText="PRs below this score will be marked as 'Needs Work'"
              />
              <Input
                label="Max Retries"
                type="number"
                value={String(form.reviewerMaxRetries)}
                onChange={(e) => updateField('reviewerMaxRetries', Number(e.target.value || 0))}
                helperText="Fix attempts after initial review"
              />
              <Input
                label="Retry Delay"
                type="number"
                value={String(form.reviewerRetryDelay)}
                onChange={(e) => updateField('reviewerRetryDelay', Number(e.target.value || 0))}
                rightIcon={<span className="text-xs">sec</span>}
              />
              <div className="md:col-span-2">
                <Input
                  label="Max PRs Per Run"
                  type="number"
                  value={String(form.reviewerMaxPrsPerRun)}
                  onChange={(e) => updateField('reviewerMaxPrsPerRun', Number(e.target.value || 0))}
                  helperText="Hard cap on PRs processed per run (0 = unlimited)"
                />
              </div>
            </div>
          </div>
        </JobAccordion>

        {/* QA */}
        <JobAccordion
          id="job-section-qa"
          title="Quality Assurance"
          icon={CheckCircle2}
          description="Automated UI testing using Playwright"
          enabled={form.qa.enabled}
          onToggle={(checked) => updateField('qa', { ...form.qa, enabled: checked })}
          expanded={expandedJob === 'qa'}
          onExpandChange={(expanded) => onExpandedJobChange(expanded ? 'qa' : null)}
          scheduleSummary={cronToHuman(form.qa.schedule)}
          providerLabel={form.jobProviders.qa ? presetOptions.find(p => p.value === form.jobProviders.qa)?.label : 'Global'}
        >
          <div className="space-y-6">
            <CadencePanel summary={cronToHuman(form.qa.schedule)} onOpen={() => onOpenSchedule('qa')} />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Select
                label="Provider"
                value={form.jobProviders.qa ?? ''}
                onChange={(val) => updateJobProvider('qa', val)}
                options={providerOptionsWithDefault}
              />
              <Input
                label="Max Runtime"
                type="number"
                value={String(form.qa.maxRuntime)}
                onChange={(e) => updateField('qa', { ...form.qa, maxRuntime: Number(e.target.value || 0) })}
                rightIcon={<span className="text-xs">sec</span>}
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
              />
              <Input
                label="Skip Label"
                value={form.qa.skipLabel}
                onChange={(e) => updateField('qa', { ...form.qa, skipLabel: e.target.value })}
                helperText="GitHub label to skip QA"
              />
              <div className="flex items-center justify-between p-3 rounded-md border border-slate-800 bg-slate-950/40 mt-1.5">
                <div>
                  <span className="text-sm font-medium text-slate-200">Auto-install Playwright</span>
                  <p className="text-xs text-slate-500 mt-0.5">Install browsers if missing</p>
                </div>
                <Switch
                  checked={form.qa.autoInstallPlaywright}
                  onChange={(checked) => updateField('qa', { ...form.qa, autoInstallPlaywright: checked })}
                />
              </div>
            </div>
            <TagInput
              label="QA Branch Patterns"
              value={form.qa.branchPatterns}
              onChange={(patterns) => updateField('qa', { ...form.qa, branchPatterns: patterns })}
              placeholder="e.g., qa/, test/"
              helpText="Branch patterns to match for QA"
            />
          </div>
        </JobAccordion>

        {/* Audit */}
        <JobAccordion
          id="job-section-audit"
          title="Code Audit"
          icon={Search}
          description="Automated code quality and security audits"
          enabled={form.audit.enabled}
          onToggle={(checked) => updateField('audit', { ...form.audit, enabled: checked })}
          expanded={expandedJob === 'audit'}
          onExpandChange={(expanded) => onExpandedJobChange(expanded ? 'audit' : null)}
          scheduleSummary={cronToHuman(form.audit.schedule)}
          providerLabel={form.jobProviders.audit ? presetOptions.find(p => p.value === form.jobProviders.audit)?.label : 'Global'}
        >
          <div className="space-y-6">
            <CadencePanel summary={cronToHuman(form.audit.schedule)} onOpen={() => onOpenSchedule('audit')} />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Select
                label="Provider"
                value={form.jobProviders.audit ?? ''}
                onChange={(val) => updateJobProvider('audit', val)}
                options={providerOptionsWithDefault}
              />
              <Input
                label="Max Runtime"
                type="number"
                value={String(form.audit.maxRuntime)}
                onChange={(e) => updateField('audit', { ...form.audit, maxRuntime: Number(e.target.value || 0) })}
                rightIcon={<span className="text-xs">sec</span>}
              />
              <Select
                label="Target Column"
                value={form.audit.targetColumn}
                onChange={(value) => updateField('audit', { ...form.audit, targetColumn: value as IAuditConfig['targetColumn'] })}
                options={[
                  { value: 'Draft', label: 'Draft' },
                  { value: 'Ready', label: 'Ready' },
                  { value: 'In Progress', label: 'In Progress' },
                  { value: 'Review', label: 'Review' },
                  { value: 'Done', label: 'Done' },
                ]}
              />
            </div>
          </div>
        </JobAccordion>

        {/* Planner */}
        <JobAccordion
          id="job-section-slicer"
          title="Planner"
          icon={Layout}
          description="Generate one PRD per run using ROADMAP.md or audit findings"
          enabled={form.roadmapScanner.enabled}
          onToggle={handleRoadmapToggle}
          expanded={expandedJob === 'slicer'}
          onExpandChange={(expanded) => onExpandedJobChange(expanded ? 'slicer' : null)}
          scheduleSummary={cronToHuman(form.roadmapScanner.slicerSchedule)}
          providerLabel={form.jobProviders.slicer ? presetOptions.find(p => p.value === form.jobProviders.slicer)?.label : 'Global'}
        >
          <div className="space-y-6">
            <CadencePanel summary={cronToHuman(form.roadmapScanner.slicerSchedule)} onOpen={() => onOpenSchedule('slicer')} />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Select
                label="Provider"
                value={form.jobProviders.slicer ?? ''}
                onChange={(val) => updateJobProvider('slicer', val)}
                options={providerOptionsWithDefault}
              />
              <Input
                label="Roadmap File Path"
                value={form.roadmapScanner.roadmapPath}
                onChange={(e) => updateField('roadmapScanner', { ...form.roadmapScanner, roadmapPath: e.target.value })}
                helperText="Primary planning source (relative to project root)."
              />
              <Input
                label="Max Runtime"
                type="number"
                value={String(form.roadmapScanner.slicerMaxRuntime || '')}
                onChange={(e) => updateField('roadmapScanner', { ...form.roadmapScanner, slicerMaxRuntime: Number(e.target.value || 0) })}
                rightIcon={<span className="text-xs">sec</span>}
              />
              <Select
                label="Priority Mode"
                value={form.roadmapScanner.priorityMode || 'roadmap-first'}
                onChange={(val) => updateField('roadmapScanner', { ...form.roadmapScanner, priorityMode: val === 'audit-first' ? 'audit-first' : 'roadmap-first' })}
                options={[
                  { label: 'Roadmap first (recommended)', value: 'roadmap-first' },
                  { label: 'Audit first', value: 'audit-first' },
                ]}
              />
              <Select
                label="Issue Column"
                value={form.roadmapScanner.issueColumn || 'Ready'}
                onChange={(val) => updateField('roadmapScanner', { ...form.roadmapScanner, issueColumn: val === 'Draft' ? 'Draft' : 'Ready' })}
                options={[
                  { label: 'Ready (default)', value: 'Ready' },
                  { label: 'Draft', value: 'Draft' },
                ]}
              />
            </div>
          </div>
        </JobAccordion>

        {/* Analytics */}
        <JobAccordion
          id="job-section-analytics"
          title="Analytics (Amplitude)"
          icon={BarChart3}
          description="Fetch Amplitude data, analyze with AI, and create board issues"
          enabled={form.analytics.enabled}
          onToggle={(checked) => updateField('analytics', { ...form.analytics, enabled: checked })}
          expanded={expandedJob === 'analytics'}
          onExpandChange={(expanded) => onExpandedJobChange(expanded ? 'analytics' : null)}
          scheduleSummary={cronToHuman(form.analytics.schedule)}
          providerLabel={form.jobProviders.analytics ? presetOptions.find(p => p.value === form.jobProviders.analytics)?.label : 'Global'}
        >
          <div className="space-y-6">
            <CadencePanel summary={cronToHuman(form.analytics.schedule)} onOpen={() => onOpenSchedule('analytics')} />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Select
                label="Provider"
                value={form.jobProviders.analytics ?? ''}
                onChange={(val) => updateJobProvider('analytics', val)}
                options={providerOptionsWithDefault}
              />
              <Input
                label="Amplitude API Key"
                value={form.providerEnv?.AMPLITUDE_API_KEY ?? ''}
                onChange={(e) => updateField('providerEnv', { ...form.providerEnv, AMPLITUDE_API_KEY: e.target.value })}
                placeholder="Required"
              />
              <Input
                label="Amplitude Secret Key"
                type="password"
                value={form.providerEnv?.AMPLITUDE_SECRET_KEY ?? ''}
                onChange={(e) => updateField('providerEnv', { ...form.providerEnv, AMPLITUDE_SECRET_KEY: e.target.value })}
                placeholder="Required"
              />
              <Input
                label="Max Runtime"
                type="number"
                value={String(form.analytics.maxRuntime)}
                onChange={(e) => updateField('analytics', { ...form.analytics, maxRuntime: Number(e.target.value || 0) })}
                rightIcon={<span className="text-xs">sec</span>}
              />
              <Input
                label="Lookback Days"
                type="number"
                min="1"
                max="90"
                value={String(form.analytics.lookbackDays)}
                onChange={(e) => updateField('analytics', { ...form.analytics, lookbackDays: Math.max(1, Math.min(90, Number(e.target.value || 7))) })}
              />
              <Select
                label="Target Column"
                value={form.analytics.targetColumn}
                onChange={(value) => updateField('analytics', { ...form.analytics, targetColumn: value as IAnalyticsConfig['targetColumn'] })}
                options={[
                  { value: 'Draft', label: 'Draft' },
                  { value: 'Ready', label: 'Ready' },
                  { value: 'In Progress', label: 'In Progress' },
                  { value: 'Review', label: 'Review' },
                  { value: 'Done', label: 'Done' },
                ]}
              />
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-slate-400 mb-1.5">
                  Analysis Prompt (optional)
                </label>
                <textarea
                  rows={4}
                  value={form.analytics.analysisPrompt ?? ''}
                  onChange={(e) => updateField('analytics', { ...form.analytics, analysisPrompt: e.target.value })}
                  placeholder="Custom prompt for AI analysis. Leave empty to use default."
                  className="w-full bg-slate-950/50 border border-white/10 text-slate-200 rounded-lg px-3 py-2.5 text-sm placeholder-slate-600 focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/20 resize-y"
                />
              </div>
            </div>
          </div>
        </JobAccordion>

        {/* PR Resolver */}
        <JobAccordion
          id="job-section-pr-resolver"
          title="PR Resolver"
          icon={GitMerge}
          description="Repo-wide conflict resolver that rebases PRs and applies feedback"
          enabled={form.prResolver.enabled}
          onToggle={(checked) => updateField('prResolver', { ...form.prResolver, enabled: checked })}
          expanded={expandedJob === 'pr-resolver'}
          onExpandChange={(expanded) => onExpandedJobChange(expanded ? 'pr-resolver' : null)}
          scheduleSummary={cronToHuman(form.prResolver.schedule)}
          providerLabel={form.jobProviders['pr-resolver'] ? presetOptions.find(p => p.value === form.jobProviders['pr-resolver'])?.label : 'Global'}
        >
          <div className="space-y-6">
            <CadencePanel summary={cronToHuman(form.prResolver.schedule)} onOpen={() => onOpenSchedule('pr-resolver')} />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Select
                label="Provider"
                value={form.jobProviders['pr-resolver'] ?? ''}
                onChange={(val) => updateJobProvider('pr-resolver', val)}
                options={providerOptionsWithDefault}
              />
              <Input
                label="Max Runtime"
                type="number"
                value={String(form.prResolver.maxRuntime)}
                onChange={(e) => updateField('prResolver', { ...form.prResolver, maxRuntime: Number(e.target.value || 0) })}
                rightIcon={<span className="text-xs">sec</span>}
              />
              <Input
                label="Per-PR Timeout"
                type="number"
                value={String(form.prResolver.perPrTimeout)}
                onChange={(e) => updateField('prResolver', { ...form.prResolver, perPrTimeout: Math.max(0, Number(e.target.value || 0)) })}
                rightIcon={<span className="text-xs">sec</span>}
              />
              <Input
                label="Max PRs Per Run"
                type="number"
                min="0"
                value={String(form.prResolver.maxPrsPerRun)}
                onChange={(e) => updateField('prResolver', { ...form.prResolver, maxPrsPerRun: Math.max(0, Number(e.target.value || 0)) })}
              />
              <Input
                label="Ready Label"
                value={form.prResolver.readyLabel}
                onChange={(e) => updateField('prResolver', { ...form.prResolver, readyLabel: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex items-center justify-between p-3 rounded-md border border-slate-800 bg-slate-950/40">
                <div>
                  <span className="text-sm font-medium text-slate-200">AI conflict resolution</span>
                  <p className="text-xs text-slate-500 mt-1">AI help for non-trivial rebases</p>
                </div>
                <Switch
                  checked={form.prResolver.aiConflictResolution}
                  onChange={(checked) => updateField('prResolver', { ...form.prResolver, aiConflictResolution: checked })}
                />
              </div>
              <div className="flex items-center justify-between p-3 rounded-md border border-slate-800 bg-slate-950/40">
                <div>
                  <span className="text-sm font-medium text-slate-200">AI review resolution</span>
                  <p className="text-xs text-slate-500 mt-1">Implement open review comments</p>
                </div>
                <Switch
                  checked={form.prResolver.aiReviewResolution}
                  onChange={(checked) => updateField('prResolver', { ...form.prResolver, aiReviewResolution: checked })}
                />
              </div>
            </div>
            <TagInput
              label="PR Resolver Branch Patterns"
              value={form.prResolver.branchPatterns}
              onChange={(patterns) => updateField('prResolver', { ...form.prResolver, branchPatterns: patterns })}
              placeholder="e.g., feat/, night-watch/"
              helpText="Branch patterns to filter PRs (empty = all)"
            />
          </div>
        </JobAccordion>

        {/* Merger */}
        <JobAccordion
          id="job-section-merger"
          title="Merge Orchestrator"
          icon={GitPullRequest}
          description="Repo-wide PR merge coordinator — scans, rebases, and merges"
          enabled={form.merger.enabled}
          onToggle={(checked) => updateField('merger', { ...form.merger, enabled: checked })}
          expanded={expandedJob === 'merger'}
          onExpandChange={(expanded) => onExpandedJobChange(expanded ? 'merger' : null)}
          scheduleSummary={cronToHuman(form.merger.schedule)}
          providerLabel={form.jobProviders.merger ? presetOptions.find(p => p.value === form.jobProviders.merger)?.label : 'Global'}
        >
          <div className="space-y-6">
            <CadencePanel summary={cronToHuman(form.merger.schedule)} onOpen={() => onOpenSchedule('merger')} />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Select
                label="Provider"
                value={form.jobProviders.merger ?? ''}
                onChange={(val) => updateJobProvider('merger', val)}
                options={providerOptionsWithDefault}
              />
              <Input
                label="Max Runtime"
                type="number"
                value={String(form.merger.maxRuntime)}
                onChange={(e) => updateField('merger', { ...form.merger, maxRuntime: Number(e.target.value || 0) })}
                rightIcon={<span className="text-xs">sec</span>}
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
              />
              <Input
                label="Min Review Score"
                type="number"
                min="0"
                max="100"
                value={String(form.merger.minReviewScore)}
                onChange={(e) => updateField('merger', { ...form.merger, minReviewScore: Math.max(0, Math.min(100, Number(e.target.value || 0))) })}
              />
              <Input
                label="Max PRs Per Run"
                type="number"
                min="0"
                value={String(form.merger.maxPrsPerRun)}
                onChange={(e) => updateField('merger', { ...form.merger, maxPrsPerRun: Math.max(0, Number(e.target.value || 0)) })}
              />
            </div>
            <div className="flex items-center justify-between p-3 rounded-md border border-slate-800 bg-slate-950/40">
              <div>
                <span className="text-sm font-medium text-slate-200">Rebase before merge</span>
                <p className="text-xs text-slate-500 mt-1">Rebase each PR against its base branch</p>
              </div>
              <Switch
                checked={form.merger.rebaseBeforeMerge}
                onChange={(checked) => updateField('merger', { ...form.merger, rebaseBeforeMerge: checked })}
              />
            </div>
            <TagInput
              label="Merger Branch Patterns"
              value={form.merger.branchPatterns}
              onChange={(patterns) => updateField('merger', { ...form.merger, branchPatterns: patterns })}
              placeholder="e.g., feat/, night-watch/"
            />
          </div>
        </JobAccordion>
      </section>
    </div>
  );
};

export default JobsTab;
