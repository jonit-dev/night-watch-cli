import { Edit2, Plus, Trash2 } from 'lucide-react';
import React from 'react';
import { INotificationConfig, IWebhookConfig } from '../../api';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Select from '../ui/Select';

interface IWebhookEditorProps {
  notifications: INotificationConfig;
  onChange: (notifications: INotificationConfig) => void;
}

interface IWebhookFormProps {
  webhook: IWebhookConfig;
  onChange: (wh: IWebhookConfig) => void;
  onSave: () => void;
  onCancel: () => void;
  isNew?: boolean;
}

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

const toggleEvent = (events: IWebhookConfig['events'], event: IWebhookConfig['events'][0]) => {
  return events.includes(event) ? events.filter((e) => e !== event) : [...events, event];
};

const WebhookForm: React.FC<IWebhookFormProps> = ({ webhook, onChange, onSave, onCancel, isNew }) => (
  <div className="p-4 rounded-md border border-slate-700 bg-slate-900/50 space-y-4">
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Select
        label="Type"
        value={webhook.type}
        onChange={(val) => {
          const newType = val as IWebhookConfig['type'];
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
          (webhook.type === 'telegram' ? !webhook.botToken || !webhook.chatId : !webhook.url)
        }
      >
        {isNew ? 'Add Webhook' : 'Save Changes'}
      </Button>
    </div>
  </div>
);

const WebhookEditor: React.FC<IWebhookEditorProps> = ({ notifications, onChange }) => {
  const [editingIndex, setEditingIndex] = React.useState<number | null>(null);
  const [showAddForm, setShowAddForm] = React.useState(false);
  const [newWebhook, setNewWebhook] = React.useState<IWebhookConfig>({
    type: 'slack',
    url: '',
    events: [],
  });

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

  return (
    <div className="space-y-4">
      <div className="text-sm text-slate-400 mb-4">
        Receive notifications when events occur via Slack, Discord, or Telegram
      </div>

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
                        <span key={event} className="px-2 py-0.5 bg-slate-800 rounded text-xs text-slate-400">
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

export default WebhookEditor;
