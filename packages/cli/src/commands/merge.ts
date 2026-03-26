/**
 * Merge command - executes the merger cron script
 */

import { Command } from 'commander';
import {
  INightWatchConfig,
  createSpinner,
  createTable,
  dim,
  executeScriptWithOutput,
  getScriptPath,
  header,
  info,
  loadConfig,
  parseScriptResult,
  resolveJobProvider,
  sendNotifications,
  error as uiError,
} from '@night-watch/core';
import {
  buildBaseEnvVars,
  formatProviderDisplay,
  maybeApplyCronSchedulingDelay,
} from './shared/env-builder.js';
import * as path from 'path';

/**
 * Options for the merge command
 */
export interface IMergeOptions {
  dryRun: boolean;
  timeout?: string;
  provider?: string;
}

/**
 * Build environment variables map from config and CLI options for merger
 */
export function buildEnvVars(
  config: INightWatchConfig,
  options: IMergeOptions,
): Record<string, string> {
  // Start with base env vars shared by all job types
  const env = buildBaseEnvVars(config, 'merger', options.dryRun);

  // Runtime for merger (uses NW_MERGER_* variables)
  env.NW_MERGER_MAX_RUNTIME = String(config.merger.maxRuntime);
  env.NW_MERGER_MERGE_METHOD = config.merger.mergeMethod;
  env.NW_MERGER_MIN_REVIEW_SCORE = String(config.merger.minReviewScore);
  env.NW_MERGER_BRANCH_PATTERNS = (
    config.merger.branchPatterns.length > 0
      ? config.merger.branchPatterns
      : config.branchPatterns
  ).join(',');
  env.NW_MERGER_REBASE_BEFORE_MERGE = config.merger.rebaseBeforeMerge ? '1' : '0';
  env.NW_MERGER_MAX_PRS_PER_RUN = String(config.merger.maxPrsPerRun);

  return env;
}

/**
 * Apply CLI flag overrides to the config for merger
 */
export function applyCliOverrides(
  config: INightWatchConfig,
  options: IMergeOptions,
): INightWatchConfig {
  const overridden = { ...config, merger: { ...config.merger } };

  if (options.timeout) {
    const timeout = parseInt(options.timeout, 10);
    if (!isNaN(timeout)) {
      overridden.merger.maxRuntime = timeout;
    }
  }

  if (options.provider) {
    // Use _cliProviderOverride to ensure CLI flag takes precedence over jobProviders
    overridden._cliProviderOverride = options.provider as INightWatchConfig['provider'];
  }

  return overridden;
}

/**
 * Resolve which notification event to emit based on the script outcome
 */
function resolveMergeNotificationEvent(
  exitCode: number,
  mergedCount: number,
  failedCount: number,
): 'merge_completed' | 'merge_failed' | null {
  if (exitCode === 0 && mergedCount > 0) {
    return 'merge_completed';
  }
  if (exitCode !== 0 || failedCount > 0) {
    return 'merge_failed';
  }
  return null;
}

/**
 * Print dry-run output for the merge command
 */
function printDryRun(
  config: INightWatchConfig,
  envVars: Record<string, string>,
  scriptPath: string,
  projectDir: string,
): void {
  header('Dry Run: Merge Orchestrator');

  const mergerProvider = resolveJobProvider(config, 'merger');

  header('Configuration');
  const configTable = createTable({ head: ['Setting', 'Value'] });
  configTable.push(['Provider', mergerProvider]);
  configTable.push([
    'Max Runtime',
    `${config.merger.maxRuntime}s (${Math.floor(config.merger.maxRuntime / 60)}min)`,
  ]);
  configTable.push(['Merge Method', config.merger.mergeMethod]);
  configTable.push(['Min Review Score', `${config.merger.minReviewScore}/100`]);
  configTable.push([
    'Branch Patterns',
    config.merger.branchPatterns.length > 0
      ? config.merger.branchPatterns.join(', ')
      : '(top-level)',
  ]);
  configTable.push(['Rebase Before Merge', config.merger.rebaseBeforeMerge ? 'Yes' : 'No']);
  configTable.push([
    'Max PRs Per Run',
    config.merger.maxPrsPerRun === 0 ? 'Unlimited' : String(config.merger.maxPrsPerRun),
  ]);
  console.log(configTable.toString());

  header('Environment Variables');
  for (const [key, value] of Object.entries(envVars)) {
    dim(`  ${key}=${value}`);
  }

  header('Command');
  dim(`  bash ${scriptPath} ${projectDir}`);
  console.log();
}

/**
 * Register the merge command with the program
 */
export function mergeCommand(program: Command): void {
  program
    .command('merge')
    .description('Merge eligible PRs in FIFO order')
    .option('--dry-run', 'Show what would be executed without running')
    .option('--timeout <seconds>', 'Override max runtime')
    .option('--provider <string>', 'AI provider to use')
    .action(async (options: IMergeOptions) => {
      // Get the project directory (current working directory)
      const projectDir = process.cwd();

      // Load config from file and environment
      let config = loadConfig(projectDir);

      // Apply CLI flag overrides
      config = applyCliOverrides(config, options);

      if (!config.merger.enabled && !options.dryRun) {
        info('Merge orchestrator is disabled in config; skipping.');
        process.exit(0);
      }

      // Build environment variables
      const envVars = buildEnvVars(config, options);

      // Get the script path
      const scriptPath = getScriptPath('night-watch-merger-cron.sh');

      if (options.dryRun) {
        printDryRun(config, envVars, scriptPath, projectDir);
        process.exit(0);
      }

      // Execute the script with spinner
      const spinner = createSpinner('Running merge orchestrator...');
      spinner.start();

      try {
        await maybeApplyCronSchedulingDelay(config, 'merger', projectDir);
        const { exitCode, stdout, stderr } = await executeScriptWithOutput(
          scriptPath,
          [projectDir],
          envVars,
        );
        const scriptResult = parseScriptResult(`${stdout}\n${stderr}`);

        if (exitCode === 0) {
          if (scriptResult?.status === 'queued') {
            spinner.succeed('Merge orchestrator queued — another job is currently running');
          } else if (scriptResult?.status?.startsWith('skip_')) {
            spinner.succeed('Merge orchestrator completed (no eligible PRs)');
          } else {
            spinner.succeed('Merge orchestrator completed successfully');
          }
        } else {
          spinner.fail(`Merge orchestrator exited with code ${exitCode}`);
        }

        // Parse result for notification data
        const mergedCount = parseInt(scriptResult?.data?.merged ?? '0', 10);
        const failedCount = parseInt(scriptResult?.data?.failed ?? '0', 10);

        const notificationEvent = resolveMergeNotificationEvent(exitCode, mergedCount, failedCount);

        if (notificationEvent) {
          await sendNotifications(config, {
            event: notificationEvent,
            projectName: path.basename(projectDir),
            exitCode,
            provider: formatProviderDisplay(envVars.NW_PROVIDER_CMD, envVars.NW_PROVIDER_LABEL),
          });
        }

        process.exit(exitCode);
      } catch (err) {
        spinner.fail('Failed to execute merge command');
        uiError(`${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });
}
