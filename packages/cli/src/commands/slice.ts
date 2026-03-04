/**
 * Slice command - executes the roadmap slicer to create PRDs from roadmap items
 */

import { Command } from 'commander';
import {
  INightWatchConfig,
  IWebhookConfig,
  LOCK_FILE_PREFIX,
  PROVIDER_COMMANDS,
  createSpinner,
  createTable,
  dim,
  getRoadmapStatus,
  header,
  info,
  isProcessRunning,
  loadConfig,
  projectRuntimeKey,
  resolveJobProvider,
  sendNotifications,
  sliceNextItem,
  error as uiError,
} from '@night-watch/core';
import type { ISliceResult } from '@night-watch/core';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Options for the slice command
 */
export interface ISliceOptions {
  dryRun: boolean;
  timeout?: string;
  provider?: string;
}

function getTelegramStatusWebhooks(
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

function plannerLockPath(projectDir: string): string {
  return `${LOCK_FILE_PREFIX}slicer-${projectRuntimeKey(projectDir)}.lock`;
}

function acquirePlannerLock(projectDir: string): {
  acquired: boolean;
  lockFile: string;
  pid?: number;
} {
  const lockFile = plannerLockPath(projectDir);
  if (fs.existsSync(lockFile)) {
    const pidRaw = fs.readFileSync(lockFile, 'utf-8').trim();
    const pid = parseInt(pidRaw, 10);
    if (!Number.isNaN(pid) && isProcessRunning(pid)) {
      return { acquired: false, lockFile, pid };
    }
    // stale lock
    try {
      fs.unlinkSync(lockFile);
    } catch {
      // ignore stale-lock cleanup errors
    }
  }

  fs.writeFileSync(lockFile, String(process.pid));
  return { acquired: true, lockFile };
}

function releasePlannerLock(lockFile: string): void {
  try {
    if (fs.existsSync(lockFile)) {
      fs.unlinkSync(lockFile);
    }
  } catch {
    // ignore cleanup errors
  }
}

/**
 * Build environment variables map from config and CLI options for slicer
 */
export function buildEnvVars(
  config: INightWatchConfig,
  options: ISliceOptions,
): Record<string, string> {
  const env: Record<string, string> = {};

  // Provider command - the actual CLI binary to call (use job-specific provider for slicer)
  const slicerProvider = resolveJobProvider(config, 'slicer');
  env.NW_PROVIDER_CMD = PROVIDER_COMMANDS[slicerProvider];

  // Slicer runtime
  env.NW_SLICER_MAX_RUNTIME = String(config.roadmapScanner.slicerMaxRuntime);

  // PRD directory for slicer output
  env.NW_PRD_DIR = config.prdDir;

  // Roadmap path
  env.NW_ROADMAP_PATH = config.roadmapScanner.roadmapPath;

  // Provider environment variables (API keys, base URLs, etc.)
  if (config.providerEnv) {
    Object.assign(env, config.providerEnv);
  }

  // Telegram status messages from bash scripts (start/progress/final status)
  const telegramWebhooks = getTelegramStatusWebhooks(config);
  if (telegramWebhooks.length > 0) {
    env.NW_TELEGRAM_STATUS_WEBHOOKS = JSON.stringify(telegramWebhooks);
    env.NW_TELEGRAM_BOT_TOKEN = telegramWebhooks[0].botToken;
    env.NW_TELEGRAM_CHAT_ID = telegramWebhooks[0].chatId;
  }

  // Dry run flag
  if (options.dryRun) {
    env.NW_DRY_RUN = '1';
  }

  // Sandbox flag - prevents the agent from modifying crontab during execution
  env.NW_EXECUTION_CONTEXT = 'agent';

  return env;
}

/**
 * Apply CLI flag overrides to the config for slicer
 */
export function applyCliOverrides(
  config: INightWatchConfig,
  options: ISliceOptions,
): INightWatchConfig {
  const overridden = { ...config };

  if (options.timeout) {
    const timeout = parseInt(options.timeout, 10);
    if (!isNaN(timeout)) {
      overridden.roadmapScanner = {
        ...overridden.roadmapScanner,
        slicerMaxRuntime: timeout,
      };
    }
  }

  if (options.provider) {
    // Use _cliProviderOverride to ensure CLI flag takes precedence over jobProviders
    overridden._cliProviderOverride = options.provider as INightWatchConfig['provider'];
  }

  return overridden;
}

/**
 * Register the slice command with the program
 */
export function sliceCommand(program: Command): void {
  program
    .command('slice')
    .alias('planner')
    .description('Run Planner (roadmap slicer) to create a PRD from the next roadmap item')
    .option('--dry-run', 'Show what would be executed without running')
    .option('--timeout <seconds>', 'Override max runtime in seconds for slicer')
    .option('--provider <string>', 'AI provider to use (claude or codex)')
    .action(async (options: ISliceOptions) => {
      // Get the project directory (current working directory)
      const projectDir = process.cwd();
      const lockResult = acquirePlannerLock(projectDir);
      if (!lockResult.acquired) {
        info(`Planner is already running${lockResult.pid ? ` (PID ${lockResult.pid})` : ''}`);
        process.exit(0);
      }
      const cleanupLock = () => releasePlannerLock(lockResult.lockFile);
      process.on('exit', cleanupLock);

      // Load config from file and environment
      let config = loadConfig(projectDir);

      // Apply CLI flag overrides
      config = applyCliOverrides(config, options);

      // Build environment variables
      const envVars = buildEnvVars(config, options);

      if (options.dryRun) {
        header('Dry Run: Planner');

        // Resolve slicer-specific provider
        const slicerProvider = resolveJobProvider(config, 'slicer');

        // Configuration section with table
        header('Configuration');
        const configTable = createTable({ head: ['Setting', 'Value'] });
        configTable.push(['Provider', slicerProvider]);
        configTable.push(['Provider CLI', PROVIDER_COMMANDS[slicerProvider]]);
        configTable.push(['PRD Directory', config.prdDir]);
        configTable.push(['Roadmap Path', config.roadmapScanner.roadmapPath]);
        configTable.push([
          'Planner Max Runtime',
          `${config.roadmapScanner.slicerMaxRuntime}s (${Math.floor(config.roadmapScanner.slicerMaxRuntime / 60)}min)`,
        ]);
        configTable.push(['Planner Schedule', config.roadmapScanner.slicerSchedule]);
        configTable.push(['Scanner Enabled', config.roadmapScanner.enabled ? 'Yes' : 'No']);
        console.log(configTable.toString());

        // Get roadmap status
        header('Roadmap Status');
        const roadmapStatus = getRoadmapStatus(projectDir, config);

        if (!config.roadmapScanner.enabled) {
          dim('  Roadmap scanner is disabled');
        } else if (roadmapStatus.status === 'no-roadmap') {
          dim(`  ROADMAP.md not found at ${config.roadmapScanner.roadmapPath}`);
        } else {
          const statusTable = createTable({ head: ['Metric', 'Count'] });
          statusTable.push(['Total Items', roadmapStatus.totalItems]);
          statusTable.push(['Processed', roadmapStatus.processedItems]);
          statusTable.push(['Pending', roadmapStatus.pendingItems]);
          statusTable.push(['Status', roadmapStatus.status]);
          console.log(statusTable.toString());

          // Show pending items
          if (roadmapStatus.pendingItems > 0) {
            header('Pending Items');
            const pendingItems = roadmapStatus.items.filter(
              (item) => !item.processed && !item.checked,
            );
            for (const item of pendingItems.slice(0, 10)) {
              info(`  - ${item.title}`);
              if (item.section) {
                dim(`    Section: ${item.section}`);
              }
            }
            if (pendingItems.length > 10) {
              dim(`  ... and ${pendingItems.length - 10} more`);
            }
          }
        }

        // Provider invocation command
        header('Provider Invocation');
        const providerCmd = PROVIDER_COMMANDS[slicerProvider];
        const autoFlag = slicerProvider === 'claude' ? '--dangerously-skip-permissions' : '--yolo';
        dim(`  ${providerCmd} ${autoFlag} -p "/night-watch-slicer"`);

        // Environment variables
        header('Environment Variables');
        for (const [key, value] of Object.entries(envVars)) {
          dim(`  ${key}=${value}`);
        }

        // Full command that would be executed
        header('Action');
        dim('  Would invoke sliceNextItem() to process one roadmap item');
        console.log();

        process.exit(0);
      }

      // Check if roadmap scanner is enabled
      if (!config.roadmapScanner.enabled) {
        info('Planner is disabled in config; skipping run.');
        process.exit(0);
      }

      // Execute planner with spinner
      const spinner = createSpinner('Running Planner...');
      spinner.start();

      try {
        if (!options.dryRun) {
          await sendNotifications(config, {
            event: 'run_started',
            projectName: path.basename(projectDir),
            exitCode: 0,
            provider: config.provider,
          });
        }

        const result: ISliceResult = await sliceNextItem(projectDir, config);

        if (result.sliced) {
          spinner.succeed(`Planner completed successfully: Created ${result.file}`);
        } else if (result.error) {
          if (result.error === 'No pending items to process') {
            spinner.succeed('No pending items to process');
          } else {
            spinner.fail(`Planner failed: ${result.error}`);
          }
        }

        // Send notifications (fire-and-forget, failures do not affect exit code)
        const nothingPending = result.error === 'No pending items to process';
        const exitCode = result.sliced || nothingPending ? 0 : 1;

        if (!options.dryRun && result.sliced) {
          await sendNotifications(config, {
            event: 'run_succeeded',
            projectName: path.basename(projectDir),
            exitCode,
            provider: config.provider,
            prTitle: result.item?.title,
          });
        } else if (!options.dryRun && !nothingPending) {
          await sendNotifications(config, {
            event: 'run_failed',
            projectName: path.basename(projectDir),
            exitCode,
            provider: config.provider,
          });
        }

        process.exit(exitCode);
      } catch (err) {
        spinner.fail('Failed to execute planner command');
        uiError(`${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });
}
