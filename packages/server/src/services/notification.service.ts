/**
 * NotificationService — injectable wrapper around notification utilities.
 *
 * Encapsulates all notification logic (webhook delivery, Slack Bot API posts,
 * and deliberation triggering) in a single, testable service class.
 * The original utils/notify.ts functions continue to work as-is; this class
 * is the DI-friendly entry point for the server layer.
 */

import 'reflect-metadata';
import { injectable } from 'tsyringe';

import { INightWatchConfig } from '@night-watch/core/types.js';
import {
  INotificationContext,
  buildDescription,
  buildNotificationText,
  formatDiscordPayload,
  formatSlackPayload,
  formatTelegramPayload,
  getEventColor,
  getEventEmoji,
  getEventTitle,
  sendNotifications,
  sendWebhook,
} from '@night-watch/core/utils/notify.js';

export type { INotificationContext };

@injectable()
export class NotificationService {
  /**
   * Send all configured notifications (webhooks + Slack Bot API) for a given event.
   * Delegates to the battle-tested sendNotifications() function in utils/notify.ts.
   */
  async send(config: INightWatchConfig, ctx: INotificationContext): Promise<void> {
    return sendNotifications(config, ctx);
  }

  /**
   * Build a human-readable one-line notification text for the given context.
   */
  buildText(ctx: INotificationContext): string {
    return buildNotificationText(ctx);
  }

  /**
   * Build a multi-line description from the context (used by webhook formatters).
   */
  buildDescription(ctx: INotificationContext): string {
    return buildDescription(ctx);
  }

  /**
   * Format a Slack incoming-webhook payload.
   */
  formatSlack(ctx: INotificationContext): object {
    return formatSlackPayload(ctx);
  }

  /**
   * Format a Discord incoming-webhook payload.
   */
  formatDiscord(ctx: INotificationContext): object {
    return formatDiscordPayload(ctx);
  }

  /**
   * Format a Telegram sendMessage payload.
   */
  formatTelegram(ctx: INotificationContext): { text: string; parse_mode: string } {
    return formatTelegramPayload(ctx);
  }

  /**
   * Get the emoji associated with a notification event.
   */
  getEmoji(ctx: INotificationContext): string {
    return getEventEmoji(ctx.event);
  }

  /**
   * Get the human-readable title for a notification event.
   */
  getTitle(ctx: INotificationContext): string {
    return getEventTitle(ctx.event);
  }

  /**
   * Get the Discord embed colour for a notification event.
   */
  getColor(ctx: INotificationContext): number {
    return getEventColor(ctx.event);
  }

  /**
   * Deliver a notification to a single webhook endpoint.
   * Silently catches errors — never throws.
   */
  async sendWebhook(
    webhook: INightWatchConfig['notifications']['webhooks'][number],
    ctx: INotificationContext
  ): Promise<void> {
    return sendWebhook(webhook, ctx);
  }
}
