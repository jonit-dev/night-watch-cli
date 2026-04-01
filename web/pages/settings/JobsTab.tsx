import React from 'react';
import {
  Activity,
  BarChart3,
  CheckCircle2,
  Eye,
  GitMerge,
  GitPullRequest,
  Layout,
  Play,
  Search,
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
  QueueMode,
  INightWatchConfig,
} from '../../api';
import TagInput from '../../components/settings/TagInput.js';
import Input from '../../components/ui/Input';
import Select from '../../components/ui/Select';
import Switch from '../../components/ui/Switch';
import Card from '../../components/ui/Card';
import CronScheduleInput from '../../components/ui/CronScheduleInput';
import JobAccordion from '../../components/settings/JobAccordion';
import ScheduleTimeline from '../../components/scheduling/ScheduleTimeline';
import { cronToHuman, IScheduleTemplate, SCHEDULE_TEMPLATES } from '../../utils/cron.js';

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
  scheduleMode: 'template' | 'custom';
  onSwitchToTemplate: () => void;
  onSwitchToCustom: () => void;
  onApplyTemplate: (tpl: IScheduleTemplate) => void;
  allProjectConfigs: Array<{ projectId: string; config: INightWatchConfig }>;
  currentProjectId: string;
}

const JobsTab: React.FC<IJobsTabProps> = ({
  form,
  updateField,
  handleRoadmapToggle,
  presetOptions,
  scheduleMode,
  onSwitchToTemplate,
  onSwitchToCustom,
  onApplyTemplate,
  allProjectConfigs,
  currentProjectId,
}) => {
  const [expandedJob, setExpandedJob] = React.useState<string | null>(null);

  // Deep linking: expand correct job on load
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const jobType = params.get('jobType');
    if (jobType) {
      setExpandedJob(jobType);
      setTimeout(() => {
        const el = document.getElementById(`job-section-${jobType}`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 100);
    }
  }, []);

  const updateJobProvider = (jobKey: keyof IJobProviders, value: string) => {
    const newJobProviders = { ...form.jobProviders };
    if (value === '') {
      delete newJobProviders[jobKey];
    } else {
      newJobProviders[jobKey] = value;
    }
    updateField('jobProviders', newJobProviders);
  };

  const handleEditJobFromTimeline = (_projectId: string, jobType: string) => {
    const registryId = jobType === 'planner' ? 'slicer' : jobType;
    setExpandedJob(registryId);
    setTimeout(() => {
        const el = document.getElementById(`job-section-${registryId}`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 50);
  };

  const providerOptionsWithDefault = [
    { label: 'Use Global (default)', value: '' },
    ...presetOptions,
  ];

  return (
    <div className="space-y-8">
      {/* Schedule Presets Section */}
      <section className="space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-medium text-slate-200 mb-1">Schedule Presets</h3>
            <p className="text-sm text-slate-400">
              Apply a template to all jobs or configure custom schedules per job
            </p>
          </div>
          <div className="flex rounded-lg border border-slate-700 overflow-hidden shrink-0">
            <button
              type="button"
              className={`px-4 py-1.5 text-sm font-medium transition-colors ${
                scheduleMode === 'template'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-800 text-slate-400 hover:text-slate-200'
              }`}
              onClick={onSwitchToTemplate}
            >
              Template
            </button>
            <button
              type="button"
              className={`px-4 py-1.5 text-sm font-medium transition-colors ${
                scheduleMode === 'custom'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-800 text-slate-400 hover:text-slate-200'
              }`}
              onClick={onSwitchToCustom}
            >
              Custom
            </button>
          </div>
        </div>

        {scheduleMode === 'template' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {SCHEDULE_TEMPLATES.map((tpl) => {
              const active = form.scheduleBundleId === tpl.id;
              return (
                <button
                  key={tpl.id}
                  type="button"
                  onClick={() => onApplyTemplate(tpl)}
                  className={`text-left p-4 rounded-lg border transition-all ${
                    active
                      ? 'border-indigo-500 bg-indigo-950/40 ring-1 ring-indigo-500/20'
                      : 'border-slate-800 bg-slate-900/30 hover:border-slate-700'
                  }`}
                >
                  <div className="font-medium text-slate-200 mb-1 text-sm">{tpl.label}</div>
                  <p className="text-[11px] text-slate-500 leading-relaxed">{tpl.description}</p>
                </button>
              );
            })}
          </div>
        )}

        <ScheduleTimeline
          configs={allProjectConfigs}
          currentProjectId={currentProjectId}
          onEditJob={handleEditJobFromTimeline}
        />
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-4 border-t border-slate-800/50">
          <Select
            label="Scheduling Priority"
            value={String(form.schedulingPriority)}
            onChange={(val) => updateField('schedulingPriority', Number(val))}
            options={[
              { label: '1 - Lowest', value: '1' },
              { label: '2 - Low', value: '2' },
              { label: '3 - Balanced', value: '3' },
              { label: '4 - High', value: '4' },
              { label: '5 - Highest', value: '5' },
            ]}
            helperText="Projects with higher priority get earlier slots"
          />
          <Input
            label="Extra Start Delay"
            type="number"
            min="0"
            max="59"
            value={String(form.cronScheduleOffset)}
            onChange={(e) => updateField('cronScheduleOffset', Math.min(59, Math.max(0, Number(e.target.value || 0))))}
            rightIcon={<span className="text-xs">min</span>}
            helperText="Manual delay added to all jobs"
          />
          <div className="flex items-center justify-between p-4 rounded-xl border border-slate-800 bg-slate-950/30">
            <div>
              <div className="text-sm font-medium text-slate-200">Global Queue</div>
              <p className="text-[11px] text-slate-500 mt-0.5">Queue overlapping jobs</p>
            </div>
            <Switch
              checked={form.queue.enabled}
              onChange={(enabled) => updateField('queue', { ...form.queue, enabled })}
            />
          </div>
        </div>
      </section>

      {/* Individual Jobs Section */}
      <section className="space-y-4">
        <div className="flex items-center justify-between pb-2 border-b border-slate-800/50">
          <h3 className="text-lg font-medium text-slate-200">Job Configurations</h3>
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
          onExpandChange={(expanded) => setExpandedJob(expanded ? 'executor' : null)}
          scheduleSummary={cronToHuman(form.cronSchedule)}
          providerLabel={form.jobProviders.executor ? presetOptions.find(p => p.value === form.jobProviders.executor)?.label : 'Global'}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <CronScheduleInput
              label="Schedule"
              value={form.cronSchedule}
              onChange={(val) => updateField('cronSchedule', val)}
            />
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
          onExpandChange={(expanded) => setExpandedJob(expanded ? 'reviewer' : null)}
          scheduleSummary={cronToHuman(form.reviewerSchedule)}
          providerLabel={form.jobProviders.reviewer ? presetOptions.find(p => p.value === form.jobProviders.reviewer)?.label : 'Global'}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <CronScheduleInput
              label="Schedule"
              value={form.reviewerSchedule}
              onChange={(val) => updateField('reviewerSchedule', val)}
            />
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
          onExpandChange={(expanded) => setExpandedJob(expanded ? 'qa' : null)}
          scheduleSummary={cronToHuman(form.qa.schedule)}
          providerLabel={form.jobProviders.qa ? presetOptions.find(p => p.value === form.jobProviders.qa)?.label : 'Global'}
        >
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <CronScheduleInput
                label="Schedule"
                value={form.qa.schedule}
                onChange={(val) => updateField('qa', { ...form.qa, schedule: val })}
              />
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
          onExpandChange={(expanded) => setExpandedJob(expanded ? 'audit' : null)}
          scheduleSummary={cronToHuman(form.audit.schedule)}
          providerLabel={form.jobProviders.audit ? presetOptions.find(p => p.value === form.jobProviders.audit)?.label : 'Global'}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <CronScheduleInput
              label="Schedule"
              value={form.audit.schedule}
              onChange={(val) => updateField('audit', { ...form.audit, schedule: val })}
            />
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
          onExpandChange={(expanded) => setExpandedJob(expanded ? 'slicer' : null)}
          scheduleSummary={cronToHuman(form.roadmapScanner.slicerSchedule)}
          providerLabel={form.jobProviders.slicer ? presetOptions.find(p => p.value === form.jobProviders.slicer)?.label : 'Global'}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <CronScheduleInput
              label="Schedule"
              value={form.roadmapScanner.slicerSchedule}
              onChange={(val) => updateField('roadmapScanner', { ...form.roadmapScanner, slicerSchedule: val })}
            />
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
          onExpandChange={(expanded) => setExpandedJob(expanded ? 'analytics' : null)}
          scheduleSummary={cronToHuman(form.analytics.schedule)}
          providerLabel={form.jobProviders.analytics ? presetOptions.find(p => p.value === form.jobProviders.analytics)?.label : 'Global'}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <CronScheduleInput
              label="Schedule"
              value={form.analytics.schedule}
              onChange={(val) => updateField('analytics', { ...form.analytics, schedule: val })}
            />
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
          onExpandChange={(expanded) => setExpandedJob(expanded ? 'pr-resolver' : null)}
          scheduleSummary={cronToHuman(form.prResolver.schedule)}
          providerLabel={form.jobProviders['pr-resolver'] ? presetOptions.find(p => p.value === form.jobProviders['pr-resolver'])?.label : 'Global'}
        >
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <CronScheduleInput
                label="Schedule"
                value={form.prResolver.schedule}
                onChange={(val) => updateField('prResolver', { ...form.prResolver, schedule: val })}
              />
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
          onExpandChange={(expanded) => setExpandedJob(expanded ? 'merger' : null)}
          scheduleSummary={cronToHuman(form.merger.schedule)}
          providerLabel={form.jobProviders.merger ? presetOptions.find(p => p.value === form.jobProviders.merger)?.label : 'Global'}
        >
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <CronScheduleInput
                label="Schedule"
                value={form.merger.schedule}
                onChange={(val) => updateField('merger', { ...form.merger, schedule: val })}
              />
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
