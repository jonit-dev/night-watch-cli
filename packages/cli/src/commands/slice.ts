/**
 * Slice command - executes the roadmap slicer to create PRDs from roadmap items
 */

import { Command } from 'commander';
import {
  BoardColumnName,
  CLAUDE_MODEL_IDS,
  INightWatchConfig,
  LOCK_FILE_PREFIX,
  PROVIDER_COMMANDS,
  createBoardProvider,
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
  warn,
} from '@night-watch/core';
import {
  buildBaseEnvVars,
  getTelegramStatusWebhooks,
  maybeApplyCronSchedulingDelay,
} from './shared/env-builder.js';
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

export interface IPlannerIssueCreationResult {
  created: boolean;
  skippedReason?: string;
  issueNumber?: number;
  issueUrl?: string;
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

function resolvePlannerIssueColumn(config: INightWatchConfig): BoardColumnName {
  return config.roadmapScanner.issueColumn === 'Ready' ? 'Ready' : 'Draft';
}

function buildPlannerIssueBody(
  projectDir: string,
  config: INightWatchConfig,
  result: ISliceResult,
): string {
  const relativePrdPath = path.join(config.prdDir, result.file ?? '').replace(/\\/g, '/');
  const absolutePrdPath = path.join(projectDir, config.prdDir, result.file ?? '');
  const sourceItem = result.item;

  let prdContent = '';
  try {
    prdContent = fs.readFileSync(absolutePrdPath, 'utf-8');
  } catch {
    prdContent = `Unable to read generated PRD file at \`${relativePrdPath}\`.`;
  }

  const maxBodyChars = 60000;
  const truncated = prdContent.length > maxBodyChars;
  const prdPreview = truncated
    ? `${prdContent.slice(0, maxBodyChars)}\n\n...[truncated]`
    : prdContent;

  const sourceLines = sourceItem
    ? [
        `- Source section: ${sourceItem.section}`,
        `- Source item: ${sourceItem.title}`,
        sourceItem.description ? `- Source summary: ${sourceItem.description}` : '',
      ].filter((line) => line.length > 0)
    : [];

  return [
    '## Planner Generated PRD',
    '',
    `- PRD file: \`${relativePrdPath}\``,
    ...sourceLines,
    '',
    '---',
    '',
    prdPreview,
  ].join('\n');
}

export async function createPlannerIssue(
  projectDir: string,
  config: INightWatchConfig,
  result: ISliceResult,
): Promise<IPlannerIssueCreationResult> {
  if (!result.sliced || !result.file || !result.item) {
    return { created: false, skippedReason: 'nothing-created' };
  }

  if (!config.boardProvider?.enabled) {
    return { created: false, skippedReason: 'board-disabled' };
  }

  const provider = createBoardProvider(config.boardProvider, projectDir);
  const board = await provider.getBoard();
  if (!board) {
    return { created: false, skippedReason: 'board-not-configured' };
  }

  const existingIssues = await provider.getAllIssues();
  const existing = existingIssues.find(
    (issue) => issue.title.trim().toLowerCase() === result.item!.title.trim().toLowerCase(),
  );
  if (existing) {
    return {
      created: false,
      skippedReason: 'already-exists',
      issueNumber: existing.number,
      issueUrl: existing.url,
    };
  }

  const issue = await provider.createIssue({
    title: result.item.title,
    body: buildPlannerIssueBody(projectDir, config, result),
    column: resolvePlannerIssueColumn(config),
  });

  return {
    created: true,
    issueNumber: issue.number,
    issueUrl: issue.url,
  };
}

/**
 * Build environment variables map from config and CLI options for slicer
 */
export function buildEnvVars(
  config: INightWatchConfig,
  options: ISliceOptions,
): Record<string, string> {
  // Start with base env vars shared by all job types
  const env = buildBaseEnvVars(config, 'slicer', options.dryRun);

  // Slicer runtime
  env.NW_SLICER_MAX_RUNTIME = String(config.roadmapScanner.slicerMaxRuntime);

  // PRD directory for slicer output
  env.NW_PRD_DIR = config.prdDir;

  // Roadmap path
  env.NW_ROADMAP_PATH = config.roadmapScanner.roadmapPath;
  env.NW_CLAUDE_MODEL_ID = CLAUDE_MODEL_IDS[config.claudeModel ?? 'sonnet'];

  // Telegram status messages from bash scripts (start/progress/final status)
  const telegramWebhooks = getTelegramStatusWebhooks(config);
  if (telegramWebhooks.length > 0) {
    env.NW_TELEGRAM_STATUS_WEBHOOKS = JSON.stringify(telegramWebhooks);
    env.NW_TELEGRAM_BOT_TOKEN = telegramWebhooks[0].botToken;
    env.NW_TELEGRAM_CHAT_ID = telegramWebhooks[0].chatId;
  }

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
        configTable.push(['Planner Priority Mode', config.roadmapScanner.priorityMode]);
        configTable.push(['Planner Issue Column', resolvePlannerIssueColumn(config)]);
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
        if (slicerProvider === 'claude') {
          dim('  claude -p "/night-watch-slicer" --dangerously-skip-permissions');
        } else {
          dim('  codex exec --yolo "/night-watch-slicer"');
        }

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
        await maybeApplyCronSchedulingDelay(config, 'slicer', projectDir);
        if (!options.dryRun) {
          await sendNotifications(config, {
            event: 'run_started',
            projectName: path.basename(projectDir),
            exitCode: 0,
            provider: config.provider,
          });
        }

        const result: ISliceResult = await sliceNextItem(projectDir, config);

        let issueSummary = '';
        if (result.sliced) {
          try {
            const issueResult = await createPlannerIssue(projectDir, config, result);
            if (issueResult.created && issueResult.issueNumber) {
              issueSummary = `; issue #${issueResult.issueNumber} (${resolvePlannerIssueColumn(config)})`;
            } else if (issueResult.skippedReason === 'already-exists' && issueResult.issueNumber) {
              issueSummary = `; existing issue #${issueResult.issueNumber}`;
            }
          } catch (issueError) {
            warn(
              `Planner created ${result.file} but failed to create board issue: ${
                issueError instanceof Error ? issueError.message : String(issueError)
              }`,
            );
          }
        }

        if (result.sliced) {
          spinner.succeed(`Planner completed successfully: Created ${result.file}${issueSummary}`);
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
