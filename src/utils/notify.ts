/**
 * Notification utilities for Night Watch CLI
 * Sends webhook notifications to Slack, Discord, and Telegram
 */

import { INightWatchConfig, ISlackBotConfig, IWebhookConfig, NotificationEvent } from "../types.js";
import { IDiscussionTrigger } from "../../shared/types.js";
import { info, warn } from "./ui.js";
import { extractSummary } from "./github.js";
import { SlackClient } from "../slack/client.js";
import { DeliberationEngine } from "../slack/deliberation.js";
import { getRepositories } from "../storage/repositories/index.js";

export interface INotificationContext {
  event: NotificationEvent;
  projectName: string;
  prdName?: string;
  branchName?: string;
  prNumber?: number;
  exitCode: number;
  duration?: number;
  provider: string;
  // Enriched PR details (optional — populated when gh CLI is available)
  prUrl?: string;
  prTitle?: string;
  prBody?: string;
  filesChanged?: number;
  additions?: number;
  deletions?: number;
}

/**
 * Get the emoji for a notification event
 */
export function getEventEmoji(event: NotificationEvent): string {
  switch (event) {
    case "run_started":
      return "\uD83D\uDE80";
    case "run_succeeded":
      return "\u2705";
    case "run_failed":
      return "\u274C";
    case "run_timeout":
      return "\u23F0";
    case "review_completed":
      return "\uD83D\uDD0D";
    case "rate_limit_fallback":
      return "\u26A0\uFE0F";
    case "pr_auto_merged":
      return "\uD83D\uDD00";
    case "qa_completed":
      return "\uD83E\uDDEA";
  }
}

/**
 * Get a human-readable title for a notification event
 */
export function getEventTitle(event: NotificationEvent): string {
  switch (event) {
    case "run_started":
      return "PRD Execution Started";
    case "run_succeeded":
      return "PRD Execution Succeeded";
    case "run_failed":
      return "PRD Execution Failed";
    case "run_timeout":
      return "PRD Execution Timed Out";
    case "review_completed":
      return "PR Review Completed";
    case "rate_limit_fallback":
      return "Rate Limit Fallback";
    case "pr_auto_merged":
      return "PR Auto-Merged";
    case "qa_completed":
      return "QA Completed";
  }
}

/**
 * Get the Discord embed color for a notification event
 */
export function getEventColor(event: NotificationEvent): number {
  switch (event) {
    case "run_started":
      return 0x3498db;
    case "run_succeeded":
      return 0x00ff00;
    case "run_failed":
      return 0xff0000;
    case "run_timeout":
      return 0xff0000;
    case "review_completed":
      return 0x0099ff;
    case "rate_limit_fallback":
      return 0xffa500;
    case "pr_auto_merged":
      return 0x9b59b6;
    case "qa_completed":
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
export function formatSlackPayload(ctx: INotificationContext): object {
  const emoji = getEventEmoji(ctx.event);
  const title = getEventTitle(ctx.event);
  const description = buildDescription(ctx);

  let color: string;
  if (ctx.event === "run_succeeded") {
    color = "#00ff00";
  } else if (ctx.event === "run_started") {
    color = "#3498db";
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
  const title = getEventTitle(ctx.event);

  // If PR details are present, use the rich structured template
  if (ctx.prUrl && ctx.prTitle) {
    const lines: string[] = [];

    lines.push(`*${escapeMarkdownV2(emoji + " " + title)}*`);
    lines.push("");
    lines.push(`${escapeMarkdownV2("📋")} *${escapeMarkdownV2("PR #" + (ctx.prNumber ?? "") + ": " + ctx.prTitle)}*`);
    lines.push(`${escapeMarkdownV2("🔗")} ${escapeMarkdownV2(ctx.prUrl)}`);

    // Summary from PR body
    if (ctx.prBody && ctx.prBody.trim().length > 0) {
      const summary = extractSummary(ctx.prBody);
      if (summary) {
        lines.push("");
        lines.push(`${escapeMarkdownV2("📝 Summary")}`);
        lines.push(escapeMarkdownV2(summary));
      }
    }

    // Stats
    if (ctx.filesChanged !== undefined || ctx.additions !== undefined) {
      lines.push("");
      lines.push(`${escapeMarkdownV2("📊 Stats")}`);
      const stats: string[] = [];
      if (ctx.filesChanged !== undefined) {
        stats.push(`Files changed: ${ctx.filesChanged}`);
      }
      if (ctx.additions !== undefined && ctx.deletions !== undefined) {
        stats.push(`+${ctx.additions} / -${ctx.deletions}`);
      }
      lines.push(escapeMarkdownV2(stats.join(" | ")));
    }

    // Footer
    lines.push("");
    lines.push(escapeMarkdownV2(`⚙️ Project: ${ctx.projectName} | Provider: ${ctx.provider}`));

    return {
      text: lines.join("\n"),
      parse_mode: "MarkdownV2",
    };
  }

  // Fallback: basic format (no PR details)
  const description = buildDescription(ctx);
  return {
    text: `*${escapeMarkdownV2(emoji + " " + title)}*\n\n${escapeMarkdownV2(description)}`,
    parse_mode: "MarkdownV2",
  };
}

/**
 * Build a one-line notification text for Slack Bot API posts
 */
function buildQaNotificationText(ctx: INotificationContext): string {
  const prLabel = ctx.prNumber !== undefined ? `PR #${ctx.prNumber}` : "the latest PR";
  const prRef = ctx.prUrl ? `<${ctx.prUrl}|${prLabel}>` : prLabel;
  const project = ctx.projectName;

  if (ctx.exitCode === 0) {
    return `Finished QA on ${prRef} for ${project}.`;
  }

  return `I ran QA on ${prRef} for ${project}, but it failed. I'll check the logs.`;
}

export function buildNotificationText(ctx: INotificationContext): string {
  if (ctx.event === "qa_completed") {
    return buildQaNotificationText(ctx);
  }

  const emoji = getEventEmoji(ctx.event);
  const title = getEventTitle(ctx.event);
  const parts: string[] = [`${emoji} *${title}*`, `Project: ${ctx.projectName}`];
  if (ctx.prdName) parts.push(`PRD: ${ctx.prdName}`);
  if (ctx.branchName) parts.push(`Branch: ${ctx.branchName}`);
  if (ctx.prNumber !== undefined) parts.push(`PR: #${ctx.prNumber}`);
  if (ctx.prUrl) parts.push(`<${ctx.prUrl}|View PR>`);
  if (ctx.duration !== undefined) parts.push(`Duration: ${ctx.duration}s`);
  return parts.join(" | ");
}

/**
 * Determine which agent persona name should post for a given event
 */
function getPersonaNameForEvent(event: NotificationEvent): string {
  switch (event) {
    case "run_started":
    case "run_succeeded":
    case "run_failed":
    case "run_timeout":
      return "Dev";
    case "review_completed":
    case "pr_auto_merged":
      return "Carlos";
    case "qa_completed":
      return "Priya";
    default:
      return "Carlos";
  }
}

/**
 * Determine which Slack channel to post to for a given event
 */
function getChannelForEvent(event: NotificationEvent, slackConfig: ISlackBotConfig): string {
  switch (event) {
    case "run_started":
    case "run_succeeded":
    case "run_failed":
    case "run_timeout":
    case "rate_limit_fallback":
      return slackConfig.channels.eng;
    case "review_completed":
    case "pr_auto_merged":
      return slackConfig.channels.prs;
    case "qa_completed":
      return slackConfig.channels.eng;
    default:
      return slackConfig.channels.eng;
  }
}

/**
 * Send a notification to a single webhook endpoint
 * Silently catches errors — never throws
 */
export async function sendWebhook(webhook: IWebhookConfig, ctx: INotificationContext): Promise<void> {
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
 * Build a discussion trigger from a notification context, if the event warrants deliberation.
 * Returns null when deliberation should not be triggered.
 */
function buildDiscussionTrigger(ctx: INotificationContext, projectPath: string): IDiscussionTrigger | null {
  if (ctx.event === "run_succeeded" && ctx.prNumber) {
    return {
      type: "pr_review",
      projectPath,
      ref: String(ctx.prNumber),
      context: ctx.prBody
        ? ctx.prBody.slice(0, 2000)
        : `PR #${ctx.prNumber}: ${ctx.prTitle ?? ctx.projectName}`,
      prUrl: ctx.prUrl,
    };
  }
  return null;
}

/**
 * Send notifications to all configured webhooks and (if configured) to Slack via Bot API.
 */
export async function sendNotifications(
  config: INightWatchConfig,
  ctx: INotificationContext
): Promise<void> {
  const tasks: Promise<unknown>[] = [];

  // Slack Bot API path — additive, controlled by config.slack?.enabled
  if (config.slack?.enabled && config.slack?.botToken) {
    const slackConfig = config.slack;
    const slackClient = new SlackClient(slackConfig.botToken);

    // Notification post
    tasks.push(
      (async () => {
        try {
          const repos = getRepositories();
          const personas = repos.agentPersona.getActive();
          const personaName = getPersonaNameForEvent(ctx.event);
          const persona = personas.find((p) => p.name === personaName) ?? personas[0];

          if (persona) {
            const channel = getChannelForEvent(ctx.event, slackConfig);
            if (channel) {
              const text = buildNotificationText(ctx);
              await slackClient.postAsAgent(channel, text, persona);
            }
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          warn(`Slack Bot notification failed: ${message}`);
        }
      })()
    );

    // Deliberation — fire-and-forget, gated by discussionEnabled
    if (slackConfig.discussionEnabled) {
      const trigger = buildDiscussionTrigger(ctx, process.cwd());
      if (trigger) {
        tasks.push(
          (async () => {
            try {
              const engine = new DeliberationEngine(slackClient, config);
              await engine.startDiscussion(trigger);
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              warn(`Slack deliberation failed: ${message}`);
            }
          })()
        );
      }
    }
  }

  // Legacy webhook path — backward compatible
  const webhooks = config.notifications?.webhooks ?? [];
  for (const wh of webhooks) {
    tasks.push(sendWebhook(wh, ctx));
  }

  if (tasks.length === 0) {
    return;
  }

  const results = await Promise.allSettled(tasks);
  const sent = results.filter((r) => r.status === "fulfilled").length;
  const total = results.length;
  info(`Sent ${sent}/${total} notifications`);
}
