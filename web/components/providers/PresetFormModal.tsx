import { ChevronDown, ChevronUp } from 'lucide-react';
import React from 'react';

import type { IProviderPreset } from '../../api.js';
import Button from '../ui/Button.js';
import Input from '../ui/Input.js';
import Modal from '../ui/Modal.js';
import Select from '../ui/Select.js';
import ProviderEnvEditor from './ProviderEnvEditor.js';

/** Built-in preset templates for quick setup */
const PRESET_TEMPLATES: Record<string, Partial<IProviderPreset>> = {
  claude: {
    name: 'Claude',
    command: 'claude',
    promptFlag: '-p',
    autoApproveFlag: '--dangerously-skip-permissions',
  },
  codex: {
    name: 'Codex',
    command: 'codex',
    subcommand: 'exec',
    autoApproveFlag: '--yolo',
    workdirFlag: '-C',
  },
  custom: {
    name: '',
    command: '',
  },
};

interface IPresetFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (presetId: string, preset: IProviderPreset) => void;
  /** Existing preset ID for editing (null for new preset) */
  presetId: string | null;
  /** Existing preset data for editing */
  preset: IProviderPreset | null;
  /** Whether this is a built-in preset being edited */
  isBuiltIn: boolean;
  /** List of existing preset IDs to prevent duplicates */
  existingIds: string[];
}

const PresetFormModal: React.FC<IPresetFormModalProps> = ({
  isOpen,
  onClose,
  onSave,
  presetId,
  preset,
  isBuiltIn,
  existingIds,
}) => {
  const [formId, setFormId] = React.useState('');
  const [formData, setFormData] = React.useState<IProviderPreset>({
    name: '',
    command: '',
    subcommand: '',
    promptFlag: '',
    autoApproveFlag: '',
    workdirFlag: '',
    modelFlag: '',
    model: '',
    envVars: {},
  });
  const [showAdvanced, setShowAdvanced] = React.useState(false);
  const [selectedTemplate, setSelectedTemplate] = React.useState<string>('custom');
  const [error, setError] = React.useState<string | null>(null);

  // Initialize form when modal opens with preset data
  React.useEffect(() => {
    if (isOpen) {
      if (presetId && preset) {
        setFormId(presetId);
        setFormData({
          name: preset.name,
          command: preset.command,
          subcommand: preset.subcommand ?? '',
          promptFlag: preset.promptFlag ?? '',
          autoApproveFlag: preset.autoApproveFlag ?? '',
          workdirFlag: preset.workdirFlag ?? '',
          modelFlag: preset.modelFlag ?? '',
          model: preset.model ?? '',
          envVars: preset.envVars ?? {},
        });
        // Determine which template matches (if any)
        if (presetId === 'claude' || preset.command === 'claude') {
          setSelectedTemplate('claude');
        } else if (presetId === 'codex' || preset.command === 'codex') {
          setSelectedTemplate('codex');
        } else {
          setSelectedTemplate('custom');
        }
      } else {
        // New preset - reset to empty
        setFormId('');
        setFormData({
          name: '',
          command: '',
          subcommand: '',
          promptFlag: '',
          autoApproveFlag: '',
          workdirFlag: '',
          modelFlag: '',
          model: '',
          envVars: {},
        });
        setSelectedTemplate('custom');
      }
      setError(null);
      setShowAdvanced(false);
    }
  }, [isOpen, presetId, preset]);

  // Apply template when selected
  const handleTemplateChange = (templateId: string) => {
    setSelectedTemplate(templateId);
    if (templateId !== 'custom' && PRESET_TEMPLATES[templateId]) {
      const template = PRESET_TEMPLATES[templateId];
      setFormData((prev) => ({
        ...prev,
        ...template,
        envVars: prev.envVars, // Preserve any env vars
      }));
      // Auto-fill ID if this is a new preset
      if (!presetId && !formId) {
        setFormId(templateId);
      }
    }
  };

  const updateField = <K extends keyof IProviderPreset>(key: K, value: IProviderPreset[K]) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
    setError(null);
  };

  const validate = (): boolean => {
    if (!formData.name.trim()) {
      setError('Name is required');
      return false;
    }
    if (!formData.command.trim()) {
      setError('Command is required');
      return false;
    }
    // For new presets, validate ID
    if (!presetId) {
      if (!formId.trim()) {
        setError('Preset ID is required');
        return false;
      }
      if (!/^[a-z0-9_-]+$/.test(formId)) {
        setError('Preset ID must be lowercase letters, numbers, hyphens, and underscores only');
        return false;
      }
      if (existingIds.includes(formId)) {
        setError('A preset with this ID already exists');
        return false;
      }
    }
    return true;
  };

  const handleSave = () => {
    if (!validate()) return;

    // Clean up empty optional fields
    const cleanedPreset: IProviderPreset = {
      name: formData.name.trim(),
      command: formData.command.trim(),
    };

    // Only include optional fields if they have values
    if (formData.subcommand?.trim()) cleanedPreset.subcommand = formData.subcommand.trim();
    if (formData.promptFlag?.trim()) cleanedPreset.promptFlag = formData.promptFlag.trim();
    if (formData.autoApproveFlag?.trim()) cleanedPreset.autoApproveFlag = formData.autoApproveFlag.trim();
    if (formData.workdirFlag?.trim()) cleanedPreset.workdirFlag = formData.workdirFlag.trim();
    if (formData.modelFlag?.trim()) cleanedPreset.modelFlag = formData.modelFlag.trim();
    if (formData.model?.trim()) cleanedPreset.model = formData.model.trim();
    if (formData.envVars && Object.keys(formData.envVars).length > 0) {
      cleanedPreset.envVars = formData.envVars;
    }

    onSave(presetId || formId, cleanedPreset);
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={presetId ? `Edit Preset: ${preset?.name}` : 'Add Provider Preset'}
    >
      <div className="space-y-6">
        {error && (
          <div className="p-3 rounded-md bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
            {error}
          </div>
        )}

        {/* Template selector for new presets */}
        {!isBuiltIn && (
          <div>
            <Select
              label="Template"
              value={selectedTemplate}
              onChange={handleTemplateChange}
              options={[
                { label: 'Start from scratch', value: 'custom' },
                { label: 'Claude (Anthropic)', value: 'claude' },
                { label: 'Codex (OpenAI)', value: 'codex' },
              ]}
              helperText="Start with a pre-configured template or customize from scratch"
            />
          </div>
        )}

        {/* Preset ID (only for new presets) */}
        {!presetId && (
          <Input
            label="Preset ID"
            value={formId}
            onChange={(e) => setFormId(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))}
            placeholder="e.g., my-custom-provider"
            helperText="Unique identifier for this preset (lowercase, numbers, hyphens, underscores)"
          />
        )}

        {/* Basic fields */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Input
            label="Display Name"
            value={formData.name}
            onChange={(e) => updateField('name', e.target.value)}
            placeholder="e.g., My Custom Provider"
            required
          />
          <Input
            label="Command"
            value={formData.command}
            onChange={(e) => updateField('command', e.target.value)}
            placeholder="e.g., claude, codex, npx"
            required
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Input
            label="Model"
            value={formData.model ?? ''}
            onChange={(e) => updateField('model', e.target.value)}
            placeholder="e.g., claude-opus-4-6"
            helperText="Default model to use"
          />
          <Input
            label="Model Flag"
            value={formData.modelFlag ?? ''}
            onChange={(e) => updateField('modelFlag', e.target.value)}
            placeholder="e.g., --model"
            helperText="Flag for specifying the model"
          />
        </div>

        {/* Advanced section */}
        <div className="border-t border-slate-800 pt-4">
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-2 text-sm text-slate-400 hover:text-slate-200 transition-colors"
          >
            {showAdvanced ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            Advanced Options
          </button>

          {showAdvanced && (
            <div className="mt-4 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Input
                  label="Subcommand"
                  value={formData.subcommand ?? ''}
                  onChange={(e) => updateField('subcommand', e.target.value)}
                  placeholder="e.g., exec"
                  helperText="Subcommand after base command"
                />
                <Input
                  label="Prompt Flag"
                  value={formData.promptFlag ?? ''}
                  onChange={(e) => updateField('promptFlag', e.target.value)}
                  placeholder="e.g., -p"
                  helperText="Flag for passing the prompt"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Input
                  label="Auto-Approve Flag"
                  value={formData.autoApproveFlag ?? ''}
                  onChange={(e) => updateField('autoApproveFlag', e.target.value)}
                  placeholder="e.g., --dangerously-skip-permissions"
                  helperText="Flag to enable auto-approve mode"
                />
                <Input
                  label="Workdir Flag"
                  value={formData.workdirFlag ?? ''}
                  onChange={(e) => updateField('workdirFlag', e.target.value)}
                  placeholder="e.g., -C"
                  helperText="Flag for setting working directory"
                />
              </div>

              {/* Environment Variables */}
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-2">
                  Environment Variables
                </label>
                <ProviderEnvEditor
                  envVars={formData.envVars ?? {}}
                  onChange={(envVars) => updateField('envVars', envVars)}
                  compact
                />
              </div>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-4 border-t border-slate-800">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave}>
            {presetId ? 'Save Changes' : 'Add Preset'}
          </Button>
        </div>
      </div>
    </Modal>
  );
};

export default PresetFormModal;
