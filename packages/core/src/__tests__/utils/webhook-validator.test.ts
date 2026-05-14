import { describe, expect, it } from 'vitest';
import { NOTIFICATION_EVENTS, type IWebhookConfig } from '../../types.js';
import { validateWebhook } from '../../utils/webhook-validator.js';

describe('validateWebhook', () => {
  it('accepts every supported notification event', () => {
    const webhook: IWebhookConfig = {
      type: 'telegram',
      botToken: '123456:ABC-DEF',
      chatId: '-1001234567890',
      events: [...NOTIFICATION_EVENTS],
    };

    expect(validateWebhook(webhook)).toEqual([]);
  });

  it('accepts merge, review, and resolver notification events', () => {
    const webhook: IWebhookConfig = {
      type: 'slack',
      url: 'https://hooks.slack.com/services/T00/B00/xxx',
      events: [
        'review_ready_for_human',
        'pr_auto_merged',
        'pr_resolver_completed',
        'pr_resolver_conflict_resolved',
        'pr_resolver_failed',
        'merge_completed',
        'merge_failed',
      ],
    };

    expect(validateWebhook(webhook)).toEqual([]);
  });

  it('rejects unknown notification events', () => {
    const webhook: IWebhookConfig = {
      type: 'discord',
      url: 'https://discord.com/api/webhooks/123/abc',
      events: ['bogus_event' as any],
    };

    expect(validateWebhook(webhook)).toContain('Invalid event: bogus_event');
  });
});
