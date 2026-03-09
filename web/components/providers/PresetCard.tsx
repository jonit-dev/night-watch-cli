import { Edit2, RotateCcw, Trash2 } from 'lucide-react';
import React from 'react';

import type { IProviderPreset } from '../../api.js';
import Badge from '../ui/Badge.js';

interface IPresetCardProps {
  /** Unique preset ID (e.g., 'claude', 'codex', or custom ID) */
  presetId: string;
  /** The preset configuration */
  preset: IProviderPreset;
  /** Whether this is a built-in preset (cannot be deleted) */
  isBuiltIn: boolean;
  /** Handler for editing the preset */
  onEdit: () => void;
  /** Handler for deleting the preset (only for custom presets) */
  onDelete?: () => void;
  /** Handler for resetting a built-in preset to defaults */
  onReset?: () => void;
}

const PresetCard: React.FC<IPresetCardProps> = ({
  presetId,
  preset,
  isBuiltIn,
  onEdit,
  onDelete,
  onReset,
}) => {
  const envVarCount = preset.envVars ? Object.keys(preset.envVars).length : 0;

  return (
    <div className="flex flex-col p-4 rounded-lg border border-slate-800 bg-slate-950/40 hover:border-slate-700 transition-colors">
      {/* Header with name and badges */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <h4 className="text-sm font-medium text-slate-200">{preset.name}</h4>
          {isBuiltIn && (
            <Badge variant="info" className="text-[10px]">
              Built-in
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onEdit}
            className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded transition-colors"
            aria-label={`Edit ${preset.name} preset`}
            title="Edit preset"
          >
            <Edit2 className="h-4 w-4" />
          </button>
          {isBuiltIn ? (
            onReset && (
              <button
                type="button"
                onClick={onReset}
                className="p-1.5 text-slate-400 hover:text-indigo-400 hover:bg-slate-800 rounded transition-colors"
                aria-label={`Reset ${preset.name} to defaults`}
                title="Reset to defaults"
              >
                <RotateCcw className="h-4 w-4" />
              </button>
            )
          ) : (
            onDelete && (
              <button
                type="button"
                onClick={onDelete}
                className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-slate-800 rounded transition-colors"
                aria-label={`Delete ${preset.name} preset`}
                title="Delete preset"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )
          )}
        </div>
      </div>

      {/* Command pill */}
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs text-slate-500">Command:</span>
        <code className="px-2 py-0.5 bg-slate-800 rounded text-xs text-indigo-400 font-mono">
          {preset.command}
          {preset.subcommand && ` ${preset.subcommand}`}
        </code>
      </div>

      {/* Model badge (if configured) */}
      {preset.model && (
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs text-slate-500">Model:</span>
          <Badge variant="neutral" className="text-[10px] font-mono">
            {preset.model}
          </Badge>
        </div>
      )}

      {/* ID and env var count */}
      <div className="flex items-center gap-3 mt-auto pt-2 border-t border-slate-800/50">
        <span className="text-xs text-slate-600 font-mono">id: {presetId}</span>
        {envVarCount > 0 && (
          <span className="text-xs text-slate-500">
            {envVarCount} env var{envVarCount !== 1 ? 's' : ''}
          </span>
        )}
      </div>
    </div>
  );
};

export default PresetCard;
