import React from 'react';
import { IAnalyticsConfig, IQaConfig, IAuditConfig, IRoadmapScannerConfig, QaArtifacts } from '../../api';
import TagInput from '../../components/settings/TagInput.js';
import Card from '../../components/ui/Card';
import CronScheduleInput from '../../components/ui/CronScheduleInput';
import Input from '../../components/ui/Input';
import Select from '../../components/ui/Select';
import Switch from '../../components/ui/Switch';

interface IConfigFormJobs {
  qa: IQaConfig;
  audit: IAuditConfig;
  analytics: IAnalyticsConfig;
  roadmapScanner: IRoadmapScannerConfig;
  providerEnv: Record<string, string>;
}

interface IJobsTabProps {
  form: IConfigFormJobs;
  updateField: <K extends keyof IConfigFormJobs>(key: K, value: IConfigFormJobs[K]) => void;
  handleRoadmapToggle: (enabled: boolean) => Promise<void>;
}

const JobsTab: React.FC<IJobsTabProps> = ({ form, updateField, handleRoadmapToggle }) => {
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
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <CronScheduleInput
                  label="QA Schedule"
                  value={form.qa.schedule}
                  onChange={(val) => updateField('qa', { ...form.qa, schedule: val })}
                />
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
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-slate-800">
              <CronScheduleInput
                label="Audit Schedule"
                value={form.audit.schedule}
                onChange={(val) => updateField('audit', { ...form.audit, schedule: val })}
              />
              <Input
                label="Max Runtime"
                type="number"
                value={String(form.audit.maxRuntime)}
                onChange={(e) => updateField('audit', { ...form.audit, maxRuntime: Number(e.target.value || 0) })}
                rightIcon={<span className="text-xs">sec</span>}
                helperText="Maximum runtime for audit tasks (default: 1800 seconds)"
              />
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
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-slate-800">
              <Input
                label="Amplitude API Key"
                value={form.providerEnv?.AMPLITUDE_API_KEY ?? ''}
                onChange={(e) =>
                  updateField('providerEnv', { ...form.providerEnv, AMPLITUDE_API_KEY: e.target.value })
                }
                placeholder="Required"
                helperText="Your Amplitude project API key"
              />
              <Input
                label="Amplitude Secret Key"
                type="password"
                value={form.providerEnv?.AMPLITUDE_SECRET_KEY ?? ''}
                onChange={(e) =>
                  updateField('providerEnv', { ...form.providerEnv, AMPLITUDE_SECRET_KEY: e.target.value })
                }
                placeholder="Required"
                helperText="Your Amplitude secret key"
              />
              <CronScheduleInput
                label="Analytics Schedule"
                value={form.analytics.schedule}
                onChange={(val) => updateField('analytics', { ...form.analytics, schedule: val })}
              />
              <Input
                label="Max Runtime"
                type="number"
                value={String(form.analytics.maxRuntime)}
                onChange={(e) =>
                  updateField('analytics', { ...form.analytics, maxRuntime: Number(e.target.value || 0) })
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
                  onChange={(e) => updateField('analytics', { ...form.analytics, analysisPrompt: e.target.value })}
                  placeholder="Custom prompt for AI analysis. Leave empty to use default."
                  className="w-full bg-slate-950/50 border border-white/10 text-slate-200 rounded-lg px-3 py-2.5 text-sm placeholder-slate-600 focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/20 resize-y"
                />
                <p className="mt-1.5 text-xs text-slate-500">
                  Custom prompt for AI analysis. Leave empty to use default.
                </p>
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
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-slate-800">
              <Input
                label="Roadmap File Path"
                value={form.roadmapScanner.roadmapPath}
                onChange={(e) =>
                  updateField('roadmapScanner', { ...form.roadmapScanner, roadmapPath: e.target.value })
                }
                helperText="Primary planning source (relative to project root)."
              />
              <CronScheduleInput
                label="Planner Schedule"
                value={form.roadmapScanner.slicerSchedule || '35 */12 * * *'}
                onChange={(val) =>
                  updateField('roadmapScanner', { ...form.roadmapScanner, slicerSchedule: val })
                }
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
          )}
        </Card>
      </div>
    </div>
  );
};

export default JobsTab;
