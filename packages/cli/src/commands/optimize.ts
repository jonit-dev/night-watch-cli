/**
 * Optimizer command - runs the AI provider to find and prove one performance improvement.
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
  getScriptPath,
  header,
  info,
  loadConfig,
  parseScriptResult,
  resolveJobProvider,
} from '@night-watch/core';
import * as path from 'path';
import {
  buildBaseEnvVars,
  getTelegramStatusWebhooks,
  maybeApplyCronSchedulingDelay,
} from './shared/env-builder.js';
import { recordJobOutcome } from './shared/feedback.js';

export interface IOptimizeOptions {
  dryRun: boolean;
  json?: boolean;
  timeout?: string;
  provider?: string;
  targetScope?: string;
}

export function buildEnvVars(
  config: INightWatchConfig,
  options: IOptimizeOptions,
  projectDir: string = process.cwd(),
): Record<string, string> {
  const env = buildBaseEnvVars(config, 'optimizer', options.dryRun);

  env.NW_OPTIMIZER_MAX_RUNTIME = String(config.optimizer.maxRuntime);
  env.NW_OPTIMIZER_BRANCH_PREFIX = config.optimizer.branchPrefix;
  env.NW_OPTIMIZER_PR_LABEL = config.optimizer.prLabel;
  env.NW_OPTIMIZER_TARGET_SCOPE = options.targetScope ?? config.optimizer.targetScope;
  env.NW_OPTIMIZER_MAX_FINDINGS_TO_INSPECT = String(config.optimizer.maxFindingsToInspect);
  env.NW_OPTIMIZER_VERIFICATION_COMMAND = config.optimizer.verificationCommand;
  env.NW_OPTIMIZER_SCANNER_CMD = `bash ${getScriptPath('night-watch-optimizer-scan.sh')}`;
  env.NW_OPTIMIZER_REPORT_PATH = path.join(projectDir, 'logs', 'optimizer-report.md');
  env.NW_CLAUDE_MODEL_ID =
    CLAUDE_MODEL_IDS[config.primaryFallbackModel ?? config.claudeModel ?? 'sonnet'];

  const telegramWebhooks = getTelegramStatusWebhooks(config);
  if (telegramWebhooks.length > 0) {
    env.NW_TELEGRAM_STATUS_WEBHOOKS = JSON.stringify(telegramWebhooks);
    env.NW_TELEGRAM_BOT_TOKEN = telegramWebhooks[0].botToken;
    env.NW_TELEGRAM_CHAT_ID = telegramWebhooks[0].chatId;
  }

  return env;
}

export function applyCliOverrides(
  config: INightWatchConfig,
  options: IOptimizeOptions,
): INightWatchConfig {
  let overridden = { ...config, optimizer: { ...config.optimizer } };

  if (options.timeout) {
    const timeout = parseInt(options.timeout, 10);
    if (!isNaN(timeout) && timeout >= 0) {
      overridden.optimizer.maxRuntime = timeout;
    }
  }

  if (options.targetScope !== undefined) {
    overridden.optimizer.targetScope = options.targetScope;
  }

  if (options.provider) {
    overridden = {
      ...overridden,
      _cliProviderOverride: options.provider as INightWatchConfig['provider'],
    };
  }

  return overridden;
}

function writeJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function optimizeCommand(program: Command): void {
  program
    .command('optimize')
    .description('Run Optimizer to find and prove one performance improvement')
    .option('--dry-run', 'Show what would be executed without mutating the repo')
    .option('--json', 'Output structured JSON')
    .option('--timeout <seconds>', 'Override max runtime in seconds')
    .option('--provider <string>', 'AI provider to use')
    .option('--target-scope <scope>', 'Optional path or scope to scan instead of the whole repo')
    .action(async (options: IOptimizeOptions) => {
      const projectDir = process.cwd();
      let config = loadConfig(projectDir);
      config = applyCliOverrides(config, options);

      if (!config.optimizer.enabled && !options.dryRun) {
        if (options.json) {
          writeJson({ skipped: true, reason: 'optimizer-disabled' });
        } else {
          info('Optimizer is disabled in config; skipping run.');
        }
        process.exit(0);
        return;
      }

      const envVars = buildEnvVars(config, options, projectDir);
      const scriptPath = getScriptPath('night-watch-optimizer-cron.sh');
      const optimizerProvider = resolveJobProvider(config, 'optimizer');

      if (options.dryRun) {
        const payload = {
          dryRun: true,
          provider: optimizerProvider,
          providerCli: PROVIDER_COMMANDS[optimizerProvider] ?? envVars.NW_PROVIDER_CMD,
          targetScope: envVars.NW_OPTIMIZER_TARGET_SCOPE || '(repo)',
          branchPrefix: config.optimizer.branchPrefix,
          prLabel: config.optimizer.prLabel,
          scannerCommand: envVars.NW_OPTIMIZER_SCANNER_CMD,
          verificationCommand: config.optimizer.verificationCommand || '(auto-detect)',
          reportPath: envVars.NW_OPTIMIZER_REPORT_PATH,
          command: `bash ${scriptPath} ${projectDir}`,
        };

        if (options.json) {
          writeJson(payload);
        } else {
          header('Dry Run: Optimizer');
          const table = createTable({ head: ['Setting', 'Value'] });
          table.push(['Provider', payload.provider]);
          table.push(['Provider CLI', payload.providerCli ?? '']);
          table.push(['Target Scope', payload.targetScope]);
          table.push(['Branch Prefix', payload.branchPrefix]);
          table.push(['PR Label', payload.prLabel]);
          table.push(['Scanner Command', payload.scannerCommand]);
          table.push(['Verification Command', payload.verificationCommand]);
          table.push(['Report Path', payload.reportPath]);
          console.log(table.toString());
          header('Command');
          dim(`  ${payload.command}`);
          console.log();
        }
        process.exit(0);
        return;
      }

      const spinner = options.json ? null : createSpinner('Running Optimizer...');
      spinner?.start();
      const startedAt = Date.now();

      try {
        await maybeApplyCronSchedulingDelay(config, 'optimizer', projectDir);
        const { exitCode, stdout, stderr } = await executeScriptWithOutput(
          scriptPath,
          [projectDir],
          envVars,
        );
        const finishedAt = Date.now();
        const scriptResult = parseScriptResult(`${stdout}\n${stderr}`);

        try {
          recordJobOutcome({
            config,
            exitCode,
            finishedAt,
            jobType: 'optimizer',
            metadata: {
              providerCommand: envVars.NW_PROVIDER_CMD,
              providerLabel: envVars.NW_PROVIDER_LABEL,
            },
            projectDir,
            providerKey: envVars.NW_PROVIDER_KEY ?? optimizerProvider,
            scriptResult,
            startedAt,
            stderr,
            stdout,
          });
        } catch {
          // Outcome persistence must not change command exit behavior.
        }

        if (options.json) {
          writeJson({ exitCode, status: scriptResult?.status, data: scriptResult?.data ?? {} });
        } else if (exitCode === 0) {
          if (scriptResult?.status === 'success_pr') {
            spinner?.succeed('Optimizer opened a proven draft PR');
          } else if (scriptResult?.status === 'queued') {
            spinner?.succeed('Optimizer queued — another job is currently running');
          } else {
            spinner?.succeed('Optimizer finished without opening a PR; report written if needed');
          }
        } else {
          spinner?.fail(`Optimizer exited with code ${exitCode}`);
        }

        process.exit(exitCode);
        return;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        try {
          recordJobOutcome({
            config,
            exitCode: 1,
            finishedAt: Date.now(),
            jobType: 'optimizer',
            metadata: { error: message },
            projectDir,
            providerKey: envVars.NW_PROVIDER_KEY ?? optimizerProvider,
            startedAt,
            stderr: message,
          });
        } catch {
          // Outcome persistence must not change command exit behavior.
        }

        if (options.json) {
          process.stderr.write(`${message}\n`);
          writeJson({ error: message });
        } else {
          spinner?.fail(`Optimizer failed: ${message}`);
        }
        process.exit(1);
        return;
      }
    });
}
