import React from 'react';
import { Save, RotateCcw, Activity, AlertCircle, Plus, Trash2, Eye, EyeOff, Edit2, X, Check } from 'lucide-react';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import Input from '../components/ui/Input';
import Select from '../components/ui/Select';
import Tabs from '../components/ui/Tabs';
import Switch from '../components/ui/Switch';
import { useStore } from '../store/useStore';
import {
  fetchConfig,
  fetchDoctor,
  INightWatchConfig,
  INotificationConfig,
  IWebhookConfig,
  IRoadmapScannerConfig,
  updateConfig,
  useApi,
  toggleRoadmapScanner,
} from '../api';

type ConfigForm = {
  provider: INightWatchConfig['provider'];
  defaultBranch: string;
  branchPrefix: string;
  branchPatterns: string[];
  reviewerEnabled: boolean;
  minReviewScore: number;
  maxRuntime: number;
  reviewerMaxRuntime: number;
  maxLogSize: number;
  cronScheduleOffset: number;
  maxRetries: number;
  providerEnv: Record<string, string>;
  notifications: INotificationConfig;
  prdPriority: string[];
  roadmapScanner: IRoadmapScannerConfig;
  templatesDir: string;
};

const toFormState = (config: INightWatchConfig): ConfigForm => ({
  provider: config.provider,
  defaultBranch: config.defaultBranch,
  branchPrefix: config.branchPrefix,
  branchPatterns: config.branchPatterns || [],
  reviewerEnabled: config.reviewerEnabled,
  minReviewScore: config.minReviewScore,
  maxRuntime: config.maxRuntime,
  reviewerMaxRuntime: config.reviewerMaxRuntime,
  maxLogSize: config.maxLogSize,
  cronScheduleOffset: config.cronScheduleOffset ?? 0,
  maxRetries: config.maxRetries ?? 3,
  providerEnv: config.providerEnv || {},
  notifications: config.notifications || { webhooks: [] },
  prdPriority: config.prdPriority || [],
  roadmapScanner: config.roadmapScanner || {
    enabled: false,
    roadmapPath: 'ROADMAP.md',
    autoScanInterval: 300,
  },
  templatesDir: config.templatesDir || '.night-watch/templates',
});

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
        {show ? value : '••••••••••••'}
      </span>
      <button
        type="button"
        onClick={() => setShow(!show)}
        className="text-slate-500 hover:text-slate-300"
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
};

// Provider Env Editor Component
const ProviderEnvEditor: React.FC<{
  envVars: Record<string, string>;
  onChange: (envVars: Record<string, string>) => void;
}> = ({ envVars, onChange }) => {
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
    setEditingValue(envVars[key]);
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
      <div className="text-sm text-slate-400 mb-4">
        Configure environment variables passed to the provider CLI (API keys, base URLs)
      </div>

      {/* Existing variables list */}
      <div className="space-y-2">
        {entries.length === 0 ? (
          <p className="text-slate-500 text-sm italic">No provider environment variables configured.</p>
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
                    >
                      <Check className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={handleCancelEdit}
                      className="p-1 text-slate-400 hover:text-slate-300"
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
                  >
                    <Edit2 className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(key)}
                    className="p-1 text-red-400 hover:text-red-300"
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
      <div className="flex items-end gap-3 pt-4 border-t border-slate-800">
        <div className="flex-1">
          <label className="block text-xs font-medium text-slate-500 mb-1">Key</label>
          <input
            type="text"
            value={newKey}
            onChange={(e) => setNewKey(e.target.value.toUpperCase())}
            placeholder="e.g., ANTHROPIC_BASE_URL"
            className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm text-slate-200 placeholder-slate-500"
          />
        </div>
        <div className="flex-1">
          <label className="block text-xs font-medium text-slate-500 mb-1">Value</label>
          <input
            type="text"
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            placeholder="e.g., https://api.example.com"
            className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm text-slate-200 placeholder-slate-500"
          />
        </div>
        <Button onClick={handleAdd} disabled={!newKey.trim()}>
          <Plus className="h-4 w-4 mr-1" />
          Add
        </Button>
      </div>
    </div>
  );
};

// Webhook Editor Component
const WebhookEditor: React.FC<{
  notifications: INotificationConfig;
  onChange: (notifications: INotificationConfig) => void;
}> = ({ notifications, onChange }) => {
  const [editingIndex, setEditingIndex] = React.useState<number | null>(null);
  const [showAddForm, setShowAddForm] = React.useState(false);
  const [newWebhook, setNewWebhook] = React.useState<IWebhookConfig>({
    type: 'slack',
    url: '',
    events: [],
  });

  const eventOptions: { label: string; value: IWebhookConfig['events'][0] }[] = [
    { label: 'Run Started', value: 'run_started' },
    { label: 'Run Succeeded', value: 'run_succeeded' },
    { label: 'Run Failed', value: 'run_failed' },
    { label: 'Run Timeout', value: 'run_timeout' },
    { label: 'Review Completed', value: 'review_completed' },
    { label: 'PR Auto-Merged', value: 'pr_auto_merged' },
    { label: 'Rate Limit Fallback', value: 'rate_limit_fallback' },
    { label: 'QA Completed', value: 'qa_completed' },
  ];

  const handleAddWebhook = () => {
    onChange({
      webhooks: [...notifications.webhooks, newWebhook],
    });
    setNewWebhook({ type: 'slack', url: '', events: [] });
    setShowAddForm(false);
  };

  const handleUpdateWebhook = (index: number, webhook: IWebhookConfig) => {
    const updated = [...notifications.webhooks];
    updated[index] = webhook;
    onChange({ webhooks: updated });
  };

  const handleDeleteWebhook = (index: number) => {
    onChange({
      webhooks: notifications.webhooks.filter((_, i) => i !== index),
    });
  };

  const toggleEvent = (events: IWebhookConfig['events'], event: IWebhookConfig['events'][0]) => {
    return events.includes(event) ? events.filter((e) => e !== event) : [...events, event];
  };

  const WebhookForm: React.FC<{
    webhook: IWebhookConfig;
    onChange: (wh: IWebhookConfig) => void;
    onSave: () => void;
    onCancel: () => void;
    isNew?: boolean;
  }> = ({ webhook, onChange, onSave, onCancel, isNew }) => (
    <div className="p-4 rounded-md border border-slate-700 bg-slate-900/50 space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Select
          label="Type"
          value={webhook.type}
          onChange={(val) => {
            const newType = val as IWebhookConfig['type'];
            // Reset type-specific fields when changing type
            if (newType === 'telegram') {
              onChange({ type: newType, botToken: '', chatId: '', events: webhook.events });
            } else {
              onChange({ type: newType, url: '', events: webhook.events });
            }
          }}
          options={[
            { label: 'Slack', value: 'slack' },
            { label: 'Discord', value: 'discord' },
            { label: 'Telegram', value: 'telegram' },
          ]}
        />

        {webhook.type === 'telegram' ? (
          <>
            <div className="relative">
              <Input
                label="Bot Token"
                type="password"
                value={webhook.botToken || ''}
                onChange={(e) => onChange({ ...webhook, botToken: e.target.value })}
                placeholder="123456789:ABCdefGHIjklMNOpqrsTUVwxyz"
              />
            </div>
            <Input
              label="Chat ID"
              value={webhook.chatId || ''}
              onChange={(e) => onChange({ ...webhook, chatId: e.target.value })}
              placeholder="123456789"
            />
          </>
        ) : (
          <div className="md:col-span-2">
            <Input
              label="Webhook URL"
              type="password"
              value={webhook.url || ''}
              onChange={(e) => onChange({ ...webhook, url: e.target.value })}
              placeholder="https://hooks.slack.com/services/..."
            />
          </div>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-400 mb-2">Events</label>
        <div className="flex flex-wrap gap-2">
          {eventOptions.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange({ ...webhook, events: toggleEvent(webhook.events, opt.value) })}
              className={`px-3 py-1.5 rounded-md text-sm transition-colors ${
                webhook.events.includes(opt.value)
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          onClick={onSave}
          disabled={
            webhook.events.length === 0 ||
            (webhook.type === 'telegram'
              ? !webhook.botToken || !webhook.chatId
              : !webhook.url)
          }
        >
          {isNew ? 'Add Webhook' : 'Save Changes'}
        </Button>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="text-sm text-slate-400 mb-4">
        Receive notifications when events occur via Slack, Discord, or Telegram
      </div>

      {/* Existing webhooks list */}
      <div className="space-y-3">
        {notifications.webhooks.length === 0 ? (
          <p className="text-slate-500 text-sm italic">No webhooks configured.</p>
        ) : (
          notifications.webhooks.map((webhook, index) => (
            <div key={index}>
              {editingIndex === index ? (
                <WebhookForm
                  webhook={webhook}
                  onChange={(wh) => handleUpdateWebhook(index, wh)}
                  onSave={() => setEditingIndex(null)}
                  onCancel={() => setEditingIndex(null)}
                />
              ) : (
                <div className="flex items-center justify-between p-4 rounded-md border border-slate-800 bg-slate-950/40">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-medium text-slate-200 capitalize">{webhook.type}</span>
                      {webhook.type === 'telegram' && (
                        <span className="text-xs text-slate-500">Chat ID: {webhook.chatId}</span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {webhook.events.map((event) => (
                        <span
                          key={event}
                          className="px-2 py-0.5 bg-slate-800 rounded text-xs text-slate-400"
                        >
                          {event.replace('_', ' ')}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setEditingIndex(index)}
                      className="p-2 text-slate-400 hover:text-slate-200"
                    >
                      <Edit2 className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteWebhook(index)}
                      className="p-2 text-red-400 hover:text-red-300"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Add new webhook form */}
      {showAddForm ? (
        <WebhookForm
          webhook={newWebhook}
          onChange={setNewWebhook}
          onSave={handleAddWebhook}
          onCancel={() => setShowAddForm(false)}
          isNew
        />
      ) : (
        <Button variant="ghost" onClick={() => setShowAddForm(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Add Webhook
        </Button>
      )}
    </div>
  );
};

// Tag Input Component for arrays
const TagInput: React.FC<{
  label: string;
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  helpText?: string;
}> = ({ label, value, onChange, placeholder, helpText }) => {
  const [input, setInput] = React.useState('');

  const handleAdd = () => {
    if (input.trim() && !value.includes(input.trim())) {
      onChange([...value, input.trim()]);
      setInput('');
    }
  };

  const handleRemove = (tag: string) => {
    onChange(value.filter((t) => t !== tag));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAdd();
    }
  };

  return (
    <div>
      <label className="block text-sm font-medium text-slate-400 mb-2">{label}</label>
      <div className="flex flex-wrap gap-2 mb-2">
        {value.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 px-2 py-1 bg-slate-800 rounded text-sm text-slate-300"
          >
            {tag}
            <button
              type="button"
              onClick={() => handleRemove(tag)}
              className="text-slate-500 hover:text-red-400"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="flex-1 bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm text-slate-200 placeholder-slate-500"
        />
        <Button onClick={handleAdd} disabled={!input.trim()}>
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      {helpText && <p className="text-xs text-slate-500 mt-1">{helpText}</p>}
    </div>
  );
};

const Settings: React.FC = () => {
  const { addToast, projectName, selectedProjectId, globalModeLoading } = useStore();
  const [saving, setSaving] = React.useState(false);
  const [form, setForm] = React.useState<ConfigForm | null>(null);

  const {
    data: config,
    loading: configLoading,
    error: configError,
    refetch: refetchConfig,
  } = useApi(fetchConfig, [selectedProjectId], { enabled: !globalModeLoading });
  const { data: doctorChecksData, loading: doctorLoading, refetch: refetchDoctor } = useApi(fetchDoctor, [selectedProjectId], { enabled: !globalModeLoading });
  const doctorChecks = doctorChecksData ?? [];

  React.useEffect(() => {
    if (config) {
      setForm(toFormState(config));
    }
  }, [config]);

  const updateField = <K extends keyof ConfigForm>(key: K, value: ConfigForm[K]) => {
    setForm((prev) => {
      if (!prev) {
        return prev;
      }
      return { ...prev, [key]: value };
    });
  };

  const handleSave = async () => {
    if (!form) {
      return;
    }

    setSaving(true);
    try {
      await updateConfig({
        provider: form.provider,
        defaultBranch: form.defaultBranch,
        branchPrefix: form.branchPrefix,
        branchPatterns: form.branchPatterns,
        reviewerEnabled: form.reviewerEnabled,
        minReviewScore: form.minReviewScore,
        maxRuntime: form.maxRuntime,
        reviewerMaxRuntime: form.reviewerMaxRuntime,
        maxLogSize: form.maxLogSize,
        cronScheduleOffset: form.cronScheduleOffset,
        maxRetries: form.maxRetries,
        providerEnv: form.providerEnv,
        notifications: form.notifications,
        prdPriority: form.prdPriority,
        roadmapScanner: form.roadmapScanner,
        templatesDir: form.templatesDir,
      });

      addToast({
        title: 'Settings Saved',
        message: 'Configuration updated successfully.',
        type: 'success',
      });

      refetchConfig();
      refetchDoctor();
    } catch (saveError) {
      addToast({
        title: 'Save Failed',
        message: saveError instanceof Error ? saveError.message : 'Failed to save configuration',
        type: 'error',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    if (config) {
      setForm(toFormState(config));
      addToast({
        title: 'Reset Complete',
        message: 'Unsaved changes were discarded.',
        type: 'info',
      });
    }
  };

  const handleRoadmapToggle = async (enabled: boolean) => {
    try {
      const updatedConfig = await toggleRoadmapScanner(enabled);
      updateField('roadmapScanner', updatedConfig.roadmapScanner);
      addToast({
        title: enabled ? 'Roadmap Scanner Enabled' : 'Roadmap Scanner Disabled',
        message: `Roadmap scanner has been ${enabled ? 'enabled' : 'disabled'}.`,
        type: 'success',
      });
    } catch (err) {
      addToast({
        title: 'Toggle Failed',
        message: err instanceof Error ? err.message : 'Failed to toggle roadmap scanner',
        type: 'error',
      });
    }
  };

  if (configLoading || !form) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-slate-400">Loading settings...</div>
      </div>
    );
  }

  if (configError) {
    return (
      <div className="flex flex-col items-center justify-center h-full space-y-4">
        <AlertCircle className="h-12 w-12 text-red-400" />
        <div className="text-slate-300">Failed to load settings</div>
        <div className="text-sm text-slate-500">{configError.message}</div>
        <Button onClick={() => refetchConfig()}>Retry</Button>
      </div>
    );
  }

  const tabs = [
    {
      id: 'general',
      label: 'General',
      content: (
        <Card className="p-6 space-y-4">
          <h3 className="text-lg font-medium text-slate-200">Project Configuration</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Input label="Project Name" value={projectName} disabled />
            <Select
              label="Provider"
              value={form.provider}
              onChange={(val) => updateField('provider', val as ConfigForm['provider'])}
              options={[
                { label: 'Anthropic (Claude)', value: 'claude' },
                { label: 'OpenAI (Codex)', value: 'codex' },
              ]}
            />
            <Input label="Default Branch" value={form.defaultBranch} onChange={(e) => updateField('defaultBranch', e.target.value)} />
            <Input label="Branch Prefix" value={form.branchPrefix} onChange={(e) => updateField('branchPrefix', e.target.value)} />
            <div className="md:col-span-2">
              <Switch
                label="Enable Automated Reviews"
                checked={form.reviewerEnabled}
                onChange={(checked) => updateField('reviewerEnabled', checked)}
              />
            </div>
          </div>
        </Card>
      ),
    },
    {
      id: 'runtime',
      label: 'Runtime',
      content: (
        <Card className="p-6 space-y-6">
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
            <p className="text-xs text-slate-500 mt-1">PRs below this score will be marked as "Needs Work".</p>
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
      ),
    },
    {
      id: 'env',
      label: 'Provider Env',
      content: (
        <Card className="p-6">
          <h3 className="text-lg font-medium text-slate-200 mb-2">Provider Environment Variables</h3>
          <ProviderEnvEditor
            envVars={form.providerEnv}
            onChange={(envVars) => updateField('providerEnv', envVars)}
          />
        </Card>
      ),
    },
    {
      id: 'notifications',
      label: 'Notifications',
      content: (
        <Card className="p-6">
          <h3 className="text-lg font-medium text-slate-200 mb-2">Notification Webhooks</h3>
          <WebhookEditor
            notifications={form.notifications}
            onChange={(notifications) => updateField('notifications', notifications)}
          />
        </Card>
      ),
    },
    {
      id: 'roadmap',
      label: 'Roadmap',
      content: (
        <Card className="p-6 space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-medium text-slate-200">Roadmap Scanner</h3>
              <p className="text-sm text-slate-400">
                Automatically scan ROADMAP.md and generate PRDs for unchecked items
              </p>
            </div>
            <Switch
              checked={form.roadmapScanner.enabled}
              onChange={handleRoadmapToggle}
            />
          </div>

          {form.roadmapScanner.enabled && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-slate-800">
              <Input
                label="Roadmap Path"
                value={form.roadmapScanner.roadmapPath}
                onChange={(e) =>
                  updateField('roadmapScanner', {
                    ...form.roadmapScanner,
                    roadmapPath: e.target.value,
                  })
                }
              />
              <Input
                label="Auto Scan Interval"
                type="number"
                value={String(form.roadmapScanner.autoScanInterval)}
                onChange={(e) =>
                  updateField('roadmapScanner', {
                    ...form.roadmapScanner,
                    autoScanInterval: Math.max(30, Number(e.target.value || 30)),
                  })
                }
                rightIcon={<span className="text-xs">sec (min 30)</span>}
              />
            </div>
          )}
        </Card>
      ),
    },
    {
      id: 'advanced',
      label: 'Advanced',
      content: (
        <Card className="p-6 space-y-6">
          <h3 className="text-lg font-medium text-slate-200">Advanced Settings</h3>
          <p className="text-sm text-slate-400">
            Less commonly used configuration options
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Input
              label="Templates Directory"
              value={form.templatesDir}
              onChange={(e) => updateField('templatesDir', e.target.value)}
              helperText="Directory for custom template overrides"
            />
            <Input
              label="Cron Schedule Offset"
              type="number"
              min="0"
              max="59"
              value={String(form.cronScheduleOffset)}
              onChange={(e) => {
                const val = Math.min(59, Math.max(0, Number(e.target.value || 0)));
                updateField('cronScheduleOffset', val);
              }}
              helperText="Minutes offset (0-59) for cron schedules"
            />
            <Input
              label="Max Retries"
              type="number"
              min="1"
              value={String(form.maxRetries)}
              onChange={(e) => {
                const val = Math.max(1, Number(e.target.value || 1));
                updateField('maxRetries', val);
              }}
              helperText="Retry attempts for rate-limited API calls"
            />
          </div>

          <div className="pt-4 border-t border-slate-800 space-y-4">
            <TagInput
              label="Branch Patterns"
              value={form.branchPatterns}
              onChange={(patterns) => updateField('branchPatterns', patterns)}
              placeholder="e.g., feat/"
              helpText="Patterns to match for PR reviews"
            />

            <TagInput
              label="PRD Priority"
              value={form.prdPriority}
              onChange={(priority) => updateField('prdPriority', priority)}
              placeholder="e.g., feature-x"
              helpText="PRDs matching these names are executed first"
            />
          </div>
        </Card>
      ),
    },
  ];

  return (
    <div className="max-w-4xl mx-auto pb-10">
      <h2 className="text-2xl font-bold text-slate-100 mb-6">Settings</h2>

      <Tabs tabs={tabs} />

      <div className="flex items-center justify-end space-x-4 pt-6 mt-6 border-t border-slate-800">
        <Button variant="ghost" className="text-slate-400 hover:text-slate-300" onClick={handleReset}>
          <RotateCcw className="h-4 w-4 mr-2" />
          Reset
        </Button>
        <Button onClick={handleSave} loading={saving}>
          <Save className="h-4 w-4 mr-2" />
          Save Changes
        </Button>
      </div>

      <div className="mt-12">
        <h3 className="text-lg font-bold text-slate-200 mb-4 flex items-center">
          <Activity className="h-5 w-5 mr-2 text-indigo-500" />
          System Health
        </h3>
        <Card className="divide-y divide-slate-800">
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
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${statusClass}`}>
                    {check.status.toUpperCase()}
                  </span>
                </div>
              );
            })
          )}
        </Card>
      </div>
    </div>
  );
};

export default Settings;
