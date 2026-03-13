import React from 'react';
import { IBoardProviderConfig, INotificationConfig } from '../../api.js';
import WebhookEditor from '../../components/settings/WebhookEditor.js';
import Card from '../../components/ui/Card';
import Input from '../../components/ui/Input';
import Select from '../../components/ui/Select';
import Switch from '../../components/ui/Switch';

interface IIntegrationsFormFields {
  boardProvider: IBoardProviderConfig;
  notifications: INotificationConfig;
}

interface IIntegrationsTabProps {
  form: IIntegrationsFormFields;
  updateField: <K extends keyof IIntegrationsFormFields>(key: K, value: IIntegrationsFormFields[K]) => void;
}

const IntegrationsTab: React.FC<IIntegrationsTabProps> = ({ form, updateField }) => {
  return (
    <div className="space-y-6">
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
            onChange={(checked) => updateField('boardProvider', { ...form.boardProvider, enabled: checked })}
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

      <Card className="p-6">
        <h3 className="text-lg font-medium text-slate-200 mb-2">Notification Webhooks</h3>
        <WebhookEditor
          notifications={form.notifications}
          onChange={(notifications) => updateField('notifications', notifications)}
        />
      </Card>
    </div>
  );
};

export default IntegrationsTab;
