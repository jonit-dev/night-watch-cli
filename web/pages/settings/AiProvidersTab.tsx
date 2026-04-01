import { Plus } from 'lucide-react';
import React from 'react';
import { IProviderPreset, IProviderScheduleOverride } from '../../api';
import ProviderEnvEditor from '../../components/providers/ProviderEnvEditor.js';
import PresetCard from '../../components/providers/PresetCard.js';
import ScheduleOverrideEditor from '../../components/providers/ScheduleOverrideEditor.js';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';
import Select from '../../components/ui/Select';
import { BUILT_IN_PRESET_IDS } from '../../constants/presets.js';

interface IConfigFormAiProviders {
  provider: string;
  providerPresets: Record<string, IProviderPreset>;
  primaryFallbackPreset: string;
  secondaryFallbackPreset: string;
  providerScheduleOverrides: IProviderScheduleOverride[];
  providerEnv: Record<string, string>;
}

interface IAiProvidersTabProps {
  form: IConfigFormAiProviders;
  updateField: <K extends keyof IConfigFormAiProviders>(key: K, value: IConfigFormAiProviders[K]) => void;
  getAllPresets: () => Record<string, IProviderPreset>;
  getPresetOptions: (customPresets: Record<string, IProviderPreset>) => Array<{ label: string; value: string }>;
  handleEditPreset: (presetId: string) => void;
  handleDeletePreset: (presetId: string) => void;
  handleResetPreset: (presetId: string) => void;
  handleAddPreset: () => void;
}

const AiProvidersTab: React.FC<IAiProvidersTabProps> = ({
  form,
  updateField,
  getAllPresets,
  getPresetOptions,
  handleEditPreset,
  handleDeletePreset,
  handleResetPreset,
  handleAddPreset,
}) => {
  return (
    <div className="space-y-6">
      {/* Global Provider Selector at the top */}
      <Card className="p-6 bg-slate-900/60 border-indigo-500/20">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h3 className="text-lg font-medium text-slate-100">Global AI Provider</h3>
            <p className="text-sm text-slate-400 mt-1">Default preset for all automation tasks</p>
          </div>
          <div className="w-full md:w-72">
             <Select
                value={form.provider}
                onChange={(val) => updateField('provider', val)}
                options={getPresetOptions(form.providerPresets)}
              />
          </div>
        </div>
      </Card>

      {/* Provider Presets Card */}
      <Card className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-medium text-slate-200">Available Presets</h3>
            <p className="text-sm text-slate-400 mt-1">
              Custom AI models and environment configurations
            </p>
          </div>
          <Button onClick={handleAddPreset} variant="primary" size="sm">
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
            .filter(([id]) => !(BUILT_IN_PRESET_IDS as readonly string[]).includes(id))
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

      {/* Rate Limit Fallback Card */}
      <Card className="p-6 space-y-6">
        <div>
          <h3 className="text-lg font-medium text-slate-200">Reliability & Fallbacks</h3>
          <p className="text-sm text-slate-400 mt-1">Configure automated fallback when a provider is rate-limited</p>
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
            helperText="Automatic switch when global provider is throttled"
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
          />
        </div>
      </Card>

      {/* Schedule Overrides Card */}
      <Card className="p-6 space-y-6">
        <div>
          <h3 className="text-lg font-medium text-slate-200">Scheduled Overrides</h3>
          <p className="text-sm text-slate-400 mt-1">
             Automatically switch providers based on the time of day (e.g. use cheaper models at night)
          </p>
        </div>
        <ScheduleOverrideEditor
          overrides={form.providerScheduleOverrides}
          onChange={(overrides) => updateField('providerScheduleOverrides', overrides)}
          presetOptions={Object.entries(getAllPresets()).map(([id, preset]) => ({
            label: preset.name,
            value: id,
          }))}
        />
      </Card>

      {/* Provider Environment Variables Card */}
      <Card className="p-6">
        <h3 className="text-lg font-medium text-slate-200 mb-2">Global Environment Variables</h3>
        <p className="text-sm text-slate-400 mb-4">
          Variables passed to all provider CLI executions
        </p>
        <ProviderEnvEditor
          envVars={form.providerEnv}
          onChange={(envVars) => updateField('providerEnv', envVars)}
        />
      </Card>
    </div>
  );
};

export default AiProvidersTab;
