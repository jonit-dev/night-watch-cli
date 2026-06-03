/**
 * Run command - executes the PRD cron script
 */

import { Command } from 'commander';
import {
  CLAIM_FILE_EXTENSION,
  CLAUDE_MODEL_IDS,
  INightWatchConfig,
  IWebhookConfig,
  NotificationEvent,
  PROVIDER_COMMANDS,
  analyzeFeedbackOutcome,
  buildProjectFeedbackPromptBlock,
  buildSessionOutcomeInput,
  createBoardProvider,
  createSpinner,
  createTable,
  dim,
  executeScriptWithOutput,
  fetchPrDetails,
  fetchPrDetailsByNumber,
  fetchPrDetailsForBranch,
  getRepositories,
  getScriptPath,
  header,
  info,
  isFeedbackPromptEnabled,
  loadConfig,
  parseScriptResult,
  resolveJobProvider,
  resolvePreset,
  sendNotifications,
  error as uiError,
  validateRegistry,
  warn,
} from '@night-watch/core';
import { buildBaseEnvVars, maybeApplyCronSchedulingDelay } from './shared/env-builder.js';
import { getFeedbackAnalysisOptions, isFeedbackEnabled } from './shared/feedback.js';
import type { INotificationContext, IPrDetails, JobType } from '@night-watch/core';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Options for the run command
 */
export interface IRunOptions {
  dryRun: boolean;
  timeout?: string;
  provider?: string;
  crossProjectFallback?: boolean;
}

export interface IRunOutcomeRecordInput {
  projectDir: string;
  config: INightWatchConfig;
  envVars: Record<string, string>;
  startedAt: number;
  finishedAt: number;
  exitCode: number;
  stdout?: string;
  stderr?: string;
  scriptResult?: ReturnType<typeof parseScriptResult>;
  metadata?: Record<string, unknown>;
}

export interface IRunPrMetadata {
  prUrl?: string;
  branchName?: string;
  prNumber?: number;
}

/**
 * Map executor exit/result state to a notification event.
 * Returns null when the run completed with no actionable work (skip/no-op).
 */
export function resolveRunNotificationEvent(
  exitCode: number,
  scriptStatus?: string,
): NotificationEvent | null {
  if (exitCode === 124) {
    return 'run_timeout';
  }
  if (exitCode !== 0) {
    return 'run_failed';
  }
  if (!scriptStatus || scriptStatus === 'success_open_pr') {
    return 'run_succeeded';
  }
  if (scriptStatus?.startsWith('skip_')) {
    return 'run_no_work';
  }
  return null;
}

/**
 * Extract the most recent GitHub PR URL from raw executor output.
 * This is a safety net for older/custom scripts that open a PR successfully
 * but do not emit complete NIGHT_WATCH_RESULT metadata.
 */
export function extractPrUrlFromOutput(output?: string): string | undefined {
  if (!output) {
    return undefined;
  }

  const matches = Array.from(
    output.matchAll(/https:\/\/github\.com\/[^\s)]+\/pull\/\d+/g),
    (match) => match[0],
  );
  return matches.at(-1);
}

function extractResultValueFromOutput(output: string | undefined, key: string): string | undefined {
  if (!output) {
    return undefined;
  }

  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`\\b${escapedKey}=([^\\s|]+)`, 'g');
  const matches = Array.from(output.matchAll(regex), (match) => match[1]).filter(
    (value): value is string => value !== undefined && value.length > 0,
  );
  return matches.at(-1);
}

/**
 * Determine if cross-project fallback should run for this executor result.
 */
export function shouldAttemptCrossProjectFallback(
  options: IRunOptions,
  scriptStatus?: string,
): boolean {
  if (options.crossProjectFallback !== true) {
    return false;
  }
  if (options.dryRun) {
    return false;
  }
  if (process.env.NW_CROSS_PROJECT_FALLBACK_ACTIVE === '1') {
    return false;
  }
  // Don't attempt cross-project fallback when job was queued — queue handles ordering
  if (scriptStatus === 'queued') {
    return false;
  }
  return scriptStatus === 'skip_no_eligible_prd';
}

export function parsePrNumberFromUrl(prUrl?: string): number | undefined {
  const match = prUrl?.match(/\/pull\/(\d+)(?:\b|[/?#])/);
  if (!match?.[1]) {
    return undefined;
  }
  const parsed = parseInt(match[1], 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function getRunPrMetadata(
  scriptResult: ReturnType<typeof parseScriptResult>,
  rawOutput?: string,
): IRunPrMetadata {
  const prUrl = scriptResult?.data.pr_url ?? extractPrUrlFromOutput(rawOutput);
  const branchName = scriptResult?.data.branch ?? extractResultValueFromOutput(rawOutput, 'branch');
  const prNumber =
    parsePrNumberFromUrl(prUrl) ??
    (scriptResult?.data.pr_number ? parseInt(scriptResult.data.pr_number, 10) : undefined);

  return {
    prUrl,
    branchName,
    prNumber: prNumber !== undefined && !Number.isNaN(prNumber) ? prNumber : undefined,
  };
}

function fetchRunPrDetails(
  config: INightWatchConfig,
  projectDir: string,
  metadata: IRunPrMetadata,
): IPrDetails | null {
  // Prefer number lookup. Some gh versions are less reliable with URL selectors,
  // while PR numbers are unambiguous once parsed from the emitted PR URL.
  if (metadata.prNumber !== undefined) {
    const details = fetchPrDetailsByNumber(metadata.prNumber, projectDir);
    if (details) {
      return details;
    }
  }

  if (metadata.prUrl) {
    const details = fetchPrDetailsForBranch(metadata.prUrl, projectDir);
    if (details) {
      return details;
    }
  }

  if (metadata.branchName) {
    const details = fetchPrDetailsForBranch(metadata.branchName, projectDir);
    if (details) {
      return details;
    }
  }

  return fetchPrDetails(config.branchPrefix, projectDir);
}

export function buildRunNotificationContext(
  config: INightWatchConfig,
  projectDir: string,
  event: NotificationEvent,
  exitCode: number,
  scriptResult: ReturnType<typeof parseScriptResult>,
  prDetails: IPrDetails | null,
  rawOutput?: string,
): INotificationContext {
  const metadata = getRunPrMetadata(scriptResult, rawOutput);
  const timeoutDuration = event === 'run_timeout' ? config.maxRuntime : undefined;
  const checkpointValue = scriptResult?.data.checkpoint;
  const checkpointStatus: 'created' | 'available' | 'none' | undefined =
    checkpointValue === 'created' || checkpointValue === 'available' || checkpointValue === 'none'
      ? checkpointValue
      : undefined;

  return {
    event,
    projectName: path.basename(projectDir),
    exitCode,
    provider: config.provider,
    prdName: scriptResult?.data.prd ?? extractResultValueFromOutput(rawOutput, 'prd'),
    branchName: metadata.branchName,
    duration: timeoutDuration,
    scriptStatus: scriptResult?.status,
    failureReason: scriptResult?.data.reason,
    failureDetail: scriptResult?.data.detail,
    checkpointStatus,
    prUrl: prDetails?.url || metadata.prUrl,
    prTitle: prDetails?.title,
    prBody: prDetails?.body,
    prNumber: prDetails?.number ?? metadata.prNumber,
    filesChanged: prDetails?.changedFiles,
    additions: prDetails?.additions,
    deletions: prDetails?.deletions,
  };
}

/**
 * Resolve valid registered projects excluding the current project.
 */
export function getCrossProjectFallbackCandidates(currentProjectDir: string): Array<{
  name: string;
  path: string;
}> {
  const current = path.resolve(currentProjectDir);
  const { valid, invalid } = validateRegistry();
  for (const entry of invalid) {
    warn(`Skipping invalid registry entry: ${entry.path}`);
  }
  return valid.filter((entry) => path.resolve(entry.path) !== current);
}

/**
 * Run completion notifications for an executor invocation (local or fallback).
 */
async function sendRunCompletionNotifications(
  config: INightWatchConfig,
  projectDir: string,
  options: IRunOptions,
  exitCode: number,
  scriptResult: ReturnType<typeof parseScriptResult>,
  rawOutput?: string,
): Promise<void> {
  // Rate-limit fallback notifications are sent immediately to Telegram in bash.
  // Send this event only to non-Telegram webhooks to avoid duplicate alerts.
  if (isRateLimitFallbackTriggered(scriptResult?.data)) {
    const nonTelegramWebhooks = (config.notifications?.webhooks ?? []).filter(
      (wh) => wh.type !== 'telegram',
    );
    if (nonTelegramWebhooks.length > 0) {
      const _rateLimitCtx = {
        event: 'rate_limit_fallback' as const,
        projectName: path.basename(projectDir),
        exitCode,
        provider: config.provider,
      };
      await sendNotifications(
        {
          ...config,
          notifications: { ...config.notifications, webhooks: nonTelegramWebhooks },
        },
        _rateLimitCtx,
      );
    }
  }

  // Backward-compatible fallback: if no marker is present, preserve previous behavior.
  const event = resolveRunNotificationEvent(exitCode, scriptResult?.status);

  // Enrich with PR details on success (graceful — null if gh fails)
  let prDetails: IPrDetails | null = null;
  if (event === 'run_succeeded') {
    prDetails = fetchRunPrDetails(config, projectDir, getRunPrMetadata(scriptResult, rawOutput));
  }

  if (event) {
    const _ctx = buildRunNotificationContext(
      config,
      projectDir,
      event,
      exitCode,
      scriptResult,
      prDetails,
      rawOutput,
    );
    await sendNotifications(config, _ctx);
  } else if (!options.dryRun) {
    info('Skipping completion notification (no actionable run result)');
  }
}

/**
 * If current project has no eligible work, try other registered projects.
 * Returns true when any fallback project executed actionable work.
 */
async function runCrossProjectFallback(
  currentProjectDir: string,
  options: IRunOptions,
): Promise<boolean> {
  const candidates = getCrossProjectFallbackCandidates(currentProjectDir);
  if (candidates.length === 0) {
    return false;
  }

  const scriptPath = getScriptPath('night-watch-cron.sh');
  for (const candidate of candidates) {
    info(`Cross-project fallback: checking ${candidate.name}`);
    let candidateConfig = loadConfig(candidate.path);
    candidateConfig = applyCliOverrides(candidateConfig, options);
    const envVars = buildEnvVars(candidateConfig, options);
    applyProjectFeedbackPromptEnv(envVars, candidate.path, 'executor');
    envVars.NW_CROSS_PROJECT_FALLBACK_ACTIVE = '1';

    try {
      const startedAt = Date.now();
      const { exitCode, stdout, stderr } = await executeScriptWithOutput(
        scriptPath,
        [candidate.path],
        envVars,
        { cwd: candidate.path },
      );
      const finishedAt = Date.now();
      const scriptResult = parseScriptResult(`${stdout}\n${stderr}`);

      try {
        recordRunSessionOutcome({
          projectDir: candidate.path,
          config: candidateConfig,
          envVars,
          startedAt,
          finishedAt,
          exitCode,
          stdout,
          stderr,
          scriptResult,
          metadata: { crossProjectFallback: true },
        });
      } catch {
        // Outcome persistence must not change fallback execution behavior.
      }

      if (!options.dryRun) {
        await sendRunCompletionNotifications(
          candidateConfig,
          candidate.path,
          options,
          exitCode,
          scriptResult,
          `${stdout}\n${stderr}`,
        );
      }

      if (exitCode !== 0) {
        warn(
          `Cross-project fallback: ${candidate.name} exited with code ${exitCode}; checking next project.`,
        );
        continue;
      }

      if (
        scriptResult?.status?.startsWith('skip_') ||
        scriptResult?.status === 'success_already_merged'
      ) {
        continue;
      }

      info(`Cross-project fallback: executed work in ${candidate.name}`);
      return true;
    } catch (err) {
      warn(
        `Cross-project fallback failed for ${candidate.name}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return false;
}

/**
 * Return Telegram webhooks that opted in to rate-limit fallback notifications.
 */
export function getRateLimitFallbackTelegramWebhooks(
  config: INightWatchConfig,
): Array<{ botToken: string; chatId: string }> {
  return (config.notifications?.webhooks ?? [])
    .filter(
      (wh): wh is IWebhookConfig & { type: 'telegram'; botToken: string; chatId: string } =>
        wh.type === 'telegram' &&
        typeof wh.botToken === 'string' &&
        wh.botToken.trim().length > 0 &&
        typeof wh.chatId === 'string' &&
        wh.chatId.trim().length > 0 &&
        wh.events.includes('rate_limit_fallback'),
    )
    .map((wh) => ({ botToken: wh.botToken, chatId: wh.chatId }));
}

/**
 * Whether the bash execution reported a rate-limit fallback trigger.
 */
export function isRateLimitFallbackTriggered(resultData?: Record<string, string>): boolean {
  return resultData?.rate_limit_fallback === '1';
}

export function recordRunSessionOutcome(input: IRunOutcomeRecordInput): void {
  const outcome = buildSessionOutcomeInput({
    projectPath: input.projectDir,
    jobType: 'executor',
    providerKey: input.envVars.NW_PROVIDER_KEY ?? resolveJobProvider(input.config, 'executor'),
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    exitCode: input.exitCode,
    stdout: input.stdout,
    stderr: input.stderr,
    scriptResult: input.scriptResult,
    metadata: {
      providerCommand: input.envVars.NW_PROVIDER_CMD,
      providerLabel: input.envVars.NW_PROVIDER_LABEL,
      ...(input.metadata ?? {}),
    },
  });

  const repository = getRepositories().sessionOutcomes;
  const storedOutcome = repository.insertOutcome(outcome);
  if (isFeedbackEnabled(input.config)) {
    analyzeFeedbackOutcome(repository, storedOutcome, getFeedbackAnalysisOptions(input.config));
  }
}

export function applyProjectFeedbackPromptEnv(
  envVars: Record<string, string>,
  projectDir: string,
  jobType: JobType,
  markApplied = true,
): void {
  delete envVars.NW_PROJECT_FEEDBACK_PROMPT;
  const config = loadConfig(projectDir);
  if (!isFeedbackPromptEnabled() || config.feedback?.enabled === false) {
    return;
  }

  try {
    const { promptBlock } = buildProjectFeedbackPromptBlock(
      getRepositories().sessionOutcomes,
      projectDir,
      jobType,
      { markApplied, maxActiveAugmentations: config.feedback?.maxActiveAugmentations },
    );
    if (promptBlock.length > 0) {
      envVars.NW_PROJECT_FEEDBACK_PROMPT = promptBlock;
    }
  } catch {
    // Feedback prompt context must never block the primary executor path.
  }
}

/**
 * Build environment variables map from config and CLI options
 */
export function buildEnvVars(
  config: INightWatchConfig,
  options: IRunOptions,
): Record<string, string> {
  // Start with base env vars shared by all job types
  const env = buildBaseEnvVars(config, 'executor', options.dryRun);

  // Runtime
  env.NW_MAX_RUNTIME = String(config.maxRuntime);
  if (config.sessionMaxRuntime != null) {
    env.NW_SESSION_MAX_RUNTIME = String(config.sessionMaxRuntime);
  }
  env.NW_PRD_DIR = config.prdDir;
  env.NW_BRANCH_PREFIX = config.branchPrefix;
  env.NW_MODEL_ATTRIBUTION_ENABLED = config.modelAttribution ? '1' : '0';
  env.NW_NEW_PR_LABEL = config.newPrLabel ?? 'draft';

  // PRD priority order
  if (config.prdPriority && config.prdPriority.length > 0) {
    env.NW_PRD_PRIORITY = config.prdPriority.join(':');
  }

  // Max retries for rate-limited API calls (minimum 1 attempt)
  const maxRetries = Number.isFinite(config.maxRetries)
    ? Math.max(1, Math.floor(config.maxRetries))
    : 3;
  env.NW_MAX_RETRIES = String(maxRetries);

  // Current CLI executable path for nested CLI calls inside bash scripts.
  if (process.argv[1]) {
    env.NW_CLI_BIN = process.argv[1];
  }

  // Board provider — signal to the cron script to use board mode whenever enabled.
  // If projectNumber is missing, `night-watch board next-issue` auto-bootstraps
  // a board and persists it before continuing.
  if (config.boardProvider?.enabled !== false) {
    env.NW_BOARD_ENABLED = 'true';
  }

  // Rate-limit fallback: fall back to native Claude when proxy quota is exhausted
  if (config.fallbackOnRateLimit) {
    env.NW_FALLBACK_ON_RATE_LIMIT = 'true';
  }

  // Claude models used for native / fallback execution
  if (config.primaryFallbackModel) {
    env.NW_CLAUDE_PRIMARY_MODEL_ID = CLAUDE_MODEL_IDS[config.primaryFallbackModel];
    // Backward compatibility for scripts/helpers still reading the legacy env var.
    env.NW_CLAUDE_MODEL_ID = env.NW_CLAUDE_PRIMARY_MODEL_ID;
  }

  if (config.secondaryFallbackModel) {
    env.NW_CLAUDE_SECONDARY_MODEL_ID = CLAUDE_MODEL_IDS[config.secondaryFallbackModel];
  }

  // Preset-based fallback (takes precedence over model-based fallback when configured)
  if (config.primaryFallbackPreset) {
    try {
      const fallbackPreset = resolvePreset(config, config.primaryFallbackPreset);
      env.NW_FALLBACK_PRIMARY_PRESET_CMD = fallbackPreset.command;
      if (fallbackPreset.promptFlag)
        env.NW_FALLBACK_PRIMARY_PRESET_PROMPT_FLAG = fallbackPreset.promptFlag;
      if (fallbackPreset.autoApproveFlag)
        env.NW_FALLBACK_PRIMARY_PRESET_AUTO_APPROVE_FLAG = fallbackPreset.autoApproveFlag;
      if (fallbackPreset.modelFlag)
        env.NW_FALLBACK_PRIMARY_PRESET_MODEL_FLAG = fallbackPreset.modelFlag;
      if (fallbackPreset.model) env.NW_FALLBACK_PRIMARY_PRESET_MODEL = fallbackPreset.model;
      if (fallbackPreset.envVars && Object.keys(fallbackPreset.envVars).length > 0) {
        env.NW_FALLBACK_PRIMARY_PRESET_ENV = JSON.stringify(fallbackPreset.envVars);
      }
    } catch {
      // preset not found — fall back to model-based fallback
    }
  }
  if (config.secondaryFallbackPreset) {
    try {
      const fallbackPreset = resolvePreset(config, config.secondaryFallbackPreset);
      env.NW_FALLBACK_SECONDARY_PRESET_CMD = fallbackPreset.command;
      if (fallbackPreset.promptFlag)
        env.NW_FALLBACK_SECONDARY_PRESET_PROMPT_FLAG = fallbackPreset.promptFlag;
      if (fallbackPreset.autoApproveFlag)
        env.NW_FALLBACK_SECONDARY_PRESET_AUTO_APPROVE_FLAG = fallbackPreset.autoApproveFlag;
      if (fallbackPreset.modelFlag)
        env.NW_FALLBACK_SECONDARY_PRESET_MODEL_FLAG = fallbackPreset.modelFlag;
      if (fallbackPreset.model) env.NW_FALLBACK_SECONDARY_PRESET_MODEL = fallbackPreset.model;
      if (fallbackPreset.envVars && Object.keys(fallbackPreset.envVars).length > 0) {
        env.NW_FALLBACK_SECONDARY_PRESET_ENV = JSON.stringify(fallbackPreset.envVars);
      }
    } catch {
      // preset not found — fall back to model-based fallback
    }
  }

  // Telegram credentials for in-script fallback warnings.
  // Export only webhooks that explicitly subscribed to rate_limit_fallback.
  const fallbackTelegramWebhooks = getRateLimitFallbackTelegramWebhooks(config);
  if (fallbackTelegramWebhooks.length > 0) {
    env.NW_TELEGRAM_RATE_LIMIT_WEBHOOKS = JSON.stringify(fallbackTelegramWebhooks);
    // Backward compatibility for older helper implementations.
    env.NW_TELEGRAM_BOT_TOKEN = fallbackTelegramWebhooks[0].botToken;
    env.NW_TELEGRAM_CHAT_ID = fallbackTelegramWebhooks[0].chatId;
  }

  return env;
}

/**
 * Apply CLI flag overrides to the config
 */
export function applyCliOverrides(
  config: INightWatchConfig,
  options: IRunOptions,
): INightWatchConfig {
  const overridden = { ...config };

  if (options.timeout) {
    const timeout = parseInt(options.timeout, 10);
    if (!isNaN(timeout)) {
      overridden.maxRuntime = timeout;
    }
  }

  if (options.provider) {
    // Use _cliProviderOverride to ensure CLI flag takes precedence over jobProviders
    overridden._cliProviderOverride = options.provider as INightWatchConfig['provider'];
  }

  return overridden;
}

/**
 * Information about a scanned PRD file, including claim status
 */
export interface IPrdScanItem {
  name: string;
  claimed: boolean;
  claimInfo: { hostname: string; pid: number; timestamp: number } | null;
}

/**
 * Scan the PRD directory for eligible PRD files
 */
export function scanPrdDirectory(
  projectDir: string,
  prdDir: string,
  maxRuntime: number,
): { pending: IPrdScanItem[]; completed: string[] } {
  const claimStaleAfter = maxRuntime > 0 ? maxRuntime : 14400;
  const absolutePrdDir = path.join(projectDir, prdDir);
  const doneDir = path.join(absolutePrdDir, 'done');

  const pending: IPrdScanItem[] = [];
  const completed: string[] = [];

  // Scan main PRD directory for pending PRDs
  if (fs.existsSync(absolutePrdDir)) {
    const entries = fs.readdirSync(absolutePrdDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.md')) {
        const claimPath = path.join(absolutePrdDir, entry.name + CLAIM_FILE_EXTENSION);
        let claimed = false;
        let claimInfo: IPrdScanItem['claimInfo'] = null;

        if (fs.existsSync(claimPath)) {
          try {
            const content = fs.readFileSync(claimPath, 'utf-8');
            const data = JSON.parse(content);
            const age = Math.floor(Date.now() / 1000) - data.timestamp;
            if (age < claimStaleAfter) {
              claimed = true;
              claimInfo = { hostname: data.hostname, pid: data.pid, timestamp: data.timestamp };
            }
          } catch {
            // Invalid claim file, treat as unclaimed
          }
        }

        pending.push({ name: entry.name, claimed, claimInfo });
      }
    }
  }

  // Scan done directory for completed PRDs
  if (fs.existsSync(doneDir)) {
    const entries = fs.readdirSync(doneDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.md')) {
        completed.push(entry.name);
      }
    }
  }

  return { pending, completed };
}

/**
 * Register the run command with the program
 */
export function runCommand(program: Command): void {
  program
    .command('run')
    .description('Run PRD executor now')
    .option('--dry-run', 'Show what would be executed without running')
    .option('--timeout <seconds>', 'Override max runtime in seconds')
    .option('--provider <string>', 'AI provider to use (claude or codex)')
    .option(
      '--cross-project-fallback',
      'Check other registered projects when this project has no eligible work',
    )
    .option(
      '--no-cross-project-fallback',
      'Deprecated alias; cross-project fallback is disabled by default',
    )
    .action(async (options: IRunOptions) => {
      // Get the project directory (current working directory)
      const projectDir = process.cwd();

      // Load config from file and environment
      let config = loadConfig(projectDir);

      // Apply CLI flag overrides
      config = applyCliOverrides(config, options);

      if (config.executorEnabled === false && !options.dryRun) {
        info('Executor is disabled in config; skipping run.');
        process.exit(0);
      }

      // Build environment variables
      const envVars = buildEnvVars(config, options);
      applyProjectFeedbackPromptEnv(envVars, projectDir, 'executor', !options.dryRun);

      // Get the script path
      const scriptPath = getScriptPath('night-watch-cron.sh');

      if (options.dryRun) {
        header('Dry Run: PRD Executor');

        // Resolve executor-specific provider
        const executorProvider = resolveJobProvider(config, 'executor');

        // Configuration section with table
        header('Configuration');
        const configTable = createTable({ head: ['Setting', 'Value'] });
        configTable.push(['Provider', executorProvider]);
        configTable.push(['Provider CLI', PROVIDER_COMMANDS[executorProvider]]);
        configTable.push(['Default Branch', config.defaultBranch || '(auto-detect)']);
        configTable.push(['PRD Directory', config.prdDir]);
        configTable.push([
          'Max Runtime',
          `${config.maxRuntime}s (${Math.floor(config.maxRuntime / 60)}min)`,
        ]);
        configTable.push(['Branch Prefix', config.branchPrefix]);
        configTable.push([
          'Auto-merge',
          config.autoMerge ? `Enabled (${config.autoMergeMethod})` : 'Disabled',
        ]);
        console.log(configTable.toString());

        if (envVars.NW_BOARD_ENABLED === 'true') {
          header('Board Status');
          if (config.boardProvider?.projectNumber) {
            try {
              const provider = createBoardProvider(config.boardProvider, projectDir);
              const readyIssues = await provider.getIssuesByColumn('Ready');
              if (readyIssues.length === 0) {
                dim('  Ready: (none)');
              } else {
                info(`Ready (${readyIssues.length}):`);
                for (const issue of readyIssues.slice(0, 5)) {
                  dim(`    - #${issue.number} ${issue.title}`);
                }
                if (readyIssues.length > 5) {
                  dim(`    ... and ${readyIssues.length - 5} more`);
                }
              }
            } catch (err) {
              dim(`  Could not query board: ${err instanceof Error ? err.message : String(err)}`);
            }
          } else {
            dim('  No board configured yet. A board will be auto-created on first board-mode run.');
          }
        } else {
          // Scan for PRDs in filesystem mode
          header('PRD Status');
          const prdStatus = scanPrdDirectory(projectDir, config.prdDir, config.maxRuntime);

          if (prdStatus.pending.length === 0) {
            dim('  Pending: (none)');
          } else {
            const claimedItems = prdStatus.pending.filter((p) => p.claimed);
            const unclaimed = prdStatus.pending.filter((p) => !p.claimed);
            info(`Pending (${unclaimed.length} pending, ${claimedItems.length} claimed):`);
            for (const prd of prdStatus.pending) {
              if (prd.claimed && prd.claimInfo) {
                dim(
                  `    - ${prd.name} [claimed by ${prd.claimInfo.hostname}:${prd.claimInfo.pid}]`,
                );
              } else {
                dim(`    - ${prd.name}`);
              }
            }
          }

          if (prdStatus.completed.length === 0) {
            dim('  Completed: (none)');
          } else {
            info(`Completed (${prdStatus.completed.length}):`);
            for (const prd of prdStatus.completed.slice(0, 5)) {
              dim(`    - ${prd}`);
            }
            if (prdStatus.completed.length > 5) {
              dim(`    ... and ${prdStatus.completed.length - 5} more`);
            }
          }
        }

        // Provider invocation command
        header('Provider Invocation');
        if (executorProvider === 'claude') {
          dim('  claude -p "/night-watch" --dangerously-skip-permissions');
        } else {
          dim('  codex exec --yolo "/night-watch"');
        }

        // Environment variables
        header('Environment Variables');
        for (const [key, value] of Object.entries(envVars)) {
          dim(`  ${key}=${value}`);
        }

        // Full command that would be executed
        header('Command');
        dim(`  bash ${scriptPath} ${projectDir}`);
        console.log();

        process.exit(0);
      }

      // Execute the script with spinner
      const spinner = createSpinner('Running PRD executor...');
      spinner.start();

      try {
        const startedAt = Date.now();
        await maybeApplyCronSchedulingDelay(config, 'executor', projectDir);
        const { exitCode, stdout, stderr } = await executeScriptWithOutput(
          scriptPath,
          [projectDir],
          envVars,
          { cwd: projectDir },
        );
        const finishedAt = Date.now();
        const scriptResult = parseScriptResult(`${stdout}\n${stderr}`);

        if (exitCode === 0) {
          if (scriptResult?.status === 'queued') {
            spinner.succeed('PRD executor queued — another job is currently running');
          } else if (scriptResult?.status?.startsWith('skip_')) {
            spinner.succeed('PRD executor completed (no eligible work)');
          } else if (scriptResult?.status === 'success_already_merged') {
            spinner.succeed('PRD executor completed (PRD already merged)');
          } else {
            spinner.succeed('PRD executor completed successfully');
          }
        } else {
          spinner.fail(`PRD executor exited with code ${exitCode}`);
        }

        // Send completion notifications (fire-and-forget, failures do not affect exit code)
        if (!options.dryRun) {
          try {
            recordRunSessionOutcome({
              projectDir,
              config,
              envVars,
              startedAt,
              finishedAt,
              exitCode,
              stdout,
              stderr,
              scriptResult,
            });
          } catch {
            // Outcome persistence must not change command exit behavior.
          }

          await sendRunCompletionNotifications(
            config,
            projectDir,
            options,
            exitCode,
            scriptResult,
            `${stdout}\n${stderr}`,
          );
        }

        // Opportunistic cross-project balancing:
        // if this project has no eligible work, try other registered projects.
        if (shouldAttemptCrossProjectFallback(options, scriptResult?.status)) {
          const executedFallback = await runCrossProjectFallback(projectDir, options);
          if (!executedFallback) {
            info('Cross-project fallback: no eligible work found in other registered projects');
          }
        }

        process.exit(exitCode);
      } catch (err) {
        spinner.fail('Failed to execute run command');
        uiError(`${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });
}
