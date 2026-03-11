import { Activity, AlertCircle, AlertTriangle, Check, Edit2, Eye, EyeOff, Plus, RotateCcw, Save, Trash2, X } from 'lucide-react';
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
  IProviderPreset,
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
import PresetCard from '../components/providers/PresetCard.js';
import PresetFormModal from '../components/providers/PresetFormModal.js';
import ProviderEnvEditor from '../components/providers/ProviderEnvEditor.js';
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

/** Built-in preset IDs that cannot be deleted */
const BUILT_IN_PRESET_IDS = ['claude', 'claude-sonnet-4-6', 'claude-opus-4-6', 'codex', 'glm-47', 'glm-5'];

type ConfigForm = {
  provider: INightWatchConfig['provider'];
  providerLabel: string;
  providerPresets: Record<string, IProviderPreset>;
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
  primaryFallbackPreset: string;
  secondaryFallbackPreset: string;
  claudeModel: ClaudeModel;
  qa: IQaConfig;
  audit: IAuditConfig;
  queue: INightWatchConfig['queue'];
};

const toFormState = (config: INightWatchConfig): ConfigForm => ({
  provider: config.provider,
  providerLabel: config.providerLabel ?? '',
  providerPresets: config.providerPresets ?? {},
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
  primaryFallbackPreset: config.primaryFallbackPreset ?? '',
  secondaryFallbackPreset: config.secondaryFallbackPreset ?? '',
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
  // Tracks when jobProviders was changed by user (to trigger auto-save)
  const jobProvidersChangedRef = React.useRef(false);
  const [scheduleMode, setScheduleMode] = React.useState<'template' | 'custom'>('template');
  const [selectedTemplateId, setSelectedTemplateId] = React.useState<string>('always-on');

  // Preset modal state
  const [presetModalOpen, setPresetModalOpen] = React.useState(false);
  const [editingPresetId, setEditingPresetId] = React.useState<string | null>(null);
  const [editingPreset, setEditingPreset] = React.useState<IProviderPreset | null>(null);
  const [deleteWarning, setDeleteWarning] = React.useState<{ presetId: string; presetName: string; references: string[] } | null>(null);

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

  // Auto-save when jobProviders changes from user input
  React.useEffect(() => {
    if (form && jobProvidersChangedRef.current) {
      jobProvidersChangedRef.current = false;
      handleSave();
    }
  }, [form?.jobProviders]);

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
        cleanedJobProviders[jobType as keyof IJobProviders] = provider;
      }
    }

    setSaving(true);
    try {
      const savedConfig = await updateConfig({
        provider: form.provider,
        providerLabel: form.providerLabel.trim(),
        providerPresets: Object.keys(form.providerPresets).length > 0 ? form.providerPresets : undefined,
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
        primaryFallbackPreset: form.primaryFallbackPreset || undefined,
        secondaryFallbackPreset: form.secondaryFallbackPreset || undefined,
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

  // Get default built-in preset configuration
  // TODO: expose BUILT_IN_PRESETS from server API to avoid this duplication with constants.ts
  const getDefaultBuiltInPreset = (presetId: string): IProviderPreset | null => {
    const builtIn: Record<string, IProviderPreset> = {
      claude: { name: 'Claude', command: 'claude', promptFlag: '-p', autoApproveFlag: '--dangerously-skip-permissions' },
      'claude-sonnet-4-6': { name: 'Claude Sonnet 4.6', command: 'claude', promptFlag: '-p', autoApproveFlag: '--dangerously-skip-permissions', modelFlag: '--model', model: 'claude-sonnet-4-6' },
      'claude-opus-4-6': { name: 'Claude Opus 4.6', command: 'claude', promptFlag: '-p', autoApproveFlag: '--dangerously-skip-permissions', modelFlag: '--model', model: 'claude-opus-4-6' },
      codex: { name: 'Codex', command: 'codex', subcommand: 'exec', autoApproveFlag: '--yolo', workdirFlag: '-C' },
      'glm-47': { name: 'GLM-4.7', command: 'claude', promptFlag: '-p', autoApproveFlag: '--dangerously-skip-permissions', modelFlag: '--model', model: 'glm-4.7', envVars: { ANTHROPIC_BASE_URL: 'https://api.z.ai/api/anthropic', API_TIMEOUT_MS: '3000000', ANTHROPIC_DEFAULT_OPUS_MODEL: 'glm-4.7', ANTHROPIC_DEFAULT_SONNET_MODEL: 'glm-4.7' } },
      'glm-5': { name: 'GLM-5', command: 'claude', promptFlag: '-p', autoApproveFlag: '--dangerously-skip-permissions', modelFlag: '--model', model: 'glm-5', envVars: { ANTHROPIC_BASE_URL: 'https://api.z.ai/api/anthropic', API_TIMEOUT_MS: '3000000', ANTHROPIC_DEFAULT_OPUS_MODEL: 'glm-5', ANTHROPIC_DEFAULT_SONNET_MODEL: 'glm-5' } },
    };
    return builtIn[presetId] ?? null;
  };

  // Get all available presets (built-in + custom)
  const getAllPresets = (): Record<string, IProviderPreset> => {
    const builtIn: Record<string, IProviderPreset> = {
      claude: { name: 'Claude', command: 'claude', promptFlag: '-p', autoApproveFlag: '--dangerously-skip-permissions' },
      'claude-sonnet-4-6': { name: 'Claude Sonnet 4.6', command: 'claude', promptFlag: '-p', autoApproveFlag: '--dangerously-skip-permissions', modelFlag: '--model', model: 'claude-sonnet-4-6' },
      'claude-opus-4-6': { name: 'Claude Opus 4.6', command: 'claude', promptFlag: '-p', autoApproveFlag: '--dangerously-skip-permissions', modelFlag: '--model', model: 'claude-opus-4-6' },
      codex: { name: 'Codex', command: 'codex', subcommand: 'exec', autoApproveFlag: '--yolo', workdirFlag: '-C' },
      'glm-47': { name: 'GLM-4.7', command: 'claude', promptFlag: '-p', autoApproveFlag: '--dangerously-skip-permissions', modelFlag: '--model', model: 'glm-4.7', envVars: { ANTHROPIC_BASE_URL: 'https://api.z.ai/api/anthropic', API_TIMEOUT_MS: '3000000', ANTHROPIC_DEFAULT_OPUS_MODEL: 'glm-4.7', ANTHROPIC_DEFAULT_SONNET_MODEL: 'glm-4.7' } },
      'glm-5': { name: 'GLM-5', command: 'claude', promptFlag: '-p', autoApproveFlag: '--dangerously-skip-permissions', modelFlag: '--model', model: 'glm-5', envVars: { ANTHROPIC_BASE_URL: 'https://api.z.ai/api/anthropic', API_TIMEOUT_MS: '3000000', ANTHROPIC_DEFAULT_OPUS_MODEL: 'glm-5', ANTHROPIC_DEFAULT_SONNET_MODEL: 'glm-5' } },
    };
    return { ...builtIn, ...form?.providerPresets };
  };

  // Get preset options for select dropdowns (includes built-ins)
  const getPresetOptions = (customPresets: Record<string, IProviderPreset>): Array<{ label: string; value: string }> => {
    const allPresets = getAllPresets();
    return Object.entries(allPresets).map(([id, preset]) => ({
      label: preset.name,
      value: id,
    }));
  };

  // Check if a preset is referenced by any job assignment
  const getPresetReferences = (presetId: string, formData: ConfigForm): string[] => {
    const references: string[] = [];

    // Check global provider
    if (formData.provider === presetId) {
      references.push('Global Provider');
    }

    // Check job providers
    const jobLabels: Record<string, string> = {
      executor: 'Executor',
      reviewer: 'Reviewer',
      qa: 'QA',
      audit: 'Audit',
      slicer: 'Planner',
    };

    for (const [jobType, provider] of Object.entries(formData.jobProviders)) {
      if (provider === presetId) {
        references.push(jobLabels[jobType] ?? jobType);
      }
    }

    return references;
  };

  // Open preset modal for adding new preset
  const handleAddPreset = () => {
    setEditingPresetId(null);
    setEditingPreset(null);
    setPresetModalOpen(true);
  };

  // Open preset modal for editing existing preset
  const handleEditPreset = (presetId: string) => {
    const allPresets = getAllPresets();
    const preset = allPresets[presetId];
    if (preset) {
      setEditingPresetId(presetId);
      setEditingPreset(preset);
      setPresetModalOpen(true);
    }
  };

  // Save preset (add or update) — immediately persists to server
  const handleSavePreset = async (presetId: string, preset: IProviderPreset) => {
    if (!form) return;

    const isNew = !editingPresetId;
    const updatedPresets = { ...form.providerPresets, [presetId]: preset };
    updateField('providerPresets', updatedPresets);

    try {
      await updateConfig({ providerPresets: { [presetId]: preset } });
      addToast({
        title: isNew ? 'Preset Added' : 'Preset Updated',
        message: isNew
          ? `${preset.name} has been added. You can now assign it to jobs.`
          : `${preset.name} has been saved.`,
        type: 'success',
      });
    } catch (err) {
      addToast({
        title: 'Save Failed',
        message: err instanceof Error ? err.message : 'Failed to save preset',
        type: 'error',
      });
      // Revert local state on failure
      updateField('providerPresets', form.providerPresets);
    }
  };

  // Delete preset with protection check
  const handleDeletePreset = (presetId: string) => {
    if (!form) return;

    // Prevent deletion of built-in presets
    if (BUILT_IN_PRESET_IDS.includes(presetId)) {
      addToast({
        title: 'Cannot Delete',
        message: 'Built-in presets cannot be deleted.',
        type: 'error',
      });
      return;
    }

    // Check if preset is in use
    const references = getPresetReferences(presetId, form);
    if (references.length > 0) {
      setDeleteWarning({
        presetId,
        presetName: getAllPresets()[presetId]?.name ?? presetId,
        references,
      });
      return;
    }

    // Safe to delete
    const updatedPresets = { ...form.providerPresets };
    delete updatedPresets[presetId];
    updateField('providerPresets', updatedPresets);

    addToast({
      title: 'Preset Deleted',
      message: `${getAllPresets()[presetId]?.name ?? presetId} has been removed.`,
      type: 'success',
    });
  };

  // Reset built-in preset to defaults
  const handleResetPreset = (presetId: string) => {
    if (!form) return;

    // Remove any custom override for this preset
    const updatedPresets = { ...form.providerPresets };
    delete updatedPresets[presetId];
    updateField('providerPresets', updatedPresets);

    addToast({
      title: 'Preset Reset',
      message: `${presetId} has been reset to built-in defaults.`,
      type: 'success',
    });
  };

  // Confirm deletion despite warnings (shouldn't happen with proper UI, but just in case)
  const handleConfirmDelete = () => {
    if (!deleteWarning || !form) return;

    const { presetId } = deleteWarning;
    const updatedPresets = { ...form.providerPresets };
    delete updatedPresets[presetId];
    updateField('providerPresets', updatedPresets);

    // Also clear any job assignments that reference this preset
    const newJobProviders = { ...form.jobProviders };
    for (const key of Object.keys(newJobProviders)) {
      if (newJobProviders[key as keyof IJobProviders] === presetId) {
        delete newJobProviders[key as keyof IJobProviders];
      }
    }
    updateField('jobProviders', newJobProviders);

    // Clear global provider if it was this preset
    if (form.provider === presetId) {
      updateField('provider', 'claude');
    }

    setDeleteWarning(null);
    addToast({
      title: 'Preset Deleted',
      message: `${deleteWarning.presetName} has been removed and all references cleared.`,
      type: 'success',
    });
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
          {/* Provider Presets Card */}
          <Card className="p-6 space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-medium text-slate-200">Provider Presets</h3>
                <p className="text-sm text-slate-400 mt-1">
                  Configure AI provider presets with custom commands, models, and environment variables
                </p>
              </div>
              <Button
                onClick={() => {
                  setEditingPresetId(null);
                  setEditingPreset(null);
                  setPresetModalOpen(true);
                }}
              >
                <Plus className="h-4 w-4 mr-2" />
                Add Provider
              </Button>
            </div>

            {/* Preset Cards Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {/* Built-in presets */}
              {BUILT_IN_PRESET_IDS.map((presetId) => {
                const customPreset = form.providerPresets[presetId];
                const preset = customPreset || getDefaultBuiltInPreset(presetId);
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
              <p className="text-sm text-slate-400 mt-1">
                Preset to use when the active provider is rate-limited
              </p>
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
            roadmapScanner: {
              enabled: form.roadmapScanner.enabled,
              slicerSchedule: form.roadmapScanner.slicerSchedule || '35 */12 * * *',
            },
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

      {/* Preset Form Modal */}
      <PresetFormModal
        isOpen={presetModalOpen}
        onClose={() => {
          setPresetModalOpen(false);
          setEditingPresetId(null);
          setEditingPreset(null);
        }}
        onSave={handleSavePreset}
        presetId={editingPresetId}
        preset={editingPreset}
        isBuiltIn={editingPresetId ? BUILT_IN_PRESET_IDS.includes(editingPresetId) : false}
        existingIds={Object.keys(getAllPresets())}
      />

      {/* Delete Warning Modal */}
      {deleteWarning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setDeleteWarning(null)}
            aria-hidden="true"
          />
          <div className="relative w-full max-w-md transform rounded-xl bg-slate-900 border border-slate-800 shadow-2xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <AlertTriangle className="h-6 w-6 text-amber-400" />
              <h3 className="text-lg font-semibold text-slate-100">Cannot Delete Preset</h3>
            </div>
            <p className="text-sm text-slate-300 mb-4">
              <strong>{deleteWarning.presetName}</strong> is currently assigned to the following jobs:
            </p>
            <ul className="list-disc list-inside text-sm text-slate-400 mb-4">
              {deleteWarning.references.map((ref) => (
                <li key={ref}>{ref}</li>
              ))}
            </ul>
            <p className="text-sm text-slate-400 mb-6">
              Please remove these assignments before deleting the preset, or use &quot;Force Delete&quot; to remove the preset and clear all references.
            </p>
            <div className="flex justify-end gap-3">
              <Button variant="ghost" onClick={() => setDeleteWarning(null)}>
                Cancel
              </Button>
              <Button
                variant="secondary"
                onClick={handleConfirmDelete}
                className="bg-red-600 hover:bg-red-700"
              >
                Force Delete
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Settings;
