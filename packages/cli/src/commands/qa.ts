/**
 * QA command - executes the QA cron script for PR test generation
 */

import { Command } from 'commander';
import {
  CLAUDE_MODEL_IDS,
  INightWatchConfig,
  PROVIDER_COMMANDS,
  createSpinner,
  createTable,
  dim,
  executeScriptWithOutput,
  fetchPrDetailsByNumber,
  fetchQaScreenshotUrlsForPr,
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
  getTelegramStatusWebhooks,
} from './shared/env-builder.js';
import * as path from 'path';

/**
 * Options for the qa command
 */
export interface IQaOptions {
  dryRun: boolean;
  timeout?: string;
  provider?: string;
}

/**
 * QA notifications should not fire for script-level skip/no-op outcomes.
 */
export function shouldSendQaNotification(scriptStatus?: string): boolean {
  if (!scriptStatus) {
    return true;
  }
  return !scriptStatus.startsWith('skip_');
}

/**
 * Parse PR numbers emitted by the QA script marker data (e.g. "#12,#34").
 */
export function parseQaPrNumbers(prsRaw?: string): number[] {
  if (!prsRaw) return [];

  const seen = new Set<number>();
  const numbers: number[] = [];
  for (const token of prsRaw.split(',')) {
    const parsed = parseInt(token.trim().replace(/^#/, ''), 10);
    if (Number.isNaN(parsed) || seen.has(parsed)) {
      continue;
    }
    seen.add(parsed);
    numbers.push(parsed);
  }
  return numbers;
}

function parseRepoFromPrUrl(prUrl?: string): string | undefined {
  if (!prUrl) {
    return undefined;
  }

  const match = prUrl.match(/^https?:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/\d+/i);
  return match?.[1];
}

/**
 * Build environment variables map from config and CLI options for QA
 */
export function buildEnvVars(
  config: INightWatchConfig,
  options: IQaOptions,
): Record<string, string> {
  // Start with base env vars shared by all job types
  const env = buildBaseEnvVars(config, 'qa', options.dryRun);

  // Runtime for QA (uses NW_QA_* variables)
  env.NW_QA_MAX_RUNTIME = String(config.qa.maxRuntime);

  // Branch patterns: use qa-specific if non-empty, else top-level
  const branchPatterns =
    config.qa.branchPatterns.length > 0 ? config.qa.branchPatterns : config.branchPatterns;
  env.NW_BRANCH_PATTERNS = branchPatterns.join(',');

  // QA-specific settings
  env.NW_QA_SKIP_LABEL = config.qa.skipLabel;
  env.NW_QA_ARTIFACTS = config.qa.artifacts;
  env.NW_QA_AUTO_INSTALL_PLAYWRIGHT = config.qa.autoInstallPlaywright ? '1' : '0';
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
 * Apply CLI flag overrides to the config for QA
 */
export function applyCliOverrides(
  config: INightWatchConfig,
  options: IQaOptions,
): INightWatchConfig {
  const overridden = { ...config, qa: { ...config.qa } };

  if (options.timeout) {
    const timeout = parseInt(options.timeout, 10);
    if (!isNaN(timeout)) {
      overridden.qa.maxRuntime = timeout;
    }
  }

  if (options.provider) {
    // Use _cliProviderOverride to ensure CLI flag takes precedence over jobProviders
    overridden._cliProviderOverride = options.provider as INightWatchConfig['provider'];
  }

  return overridden;
}

/**
 * Register the qa command with the program
 */
export function qaCommand(program: Command): void {
  program
    .command('qa')
    .description('Run QA process now')
    .option('--dry-run', 'Show what would be executed without running')
    .option('--timeout <seconds>', 'Override max runtime in seconds for QA')
    .option('--provider <string>', 'AI provider to use (claude or codex)')
    .action(async (options: IQaOptions) => {
      // Get the project directory (current working directory)
      const projectDir = process.cwd();

      // Load config from file and environment
      let config = loadConfig(projectDir);

      // Apply CLI flag overrides
      config = applyCliOverrides(config, options);

      if (!config.qa.enabled && !options.dryRun) {
        info('QA is disabled in config; skipping run.');
        process.exit(0);
      }

      // Build environment variables
      const envVars = buildEnvVars(config, options);

      // Get the script path
      const scriptPath = getScriptPath('night-watch-qa-cron.sh');

      if (options.dryRun) {
        header('Dry Run: QA Process');

        // Resolve QA-specific provider
        const qaProvider = resolveJobProvider(config, 'qa');

        // Configuration section with table
        header('Configuration');
        const configTable = createTable({ head: ['Setting', 'Value'] });
        configTable.push(['Provider', qaProvider]);
        configTable.push(['Provider CLI', PROVIDER_COMMANDS[qaProvider]]);
        configTable.push([
          'Max Runtime',
          `${config.qa.maxRuntime}s (${Math.floor(config.qa.maxRuntime / 60)}min)`,
        ]);
        const branchPatterns =
          config.qa.branchPatterns.length > 0 ? config.qa.branchPatterns : config.branchPatterns;
        configTable.push(['Branch Patterns', branchPatterns.join(', ')]);
        configTable.push(['Skip Label', config.qa.skipLabel]);
        configTable.push(['Artifacts', config.qa.artifacts]);
        configTable.push([
          'Auto-install Playwright',
          config.qa.autoInstallPlaywright ? 'Yes' : 'No',
        ]);
        console.log(configTable.toString());

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
      const spinner = createSpinner('Running QA process...');
      spinner.start();

      try {
        const { exitCode, stdout, stderr } = await executeScriptWithOutput(
          scriptPath,
          [projectDir],
          envVars,
        );
        const scriptResult = parseScriptResult(`${stdout}\n${stderr}`);

        if (exitCode === 0) {
          if (scriptResult?.status?.startsWith('skip_')) {
            spinner.succeed('QA process completed (no PRs needed QA)');
          } else {
            spinner.succeed('QA process completed successfully');
          }
        } else {
          spinner.fail(`QA process exited with code ${exitCode}`);
        }

        // Send notifications (fire-and-forget, failures do not affect exit code)
        if (!options.dryRun) {
          const skipNotification = !shouldSendQaNotification(scriptResult?.status);

          if (skipNotification) {
            info('Skipping QA notification (no actionable QA result)');
          }

          if (!skipNotification) {
            const qaPrNumbers = parseQaPrNumbers(scriptResult?.data.prs);
            const primaryQaPr = qaPrNumbers[0];
            const prDetails = primaryQaPr ? fetchPrDetailsByNumber(primaryQaPr, projectDir) : null;
            const repo = scriptResult?.data.repo ?? parseRepoFromPrUrl(prDetails?.url);
            const fallbackPrUrl =
              !prDetails?.url && primaryQaPr && repo
                ? `https://github.com/${repo}/pull/${primaryQaPr}`
                : undefined;
            const qaScreenshotUrls =
              primaryQaPr !== undefined
                ? fetchQaScreenshotUrlsForPr(primaryQaPr, projectDir, repo)
                : [];

            const _qaCtx = {
              event: 'qa_completed' as const,
              projectName: path.basename(projectDir),
              exitCode,
              provider: formatProviderDisplay(envVars.NW_PROVIDER_CMD, envVars.NW_PROVIDER_LABEL),
              prNumber: prDetails?.number ?? primaryQaPr,
              prUrl: prDetails?.url ?? fallbackPrUrl,
              prTitle: prDetails?.title,
              prBody: prDetails?.body,
              filesChanged: prDetails?.changedFiles,
              additions: prDetails?.additions,
              deletions: prDetails?.deletions,
              qaScreenshotUrls,
            };
            await sendNotifications(config, _qaCtx);
          }
        }

        process.exit(exitCode);
      } catch (err) {
        spinner.fail('Failed to execute QA command');
        uiError(`${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });
}
