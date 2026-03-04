/**
 * Shared environment variable building utilities for Night Watch CLI commands.
 * Extracts common logic for building base env vars and Telegram webhook extraction.
 */

import {
  INightWatchConfig,
  IWebhookConfig,
  PROVIDER_COMMANDS,
  resolveJobProvider,
} from '@night-watch/core';
import type { JobType } from '@night-watch/core';

/**
 * Build the base environment variables shared by all job types.
 * Sets exactly these 5 fields:
 * - NW_PROVIDER_CMD: the CLI binary for the resolved provider
 * - NW_DEFAULT_BRANCH: optional default branch
 * - providerEnv: merged into env
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

  // Default branch (empty = auto-detect in bash script)
  if (config.defaultBranch) {
    env.NW_DEFAULT_BRANCH = config.defaultBranch;
  }

  // Provider environment variables (API keys, base URLs, etc.)
  if (config.providerEnv) {
    Object.assign(env, config.providerEnv);
  }

  // Dry run flag
  if (isDryRun) {
    env.NW_DRY_RUN = '1';
  }

  // Sandbox flag - prevents the agent from modifying crontab during execution
  env.NW_EXECUTION_CONTEXT = 'agent';

  return env;
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
