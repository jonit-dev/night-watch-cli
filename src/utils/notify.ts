/**
 * Notification utilities for Night Watch CLI
 * Sends webhook notifications to Slack, Discord, and Telegram
 */

import { INightWatchConfig, WebhookConfig, NotificationEvent } from "../types.js";
import { warn, info } from "./ui.js";

export interface NotificationContext {
  event: NotificationEvent;
  projectName: string;
  prdName?: string;
  branchName?: string;
  prNumber?: number;
  exitCode: number;
  duration?: number;
  provider: string;
}

/**
 * Get the emoji for a notification event
 */
export function getEventEmoji(event: NotificationEvent): string {
  switch (event) {
    case "run_succeeded":
      return "\u2705";
    case "run_failed":
      return "\u274C";
    case "run_timeout":
      return "\u23F0";
    case "review_completed":
      return "\uD83D\uDD0D";
  }
}

/**
 * Get a human-readable title for a notification event
 */
export function getEventTitle(event: NotificationEvent): string {
  switch (event) {
    case "run_succeeded":
      return "PRD Execution Succeeded";
    case "run_failed":
      return "PRD Execution Failed";
    case "run_timeout":
      return "PRD Execution Timed Out";
    case "review_completed":
      return "PR Review Completed";
  }
}

/**
 * Get the Discord embed color for a notification event
 */
export function getEventColor(event: NotificationEvent): number {
  switch (event) {
    case "run_succeeded":
      return 0x00ff00;
    case "run_failed":
      return 0xff0000;
    case "run_timeout":
      return 0xff0000;
    case "review_completed":
      return 0x0099ff;
  }
}

/**
 * Build a description string from notification context
 */
export function buildDescription(ctx: NotificationContext): string {
  const lines: string[] = [];
  lines.push(`Project: ${ctx.projectName}`);
  lines.push(`Provider: ${ctx.provider}`);
  lines.push(`Exit code: ${ctx.exitCode}`);
  if (ctx.prdName) {
    lines.push(`PRD: ${ctx.prdName}`);
  }
  if (ctx.branchName) {
    lines.push(`Branch: ${ctx.branchName}`);
  }
  if (ctx.prNumber !== undefined) {
    lines.push(`PR: #${ctx.prNumber}`);
  }
  if (ctx.duration !== undefined) {
    lines.push(`Duration: ${ctx.duration}s`);
  }
  return lines.join("\n");
}

/**
 * Escape special characters for Telegram MarkdownV2 format
 */
function escapeMarkdownV2(text: string): string {
  return text.replace(/[_*[\]()~`>#+=|{}.!-]/g, "\\$&");
}

/**
 * Format a notification payload for Slack incoming webhooks
 */
export function formatSlackPayload(ctx: NotificationContext): object {
  const emoji = getEventEmoji(ctx.event);
  const title = getEventTitle(ctx.event);
  const description = buildDescription(ctx);

  let color: string;
  if (ctx.event === "run_succeeded") {
    color = "#00ff00";
  } else if (ctx.event === "review_completed") {
    color = "#0099ff";
  } else {
    color = "#ff0000";
  }

  return {
    attachments: [
      {
        color,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*${emoji} ${title}*\n${description}`,
            },
          },
        ],
      },
    ],
  };
}

/**
 * Format a notification payload for Discord webhooks
 */
export function formatDiscordPayload(ctx: NotificationContext): object {
  const emoji = getEventEmoji(ctx.event);
  const title = getEventTitle(ctx.event);
  const description = buildDescription(ctx);

  return {
    embeds: [
      {
        title: `${emoji} ${title}`,
        description,
        color: getEventColor(ctx.event),
        timestamp: new Date().toISOString(),
      },
    ],
  };
}

/**
 * Format a notification payload for Telegram Bot API
 */
export function formatTelegramPayload(ctx: NotificationContext): {
  text: string;
  parse_mode: string;
} {
  const emoji = getEventEmoji(ctx.event);
  const title = getEventTitle(ctx.event);
  const description = buildDescription(ctx);

  return {
    text: `*${escapeMarkdownV2(emoji + " " + title)}*\n\n${escapeMarkdownV2(description)}`,
    parse_mode: "MarkdownV2",
  };
}

/**
 * Send a notification to a single webhook endpoint
 * Silently catches errors — never throws
 */
export async function sendWebhook(webhook: WebhookConfig, ctx: NotificationContext): Promise<void> {
  // Skip if this event is not in the webhook's configured events
  if (!webhook.events.includes(ctx.event)) {
    return;
  }

  try {
    let url: string;
    let body: string;

    switch (webhook.type) {
      case "slack": {
        url = webhook.url!;
        body = JSON.stringify(formatSlackPayload(ctx));
        break;
      }
      case "discord": {
        url = webhook.url!;
        body = JSON.stringify(formatDiscordPayload(ctx));
        break;
      }
      case "telegram": {
        url = `https://api.telegram.org/bot${webhook.botToken}/sendMessage`;
        const telegramPayload = formatTelegramPayload(ctx);
        body = JSON.stringify({ chat_id: webhook.chatId, ...telegramPayload });
        break;
      }
    }

    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    warn(`Notification failed (${webhook.type}): ${message}`);
  }
}

/**
 * Send notifications to all configured webhooks
 */
export async function sendNotifications(
  config: INightWatchConfig,
  ctx: NotificationContext
): Promise<void> {
  if (!config.notifications || config.notifications.webhooks.length === 0) {
    return;
  }

  const webhooks = config.notifications.webhooks;
  const results = await Promise.allSettled(webhooks.map((wh) => sendWebhook(wh, ctx)));

  const sent = results.filter((r) => r.status === "fulfilled").length;
  const total = webhooks.length;
  info(`Sent ${sent}/${total} notifications`);
}
