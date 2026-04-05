/**
 * Shared environment variable building utilities for Night Watch CLI commands.
 * Extracts common logic for building base env vars and Telegram webhook extraction.
 */

import {
  DEFAULT_QUEUE,
  INightWatchConfig,
  IProviderPreset,
  IQueueEntry,
  IWebhookConfig,
  getSchedulingPlan,
  loadConfig,
  resolveJobProvider,
  resolvePreset,
  resolveProviderBucketKey,
} from '@night-watch/core';
import type { JobType, Provider } from '@night-watch/core';

/**
 * Derive a human-friendly provider label for display in PR bodies, comments, and commits.
 * Uses the preset's name field as the primary source, falls back to config.providerLabel
 * for backward compat, then auto-derives from provider/env.
 */
function deriveProviderLabel(config: INightWatchConfig, preset: IProviderPreset): string {
  // Primary: use preset name
  if (preset.name) return preset.name;
  // Backward compat: use deprecated providerLabel
  if (config.providerLabel) return config.providerLabel;
  // Fallback: derive from command
  if (preset.command === 'codex') return 'Codex';
  // claude provider: check if a proxy base URL is configured
  if (config.providerEnv?.ANTHROPIC_BASE_URL) return 'Claude (proxy)';
  return 'Claude';
}

/**
 * Build the base environment variables shared by all job types.
 * Sets provider, queue, execution-context, and optional dry-run/default-branch env vars.
 *
 * Provider env vars (from preset):
 * - NW_PROVIDER_CMD: the CLI binary for the resolved provider
 * - NW_PROVIDER_SUBCOMMAND: optional subcommand (e.g. "exec" for codex)
 * - NW_PROVIDER_PROMPT_FLAG: flag for passing the prompt (e.g. "-p")
 * - NW_PROVIDER_APPROVE_FLAG: flag for auto-approve mode
 * - NW_PROVIDER_WORKDIR_FLAG: flag for working directory
 * - NW_PROVIDER_MODEL_FLAG: flag for model selection
 * - NW_PROVIDER_MODEL: model value to use
 * - NW_PROVIDER_LABEL: human-friendly provider name for PR/comment attribution
 *
 * Other env vars:
 * - NW_DEFAULT_BRANCH: optional default branch
 * - providerEnv: merged into env (preset.envVars takes precedence)
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

  // Resolve the preset for this job type
  const presetId = resolveJobProvider(config, jobType);
  const preset = resolvePreset(config, presetId);

  // Provider command - the actual CLI binary to call
  env.NW_PROVIDER_CMD = preset.command;

  // Provider subcommand (e.g. "exec" for codex)
  env.NW_PROVIDER_SUBCOMMAND = preset.subcommand ?? '';

  // Provider flags (empty string if not set)
  env.NW_PROVIDER_PROMPT_FLAG = preset.promptFlag ?? '';
  env.NW_PROVIDER_APPROVE_FLAG = preset.autoApproveFlag ?? '';
  env.NW_PROVIDER_WORKDIR_FLAG = preset.workdirFlag ?? '';
  env.NW_PROVIDER_MODEL_FLAG = preset.modelFlag ?? '';

  // Provider model (empty string if not set)
  env.NW_PROVIDER_MODEL = preset.model ?? '';

  // Human-friendly provider label for attribution in PRs, comments, commits
  env.NW_PROVIDER_LABEL = deriveProviderLabel(config, preset);

  // Provider bucket key for per-bucket concurrency tracking
  // Build the effective providerEnv for bucket key resolution:
  // start with config.providerEnv (backward compat) then overlay preset.envVars
  const effectiveProviderEnv: Record<string, string> = {
    ...(config.providerEnv ?? {}),
    ...(preset.envVars ?? {}),
  };
  env.NW_PROVIDER_KEY = resolveProviderBucketKey(preset.command as Provider, effectiveProviderEnv);

  // Default branch (empty = auto-detect in bash script)
  if (config.defaultBranch) {
    env.NW_DEFAULT_BRANCH = config.defaultBranch;
  }

  env.NW_GIT_PUSH_NO_VERIFY = config.gitPushNoVerify ? '1' : '0';

  // Provider environment variables (API keys, base URLs, etc.)
  // First apply config.providerEnv for backward compat
  if (config.providerEnv) {
    Object.assign(env, config.providerEnv);
  }
  // Then apply preset.envVars (takes precedence over config.providerEnv)
  if (preset.envVars) {
    Object.assign(env, preset.envVars);
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

  return getSchedulingPlan(projectDir, config, jobType);
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
 * Rebuild environment variables for a queued job from the job's own project config.
 * This ensures provider-specific env (ANTHROPIC_BASE_URL, API keys, model ids)
 * always comes from the queued job's own project config, not the dispatcher process env.
 */
export function buildQueuedJobEnv(entry: IQueueEntry): Record<string, string> {
  const config = loadConfig(entry.projectPath);
  return buildBaseEnvVars(config, entry.jobType, false);
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
