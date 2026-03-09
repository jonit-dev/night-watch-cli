import { Check, Edit2, Eye, EyeOff, Plus, Trash2, X } from 'lucide-react';
import React from 'react';

import Button from '../ui/Button.js';

// Helper to check if a value looks sensitive
const isSensitiveKey = (key: string): boolean => {
  const sensitivePatterns = ['TOKEN', 'SECRET', 'KEY', 'PASSWORD', 'AUTH', 'API_KEY'];
  return sensitivePatterns.some((pattern) => key.toUpperCase().includes(pattern));
};

// Masked value display component
const MaskedValue: React.FC<{ value: string; isSensitive: boolean }> = ({ value, isSensitive }) => {
  const [show, setShow] = React.useState(false);

  if (!isSensitive) {
    return <span className="text-sm text-slate-300 font-mono truncate max-w-xs">{value}</span>;
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-slate-300 font-mono">
        {show ? value : '***********'}
      </span>
      <button
        type="button"
        onClick={() => setShow(!show)}
        className="text-slate-500 hover:text-slate-300"
        aria-label={show ? 'Hide sensitive value' : 'Show sensitive value'}
        title={show ? 'Hide sensitive value' : 'Show sensitive value'}
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
};

interface IProviderEnvEditorProps {
  envVars: Record<string, string>;
  onChange: (envVars: Record<string, string>) => void;
  /** Whether to show compact layout for use in modals */
  compact?: boolean;
}

const ProviderEnvEditor: React.FC<IProviderEnvEditorProps> = ({ envVars, onChange, compact = false }) => {
  const [newKey, setNewKey] = React.useState('');
  const [newValue, setNewValue] = React.useState('');
  const [editingKey, setEditingKey] = React.useState<string | null>(null);
  const [editingValue, setEditingValue] = React.useState('');

  const handleAdd = () => {
    if (!newKey.trim()) return;

    // Validate key format (uppercase, underscores, numbers)
    if (!/^[A-Z_][A-Z0-9_]*$/.test(newKey)) {
      alert('Key must be uppercase with underscores (e.g., API_KEY)');
      return;
    }

    onChange({
      ...envVars,
      [newKey]: newValue,
    });
    setNewKey('');
    setNewValue('');
  };

  const handleDelete = (key: string) => {
    const updated = { ...envVars };
    delete updated[key];
    onChange(updated);
  };

  const handleStartEdit = (key: string) => {
    setEditingKey(key);
    setEditingValue(envVars[key] ?? '');
  };

  const handleSaveEdit = () => {
    if (editingKey) {
      onChange({
        ...envVars,
        [editingKey]: editingValue,
      });
      setEditingKey(null);
      setEditingValue('');
    }
  };

  const handleCancelEdit = () => {
    setEditingKey(null);
    setEditingValue('');
  };

  const entries = Object.entries(envVars);

  return (
    <div className="space-y-4">
      {!compact && (
        <div className="text-sm text-slate-400 mb-4">
          Configure environment variables passed to the provider CLI (API keys, base URLs)
        </div>
      )}

      {/* Existing variables list */}
      <div className="space-y-2">
        {entries.length === 0 ? (
          <p className="text-slate-500 text-sm italic">No environment variables configured.</p>
        ) : (
          entries.map(([key, value]) => (
            <div
              key={key}
              className="flex items-center justify-between p-3 rounded-md border border-slate-800 bg-slate-950/40"
            >
              <div className="flex items-center gap-4 flex-1 min-w-0">
                <span className="text-sm font-mono text-indigo-400 w-48 truncate">{key}</span>
                {editingKey === key ? (
                  <div className="flex items-center gap-2 flex-1">
                    <input
                      type="text"
                      value={editingValue}
                      onChange={(e) => setEditingValue(e.target.value)}
                      className="flex-1 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm text-slate-200"
                    />
                    <button
                      type="button"
                      onClick={handleSaveEdit}
                      className="p-1 text-green-400 hover:text-green-300"
                      aria-label={`Save ${key} value`}
                      title={`Save ${key} value`}
                    >
                      <Check className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={handleCancelEdit}
                      className="p-1 text-slate-400 hover:text-slate-300"
                      aria-label={`Cancel editing ${key}`}
                      title={`Cancel editing ${key}`}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <MaskedValue value={value} isSensitive={isSensitiveKey(key)} />
                )}
              </div>
              {editingKey !== key && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleStartEdit(key)}
                    className="p-1 text-slate-400 hover:text-slate-200"
                    aria-label={`Edit ${key}`}
                    title={`Edit ${key}`}
                  >
                    <Edit2 className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(key)}
                    className="p-1 text-red-400 hover:text-red-300"
                    aria-label={`Delete ${key}`}
                    title={`Delete ${key}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Add new variable form */}
      <div className={`flex items-end gap-3 ${compact ? '' : 'pt-4 border-t border-slate-800'}`}>
        <div className="flex-1">
          {!compact && <label className="block text-xs font-medium text-slate-500 mb-1">Key</label>}
          <input
            type="text"
            value={newKey}
            onChange={(e) => setNewKey(e.target.value.toUpperCase())}
            placeholder={compact ? 'ENV_VAR_NAME' : 'e.g., ANTHROPIC_BASE_URL'}
            className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm text-slate-200 placeholder-slate-500"
          />
        </div>
        <div className="flex-1">
          {!compact && <label className="block text-xs font-medium text-slate-500 mb-1">Value</label>}
          <input
            type="text"
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            placeholder={compact ? 'value' : 'e.g., https://api.example.com'}
            className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm text-slate-200 placeholder-slate-500"
          />
        </div>
        <Button onClick={handleAdd} disabled={!newKey.trim()} size={compact ? 'sm' : 'md'}>
          <Plus className="h-4 w-4 mr-1" />
          Add
        </Button>
      </div>
    </div>
  );
};

export default ProviderEnvEditor;
