import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { IBoardProviderConfig, INotificationConfig, IWebhookTriggerConfig } from '../../../api';
import IntegrationsTab from '../IntegrationsTab';

describe('IntegrationsTab', () => {
  it('should render inbound webhook trigger settings', () => {
    const boardProvider: IBoardProviderConfig = {
      enabled: true,
      provider: 'github',
    };
    const notifications: INotificationConfig = {
      webhooks: [],
    };
    const webhookTriggers: IWebhookTriggerConfig = {
      enabled: false,
      secretEnv: 'NIGHT_WATCH_WEBHOOK_SECRET',
      allowedJobIds: ['reviewer', 'qa'],
      requireTimestamp: false,
      maxSkewSeconds: 300,
      github: {
        enabled: true,
        events: ['workflow_run'],
        rules: [{ event: 'workflow_run', action: 'completed', jobId: 'qa' }],
      },
    };

    const { container } = render(
      <IntegrationsTab
        form={{ boardProvider, notifications, webhookTriggers }}
        updateField={vi.fn()}
      />,
    );

    expect(screen.getByText('Inbound Webhook Triggers')).toBeInTheDocument();
    expect(container.querySelector('input[name="webhookTriggers.enabled"]')).toBeInTheDocument();
  });
});
