import React from 'react';
import { Save, RotateCcw, Activity, AlertCircle, Calendar, CalendarOff, Clock } from 'lucide-react';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import Input from '../components/ui/Input';
import Select from '../components/ui/Select';
import Tabs from '../components/ui/Tabs';
import Switch from '../components/ui/Switch';
import { useStore } from '../store/useStore';
import { fetchConfig, fetchDoctor, fetchStatus, NightWatchConfig, triggerInstallCron, triggerUninstallCron, updateConfig, useApi } from '../api';

// ==================== Cron Schedule Helpers ====================

const CRON_PRESETS = [
  { label: 'Every 30 minutes', value: '*/30 * * * *' },
  { label: 'Every hour', value: '0 * * * *' },
  { label: 'Every 3 hours', value: '0 */3 * * *' },
  { label: 'Every 6 hours', value: '0 */6 * * *' },
  { label: 'Every 12 hours', value: '0 */12 * * *' },
  { label: 'Daily at midnight', value: '0 0 * * *' },
  { label: 'Daily at 9 AM', value: '0 9 * * *' },
  { label: 'Weekdays at 9 AM', value: '0 9 * * 1-5' },
  { label: 'Custom', value: '__custom__' },
];

function cronToHuman(expr: string): string {
  if (!expr) return 'No schedule set';
  const trimmed = expr.trim();

  const preset = CRON_PRESETS.find(p => p.value === trimmed);
  if (preset && preset.value !== '__custom__') return preset.label;

  const parts = trimmed.split(/\s+/);
  if (parts.length !== 5) return trimmed;

  const [min, hour, dom, mon, dow] = parts;

  if (min.startsWith('*/') && hour === '*' && dom === '*' && mon === '*' && dow === '*') {
    const n = parseInt(min.slice(2));
    return n === 1 ? 'Every minute' : `Every ${n} minutes`;
  }

  if (min === '0' && hour.startsWith('*/') && dom === '*' && mon === '*' && dow === '*') {
    const n = parseInt(hour.slice(2));
    return n === 1 ? 'Every hour' : `Every ${n} hours`;
  }

  if (min === '0' && hour === '*' && dom === '*' && mon === '*' && dow === '*') {
    return 'Every hour';
  }

  if (dom === '*' && mon === '*' && dow === '1-5') {
    const h = parseInt(hour);
    const m = parseInt(min);
    if (!isNaN(h) && !isNaN(m)) {
      return `Weekdays at ${h}:${m.toString().padStart(2, '0')}`;
    }
  }

  if (dom === '*' && mon === '*' && (dow === '*' || dow === '0-6')) {
    const h = parseInt(hour);
    const m = parseInt(min);
    if (!isNaN(h) && !isNaN(m)) {
      return `Daily at ${h}:${m.toString().padStart(2, '0')}`;
    }
  }

  return trimmed;
}

function getPresetValue(cronExpr: string): string {
  const match = CRON_PRESETS.find(p => p.value === cronExpr.trim());
  return match ? match.value : '__custom__';
}

// ==================== Schedule Picker Component ====================

const SchedulePicker: React.FC<{
  label: string;
  description: string;
  value: string;
  onChange: (value: string) => void;
}> = ({ label, description, value, onChange }) => {
  const presetValue = getPresetValue(value);
  const isCustom = presetValue === '__custom__';

  return (
    <Card className="p-5 space-y-4">
      <div>
        <h4 className="text-base font-medium text-slate-200">{label}</h4>
        <p className="text-xs text-slate-500 mt-0.5">{description}</p>
      </div>

      <Select
        label="Schedule Preset"
        value={presetValue}
        onChange={(val) => {
          if (val !== '__custom__') {
            onChange(val);
          }
        }}
        options={CRON_PRESETS.map(p => ({ label: p.label, value: p.value }))}
      />

      {isCustom && (
        <Input
          label="Cron Expression"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="* * * * *"
        />
      )}

      <div className="flex items-center space-x-2 p-2.5 rounded-lg bg-slate-950/60 border border-slate-800">
        <Clock className="h-4 w-4 text-indigo-400 shrink-0" />
        <span className="text-sm text-slate-300">{cronToHuman(value)}</span>
        <span className="text-xs text-slate-600 font-mono ml-auto">{value}</span>
      </div>
    </Card>
  );
};

type ConfigForm = {
  provider: NightWatchConfig['provider'];
  defaultBranch: string;
  branchPrefix: string;
  reviewerEnabled: boolean;
  minReviewScore: number;
  maxRuntime: number;
  reviewerMaxRuntime: number;
  maxLogSize: number;
  cronSchedule: string;
  reviewerSchedule: string;
};

const toFormState = (config: NightWatchConfig): ConfigForm => ({
  provider: config.provider,
  defaultBranch: config.defaultBranch,
  branchPrefix: config.branchPrefix,
  reviewerEnabled: config.reviewerEnabled,
  minReviewScore: config.minReviewScore,
  maxRuntime: config.maxRuntime,
  reviewerMaxRuntime: config.reviewerMaxRuntime,
  maxLogSize: config.maxLogSize,
  cronSchedule: config.cronSchedule,
  reviewerSchedule: config.reviewerSchedule,
});

const Settings: React.FC = () => {
  const { addToast, projectName, selectedProjectId } = useStore();
  const [saving, setSaving] = React.useState(false);
  const [form, setForm] = React.useState<ConfigForm | null>(null);

  const {
    data: config,
    loading: configLoading,
    error: configError,
    refetch: refetchConfig,
  } = useApi(fetchConfig, [selectedProjectId]);
  const { data: doctorChecks = [], loading: doctorLoading, refetch: refetchDoctor } = useApi(fetchDoctor, [selectedProjectId]);
  const { data: status, refetch: refetchStatus } = useApi(fetchStatus, [selectedProjectId]);
  const [cronActionLoading, setCronActionLoading] = React.useState(false);

  const cronInstalled = status?.crontab?.installed ?? false;
  const cronEntries = status?.crontab?.entries ?? [];

  const handleInstallCron = async () => {
    setCronActionLoading(true);
    try {
      await triggerInstallCron();
      addToast({ title: 'Cron Installed', message: 'Crontab entries have been installed.', type: 'success' });
      refetchStatus();
    } catch (err) {
      addToast({ title: 'Install Failed', message: err instanceof Error ? err.message : 'Failed to install cron', type: 'error' });
    } finally {
      setCronActionLoading(false);
    }
  };

  const handleUninstallCron = async () => {
    setCronActionLoading(true);
    try {
      await triggerUninstallCron();
      addToast({ title: 'Cron Removed', message: 'Crontab entries have been removed.', type: 'success' });
      refetchStatus();
    } catch (err) {
      addToast({ title: 'Uninstall Failed', message: err instanceof Error ? err.message : 'Failed to uninstall cron', type: 'error' });
    } finally {
      setCronActionLoading(false);
    }
  };

  const handleSaveAndInstall = async () => {
    if (!form) return;
    setSaving(true);
    try {
      await updateConfig({
        provider: form.provider,
        defaultBranch: form.defaultBranch,
        branchPrefix: form.branchPrefix,
        reviewerEnabled: form.reviewerEnabled,
        minReviewScore: form.minReviewScore,
        maxRuntime: form.maxRuntime,
        reviewerMaxRuntime: form.reviewerMaxRuntime,
        maxLogSize: form.maxLogSize,
        cronSchedule: form.cronSchedule,
        reviewerSchedule: form.reviewerSchedule,
      });
      refetchConfig();
    } catch (saveError) {
      addToast({ title: 'Save Failed', message: saveError instanceof Error ? saveError.message : 'Failed to save', type: 'error' });
      setSaving(false);
      return;
    }
    setSaving(false);
    await handleInstallCron();
  };

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
        reviewerEnabled: form.reviewerEnabled,
        minReviewScore: form.minReviewScore,
        maxRuntime: form.maxRuntime,
        reviewerMaxRuntime: form.reviewerMaxRuntime,
        maxLogSize: form.maxLogSize,
        cronSchedule: form.cronSchedule,
        reviewerSchedule: form.reviewerSchedule,
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
      id: 'schedules',
      label: 'Schedules',
      content: (
        <div className="space-y-6">
          {/* Cron Status Banner */}
          <Card className={`p-4 flex items-center justify-between ${cronInstalled ? 'border-green-500/30' : 'border-amber-500/30'}`}>
            <div className="flex items-center space-x-3">
              <div className={`p-2 rounded-lg ${cronInstalled ? 'bg-green-500/10 text-green-400' : 'bg-amber-500/10 text-amber-400'}`}>
                {cronInstalled ? <Calendar className="h-5 w-5" /> : <CalendarOff className="h-5 w-5" />}
              </div>
              <div>
                <p className="text-sm font-medium text-slate-200">
                  {cronInstalled ? 'Cron Jobs Active' : 'Cron Jobs Not Installed'}
                </p>
                <p className="text-xs text-slate-500">
                  {cronInstalled
                    ? `${cronEntries.length} crontab entr${cronEntries.length === 1 ? 'y' : 'ies'} installed`
                    : 'Configure schedules below, then click Install to activate'
                  }
                </p>
              </div>
            </div>
            <div className="flex items-center space-x-2">
              {!cronInstalled && (
                <Button
                  size="sm"
                  onClick={handleSaveAndInstall}
                  loading={saving || cronActionLoading}
                >
                  Save & Install
                </Button>
              )}
              <Button
                size="sm"
                variant={cronInstalled ? 'danger' : 'outline'}
                onClick={cronInstalled ? handleUninstallCron : handleInstallCron}
                loading={cronActionLoading}
              >
                {cronInstalled ? 'Uninstall' : 'Install'}
              </Button>
            </div>
          </Card>

          {/* Executor Schedule */}
          <SchedulePicker
            label="Executor Schedule"
            description="How often to pick up and process the next ready PRD."
            value={form.cronSchedule}
            onChange={(v) => updateField('cronSchedule', v)}
          />

          {/* Reviewer Schedule */}
          <SchedulePicker
            label="Reviewer Schedule"
            description="How often to review open pull requests for code quality."
            value={form.reviewerSchedule}
            onChange={(v) => updateField('reviewerSchedule', v)}
          />

          {/* Installed Entries */}
          {cronInstalled && cronEntries.length > 0 && (
            <Card className="p-4">
              <p className="text-xs font-medium text-slate-500 uppercase mb-3">Active Crontab Entries</p>
              <div className="space-y-3">
                {cronEntries.map((entry, i) => {
                  const scheduleMatch = entry.match(/^([^\s]+\s+[^\s]+\s+[^\s]+\s+[^\s]+\s+[^\s]+)\s/);
                  const schedule = scheduleMatch ? scheduleMatch[1] : '';
                  const isReviewer = entry.includes(' review ');
                  const label = isReviewer ? 'Reviewer' : 'Executor';
                  return (
                    <div key={i} className="p-3 bg-slate-950/60 rounded-lg border border-slate-800">
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center space-x-2">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase ${isReviewer ? 'bg-purple-500/10 text-purple-400 border border-purple-500/20' : 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20'}`}>
                            {label}
                          </span>
                          <span className="text-sm text-slate-300">{cronToHuman(schedule)}</span>
                        </div>
                        <span className="text-xs text-slate-600 font-mono">{schedule}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}
        </div>
      ),
    },
    {
      id: 'env',
      label: 'Provider Env',
      content: (
        <Card className="p-6">
          <div className="space-y-2">
            {Object.entries(config.providerEnv).length === 0 ? (
              <p className="text-slate-400 text-sm">No provider environment variables configured.</p>
            ) : (
              Object.entries(config.providerEnv).map(([key, value]) => (
                <div key={key} className="flex items-center justify-between p-3 rounded-md border border-slate-800 bg-slate-950/40">
                  <span className="text-sm font-mono text-slate-300">{key}</span>
                  <span className="text-sm text-slate-500">{value}</span>
                </div>
              ))
            )}
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
