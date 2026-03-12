import { Plus } from 'lucide-react';
import React from 'react';
import { IJobProviders, IProviderPreset } from '../../api';
import ProviderEnvEditor from '../../components/providers/ProviderEnvEditor.js';
import PresetCard from '../../components/providers/PresetCard.js';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';
import Input from '../../components/ui/Input';
import Select from '../../components/ui/Select';

const BUILT_IN_PRESET_IDS = ['claude', 'claude-sonnet-4-6', 'claude-opus-4-6', 'codex', 'glm-47', 'glm-5'];

interface IConfigFormAiRuntime {
  provider: string;
  providerPresets: Record<string, IProviderPreset>;
  jobProviders: IJobProviders;
  primaryFallbackPreset: string;
  secondaryFallbackPreset: string;
  providerEnv: Record<string, string>;
  minReviewScore: number;
  maxRuntime: number;
  reviewerMaxRuntime: number;
  maxLogSize: number;
  reviewerMaxRetries: number;
  reviewerRetryDelay: number;
  reviewerMaxPrsPerRun: number;
}

interface IAiRuntimeTabProps {
  form: IConfigFormAiRuntime;
  updateField: <K extends keyof IConfigFormAiRuntime>(key: K, value: IConfigFormAiRuntime[K]) => void;
  jobProvidersChangedRef: React.MutableRefObject<boolean>;
  getAllPresets: () => Record<string, IProviderPreset>;
  getPresetOptions: (customPresets: Record<string, IProviderPreset>) => Array<{ label: string; value: string }>;
  handleEditPreset: (presetId: string) => void;
  handleDeletePreset: (presetId: string) => void;
  handleResetPreset: (presetId: string) => void;
  handleAddPreset: () => void;
}

const AiRuntimeTab: React.FC<IAiRuntimeTabProps> = ({
  form,
  updateField,
  jobProvidersChangedRef,
  getAllPresets,
  getPresetOptions,
  handleEditPreset,
  handleDeletePreset,
  handleResetPreset,
  handleAddPreset,
}) => {
  return (
    <div className="space-y-6">
      {/* Provider Presets Card */}
      <Card className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-medium text-slate-200">Provider Presets</h3>
            <p className="text-sm text-slate-400 mt-1">
              Configure AI provider presets with custom commands, models, and environment variables
            </p>
          </div>
          <Button onClick={handleAddPreset}>
            <Plus className="h-4 w-4 mr-2" />
            Add Provider
          </Button>
        </div>

        {/* Preset Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Built-in presets */}
          {BUILT_IN_PRESET_IDS.map((presetId) => {
            const allPresets = getAllPresets();
            const preset = allPresets[presetId];
            if (!preset) return null;

            return (
              <PresetCard
                key={presetId}
                presetId={presetId}
                preset={preset}
                isBuiltIn
                onEdit={() => handleEditPreset(presetId)}
                onReset={() => handleResetPreset(presetId)}
              />
            );
          })}

          {/* Custom presets */}
          {Object.entries(form.providerPresets)
            .filter(([id]) => !BUILT_IN_PRESET_IDS.includes(id))
            .map(([presetId, preset]) => (
              <PresetCard
                key={presetId}
                presetId={presetId}
                preset={preset}
                isBuiltIn={false}
                onEdit={() => handleEditPreset(presetId)}
                onDelete={() => handleDeletePreset(presetId)}
              />
            ))}
        </div>
      </Card>

      {/* Job Assignments Card */}
      <Card className="p-6 space-y-6">
        <div>
          <h3 className="text-lg font-medium text-slate-200">Job Assignments</h3>
          <p className="text-sm text-slate-400 mt-1">
            Assign provider presets to specific job types. Jobs without an assignment use the global provider.
          </p>
        </div>
        <div className="space-y-4">
          {/* Global Provider Selector */}
          <div className="flex items-center justify-between p-4 rounded-md border border-indigo-500/30 bg-indigo-500/5 gap-4">
            <div>
              <span className="text-sm font-medium text-slate-200">Global Provider</span>
              <p className="text-xs text-slate-500 mt-1">Default preset for all jobs without a specific assignment</p>
            </div>
            <div className="w-64">
              <Select
                value={form.provider}
                onChange={(val) => updateField('provider', val)}
                options={getPresetOptions(form.providerPresets)}
              />
            </div>
          </div>

          {/* Per-Job Provider Overrides */}
          {([
            { key: 'executor', label: 'Executor' },
            { key: 'reviewer', label: 'Reviewer' },
            { key: 'qa', label: 'QA' },
            { key: 'audit', label: 'Audit' },
            { key: 'slicer', label: 'Planner' },
          ] as const).map(({ key, label }) => (
            <div
              key={key}
              className="flex items-center justify-between p-3 rounded-md border border-slate-800 bg-slate-950/40 gap-4"
            >
              <span className="text-sm font-medium text-slate-200 whitespace-nowrap">{label}</span>
              <div className="w-64">
                <Select
                  value={form.jobProviders[key] ?? ''}
                  onChange={(val) => {
                    const newJobProviders = { ...form.jobProviders };
                    if (val === '') {
                      delete newJobProviders[key];
                    } else {
                      newJobProviders[key] = val;
                    }
                    jobProvidersChangedRef.current = true;
                    updateField('jobProviders', newJobProviders);
                  }}
                  options={[
                    { label: 'Use Global (default)', value: '' },
                    ...getPresetOptions(form.providerPresets),
                  ]}
                />
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Rate Limit Fallback Card */}
      <Card className="p-6 space-y-6">
        <div>
          <h3 className="text-lg font-medium text-slate-200">Rate Limit Fallback</h3>
          <p className="text-sm text-slate-400 mt-1">Preset to use when the active provider is rate-limited</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Select
            label="Primary Fallback Preset"
            value={form.primaryFallbackPreset}
            onChange={(val) => updateField('primaryFallbackPreset', val)}
            options={[
              { label: '— None —', value: '' },
              ...Object.entries(getAllPresets()).map(([id, preset]) => ({
                label: preset.name,
                value: id,
              })),
            ]}
            helperText="Preset to use as the primary rate-limit fallback"
          />
          <Select
            label="Secondary Fallback Preset"
            value={form.secondaryFallbackPreset}
            onChange={(val) => updateField('secondaryFallbackPreset', val)}
            options={[
              { label: '— None —', value: '' },
              ...Object.entries(getAllPresets()).map(([id, preset]) => ({
                label: preset.name,
                value: id,
              })),
            ]}
            helperText="Used only if the primary fallback preset is also rate-limited"
          />
        </div>
      </Card>

      {/* Provider Environment Variables Card */}
      <Card className="p-6">
        <h3 className="text-lg font-medium text-slate-200 mb-2">Global Provider Environment Variables</h3>
        <p className="text-sm text-slate-400 mb-4">
          Environment variables passed to all provider CLIs. Preset-level env vars take precedence.
        </p>
        <ProviderEnvEditor
          envVars={form.providerEnv}
          onChange={(envVars) => updateField('providerEnv', envVars)}
        />
      </Card>

      <Card className="p-6 space-y-6">
        <h3 className="text-lg font-medium text-slate-200">Performance</h3>
        <div>
          <label className="block text-sm font-medium text-slate-400 mb-2">Min Review Score (0-100)</label>
          <div className="flex items-center space-x-4">
            <input
              type="range"
              min="0"
              max="100"
              value={form.minReviewScore}
              onChange={(e) => updateField('minReviewScore', Number(e.target.value))}
              className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
            />
            <span className="text-sm font-bold text-slate-200 w-10">{form.minReviewScore}</span>
          </div>
          <p className="text-xs text-slate-500 mt-1">PRs below this score will be marked as &quot;Needs Work&quot;.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Input
            label="Max Runtime (Executor)"
            type="number"
            value={String(form.maxRuntime)}
            onChange={(e) => updateField('maxRuntime', Number(e.target.value || 0))}
            rightIcon={<span className="text-xs">sec</span>}
          />
          <Input
            label="Max Runtime (Reviewer)"
            type="number"
            value={String(form.reviewerMaxRuntime)}
            onChange={(e) => updateField('reviewerMaxRuntime', Number(e.target.value || 0))}
            rightIcon={<span className="text-xs">sec</span>}
          />
          <Input
            label="Max Log Size"
            type="number"
            value={String(form.maxLogSize)}
            onChange={(e) => updateField('maxLogSize', Number(e.target.value || 0))}
            rightIcon={<span className="text-xs">bytes</span>}
          />
        </div>
      </Card>

      <Card className="p-6 space-y-6">
        <div>
          <h3 className="text-lg font-medium text-slate-200">Retry Settings</h3>
          <p className="text-sm text-slate-400 mt-1">
            Configure automatic retry behavior for the PR reviewer when fixes do not fully resolve issues.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Input
            label="Max Retry Attempts"
            type="number"
            min="0"
            max="10"
            value={String(form.reviewerMaxRetries)}
            onChange={(e) => {
              const val = Math.min(10, Math.max(0, Number(e.target.value || 0)));
              updateField('reviewerMaxRetries', val);
            }}
            helperText="Additional fix attempts after initial review. 0 = no retries."
          />
          <Input
            label="Retry Delay (seconds)"
            type="number"
            min="0"
            max="300"
            value={String(form.reviewerRetryDelay)}
            onChange={(e) => {
              const val = Math.min(300, Math.max(0, Number(e.target.value || 0)));
              updateField('reviewerRetryDelay', val);
            }}
            helperText="Wait time between retry attempts to let CI settle."
          />
          <Input
            label="Max PRs Per Run"
            type="number"
            min="0"
            max="100"
            value={String(form.reviewerMaxPrsPerRun)}
            onChange={(e) => {
              const val = Math.min(100, Math.max(0, Number(e.target.value || 0)));
              updateField('reviewerMaxPrsPerRun', val);
            }}
            helperText="Hard cap on how many PRs the reviewer processes per run. 0 = unlimited."
          />
        </div>
      </Card>
    </div>
  );
};

export default AiRuntimeTab;
