/**
 * Shared webhook validation utility.
 * Used by both the CLI doctor command and the server config routes.
 */

import { IWebhookConfig, NotificationEvent } from '../types.js';

/**
 * Validate a single webhook configuration and return a list of issues.
 * Returns an empty array if the webhook is valid.
 */
export function validateWebhook(webhook: IWebhookConfig): string[] {
  const issues: string[] = [];

  // Validate events
  if (!webhook.events || webhook.events.length === 0) {
    issues.push('No events configured');
  } else {
    const validEvents: NotificationEvent[] = [
      'run_started',
      'run_succeeded',
      'run_failed',
      'run_timeout',
      'review_completed',
      'pr_auto_merged',
      'rate_limit_fallback',
      'qa_completed',
    ];
    for (const event of webhook.events) {
      if (!validEvents.includes(event)) {
        issues.push(`Invalid event: ${event}`);
      }
    }
  }

  // Platform-specific validation
  switch (webhook.type) {
    case 'slack':
      if (!webhook.url) {
        issues.push('Missing URL');
      } else if (!webhook.url.startsWith('https://hooks.slack.com/')) {
        issues.push('URL should start with https://hooks.slack.com/');
      }
      break;
    case 'discord':
      if (!webhook.url) {
        issues.push('Missing URL');
      } else if (!webhook.url.startsWith('https://discord.com/api/webhooks/')) {
        issues.push('URL should start with https://discord.com/api/webhooks/');
      }
      break;
    case 'telegram':
      if (!webhook.botToken) {
        issues.push('Missing botToken');
      }
      if (!webhook.chatId) {
        issues.push('Missing chatId');
      }
      break;
    default:
      issues.push(`Unknown webhook type: ${(webhook as { type: string }).type}`);
  }

  return issues;
}
