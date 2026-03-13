/**
 * Notification utilities for Night Watch CLI
 * Sends webhook notifications to Slack, Discord, and Telegram
 */

import { INightWatchConfig, IWebhookConfig, NotificationEvent } from '../types.js';
import { loadGlobalNotificationsConfig } from './global-config.js';
import { info, warn } from './ui.js';
import { extractSummary } from './github.js';

// Alias for backwards compatibility with existing test imports
export type NotificationContext = INotificationContext;

export interface INotificationContext {
  event: NotificationEvent;
  projectName: string;
  prdName?: string;
  branchName?: string;
  prNumber?: number;
  exitCode: number;
  duration?: number;
  provider: string;
  failureReason?: string;
  failureDetail?: string;
  scriptStatus?: string;
  // Enriched PR details (optional — populated when gh CLI is available)
  prUrl?: string;
  prTitle?: string;
  prBody?: string;
  filesChanged?: number;
  additions?: number;
  deletions?: number;
  // Review retry info (optional — populated when retries occurred)
  attempts?: number;
  finalScore?: number;
  // QA screenshots extracted from the QA report comment
  qaScreenshotUrls?: string[];
}

const MAX_QA_SCREENSHOTS_IN_NOTIFICATION = 3;

/**
 * Get the emoji for a notification event
 */
export function getEventEmoji(event: NotificationEvent): string {
  switch (event) {
    case 'run_started':
      return '\uD83D\uDE80';
    case 'run_succeeded':
      return '\u2705';
    case 'run_failed':
      return '\u274C';
    case 'run_timeout':
      return '\u23F0';
    case 'run_no_work':
      return '\uD83D\uDCD6';
    case 'review_completed':
      return '\uD83D\uDD0D';
    case 'review_ready_for_human':
      return '\u2705';
    case 'rate_limit_fallback':
      return '\u26A0\uFE0F';
    case 'pr_auto_merged':
      return '\uD83D\uDD00';
    case 'qa_completed':
      return '\uD83E\uDDEA';
  }
}

/**
 * Get a human-readable title for a notification event
 */
export function getEventTitle(event: NotificationEvent): string {
  switch (event) {
    case 'run_started':
      return 'PRD Execution Started';
    case 'run_succeeded':
      return 'PRD Execution Succeeded';
    case 'run_failed':
      return 'PRD Execution Failed';
    case 'run_timeout':
      return 'PRD Execution Timed Out';
    case 'run_no_work':
      return 'No Eligible Work';
    case 'review_completed':
      return 'PR Review Completed';
    case 'review_ready_for_human':
      return 'PR Ready for Human Review';
    case 'rate_limit_fallback':
      return 'Rate Limit Fallback';
    case 'pr_auto_merged':
      return 'PR Auto-Merged';
    case 'qa_completed':
      return 'QA Completed';
  }
}

/**
 * Get the Discord embed color for a notification event
 */
export function getEventColor(event: NotificationEvent): number {
  switch (event) {
    case 'run_started':
      return 0x3498db;
    case 'run_succeeded':
      return 0x00ff00;
    case 'run_failed':
      return 0xff0000;
    case 'run_timeout':
      return 0xff0000;
    case 'run_no_work':
      return 0x95a5a6;
    case 'review_completed':
      return 0x0099ff;
    case 'review_ready_for_human':
      return 0x00c853;
    case 'rate_limit_fallback':
      return 0xffa500;
    case 'pr_auto_merged':
      return 0x9b59b6;
    case 'qa_completed':
      return 0x2ecc71;
  }
}

/**
 * Build a description string from notification context
 */
export function buildDescription(ctx: INotificationContext): string {
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
  if (ctx.scriptStatus && ctx.event !== 'run_succeeded') {
    lines.push(`Status: ${ctx.scriptStatus}`);
  }
  if (ctx.failureReason) {
    lines.push(`Failure reason: ${ctx.failureReason}`);
  }
  if (ctx.failureDetail) {
    lines.push(`Details: ${ctx.failureDetail}`);
  }
  if (ctx.event === 'run_timeout') {
    lines.push('Cause: Execution hit the max runtime limit and was terminated.');
    lines.push(
      'Resume: Progress is checkpointed on timeout, and the next run resumes from that branch state.',
    );
    lines.push('Recommendation: Avoid huge PRDs; slice large work into smaller PRDs/phases.');
  }
  // Include retry info for review events when attempts > 1
  if (ctx.event === 'review_completed' && ctx.attempts !== undefined && ctx.attempts > 1) {
    const retryInfo = `Attempts: ${ctx.attempts}`;
    if (ctx.finalScore !== undefined) {
      lines.push(`${retryInfo} (final score: ${ctx.finalScore}/100)`);
    } else {
      lines.push(retryInfo);
    }
  }

  if (ctx.event === 'qa_completed' && (ctx.qaScreenshotUrls?.length ?? 0) > 0) {
    const screenshotUrls = ctx.qaScreenshotUrls ?? [];
    lines.push(`QA screenshots: ${screenshotUrls.length}`);
    for (const [index, screenshotUrl] of screenshotUrls
      .slice(0, MAX_QA_SCREENSHOTS_IN_NOTIFICATION)
      .entries()) {
      lines.push(`Screenshot ${index + 1}: ${screenshotUrl}`);
    }
    if (screenshotUrls.length > MAX_QA_SCREENSHOTS_IN_NOTIFICATION) {
      lines.push(
        `Additional screenshots: ${screenshotUrls.length - MAX_QA_SCREENSHOTS_IN_NOTIFICATION}`,
      );
    }
  }

  return lines.join('\n');
}

/**
 * Escape special characters for Telegram MarkdownV2 format
 */
function escapeMarkdownV2(text: string): string {
  return text.replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&');
}

/**
 * Format a notification payload for Slack incoming webhooks
 */
export function formatSlackPayload(ctx: INotificationContext): object {
  const emoji = getEventEmoji(ctx.event);
  const title = getEventTitle(ctx.event);
  const description = buildDescription(ctx);

  let color: string;
  if (ctx.event === 'run_succeeded') {
    color = '#00ff00';
  } else if (ctx.event === 'run_started') {
    color = '#3498db';
  } else if (ctx.event === 'review_completed') {
    color = '#0099ff';
  } else if (ctx.event === 'review_ready_for_human') {
    color = '#00c853';
  } else {
    color = '#ff0000';
  }

  return {
    attachments: [
      {
        color,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
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
export function formatDiscordPayload(ctx: INotificationContext): object {
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
 * Build a structured Telegram message when PR details are available.
 * Falls back to the basic format when they are not.
 */
export function formatTelegramPayload(ctx: INotificationContext): {
  text: string;
  parse_mode: string;
} {
  const emoji = getEventEmoji(ctx.event);
  const title = ctx.event === 'run_succeeded' ? 'PR Opened' : getEventTitle(ctx.event);

  // If PR details are present, use the rich structured template
  if (ctx.prUrl && ctx.prTitle) {
    const lines: string[] = [];

    lines.push(`*${escapeMarkdownV2(emoji + ' ' + title)}*`);
    lines.push('');
    lines.push(
      `${escapeMarkdownV2('📋')} *${escapeMarkdownV2('PR #' + (ctx.prNumber ?? '') + ': ' + ctx.prTitle)}*`,
    );
    lines.push(`${escapeMarkdownV2('🔗')} ${escapeMarkdownV2(ctx.prUrl)}`);

    // Summary from PR body
    if (ctx.prBody && ctx.prBody.trim().length > 0) {
      const summary = extractSummary(ctx.prBody);
      if (summary) {
        lines.push('');
        lines.push(`${escapeMarkdownV2('📝 Summary')}`);
        lines.push(escapeMarkdownV2(summary));
      }
    }

    // Stats
    if (ctx.filesChanged !== undefined || ctx.additions !== undefined) {
      lines.push('');
      lines.push(`${escapeMarkdownV2('📊 Stats')}`);
      const stats: string[] = [];
      if (ctx.filesChanged !== undefined) {
        stats.push(`Files changed: ${ctx.filesChanged}`);
      }
      if (ctx.additions !== undefined && ctx.deletions !== undefined) {
        stats.push(`+${ctx.additions} / -${ctx.deletions}`);
      }
      lines.push(escapeMarkdownV2(stats.join(' | ')));
    }

    if (ctx.event === 'review_completed' && ctx.attempts !== undefined && ctx.attempts > 1) {
      lines.push('');
      if (ctx.finalScore !== undefined) {
        lines.push(
          escapeMarkdownV2(`🔁 Attempts: ${ctx.attempts} (final score: ${ctx.finalScore}/100)`),
        );
      } else {
        lines.push(escapeMarkdownV2(`🔁 Attempts: ${ctx.attempts}`));
      }
    }

    if (ctx.event === 'review_ready_for_human') {
      lines.push('');
      if (ctx.finalScore !== undefined) {
        lines.push(escapeMarkdownV2(`🏆 Score: ${ctx.finalScore}/100 — no changes needed`));
      }
      lines.push(escapeMarkdownV2('👤 Action required: human review & merge'));
    }

    if (ctx.event === 'qa_completed' && (ctx.qaScreenshotUrls?.length ?? 0) > 0) {
      const screenshotUrls = ctx.qaScreenshotUrls ?? [];
      lines.push('');
      lines.push(escapeMarkdownV2('🖼 Screenshots'));
      for (const screenshotUrl of screenshotUrls.slice(0, MAX_QA_SCREENSHOTS_IN_NOTIFICATION)) {
        lines.push(escapeMarkdownV2(screenshotUrl));
      }
      if (screenshotUrls.length > MAX_QA_SCREENSHOTS_IN_NOTIFICATION) {
        lines.push(
          escapeMarkdownV2(
            `...and ${screenshotUrls.length - MAX_QA_SCREENSHOTS_IN_NOTIFICATION} more`,
          ),
        );
      }
    }

    // Footer
    lines.push('');
    lines.push(escapeMarkdownV2(`⚙️ Project: ${ctx.projectName} | Provider: ${ctx.provider}`));

    return {
      text: lines.join('\n'),
      parse_mode: 'MarkdownV2',
    };
  }

  // Fallback: basic format (no PR details)
  const description = buildDescription(ctx);
  return {
    text: `*${escapeMarkdownV2(emoji + ' ' + title)}*\n\n${escapeMarkdownV2(description)}`,
    parse_mode: 'MarkdownV2',
  };
}

/**
 * Send a notification to a single webhook endpoint
 * Silently catches errors — never throws
 */
export async function sendWebhook(
  webhook: IWebhookConfig,
  ctx: INotificationContext,
): Promise<void> {
  // Skip if this event is not in the webhook's configured events
  if (!webhook.events.includes(ctx.event)) {
    return;
  }

  try {
    let url: string;
    let body: string;

    switch (webhook.type) {
      case 'slack': {
        url = webhook.url!;
        body = JSON.stringify(formatSlackPayload(ctx));
        break;
      }
      case 'discord': {
        url = webhook.url!;
        body = JSON.stringify(formatDiscordPayload(ctx));
        break;
      }
      case 'telegram': {
        url = `https://api.telegram.org/bot${webhook.botToken}/sendMessage`;
        const telegramPayload = formatTelegramPayload(ctx);
        body = JSON.stringify({ chat_id: webhook.chatId, ...telegramPayload });
        break;
      }
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });

    // Check for non-2xx responses and treat as failure
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    warn(`Notification failed (${webhook.type}): ${message}`);
  }
}

function webhookIdentity(wh: IWebhookConfig): string {
  if (wh.type === 'telegram') return `telegram:${wh.botToken}:${wh.chatId}`;
  return `${wh.type}:${wh.url}`;
}

/**
 * Send notifications to all configured webhooks, merging in the global webhook if set.
 */
export async function sendNotifications(
  config: INightWatchConfig,
  ctx: INotificationContext,
): Promise<void> {
  const projectWebhooks = config.notifications?.webhooks ?? [];
  const globalConfig = loadGlobalNotificationsConfig();

  const allWebhooks = [...projectWebhooks];
  if (globalConfig.webhook) {
    const projectIds = new Set(projectWebhooks.map(webhookIdentity));
    if (!projectIds.has(webhookIdentity(globalConfig.webhook))) {
      allWebhooks.push(globalConfig.webhook);
    }
  }

  if (allWebhooks.length === 0) {
    return;
  }

  const results = await Promise.allSettled(allWebhooks.map((wh) => sendWebhook(wh, ctx)));
  const sent = results.filter((r) => r.status === 'fulfilled').length;
  info(`Sent ${sent}/${allWebhooks.length} notifications`);
}
