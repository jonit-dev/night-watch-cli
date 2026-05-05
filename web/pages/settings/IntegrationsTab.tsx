import { Clipboard, Plus, Trash2 } from 'lucide-react';
import React from 'react';
import {
  IBoardProviderConfig,
  INotificationConfig,
  IWebhookConfig,
  IWebhookTriggerConfig,
  IWebhookTriggerGithubRule,
  JobType,
} from '../../api.js';
import WebhookEditor from '../../components/settings/WebhookEditor.js';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';
import Input from '../../components/ui/Input';
import Select from '../../components/ui/Select';
import Switch from '../../components/ui/Switch';

interface IIntegrationsFormFields {
  boardProvider: IBoardProviderConfig;
  notifications: INotificationConfig;
  webhookTriggers: IWebhookTriggerConfig;
}

interface IIntegrationsTabProps {
  form: IIntegrationsFormFields;
  updateField: <K extends keyof IIntegrationsFormFields>(key: K, value: IIntegrationsFormFields[K]) => void;
  globalWebhook?: IWebhookConfig | null;
  isGlobalMode?: boolean;
  onSetGlobal?: (webhook: IWebhookConfig) => Promise<void>;
  onUnsetGlobal?: () => Promise<void>;
  selectedProjectId?: string | null;
}

const webhookJobOptions: Array<{ label: string; value: JobType }> = [
  { label: 'Executor', value: 'executor' },
  { label: 'Reviewer', value: 'reviewer' },
  { label: 'QA', value: 'qa' },
  { label: 'Audit', value: 'audit' },
  { label: 'Slicer / Planner', value: 'slicer' },
  { label: 'Analytics', value: 'analytics' },
  { label: 'PR Resolver', value: 'pr-resolver' },
  { label: 'Merger', value: 'merger' },
];

const githubEventOptions = [
  { label: 'workflow_run', value: 'workflow_run' },
  { label: 'check_suite', value: 'check_suite' },
  { label: 'pull_request', value: 'pull_request' },
  { label: 'repository_dispatch', value: 'repository_dispatch' },
];

function encodeProjectId(id: string): string {
  return encodeURIComponent(id.replace(/\//g, '~'));
}

function getOrigin(): string {
  if (typeof window === 'undefined' || window.location.origin === 'null') return '';
  return window.location.origin;
}

function formatBranches(branchPatterns?: string[]): string {
  return branchPatterns?.join(', ') ?? '';
}

function parseBranches(value: string): string[] | undefined {
  const branches = value.split(',').map((part) => part.trim()).filter(Boolean);
  return branches.length > 0 ? branches : undefined;
}

function createGithubRule(jobId: JobType): IWebhookTriggerGithubRule {
  return {
    event: 'workflow_run',
    action: 'completed',
    jobId,
  };
}

function buildEndpointUrl(isGlobalMode: boolean, selectedProjectId: string | null | undefined, jobId: JobType): string {
  const path =
    isGlobalMode && selectedProjectId
      ? `/api/projects/${encodeProjectId(selectedProjectId)}/jobs/${jobId}/run`
      : `/api/jobs/${jobId}/run`;
  return `${getOrigin()}${path}`;
}

function buildCurlExample(endpointUrl: string): string {
  return [
    `payload='{"source":"manual"}'`,
    'signature=$(printf \'%s\' "$payload" | openssl dgst -sha256 -hmac "$NIGHT_WATCH_WEBHOOK_SECRET" | awk \'{print $2}\')',
    `curl -X POST '${endpointUrl}' \\`,
    "  -H 'Content-Type: application/json' \\",
    '  -H "X-Night-Watch-Signature: sha256=$signature" \\',
    '  --data "$payload"',
  ].join('\n');
}

const IntegrationsTab: React.FC<IIntegrationsTabProps> = ({
  form,
  updateField,
  globalWebhook,
  isGlobalMode = false,
  onSetGlobal,
  onUnsetGlobal,
  selectedProjectId,
}) => {
  const [copied, setCopied] = React.useState<'curl' | 'endpoint' | null>(null);
  const webhookTriggers = form.webhookTriggers;
  const endpointJobId = webhookTriggers.allowedJobIds[0] ?? 'reviewer';
  const endpointUrl = buildEndpointUrl(isGlobalMode, selectedProjectId, endpointJobId);
  const curlExample = buildCurlExample(endpointUrl);

  const updateWebhookTriggers = (updates: Partial<IWebhookTriggerConfig>) => {
    updateField('webhookTriggers', {
      ...webhookTriggers,
      ...updates,
    });
  };

  const updateGithub = (updates: Partial<IWebhookTriggerConfig['github']>) => {
    updateWebhookTriggers({
      github: {
        ...webhookTriggers.github,
        ...updates,
      },
    });
  };

  const toggleAllowedJob = (jobId: JobType) => {
    const allowedJobIds = webhookTriggers.allowedJobIds.includes(jobId)
      ? webhookTriggers.allowedJobIds.filter((id) => id !== jobId)
      : [...webhookTriggers.allowedJobIds, jobId];
    updateWebhookTriggers({ allowedJobIds });
  };

  const toggleGithubEvent = (event: string) => {
    const events = webhookTriggers.github.events.includes(event)
      ? webhookTriggers.github.events.filter((id) => id !== event)
      : [...webhookTriggers.github.events, event];
    updateGithub({ events });
  };

  const updateRule = (index: number, updates: Partial<IWebhookTriggerGithubRule>) => {
    const rules = webhookTriggers.github.rules.map((rule, ruleIndex) =>
      ruleIndex === index ? { ...rule, ...updates } : rule,
    );
    updateGithub({ rules });
  };

  const removeRule = (index: number) => {
    updateGithub({ rules: webhookTriggers.github.rules.filter((_, ruleIndex) => ruleIndex !== index) });
  };

  const copyText = async (value: string, target: 'curl' | 'endpoint') => {
    await navigator.clipboard?.writeText(value);
    setCopied(target);
    window.setTimeout(() => setCopied(null), 1500);
  };

  return (
    <div className="space-y-6">
      <Card className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-medium text-slate-200">Board Provider</h3>
            <p className="text-sm text-slate-400 mt-1">
              Track PRDs and their status using GitHub Projects or local SQLite
            </p>
          </div>
          <Switch
            checked={form.boardProvider.enabled}
            onChange={(checked) => updateField('boardProvider', { ...form.boardProvider, enabled: checked })}
          />
        </div>
        {form.boardProvider.enabled && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-6 border-t border-slate-800">
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

      <Card className="p-6 space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="text-lg font-medium text-slate-200">Inbound Webhook Triggers</h3>
            <p className="text-sm text-slate-400 mt-1">Run signed Night Watch jobs from external systems</p>
          </div>
          <Switch
            checked={webhookTriggers.enabled}
            label="Enabled"
            name="webhookTriggers.enabled"
            onChange={(checked) => updateWebhookTriggers({ enabled: checked })}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-6 border-t border-slate-800">
          <Input
            label="Secret Environment Variable"
            name="webhookTriggers.secretEnv"
            value={webhookTriggers.secretEnv}
            onChange={(e) => updateWebhookTriggers({ secretEnv: e.target.value })}
            helperText="Server environment variable containing the shared HMAC secret"
          />
          <Input
            label="Signature Max Skew"
            min={0}
            name="webhookTriggers.maxSkewSeconds"
            type="number"
            value={String(webhookTriggers.maxSkewSeconds)}
            onChange={(e) =>
              updateWebhookTriggers({
                maxSkewSeconds: e.target.value ? Math.max(0, Number(e.target.value)) : 0,
              })
            }
            helperText="Seconds, used when timestamp validation is required"
          />
          <div className="md:col-span-2">
            <Switch
              checked={webhookTriggers.requireTimestamp}
              label="Require timestamp header"
              name="webhookTriggers.requireTimestamp"
              onChange={(checked) => updateWebhookTriggers({ requireTimestamp: checked })}
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-400 mb-2">Allowed Jobs</label>
          <div className="flex flex-wrap gap-2">
            {webhookJobOptions.map((job) => (
              <button
                key={job.value}
                type="button"
                aria-pressed={webhookTriggers.allowedJobIds.includes(job.value)}
                onClick={() => toggleAllowedJob(job.value)}
                className={`px-3 py-1.5 rounded-md text-sm transition-colors ${
                  webhookTriggers.allowedJobIds.includes(job.value)
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                }`}
              >
                {job.label}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-end gap-2">
            <Input label="Endpoint URL" readOnly value={endpointUrl} />
            <Button
              aria-label="Copy endpoint URL"
              size="icon"
              type="button"
              variant="outline"
              onClick={() => copyText(endpointUrl, 'endpoint')}
            >
              <Clipboard className="h-4 w-4" />
            </Button>
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-slate-400">Signed curl Example</label>
              <Button size="sm" type="button" variant="ghost" onClick={() => copyText(curlExample, 'curl')}>
                <Clipboard className="h-4 w-4 mr-2" />
                {copied === 'curl' ? 'Copied' : 'Copy'}
              </Button>
            </div>
            <pre className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-950 p-3 text-xs text-slate-300">
              <code>{curlExample}</code>
            </pre>
          </div>
        </div>

        <div className="space-y-4 pt-6 border-t border-slate-800">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h4 className="text-sm font-medium text-slate-300">GitHub Events</h4>
              <p className="text-xs text-slate-500 mt-1">Rules dispatch the configured job when GitHub payloads match</p>
            </div>
            <Switch
              checked={webhookTriggers.github.enabled}
              label="Enabled"
              name="webhookTriggers.github.enabled"
              onChange={(checked) => updateGithub({ enabled: checked })}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-400 mb-2">Selected Events</label>
            <div className="flex flex-wrap gap-2">
              {githubEventOptions.map((event) => (
                <button
                  key={event.value}
                  type="button"
                  aria-pressed={webhookTriggers.github.events.includes(event.value)}
                  onClick={() => toggleGithubEvent(event.value)}
                  className={`px-3 py-1.5 rounded-md text-sm transition-colors ${
                    webhookTriggers.github.events.includes(event.value)
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                  }`}
                >
                  {event.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            {webhookTriggers.github.rules.map((rule, index) => (
              <div key={index} className="rounded-lg border border-slate-800 bg-slate-950/40 p-4 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <Select
                    label="Event"
                    value={rule.event}
                    onChange={(value) => updateRule(index, { event: value })}
                    options={githubEventOptions}
                  />
                  <Input
                    label="Action"
                    value={rule.action ?? ''}
                    onChange={(e) => updateRule(index, { action: e.target.value || undefined })}
                    placeholder="completed"
                  />
                  <Select
                    label="Job"
                    value={rule.jobId}
                    onChange={(value) => updateRule(index, { jobId: value as JobType })}
                    options={webhookJobOptions}
                  />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_auto] gap-4 md:items-end">
                  <Input
                    label="Branch Patterns"
                    value={formatBranches(rule.branchPatterns)}
                    onChange={(e) => updateRule(index, { branchPatterns: parseBranches(e.target.value) })}
                    placeholder="main, release/*"
                  />
                  <Switch
                    checked={rule.onlyOnFailure ?? false}
                    label="Only failures"
                    onChange={(checked) => updateRule(index, { onlyOnFailure: checked })}
                  />
                  <Button
                    aria-label={`Delete GitHub rule ${index + 1}`}
                    size="icon"
                    type="button"
                    variant="ghost"
                    onClick={() => removeRule(index)}
                  >
                    <Trash2 className="h-4 w-4 text-red-400" />
                  </Button>
                </div>
              </div>
            ))}
            <Button
              type="button"
              variant="ghost"
              onClick={() =>
                updateGithub({
                  rules: [...webhookTriggers.github.rules, createGithubRule(endpointJobId)],
                })
              }
            >
              <Plus className="h-4 w-4 mr-2" />
              Add GitHub Rule
            </Button>
          </div>
        </div>
      </Card>

      <Card className="p-6">
        <h3 className="text-lg font-medium text-slate-200 mb-2">Notification Webhooks</h3>
        <p className="text-sm text-slate-400 mb-6">
          Send status updates and job results to custom endpoints or team channels
        </p>
        <WebhookEditor
          notifications={form.notifications}
          onChange={(notifications) => updateField('notifications', notifications)}
          globalWebhook={globalWebhook}
          onSetGlobal={onSetGlobal}
          onUnsetGlobal={onUnsetGlobal}
        />
      </Card>
    </div>
  );
};

export default IntegrationsTab;
