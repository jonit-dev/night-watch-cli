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
  createBoardProvider,
  createSpinner,
  createTable,
  dim,
  executeScriptWithOutput,
  fetchPrDetails,
  fetchPrDetailsForBranch,
  getScriptPath,
  header,
  info,
  loadConfig,
  parseScriptResult,
  resolveJobProvider,
  sendNotifications,
  error as uiError,
  validateRegistry,
  warn,
} from '@night-watch/core';
import type { IPrDetails } from '@night-watch/core';
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
  return null;
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
  return scriptStatus === 'skip_no_eligible_prd';
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
    const branch = scriptResult?.data.branch;
    if (branch) {
      prDetails = fetchPrDetailsForBranch(branch, projectDir);
    }
    if (!prDetails) {
      prDetails = fetchPrDetails(config.branchPrefix, projectDir);
    }
  }

  if (event) {
    const _ctx = {
      event,
      projectName: path.basename(projectDir),
      exitCode,
      provider: config.provider,
      prUrl: prDetails?.url,
      prTitle: prDetails?.title,
      prBody: prDetails?.body,
      prNumber: prDetails?.number,
      filesChanged: prDetails?.changedFiles,
      additions: prDetails?.additions,
      deletions: prDetails?.deletions,
    };
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
    envVars.NW_CROSS_PROJECT_FALLBACK_ACTIVE = '1';

    try {
      const { exitCode, stdout, stderr } = await executeScriptWithOutput(
        scriptPath,
        [candidate.path],
        envVars,
        { cwd: candidate.path },
      );
      const scriptResult = parseScriptResult(`${stdout}\n${stderr}`);

      if (!options.dryRun) {
        await sendRunCompletionNotifications(
          candidateConfig,
          candidate.path,
          options,
          exitCode,
          scriptResult,
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

/**
 * Build environment variables map from config and CLI options
 */
export function buildEnvVars(
  config: INightWatchConfig,
  options: IRunOptions,
): Record<string, string> {
  const env: Record<string, string> = {};

  // Provider command - the actual CLI binary to call (use job-specific provider for executor)
  const executorProvider = resolveJobProvider(config, 'executor');
  env.NW_PROVIDER_CMD = PROVIDER_COMMANDS[executorProvider];

  // Default branch (empty = auto-detect in bash script)
  if (config.defaultBranch) {
    env.NW_DEFAULT_BRANCH = config.defaultBranch;
  }

  // Runtime
  env.NW_MAX_RUNTIME = String(config.maxRuntime);
  env.NW_PRD_DIR = config.prdDir;
  env.NW_BRANCH_PREFIX = config.branchPrefix;

  // Provider environment variables (API keys, base URLs, etc.)
  if (config.providerEnv) {
    Object.assign(env, config.providerEnv);
  }

  // PRD priority order
  if (config.prdPriority && config.prdPriority.length > 0) {
    env.NW_PRD_PRIORITY = config.prdPriority.join(':');
  }

  // Dry run flag
  if (options.dryRun) {
    env.NW_DRY_RUN = '1';
  }

  // Sandbox flag — prevents the agent from modifying crontab during execution
  env.NW_EXECUTION_CONTEXT = 'agent';

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

  // Claude model used for native / fallback execution
  env.NW_CLAUDE_MODEL_ID = CLAUDE_MODEL_IDS[config.claudeModel ?? 'sonnet'];

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
            if (age < maxRuntime) {
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
        const providerCmd = PROVIDER_COMMANDS[executorProvider];
        const autoFlag =
          executorProvider === 'claude' ? '--dangerously-skip-permissions' : '--yolo';
        dim(`  ${providerCmd} ${autoFlag} -p "/night-watch"`);

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
        const { exitCode, stdout, stderr } = await executeScriptWithOutput(
          scriptPath,
          [projectDir],
          envVars,
          { cwd: projectDir },
        );
        const scriptResult = parseScriptResult(`${stdout}\n${stderr}`);

        if (exitCode === 0) {
          if (scriptResult?.status?.startsWith('skip_')) {
            spinner.succeed('PRD executor completed (no eligible work)');
          } else if (scriptResult?.status === 'success_already_merged') {
            spinner.succeed('PRD executor completed (PRD already merged)');
          } else {
            spinner.succeed('PRD executor completed successfully');
          }
        } else {
          spinner.fail(`PRD executor exited with code ${exitCode}`);
        }

        // Send notifications (fire-and-forget, failures do not affect exit code)
        if (!options.dryRun) {
          await sendRunCompletionNotifications(config, projectDir, options, exitCode, scriptResult);
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
