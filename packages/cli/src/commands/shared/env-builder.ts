/**
 * Shared environment variable building utilities for Night Watch CLI commands.
 * Extracts common logic for building base env vars and Telegram webhook extraction.
 */

import {
  DEFAULT_QUEUE,
  INightWatchConfig,
  IWebhookConfig,
  PROVIDER_COMMANDS,
  getSchedulingPlan,
  resolveJobProvider,
} from '@night-watch/core';
import type { JobType } from '@night-watch/core';

/**
 * Derive a human-friendly provider label for display in PR bodies, comments, and commits.
 * Uses config.providerLabel if set (e.g. "GLM-5"), otherwise auto-derives from provider/env.
 */
function deriveProviderLabel(config: INightWatchConfig, jobType: JobType): string {
  if (config.providerLabel) return config.providerLabel;
  const provider = resolveJobProvider(config, jobType);
  if (provider === 'codex') return 'Codex';
  // claude provider: check if a proxy base URL is configured
  if (config.providerEnv?.ANTHROPIC_BASE_URL) return 'Claude (proxy)';
  return 'Claude';
}

/**
 * Build the base environment variables shared by all job types.
 * Sets provider, queue, execution-context, and optional dry-run/default-branch env vars.
 * - NW_PROVIDER_CMD: the CLI binary for the resolved provider
 * - NW_PROVIDER_LABEL: human-friendly provider name for PR/comment attribution
 * - NW_DEFAULT_BRANCH: optional default branch
 * - providerEnv: merged into env
 * - NW_QUEUE_*: queue configuration for bash scripts
 * - NW_DRY_RUN: '1' when isDryRun is true
 * - NW_EXECUTION_CONTEXT: always 'agent'
 */
export function buildBaseEnvVars(
  config: INightWatchConfig,
  jobType: JobType,
  isDryRun: boolean,
): Record<string, string> {
  const env: Record<string, string> = {};

  // Provider command - the actual CLI binary to call
  env.NW_PROVIDER_CMD = PROVIDER_COMMANDS[resolveJobProvider(config, jobType)];

  // Human-friendly provider label for attribution in PRs, comments, commits
  env.NW_PROVIDER_LABEL = deriveProviderLabel(config, jobType);

  // Default branch (empty = auto-detect in bash script)
  if (config.defaultBranch) {
    env.NW_DEFAULT_BRANCH = config.defaultBranch;
  }

  // Provider environment variables (API keys, base URLs, etc.)
  if (config.providerEnv) {
    Object.assign(env, config.providerEnv);
  }

  // Queue configuration
  const queueConfig = config.queue ?? DEFAULT_QUEUE;
  env.NW_QUEUE_ENABLED = queueConfig.enabled ? '1' : '0';
  env.NW_QUEUE_MAX_CONCURRENCY = String(queueConfig.maxConcurrency);
  env.NW_QUEUE_MAX_WAIT_TIME = String(queueConfig.maxWaitTime);
  env.NW_QUEUE_PRIORITY_JSON = JSON.stringify(queueConfig.priority);
  env.NW_SCHEDULING_PRIORITY = String(config.schedulingPriority ?? 3);

  // Dry run flag
  if (isDryRun) {
    env.NW_DRY_RUN = '1';
  }

  // Sandbox flag - prevents the agent from modifying crontab during execution
  env.NW_EXECUTION_CONTEXT = 'agent';

  return env;
}

export function getCronSchedulingPlan(
  config: INightWatchConfig,
  jobType: JobType,
  projectDir: string,
) {
  return getSchedulingPlan(projectDir, config, jobType);
}

export async function maybeApplyCronSchedulingDelay(
  config: INightWatchConfig,
  jobType: JobType,
  projectDir: string,
): Promise<ReturnType<typeof getSchedulingPlan>> {
  const plan = getSchedulingPlan(projectDir, config, jobType);

  if (process.env.NW_CRON_TRIGGER !== '1' || process.env.NW_QUEUE_DISPATCHED === '1') {
    return plan;
  }

  if (plan.totalDelayMinutes > 0) {
    await new Promise((resolve) => setTimeout(resolve, plan.totalDelayMinutes * 60_000));
  }

  return plan;
}

/**
 * Format provider display for notifications/UI using command + label.
 */
export function formatProviderDisplay(providerCmd?: string, providerLabel?: string): string {
  const cmd = providerCmd?.trim();
  if (!cmd) return 'unknown';
  const label = providerLabel?.trim();
  if (!label) return cmd;
  if (label.toLowerCase() === cmd.toLowerCase()) return cmd;
  return `${cmd} (${label})`;
}

/**
 * Extract Telegram webhooks that have both botToken and chatId configured.
 * Used for status messages from bash scripts (start/progress/final status).
 */
export function getTelegramStatusWebhooks(
  config: INightWatchConfig,
): Array<{ botToken: string; chatId: string }> {
  return (config.notifications?.webhooks ?? [])
    .filter(
      (wh): wh is IWebhookConfig & { botToken: string; chatId: string } =>
        wh.type === 'telegram' &&
        typeof wh.botToken === 'string' &&
        wh.botToken.trim().length > 0 &&
        typeof wh.chatId === 'string' &&
        wh.chatId.trim().length > 0,
    )
    .map((wh) => ({ botToken: wh.botToken, chatId: wh.chatId }));
}
