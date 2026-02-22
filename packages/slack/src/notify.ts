/**
 * Slack Bot API notifications for Night Watch CLI.
 *
 * This module contains the Slack-specific notification logic that was previously
 * embedded inside packages/core via dynamic imports. Moving it here eliminates the
 * hidden core → slack dependency cycle.
 */

import {
  IDiscussionTrigger,
  INightWatchConfig,
  INotificationContext,
  NotificationEvent,
  getRepositories,
  warn,
} from '@night-watch/core';

import { SlackClient } from './client.js';
import { DeliberationEngine } from './deliberation.js';
import { extractErrorMessage } from './utils.js';

function buildQaNotificationText(ctx: INotificationContext): string {
  const prLabel = ctx.prNumber !== undefined ? `PR #${ctx.prNumber}` : 'the latest PR';
  const prRef = ctx.prUrl ? `<${ctx.prUrl}|${prLabel}>` : prLabel;
  const project = ctx.projectName;

  if (ctx.exitCode === 0) {
    return `Finished QA on ${prRef} for ${project}.`;
  }
  return `I ran QA on ${prRef} for ${project}, but it failed. I'll check the logs.`;
}

function pickRandom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)] as T;
}

export function buildNotificationText(ctx: INotificationContext): string {
  if (ctx.event === 'qa_completed') {
    return buildQaNotificationText(ctx);
  }

  const prRef = ctx.prNumber !== undefined ? `#${ctx.prNumber}` : null;
  const prLink = ctx.prUrl && prRef ? `<${ctx.prUrl}|${prRef}>` : (prRef ?? null);
  const project = ctx.projectName;

  switch (ctx.event) {
    case 'run_succeeded':
      if (prLink) {
        return pickRandom([
          `Done. Opened ${prLink}.`,
          `PRD wrapped — ${prLink} is up.`,
          `Shipped it — ${prLink}.`,
          `Finished the run. ${prLink}.`,
        ]);
      }
      return pickRandom([
        `Run finished on ${project}.`,
        `PRD wrapped for ${project}.`,
        `Done with the run on ${project}.`,
      ]);

    case 'run_started':
      return pickRandom([
        `Starting the run on ${project}.`,
        `Kicking off the PRD for ${project}.`,
        `Picking up ${project} now.`,
      ]);

    case 'run_failed':
      return pickRandom([
        `Run failed on ${project}. Looking into it.`,
        `Something broke on the run for ${project}. Checking.`,
        `Hit a snag on ${project}. I'll dig in.`,
        `PRD run failed for ${project}. On it.`,
      ]);

    case 'run_timeout':
      return pickRandom([
        `Run timed out on ${project}.`,
        `Timed out waiting on the run for ${project}.`,
        `${project} run hit the timeout. Needs a look.`,
      ]);

    case 'review_completed':
      if (prLink) {
        return pickRandom([
          `Left my notes on ${prLink}.`,
          `Reviewed ${prLink}. Check the comments.`,
          `Done with the review — ${prLink}.`,
          `Wrapped up ${prLink}.`,
        ]);
      }
      return `Wrapped up the review on ${project}.`;

    case 'pr_auto_merged':
      return prLink
        ? pickRandom([`Merged ${prLink}.`, `Auto-merged ${prLink}.`, `${prLink} is in.`])
        : `Auto-merged on ${project}.`;

    case 'rate_limit_fallback':
      return pickRandom([
        `Rate limited, switching providers.`,
        `Hit the rate limit — falling back to another provider.`,
      ]);

    default:
      return `Event on ${project}${prLink ? ` — ${prLink}` : ''}.`;
  }
}

function getPersonaNameForEvent(event: NotificationEvent): string {
  switch (event) {
    case 'run_started':
    case 'run_succeeded':
    case 'run_failed':
    case 'run_timeout':
      return 'Dev';
    case 'review_completed':
    case 'pr_auto_merged':
      return 'Carlos';
    case 'qa_completed':
      return 'Priya';
    default:
      return 'Carlos';
  }
}

function buildDiscussionTrigger(
  ctx: INotificationContext,
  projectPath: string,
): IDiscussionTrigger | null {
  if (ctx.event === 'run_succeeded' && ctx.prNumber) {
    return {
      type: 'pr_review',
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
 * Send a notification to the Slack Bot API (post as agent persona + optional deliberation).
 * Silently no-ops when Slack is not configured.
 */
export async function sendSlackBotNotification(
  config: INightWatchConfig,
  ctx: INotificationContext,
): Promise<void> {
  if (!config.slack?.enabled || !config.slack?.botToken) return;

  const slackConfig = config.slack;
  const slackClient = new SlackClient(slackConfig.botToken);
  const tasks: Promise<unknown>[] = [];

  tasks.push(
    (async () => {
      try {
        const repos = getRepositories();
        const personas = repos.agentPersona.getActive();
        const personaName = getPersonaNameForEvent(ctx.event);
        const persona = personas.find((p) => p.name === personaName) ?? personas[0];

        if (persona) {
          const projects = repos.projectRegistry.getAll();
          const project = projects.find((p) => p.name === ctx.projectName) ?? projects[0];
          const channel = project?.slackChannelId;
          if (channel) {
            const text = buildNotificationText(ctx);
            await slackClient.postAsAgent(channel, text, persona);
          }
        }
      } catch (err) {
        const message = extractErrorMessage(err);
        warn(`Slack Bot notification failed: ${message}`);
      }
    })(),
  );

  if (slackConfig.discussionEnabled) {
    const trigger = buildDiscussionTrigger(ctx, process.cwd());
    if (trigger) {
      tasks.push(
        (async () => {
          try {
            const engine = new DeliberationEngine(slackClient, config);
            await engine.startDiscussion(trigger);
          } catch (err) {
            const message = extractErrorMessage(err);
            warn(`Slack deliberation failed: ${message}`);
          }
        })(),
      );
    }
  }

  await Promise.allSettled(tasks);
}
