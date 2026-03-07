import { Activity, AlertCircle, Check, Edit2, Eye, EyeOff, Plus, RotateCcw, Save, Trash2, X } from 'lucide-react';
import React from 'react';
import {
  ClaudeModel,
  fetchConfig,
  fetchDoctor,
  IAuditConfig,
  IBoardProviderConfig,
  IJobProviders,
  INightWatchConfig,
  INotificationConfig,
  IQaConfig,
  IRoadmapScannerConfig,
  IWebhookConfig,
  MergeMethod,
  QaArtifacts,
  triggerInstallCron,
  toggleRoadmapScanner,
  updateConfig,
  useApi,
} from '../api';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import CronScheduleInput from '../components/ui/CronScheduleInput';
import { IScheduleTemplate, resolveActiveTemplate } from '../utils/cron.js';
import Input from '../components/ui/Input';
import Select from '../components/ui/Select';
import Switch from '../components/ui/Switch';
import Tabs from '../components/ui/Tabs';
import { useStore } from '../store/useStore';
import ScheduleConfig from '../components/scheduling/ScheduleConfig.js';

type ConfigForm = {
  provider: INightWatchConfig['provider'];
  providerLabel: string;
  defaultBranch: string;
  prdDir: string;
  branchPrefix: string;
  branchPatterns: string[];
  executorEnabled: boolean;
  reviewerEnabled: boolean;
  minReviewScore: number;
  maxRuntime: number;
  reviewerMaxRuntime: number;
  maxLogSize: number;
  cronSchedule: string;
  reviewerSchedule: string;
  scheduleBundleId: string | null;
  cronScheduleOffset: number;
  schedulingPriority: number;
  maxRetries: number;
  reviewerMaxRetries: number;
  reviewerRetryDelay: number;
  providerEnv: Record<string, string>;
  notifications: INotificationConfig;
  prdPriority: string[];
  roadmapScanner: IRoadmapScannerConfig;
  templatesDir: string;
  boardProvider: IBoardProviderConfig;
  jobProviders: IJobProviders;
  autoMerge: boolean;
  autoMergeMethod: MergeMethod;
  fallbackOnRateLimit: boolean;
  primaryFallbackModel: ClaudeModel;
  secondaryFallbackModel: ClaudeModel;
  claudeModel: ClaudeModel;
  qa: IQaConfig;
  audit: IAuditConfig;
  queue: INightWatchConfig['queue'];
};

const toFormState = (config: INightWatchConfig): ConfigForm => ({
  provider: config.provider,
  providerLabel: config.providerLabel ?? '',
  defaultBranch: config.defaultBranch,
  prdDir: config.prdDir || 'docs/prds',
  branchPrefix: config.branchPrefix,
  branchPatterns: config.branchPatterns || [],
  executorEnabled: config.executorEnabled ?? true,
  reviewerEnabled: config.reviewerEnabled,
  minReviewScore: config.minReviewScore,
  maxRuntime: config.maxRuntime,
  reviewerMaxRuntime: config.reviewerMaxRuntime,
  maxLogSize: config.maxLogSize,
  cronSchedule: config.cronSchedule || '5 */3 * * *',
  reviewerSchedule: config.reviewerSchedule || '25 */6 * * *',
  scheduleBundleId: config.scheduleBundleId ?? null,
  cronScheduleOffset: config.cronScheduleOffset ?? 0,
  schedulingPriority: config.schedulingPriority ?? 3,
  maxRetries: config.maxRetries ?? 3,
  reviewerMaxRetries: config.reviewerMaxRetries ?? 2,
  reviewerRetryDelay: config.reviewerRetryDelay ?? 30,
  providerEnv: config.providerEnv || {},
  notifications: config.notifications || { webhooks: [] },
  prdPriority: config.prdPriority || [],
  roadmapScanner: {
    enabled: config.roadmapScanner?.enabled ?? true,
    roadmapPath: config.roadmapScanner?.roadmapPath ?? 'ROADMAP.md',
    autoScanInterval: config.roadmapScanner?.autoScanInterval ?? 300,
    slicerSchedule: config.roadmapScanner?.slicerSchedule ?? '35 */12 * * *',
    slicerMaxRuntime: config.roadmapScanner?.slicerMaxRuntime ?? 600,
    priorityMode: config.roadmapScanner?.priorityMode ?? 'roadmap-first',
    issueColumn: config.roadmapScanner?.issueColumn ?? 'Draft',
  },
  templatesDir: config.templatesDir || '.night-watch/templates',
  boardProvider: config.boardProvider || { enabled: true, provider: 'github' },
  jobProviders: config.jobProviders || {},
  autoMerge: config.autoMerge ?? false,
  autoMergeMethod: config.autoMergeMethod ?? 'squash',
  fallbackOnRateLimit: config.fallbackOnRateLimit ?? true,
  primaryFallbackModel: config.primaryFallbackModel ?? config.claudeModel ?? 'sonnet',
  secondaryFallbackModel:
    config.secondaryFallbackModel ?? config.primaryFallbackModel ?? config.claudeModel ?? 'sonnet',
  claudeModel: config.primaryFallbackModel ?? config.claudeModel ?? 'sonnet',
  qa: config.qa || {
    enabled: true,
    schedule: '45 2,14 * * *',
    maxRuntime: 3600,
    branchPatterns: [],
    artifacts: 'both',
    skipLabel: 'skip-qa',
    autoInstallPlaywright: true,
  },
  audit: config.audit || {
    enabled: true,
    schedule: '50 3 * * 1',
    maxRuntime: 1800,
  },
  queue: config.queue || {
    enabled: true,
    maxConcurrency: 1,
    maxWaitTime: 7200,
    priority: {
      executor: 50,
      reviewer: 40,
      slicer: 30,
      qa: 20,
      audit: 10,
    },
  },
});

type ScheduleUiState = {
  mode: 'template' | 'custom';
  selectedTemplateId: string;
};

const resolveScheduleUiState = (form: ConfigForm): ScheduleUiState => {
  const detected = resolveActiveTemplate(
    form.scheduleBundleId,
    form.cronSchedule,
    form.reviewerSchedule,
    form.qa.schedule,
    form.audit.schedule,
    form.roadmapScanner.slicerSchedule ?? '35 */12 * * *',
  );

  if (detected) {
    return { mode: 'template', selectedTemplateId: detected.id };
  }

  return { mode: 'custom', selectedTemplateId: '' };
};

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
        aria-label={show ? 'Hide sensitive value' : 'Show sensitive value'}
        title={show ? 'Hide sensitive value' : 'Show sensitive value'}
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
              className={`px-3 py-1.5 rounded-md text-sm transition-colors ${webhook.events.includes(opt.value)
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
                      aria-label={`Edit ${webhook.type} webhook`}
                      title={`Edit ${webhook.type} webhook`}
                    >
                      <Edit2 className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteWebhook(index)}
                      className="p-2 text-red-400 hover:text-red-300"
                      aria-label={`Delete ${webhook.type} webhook`}
                      title={`Delete ${webhook.type} webhook`}
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
              aria-label={`Remove ${tag}`}
              title={`Remove ${tag}`}
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
        <Button onClick={handleAdd} disabled={!input.trim()} aria-label={`Add ${label.toLowerCase()} value`}>
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
  // Prevents refetchConfig from overwriting the form after a save (form was already set from PUT response)
  const skipNextFormResetRef = React.useRef(false);
  const [scheduleMode, setScheduleMode] = React.useState<'template' | 'custom'>('template');
  const [selectedTemplateId, setSelectedTemplateId] = React.useState<string>('always-on');

  const {
    data: config,
    loading: configLoading,
    error: configError,
    refetch: refetchConfig,
  } = useApi(fetchConfig, [selectedProjectId], { enabled: !globalModeLoading });
  const { data: doctorChecksData, loading: doctorLoading, refetch: refetchDoctor } = useApi(fetchDoctor, [selectedProjectId], { enabled: !globalModeLoading });
  const doctorChecks = doctorChecksData ?? [];

  const applyScheduleUiState = React.useCallback((formState: ConfigForm) => {
    const scheduleUiState = resolveScheduleUiState(formState);
    setScheduleMode(scheduleUiState.mode);
    setSelectedTemplateId(scheduleUiState.selectedTemplateId);
  }, []);

  React.useEffect(() => {
    if (config) {
      if (skipNextFormResetRef.current) {
        skipNextFormResetRef.current = false;
      } else {
        const newForm = toFormState(config);
        setForm(newForm);
        applyScheduleUiState(newForm);
      }
    }
  }, [config, applyScheduleUiState]);

  const updateField = <K extends keyof ConfigForm>(key: K, value: ConfigForm[K]) => {
    setForm((prev) => {
      if (!prev) {
        return prev;
      }
      return { ...prev, [key]: value };
    });
  };

  const switchToTemplateMode = () => {
    setScheduleMode('template');
    if (!form) {
      return;
    }

    const scheduleUiState = resolveScheduleUiState(form);
    if (scheduleUiState.mode === 'template') {
      setSelectedTemplateId(scheduleUiState.selectedTemplateId);
      updateField('scheduleBundleId', scheduleUiState.selectedTemplateId);
    }
  };

  const switchToCustomMode = () => {
    setScheduleMode('custom');
    updateField('scheduleBundleId', null);
    setSelectedTemplateId('');
  };

  const applyTemplate = (tpl: IScheduleTemplate) => {
    setSelectedTemplateId(tpl.id);
    setForm((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        cronSchedule: tpl.schedules.executor,
        reviewerSchedule: tpl.schedules.reviewer,
        scheduleBundleId: tpl.id,
        qa: { ...prev.qa, schedule: tpl.schedules.qa },
        audit: { ...prev.audit, schedule: tpl.schedules.audit },
        roadmapScanner: { ...prev.roadmapScanner, slicerSchedule: tpl.schedules.slicer },
        fallbackOnRateLimit: true,
      };
    });
  };

  const handleSave = async () => {
    if (!form) {
      return;
    }

    const shouldReinstallCron =
      form.cronSchedule !== config?.cronSchedule ||
      form.reviewerSchedule !== config?.reviewerSchedule ||
      form.cronScheduleOffset !== (config?.cronScheduleOffset ?? 0) ||
      form.schedulingPriority !== (config?.schedulingPriority ?? 3) ||
      form.executorEnabled !== (config?.executorEnabled ?? true) ||
      form.reviewerEnabled !== (config?.reviewerEnabled ?? true) ||
      form.queue.enabled !== (config?.queue?.enabled ?? true) ||
      form.qa.enabled !== (config?.qa.enabled ?? true) ||
      form.qa.schedule !== config?.qa.schedule ||
      form.audit.enabled !== (config?.audit.enabled ?? true) ||
      form.audit.schedule !== config?.audit.schedule ||
      form.roadmapScanner.enabled !== (config?.roadmapScanner?.enabled ?? true) ||
      (form.roadmapScanner.slicerSchedule || '35 */12 * * *') !==
        (config?.roadmapScanner?.slicerSchedule || '35 */12 * * *');

    // Filter out empty/undefined job provider values
    const cleanedJobProviders: IJobProviders = {};
    for (const [jobType, provider] of Object.entries(form.jobProviders)) {
      if (provider !== undefined && provider !== null && provider !== '') {
        cleanedJobProviders[jobType as keyof IJobProviders] = provider as 'claude' | 'codex';
      }
    }

    setSaving(true);
    try {
      const savedConfig = await updateConfig({
        provider: form.provider,
        providerLabel: form.providerLabel.trim(),
        defaultBranch: form.defaultBranch,
        prdDir: form.prdDir,
        branchPrefix: form.branchPrefix,
        branchPatterns: form.branchPatterns,
        executorEnabled: form.executorEnabled,
        reviewerEnabled: form.reviewerEnabled,
        minReviewScore: form.minReviewScore,
        maxRuntime: form.maxRuntime,
        reviewerMaxRuntime: form.reviewerMaxRuntime,
        maxLogSize: form.maxLogSize,
        cronSchedule: form.cronSchedule,
        reviewerSchedule: form.reviewerSchedule,
        scheduleBundleId: scheduleMode === 'template' ? form.scheduleBundleId : null,
        cronScheduleOffset: form.cronScheduleOffset,
        schedulingPriority: form.schedulingPriority,
        maxRetries: form.maxRetries,
        reviewerMaxRetries: form.reviewerMaxRetries,
        reviewerRetryDelay: form.reviewerRetryDelay,
        providerEnv: form.providerEnv,
        notifications: form.notifications,
        prdPriority: form.prdPriority,
        roadmapScanner: form.roadmapScanner,
        templatesDir: form.templatesDir,
        boardProvider: form.boardProvider,
        jobProviders: cleanedJobProviders,
        autoMerge: form.autoMerge,
        autoMergeMethod: form.autoMergeMethod,
        fallbackOnRateLimit: form.fallbackOnRateLimit,
        primaryFallbackModel: form.primaryFallbackModel,
        secondaryFallbackModel: form.secondaryFallbackModel,
        claudeModel: form.primaryFallbackModel,
        qa: form.qa,
        audit: form.audit,
        queue: form.queue,
      });

      // Update form directly from server response to ensure it reflects persisted values
      const updatedForm = toFormState(savedConfig);
      setForm(updatedForm);
      applyScheduleUiState(updatedForm);

      let cronInstallFailedMessage = '';
      if (shouldReinstallCron) {
        try {
          await triggerInstallCron();
        } catch (cronErr) {
          cronInstallFailedMessage =
            cronErr instanceof Error ? cronErr.message : 'failed to reinstall cron schedules';
        }
      }

      if (cronInstallFailedMessage) {
        addToast({
          title: 'Settings Saved (Cron Reinstall Failed)',
          message: cronInstallFailedMessage,
          type: 'warning',
        });
      } else {
        addToast({
          title: 'Settings Saved',
          message: shouldReinstallCron
            ? 'Configuration updated and cron schedules reinstalled.'
            : 'Configuration updated successfully.',
          type: 'success',
        });
      }

      // Sync useApi's internal config state but skip the form reset (already done above)
      skipNextFormResetRef.current = true;
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
      const resetForm = toFormState(config);
      setForm(resetForm);
      applyScheduleUiState(resetForm);
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

      let cronInstallFailedMessage = '';
      try {
        await triggerInstallCron();
      } catch (cronErr) {
        cronInstallFailedMessage =
          cronErr instanceof Error ? cronErr.message : 'Failed to reinstall cron schedules';
      }

      addToast(
        cronInstallFailedMessage
          ? {
              title: 'Planner Saved (Cron Reinstall Failed)',
              message: cronInstallFailedMessage,
              type: 'warning',
            }
          : {
              title: enabled ? 'Roadmap Scanner Enabled' : 'Roadmap Scanner Disabled',
              message: `Roadmap scanner has been ${enabled ? 'enabled' : 'disabled'}.`,
              type: 'success',
            },
      );
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
        <Card className="p-6 space-y-6">
          <div>
            <h3 className="text-lg font-medium text-slate-200">Project Configuration</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
              <Input label="Project Name" value={projectName} disabled />
              <Input label="Default Branch" value={form.defaultBranch} onChange={(e) => updateField('defaultBranch', e.target.value)} />
              <Input
                label="PRD Directory"
                value={form.prdDir}
                onChange={(e) => updateField('prdDir', e.target.value)}
                helperText="Directory containing PRD files (relative to project root)"
              />
              <Input label="Branch Prefix" value={form.branchPrefix} onChange={(e) => updateField('branchPrefix', e.target.value)} />
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
      ),
    },
    {
      id: 'providers',
      label: 'Providers',
      content: (
        <div className="space-y-6">
          <Card className="p-6 space-y-6">
            <div>
              <h3 className="text-lg font-medium text-slate-200">Global Provider</h3>
              <p className="text-sm text-slate-400 mt-1">Default AI provider used for all jobs unless overridden below</p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
              <p className="text-sm text-slate-300">
                Primary and secondary fallback settings only control native Claude retry behavior after a Claude proxy rate limit.
                To use Codex, set the global provider above or assign Codex in the per-job provider overrides below.
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Select
                label="Provider"
                value={form.provider}
                onChange={(val) => updateField('provider', val as ConfigForm['provider'])}
                options={[
                  { label: 'Anthropic (Claude)', value: 'claude' },
                  { label: 'OpenAI (Codex)', value: 'codex' },
                ]}
              />
              <Input
                label="Provider Label"
                value={form.providerLabel}
                onChange={(e) => updateField('providerLabel', e.target.value)}
                placeholder="e.g. GLM-5 (auto-derived if blank)"
                helperText="Human-friendly name shown in PR comments, review footers, and commit attribution"
              />
              <Select
                label="Primary Native Claude Fallback"
                value={form.primaryFallbackModel}
                onChange={(val) => {
                  const next = val as ClaudeModel;
                  updateField('primaryFallbackModel', next);
                  updateField('claudeModel', next);
                }}
                options={[
                  { label: 'Sonnet (claude-sonnet-4-6)', value: 'sonnet' },
                  { label: 'Opus (claude-opus-4-6)', value: 'opus' },
                ]}
                helperText="Claude-only. First native Claude model used for direct Claude execution and the first rate-limit fallback attempt"
              />
              <Select
                label="Secondary Native Claude Fallback"
                value={form.secondaryFallbackModel}
                onChange={(val) => updateField('secondaryFallbackModel', val as ClaudeModel)}
                options={[
                  { label: 'Sonnet (claude-sonnet-4-6)', value: 'sonnet' },
                  { label: 'Opus (claude-opus-4-6)', value: 'opus' },
                ]}
                helperText="Claude-only. Used only if the primary native Claude fallback is also rate-limited"
              />
              <div className="md:col-span-2">
                <Switch
                  label="Fallback on Rate Limit"
                  checked={form.fallbackOnRateLimit}
                  onChange={(checked) => updateField('fallbackOnRateLimit', checked)}
                />
                <p className="text-xs text-slate-500 mt-2">
                  When enabled, Night Watch retries with the primary native Claude fallback model, then the secondary one if the primary is also rate-limited
                </p>
              </div>
            </div>
          </Card>

          <Card className="p-6 space-y-6">
            <div>
              <h3 className="text-lg font-medium text-slate-200">Per-Job Provider Overrides</h3>
              <p className="text-sm text-slate-400 mt-1">
                Override the AI provider for specific job types. Leave as &quot;Use Global&quot; to use the default provider.
              </p>
            </div>
            <div className="space-y-4">
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
                          newJobProviders[key] = val as 'claude' | 'codex';
                        }
                        updateField('jobProviders', newJobProviders);
                      }}
                      options={[
                        { label: 'Use Global (default)', value: '' },
                        { label: 'Anthropic (Claude)', value: 'claude' },
                        { label: 'OpenAI (Codex)', value: 'codex' },
                      ]}
                    />
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-6">
            <h3 className="text-lg font-medium text-slate-200 mb-2">Provider Environment Variables</h3>
            <ProviderEnvEditor
              envVars={form.providerEnv}
              onChange={(envVars) => updateField('providerEnv', envVars)}
            />
          </Card>
        </div>
      ),
    },
    {
      id: 'runtime',
      label: 'Runtime',
      content: (
        <div className="space-y-6">
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
            </div>
          </Card>
        </div>
      ),
    },
    {
      id: 'schedules',
      label: 'Schedules',
      content: (
        <ScheduleConfig
          form={{
            cronSchedule: form.cronSchedule,
            reviewerSchedule: form.reviewerSchedule,
            qa: form.qa,
            audit: form.audit,
            roadmapScanner: form.roadmapScanner,
            scheduleBundleId: form.scheduleBundleId,
            schedulingPriority: form.schedulingPriority,
            cronScheduleOffset: form.cronScheduleOffset,
            globalQueueEnabled: form.queue.enabled,
          }}
          scheduleMode={scheduleMode}
          selectedTemplateId={selectedTemplateId}
          onFieldChange={(field, value) => {
            if (field === 'globalQueueEnabled') {
              updateField('queue', { ...form.queue, enabled: value as boolean });
            } else {
              updateField(field as keyof ConfigForm, value as ConfigForm[keyof ConfigForm]);
            }
          }}
          onSwitchToTemplate={switchToTemplateMode}
          onSwitchToCustom={switchToCustomMode}
          onApplyTemplate={applyTemplate}
        />
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
      label: 'Planner',
      content: (
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
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-slate-800">
                <Input
                  label="Roadmap File Path"
                  value={form.roadmapScanner.roadmapPath}
                  onChange={(e) =>
                    updateField('roadmapScanner', {
                      ...form.roadmapScanner,
                      roadmapPath: e.target.value,
                    })
                  }
                  helperText="Primary planning source (relative to project root)."
                />
                <CronScheduleInput
                  label="Planner Schedule"
                  value={form.roadmapScanner.slicerSchedule || '35 */12 * * *'}
                  onChange={(val) =>
                    updateField('roadmapScanner', {
                      ...form.roadmapScanner,
                      slicerSchedule: val,
                    })
                  }
                />
              </div>

              <div className="pt-4 border-t border-slate-800">
                <h4 className="text-md font-medium text-slate-200 mb-4">Planner Execution</h4>
                <p className="text-sm text-slate-400 mb-4">
                  Planner creates one PRD at a time and can auto-create a board issue for handoff.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
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
                    value={form.roadmapScanner.issueColumn || 'Draft'}
                    onChange={(val) =>
                      updateField('roadmapScanner', {
                        ...form.roadmapScanner,
                        issueColumn: val === 'Ready' ? 'Ready' : 'Draft',
                      })
                    }
                    options={[
                      { label: 'Draft (default)', value: 'Draft' },
                      { label: 'Ready', value: 'Ready' },
                    ]}
                    helperText="Column where planner-created issues are added after PRD generation."
                  />
                </div>
              </div>
            </>
          )}
        </Card>
      ),
    },
    {
      id: 'board',
      label: 'Board',
      content: (
        <Card className="p-6 space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-medium text-slate-200">Board Provider</h3>
              <p className="text-sm text-slate-400">
                Track PRDs and their status using GitHub Projects or local SQLite
              </p>
            </div>
            <Switch
              checked={form.boardProvider.enabled}
              onChange={(checked) =>
                updateField('boardProvider', {
                  ...form.boardProvider,
                  enabled: checked,
                })
              }
            />
          </div>

          {form.boardProvider.enabled && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-slate-800">
              <Select
                label="Board Provider"
                value={form.boardProvider.provider}
                onChange={(val) =>
                  updateField('boardProvider', {
                    ...form.boardProvider,
                    provider: val as 'github' | 'local',
                  })
                }
                options={[
                  { label: 'GitHub Projects', value: 'github' },
                  { label: 'Local (SQLite)', value: 'local' },
                ]}
              />
              {form.boardProvider.provider === 'github' && (
                <>
                  <Input
                    label="Project Number"
                    type="number"
                    value={String(form.boardProvider.projectNumber || '')}
                    onChange={(e) =>
                      updateField('boardProvider', {
                        ...form.boardProvider,
                        projectNumber: e.target.value ? Number(e.target.value) : undefined,
                      })
                    }
                    helperText="GitHub Projects V2 project number"
                  />
                  <Input
                    label="Repository"
                    value={form.boardProvider.repo || ''}
                    onChange={(e) =>
                      updateField('boardProvider', {
                        ...form.boardProvider,
                        repo: e.target.value || undefined,
                      })
                    }
                    helperText="owner/repo (auto-detected if empty)"
                  />
                </>
              )}
              {form.boardProvider.provider === 'local' && (
                <div className="md:col-span-2">
                  <p className="text-sm text-slate-400">
                    Local board uses SQLite for storage — no additional configuration needed.
                  </p>
                </div>
              )}
            </div>
          )}
        </Card>
      ),
    },
    {
      id: 'qa',
      label: 'QA',
      content: (
        <Card className="p-6 space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-medium text-slate-200">Quality Assurance</h3>
              <p className="text-sm text-slate-400">
                Automated UI testing using Playwright
              </p>
            </div>
            <Switch
              checked={form.qa.enabled}
              onChange={(checked) =>
                updateField('qa', {
                  ...form.qa,
                  enabled: checked,
                })
              }
            />
          </div>

          {form.qa.enabled && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-slate-800">
                <Input
                  label="Max Runtime"
                  type="number"
                  value={String(form.qa.maxRuntime)}
                  onChange={(e) =>
                    updateField('qa', {
                      ...form.qa,
                      maxRuntime: Number(e.target.value || 0),
                    })
                  }
                  rightIcon={<span className="text-xs">sec</span>}
                  helperText="Maximum runtime for QA tasks (default: 3600 seconds)"
                />
                <Select
                  label="Artifacts"
                  value={form.qa.artifacts}
                  onChange={(val) =>
                    updateField('qa', {
                      ...form.qa,
                      artifacts: val as QaArtifacts,
                    })
                  }
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
                  onChange={(e) =>
                    updateField('qa', {
                      ...form.qa,
                      skipLabel: e.target.value,
                    })
                  }
                  helperText="GitHub label to skip QA (PRs with this label are excluded)"
                />
              </div>

              <div className="pt-4 border-t border-slate-800 space-y-4">
                <TagInput
                  label="QA Branch Patterns"
                  value={form.qa.branchPatterns}
                  onChange={(patterns) =>
                    updateField('qa', {
                      ...form.qa,
                      branchPatterns: patterns,
                    })
                  }
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
                    onChange={(checked) =>
                      updateField('qa', {
                        ...form.qa,
                        autoInstallPlaywright: checked,
                      })
                    }
                  />
                </div>
              </div>
            </>
          )}
        </Card>
      ),
    },
    {
      id: 'audit',
      label: 'Audit',
      content: (
        <Card className="p-6 space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-medium text-slate-200">Code Audit</h3>
              <p className="text-sm text-slate-400">
                Automated code quality and security audits
              </p>
            </div>
            <Switch
              checked={form.audit.enabled}
              onChange={(checked) =>
                updateField('audit', {
                  ...form.audit,
                  enabled: checked,
                })
              }
            />
          </div>

          {form.audit.enabled && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-slate-800">
              <Input
                label="Max Runtime"
                type="number"
                value={String(form.audit.maxRuntime)}
                onChange={(e) =>
                  updateField('audit', {
                    ...form.audit,
                    maxRuntime: Number(e.target.value || 0),
                  })
                }
                rightIcon={<span className="text-xs">sec</span>}
                helperText="Maximum runtime for audit tasks (default: 1800 seconds)"
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
          <p className="text-sm text-slate-400">Templates, retry policy, and PRD execution priority</p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Input
              label="Templates Directory"
              value={form.templatesDir}
              onChange={(e) => updateField('templatesDir', e.target.value)}
              helperText="Directory for custom template overrides"
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
