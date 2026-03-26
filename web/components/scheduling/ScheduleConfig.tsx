import React from 'react';
import { INightWatchConfig } from '../../api.js';
import Card from '../ui/Card';
import CronScheduleInput from '../ui/CronScheduleInput';
import Input from '../ui/Input';
import Select from '../ui/Select';
import Switch from '../ui/Switch';
import { IScheduleTemplate, SCHEDULE_TEMPLATES } from '../../utils/cron.js';
import ScheduleTimeline from './ScheduleTimeline.js';

export interface IScheduleConfigForm {
  cronSchedule: string;
  reviewerSchedule: string;
  qa: { schedule: string; enabled: boolean };
  audit: { schedule: string; enabled: boolean };
  analytics?: { schedule: string; enabled: boolean };
  roadmapScanner: { slicerSchedule: string; enabled: boolean };
  merger?: { schedule: string; enabled: boolean };
  scheduleBundleId: string | null;
  schedulingPriority: number;
  cronScheduleOffset: number;
  globalQueueEnabled?: boolean;
}

interface IScheduleConfigProps {
  form: IScheduleConfigForm;
  scheduleMode: 'template' | 'custom';
  selectedTemplateId: string | null;
  onFieldChange: (field: string, value: unknown) => void;
  onSwitchToTemplate: () => void;
  onSwitchToCustom: () => void;
  onApplyTemplate: (tpl: IScheduleTemplate) => void;
  allProjectConfigs?: Array<{ projectId: string; config: INightWatchConfig }>;
  currentProjectId?: string;
  onEditJob?: (projectId: string, jobType: string) => void;
}

const ScheduleConfig: React.FC<IScheduleConfigProps> = ({
  form,
  scheduleMode,
  selectedTemplateId,
  onFieldChange,
  onSwitchToTemplate,
  onSwitchToCustom,
  onApplyTemplate,
  allProjectConfigs,
  currentProjectId,
  onEditJob,
}) => {
  return (
    <Card className="p-6 space-y-6">
      {allProjectConfigs && allProjectConfigs.length > 0 && (
        <ScheduleTimeline
          configs={allProjectConfigs}
          currentProjectId={currentProjectId}
          onEditJob={onEditJob}
        />
      )}

      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-medium text-slate-200 mb-1">Job Schedules</h3>
          <p className="text-sm text-slate-400">
            Configure when automated jobs run using a preset template or custom cron expressions
          </p>
          <p className="text-xs text-slate-500 mt-2">
            Cadence is managed here. Enablement and runtime settings live in the Jobs tab.
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
                      ['Planner', tpl.hints.slicer],
                      ['Merger', tpl.hints.merger],
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
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div id="job-schedule-executor">
            <CronScheduleInput
              label="PRD Execution Schedule"
              value={form.cronSchedule}
              onChange={(val) => onFieldChange('cronSchedule', val)}
            />
          </div>
          <div id="job-schedule-reviewer">
            <CronScheduleInput
              label="PR Review Schedule"
              value={form.reviewerSchedule}
              onChange={(val) => onFieldChange('reviewerSchedule', val)}
            />
          </div>
          <div id="job-schedule-qa">
            <CronScheduleInput
              label="QA Schedule"
              value={form.qa.schedule}
              onChange={(val) =>
                onFieldChange('qa', {
                  ...form.qa,
                  schedule: val,
                })
              }
            />
          </div>
          <div id="job-schedule-audit">
            <CronScheduleInput
              label="Audit Schedule"
              value={form.audit.schedule}
              onChange={(val) =>
                onFieldChange('audit', {
                  ...form.audit,
                  schedule: val,
                })
              }
            />
          </div>
          <div id="job-schedule-slicer">
            <CronScheduleInput
              label="Planner Schedule"
              value={form.roadmapScanner.slicerSchedule}
              onChange={(val) =>
                onFieldChange('roadmapScanner', {
                  ...form.roadmapScanner,
                  slicerSchedule: val,
                })
              }
            />
          </div>
          {form.analytics && (
            <div id="job-schedule-analytics">
              <CronScheduleInput
                label="Analytics Schedule"
                value={form.analytics.schedule}
                onChange={(val) =>
                  onFieldChange('analytics', {
                    ...form.analytics,
                    schedule: val,
                  })
                }
              />
            </div>
          )}
          {form.merger && (
            <div id="job-schedule-merger">
              <CronScheduleInput
                label="Merge Orchestrator Schedule"
                value={form.merger.schedule}
                onChange={(val) =>
                  onFieldChange('merger', {
                    ...form.merger,
                    schedule: val,
                  })
                }
              />
            </div>
          )}
        </div>
      )}

      <div className="pt-4 border-t border-slate-800 grid grid-cols-1 md:grid-cols-3 gap-6">
        <Select
          label="Scheduling Priority"
          value={String(form.schedulingPriority)}
          onChange={(val) => onFieldChange('schedulingPriority', Number(val))}
          options={[
            { label: '1 - Lowest', value: '1' },
            { label: '2 - Low', value: '2' },
            { label: '3 - Balanced', value: '3' },
            { label: '4 - High', value: '4' },
            { label: '5 - Highest', value: '5' },
          ]}
          helperText="Higher-priority projects get earlier balanced start slots and win queue tie-breakers first."
        />

        <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-medium text-slate-200">Global Queue</div>
              <p className="text-xs text-slate-400 mt-1">
                Queue overlapping jobs across projects instead of letting them burst the provider API.
              </p>
            </div>
            <Switch
              checked={form.globalQueueEnabled ?? true}
              onChange={(enabled) => onFieldChange('globalQueueEnabled', enabled)}
            />
          </div>
        </div>

        <Input
          label="Extra Start Delay"
          type="number"
          min="0"
          max="59"
          value={String(form.cronScheduleOffset)}
          onChange={(e) => {
            const val = Math.min(59, Math.max(0, Number(e.target.value || 0)));
            onFieldChange('cronScheduleOffset', val);
          }}
          helperText="Manual delay in minutes added before cron jobs start. This stacks on top of automatic balancing."
        />
      </div>
    </Card>
  );
};

export default ScheduleConfig;
