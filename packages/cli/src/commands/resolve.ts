/**
 * Resolve command - executes the PR resolver cron script
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
import { execFileSync } from 'child_process';
import * as path from 'path';

/**
 * Options for the resolve command
 */
export interface IResolveOptions {
  dryRun: boolean;
  timeout?: string;
  provider?: string;
}

/**
 * Build environment variables map from config and CLI options for PR resolver
 */
export function buildEnvVars(
  config: INightWatchConfig,
  options: IResolveOptions,
): Record<string, string> {
  // Start with base env vars shared by all job types
  const env = buildBaseEnvVars(config, 'pr-resolver', options.dryRun);

  // Runtime for PR resolver (uses NW_PR_RESOLVER_* variables)
  env.NW_PR_RESOLVER_MAX_RUNTIME = String(config.prResolver.maxRuntime);
  env.NW_PR_RESOLVER_MAX_PRS_PER_RUN = String(config.prResolver.maxPrsPerRun);
  env.NW_PR_RESOLVER_PER_PR_TIMEOUT = String(config.prResolver.perPrTimeout);
  env.NW_PR_RESOLVER_AI_CONFLICT_RESOLUTION = config.prResolver.aiConflictResolution ? '1' : '0';
  env.NW_PR_RESOLVER_AI_REVIEW_RESOLUTION = config.prResolver.aiReviewResolution ? '1' : '0';
  env.NW_PR_RESOLVER_READY_LABEL = config.prResolver.readyLabel;
  env.NW_PR_RESOLVER_BRANCH_PATTERNS = config.prResolver.branchPatterns.join(',');

  return env;
}

/**
 * Apply CLI flag overrides to the config for PR resolver
 */
export function applyCliOverrides(
  config: INightWatchConfig,
  options: IResolveOptions,
): INightWatchConfig {
  const overridden = { ...config, prResolver: { ...config.prResolver } };

  if (options.timeout) {
    const timeout = parseInt(options.timeout, 10);
    if (!isNaN(timeout)) {
      overridden.prResolver.maxRuntime = timeout;
    }
  }

  if (options.provider) {
    // Use _cliProviderOverride to ensure CLI flag takes precedence over jobProviders
    overridden._cliProviderOverride = options.provider as INightWatchConfig['provider'];
  }

  return overridden;
}

/**
 * Get open PRs with conflict status (no branch pattern filtering)
 */
function getOpenPrs(): { number: number; title: string; branch: string; mergeable: string }[] {
  try {
    const args = ['pr', 'list', '--state', 'open', '--json', 'number,title,headRefName,mergeable'];

    const result = execFileSync('gh', args, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const prs = JSON.parse(result.trim() || '[]');
    return prs.map(
      (pr: { number: number; title: string; headRefName: string; mergeable: string }) => ({
        number: pr.number,
        title: pr.title,
        branch: pr.headRefName,
        mergeable: pr.mergeable,
      }),
    );
  } catch {
    // gh CLI not available or not authenticated
    return [];
  }
}

/**
 * Register the resolve command with the program
 */
export function resolveCommand(program: Command): void {
  program
    .command('resolve')
    .description('Run PR conflict resolver now')
    .option('--dry-run', 'Show what would be executed without running')
    .option('--timeout <seconds>', 'Override max runtime')
    .option('--provider <string>', 'AI provider to use')
    .action(async (options: IResolveOptions) => {
      // Get the project directory (current working directory)
      const projectDir = process.cwd();

      // Load config from file and environment
      let config = loadConfig(projectDir);

      // Apply CLI flag overrides
      config = applyCliOverrides(config, options);

      if (!config.prResolver.enabled && !options.dryRun) {
        info('PR resolver is disabled in config; skipping.');
        process.exit(0);
      }

      // Build environment variables
      const envVars = buildEnvVars(config, options);

      // Get the script path
      const scriptPath = getScriptPath('night-watch-pr-resolver-cron.sh');

      if (options.dryRun) {
        header('Dry Run: PR Resolver');

        // Resolve resolver-specific provider
        const resolverProvider = resolveJobProvider(config, 'pr-resolver');

        // Configuration section with table
        header('Configuration');
        const configTable = createTable({ head: ['Setting', 'Value'] });
        configTable.push(['Provider', resolverProvider]);
        configTable.push([
          'Max Runtime',
          `${config.prResolver.maxRuntime}s (${Math.floor(config.prResolver.maxRuntime / 60)}min)`,
        ]);
        configTable.push([
          'Max PRs Per Run',
          config.prResolver.maxPrsPerRun === 0
            ? 'Unlimited'
            : String(config.prResolver.maxPrsPerRun),
        ]);
        configTable.push(['Per-PR Timeout', `${config.prResolver.perPrTimeout}s`]);
        configTable.push([
          'AI Conflict Resolution',
          config.prResolver.aiConflictResolution ? 'Enabled' : 'Disabled',
        ]);
        configTable.push([
          'AI Review Resolution',
          config.prResolver.aiReviewResolution ? 'Enabled' : 'Disabled',
        ]);
        configTable.push(['Ready Label', config.prResolver.readyLabel]);
        configTable.push([
          'Branch Patterns',
          config.prResolver.branchPatterns.length > 0
            ? config.prResolver.branchPatterns.join(', ')
            : '(all)',
        ]);
        console.log(configTable.toString());

        // Check for open PRs
        header('Open PRs');
        const openPrs = getOpenPrs();

        if (openPrs.length === 0) {
          dim('  (no open PRs found)');
        } else {
          for (const pr of openPrs) {
            const conflictStatus = pr.mergeable === 'CONFLICTING' ? ' [CONFLICT]' : '';
            info(`#${pr.number}: ${pr.title}${conflictStatus}`);
            dim(`         Branch: ${pr.branch}`);
          }
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
      const spinner = createSpinner('Running PR resolver...');
      spinner.start();

      try {
        await maybeApplyCronSchedulingDelay(config, 'pr-resolver', projectDir);
        const { exitCode, stdout, stderr } = await executeScriptWithOutput(
          scriptPath,
          [projectDir],
          envVars,
        );
        const scriptResult = parseScriptResult(`${stdout}\n${stderr}`);

        if (exitCode === 0) {
          if (scriptResult?.status === 'queued') {
            spinner.succeed('PR resolver queued — another job is currently running');
          } else if (scriptResult?.status?.startsWith('skip_')) {
            spinner.succeed('PR resolver completed (no PRs needed resolution)');
          } else {
            spinner.succeed('PR resolver completed successfully');
          }
        } else {
          spinner.fail(`PR resolver exited with code ${exitCode}`);
        }

        // Send notifications (fire-and-forget, failures do not affect exit code)
        const notificationEvent =
          exitCode === 0 ? ('pr_resolver_completed' as const) : ('pr_resolver_failed' as const);

        await sendNotifications(config, {
          event: notificationEvent,
          projectName: path.basename(projectDir),
          exitCode,
          provider: formatProviderDisplay(envVars.NW_PROVIDER_CMD, envVars.NW_PROVIDER_LABEL),
        });

        process.exit(exitCode);
      } catch (err) {
        spinner.fail('Failed to execute resolve command');
        uiError(`${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });
}
