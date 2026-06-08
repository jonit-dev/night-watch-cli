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
  ClipboardList,
} from 'lucide-react';
import Card from '../ui/Card';
import CronScheduleInput from '../ui/CronScheduleInput';
import { IScheduleTemplate, SCHEDULE_TEMPLATES } from '../../utils/cron.js';

export interface IScheduleConfigForm {
  cronSchedule: string;
  reviewerSchedule: string;
  qa: { schedule: string; enabled: boolean };
  audit: { schedule: string; enabled: boolean };
  optimizer?: { schedule: string; enabled: boolean };
  ux?: { schedule: string; enabled: boolean };
  analytics?: { schedule: string; enabled: boolean };
  roadmapScanner: { slicerSchedule: string; enabled: boolean };
  prResolver?: { schedule: string; enabled: boolean };
  merger?: { schedule: string; enabled: boolean };
  manager?: { schedule: string; enabled: boolean };
}

interface IScheduleConfigProps {
  form: IScheduleConfigForm;
  scheduleMode: 'template' | 'custom';
  selectedTemplateId: string | null;
  onFieldChange: (field: string, value: unknown) => void;
  onSwitchToTemplate: () => void;
  onSwitchToCustom: () => void;
  onApplyTemplate: (tpl: IScheduleTemplate) => void;
}

interface IJobScheduleCardProps {
  id: string;
  icon: React.FC<{ size?: number; className?: string }>;
  title: string;
  description: string;
  value: string;
  onChange: (val: string) => void;
}

const JobScheduleCard: React.FC<IJobScheduleCardProps> = ({
  id,
  icon: Icon,
  title,
  description,
  value,
  onChange,
}) => (
  <div id={id} className="rounded-xl border border-slate-700 bg-slate-800/50 p-4 space-y-4">
    <div className="flex items-start gap-3">
      <div className="mt-0.5 p-1.5 rounded-md bg-slate-800 text-slate-400">
        <Icon size={14} />
      </div>
      <div>
        <div className="text-sm font-medium text-slate-200">{title}</div>
        <div className="text-xs text-slate-500 mt-0.5">{description}</div>
      </div>
    </div>
    <CronScheduleInput label="" value={value} onChange={onChange} />
  </div>
);

const ScheduleConfig: React.FC<IScheduleConfigProps> = ({
  form,
  scheduleMode,
  selectedTemplateId,
  onFieldChange,
  onSwitchToTemplate,
  onSwitchToCustom,
  onApplyTemplate,
}) => {
  return (
    <Card className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-medium text-slate-200 mb-1">Job Schedules</h3>
          <p className="text-sm text-slate-400">
            Configure when automated jobs run using a preset template or custom cron expressions
          </p>
          <p className="text-xs text-slate-500 mt-2 mb-2">
            This tab only controls cadence. Runtime and provider settings live in the Jobs tab.
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

      {scheduleMode === 'template' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {SCHEDULE_TEMPLATES.map((tpl) => {
            const active = selectedTemplateId === tpl.id;
            return (
              <button
                key={tpl.id}
                type="button"
                onClick={() => onApplyTemplate(tpl)}
                className={`text-left p-4 rounded-lg border transition-colors ${
                  active
                    ? 'border-indigo-500 bg-indigo-950/40'
                    : 'border-slate-700 bg-slate-800/30 hover:border-slate-600'
                }`}
              >
                <div className="font-medium text-slate-200 mb-1">{tpl.label}</div>
                <p className="text-xs text-slate-400 mb-3">{tpl.description}</p>
                <div className="space-y-0.5">
                  {(
                    [
                      ['Executor', tpl.hints.executor],
                      ['Reviewer', tpl.hints.reviewer],
                      ['QA', tpl.hints.qa],
                      ['Audit', tpl.hints.audit],
                      ['Optimizer', tpl.hints.optimizer],
                      ['UX', tpl.hints.ux],
                      ['Planner', tpl.hints.slicer],
                      ['PR Resolver', tpl.hints.prResolver],
                      ['Merger', tpl.hints.merger],
                      ['Manager', tpl.hints.manager],
                    ] as [string, string][]
                  ).map(([name, hint]) => (
                    <div key={name} className="flex items-center gap-2">
                      <span className="text-xs text-slate-500 w-16 shrink-0">{name}</span>
                      <span className="text-xs text-slate-400">{hint}</span>
                    </div>
                  ))}
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <JobScheduleCard
            id="job-schedule-executor"
            icon={Play}
            title="PRD Executor"
            description="Executes PRDs to generate code and create PRs"
            value={form.cronSchedule}
            onChange={(val) => onFieldChange('cronSchedule', val)}
          />
          <JobScheduleCard
            id="job-schedule-reviewer"
            icon={Eye}
            title="PR Reviewer"
            description="Reviews PRs and provides feedback or automated fixes"
            value={form.reviewerSchedule}
            onChange={(val) => onFieldChange('reviewerSchedule', val)}
          />
          <JobScheduleCard
            id="job-schedule-qa"
            icon={CheckCircle2}
            title="Quality Assurance"
            description="Automated UI testing using Playwright"
            value={form.qa.schedule}
            onChange={(val) => onFieldChange('qa', { ...form.qa, schedule: val })}
          />
          <JobScheduleCard
            id="job-schedule-audit"
            icon={Search}
            title="Code Audit"
            description="Automated code quality and security audits"
            value={form.audit.schedule}
            onChange={(val) => onFieldChange('audit', { ...form.audit, schedule: val })}
          />
          {form.optimizer && (
            <JobScheduleCard
              id="job-schedule-optimizer"
              icon={Sparkles}
              title="Optimizer"
              description="Find and prove one performance improvement"
              value={form.optimizer.schedule}
              onChange={(val) => onFieldChange('optimizer', { ...form.optimizer, schedule: val })}
            />
          )}
          {form.ux && (
            <JobScheduleCard
              id="job-schedule-ux"
              icon={Eye}
              title="UX"
              description="Inspect product flows with browser automation"
              value={form.ux.schedule}
              onChange={(val) => onFieldChange('ux', { ...form.ux, schedule: val })}
            />
          )}
          <JobScheduleCard
            id="job-schedule-slicer"
            icon={Layout}
            title="Planner"
            description="Generate PRDs from ROADMAP.md or audit findings"
            value={form.roadmapScanner.slicerSchedule}
            onChange={(val) => onFieldChange('roadmapScanner', { ...form.roadmapScanner, slicerSchedule: val })}
          />
          {form.analytics && (
            <JobScheduleCard
              id="job-schedule-analytics"
              icon={BarChart3}
              title="Analytics"
              description="Fetch Amplitude data, analyze with AI, and create issues"
              value={form.analytics.schedule}
              onChange={(val) => onFieldChange('analytics', { ...form.analytics, schedule: val })}
            />
          )}
          {form.prResolver && (
            <JobScheduleCard
              id="job-schedule-pr-resolver"
              icon={GitMerge}
              title="PR Resolver"
              description="Rebases PRs and applies review feedback"
              value={form.prResolver.schedule}
              onChange={(val) => onFieldChange('prResolver', { ...form.prResolver, schedule: val })}
            />
          )}
          {form.merger && (
            <JobScheduleCard
              id="job-schedule-merger"
              icon={GitPullRequest}
              title="Merge Orchestrator"
              description="Scans, rebases, and merges approved PRs"
              value={form.merger.schedule}
              onChange={(val) => onFieldChange('merger', { ...form.merger, schedule: val })}
            />
          )}
          {form.manager && (
            <JobScheduleCard
              id="job-schedule-manager"
              icon={ClipboardList}
              title="Manager"
              description="Monitors roadmap, PRDs, docs, and system health"
              value={form.manager.schedule}
              onChange={(val) => onFieldChange('manager', { ...form.manager, schedule: val })}
            />
          )}
        </div>
      )}
    </Card>
  );
};

export default ScheduleConfig;
