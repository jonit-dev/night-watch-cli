import { Activity } from 'lucide-react';
import React from 'react';
import { DoctorCheck, MergeMethod } from '../../api';
import TagInput from '../../components/settings/TagInput.js';
import Card from '../../components/ui/Card';
import Input from '../../components/ui/Input';
import Select from '../../components/ui/Select';
import Switch from '../../components/ui/Switch';

interface IConfigFormGeneral {
  defaultBranch: string;
  prdDir: string;
  branchPrefix: string;
  branchPatterns: string[];
  executorEnabled: boolean;
  reviewerEnabled: boolean;
  autoMerge: boolean;
  autoMergeMethod: MergeMethod;
}

interface IGeneralTabProps {
  form: IConfigFormGeneral;
  updateField: <K extends keyof IConfigFormGeneral>(key: K, value: IConfigFormGeneral[K]) => void;
  projectName: string;
  doctorChecks: DoctorCheck[];
  doctorLoading: boolean;
}

const GeneralTab: React.FC<IGeneralTabProps> = ({ form, updateField, projectName, doctorChecks, doctorLoading }) => {
  return (
    <div className="space-y-6">
      <Card className="p-6 space-y-6">
        <div>
          <h3 className="text-lg font-medium text-slate-200">Project Configuration</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
            <Input label="Project Name" value={projectName} disabled />
            <Input
              label="Default Branch"
              value={form.defaultBranch}
              onChange={(e) => updateField('defaultBranch', e.target.value)}
            />
            <Input
              label="PRD Directory"
              value={form.prdDir}
              onChange={(e) => updateField('prdDir', e.target.value)}
              helperText="Directory containing PRD files (relative to project root)"
            />
            <Input
              label="Branch Prefix"
              value={form.branchPrefix}
              onChange={(e) => updateField('branchPrefix', e.target.value)}
            />
            <div className="md:col-span-2">
              <Switch
                label="Enable PRD Executor"
                checked={form.executorEnabled}
                onChange={(checked) => updateField('executorEnabled', checked)}
              />
            </div>
            <div className="md:col-span-2">
              <Switch
                label="Enable Automated Reviews"
                checked={form.reviewerEnabled}
                onChange={(checked) => updateField('reviewerEnabled', checked)}
              />
            </div>
            <div className="md:col-span-2">
              <Switch
                label="Auto-merge approved PRs"
                checked={form.autoMerge}
                onChange={(checked) => updateField('autoMerge', checked)}
              />
            </div>
            {form.autoMerge && (
              <Select
                label="Merge Method"
                value={form.autoMergeMethod}
                onChange={(val) => updateField('autoMergeMethod', val as MergeMethod)}
                options={[
                  { label: 'Squash', value: 'squash' },
                  { label: 'Merge', value: 'merge' },
                  { label: 'Rebase', value: 'rebase' },
                ]}
              />
            )}
          </div>
          <div className="pt-4 mt-4 border-t border-slate-800">
            <TagInput
              label="Branch Patterns"
              value={form.branchPatterns}
              onChange={(patterns) => updateField('branchPatterns', patterns)}
              placeholder="e.g., feat/"
              helpText="Branch patterns matched by reviewer and related automation jobs"
            />
          </div>
        </div>
      </Card>

      <Card className="divide-y divide-slate-800">
        <div className="p-4 flex items-center gap-2">
          <Activity className="h-4 w-4 text-indigo-500" />
          <h3 className="text-base font-medium text-slate-200">System Health</h3>
        </div>
        {doctorLoading ? (
          <div className="p-4 text-sm text-slate-500">Loading health checks...</div>
        ) : (
          doctorChecks.map((check, idx) => {
            const isPass = check.status === 'pass';
            const isWarn = check.status === 'warn';
            const statusClass = isPass
              ? 'bg-green-500/10 text-green-400 border-green-500/20'
              : isWarn
                ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                : 'bg-red-500/10 text-red-400 border-red-500/20';
            return (
              <div key={`${check.name}-${idx}`} className="p-4 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-200">{check.name}</p>
                  <p className="text-xs text-slate-500">{check.detail}</p>
                </div>
                <span
                  className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${statusClass}`}
                >
                  {check.status.toUpperCase()}
                </span>
              </div>
            );
          })
        )}
      </Card>
    </div>
  );
};

export default GeneralTab;
