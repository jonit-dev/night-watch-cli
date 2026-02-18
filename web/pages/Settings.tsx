import React from 'react';
import { Save, RotateCcw, Activity, AlertCircle } from 'lucide-react';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import Input from '../components/ui/Input';
import Select from '../components/ui/Select';
import Tabs from '../components/ui/Tabs';
import Switch from '../components/ui/Switch';
import { useStore } from '../store/useStore';
import { fetchConfig, fetchDoctor, NightWatchConfig, updateConfig, useApi } from '../api';

type ConfigForm = {
  provider: NightWatchConfig['provider'];
  defaultBranch: string;
  branchPrefix: string;
  reviewerEnabled: boolean;
  minReviewScore: number;
  maxRuntime: number;
  reviewerMaxRuntime: number;
  maxLogSize: number;
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
});

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
        reviewerEnabled: form.reviewerEnabled,
        minReviewScore: form.minReviewScore,
        maxRuntime: form.maxRuntime,
        reviewerMaxRuntime: form.reviewerMaxRuntime,
        maxLogSize: form.maxLogSize,
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
