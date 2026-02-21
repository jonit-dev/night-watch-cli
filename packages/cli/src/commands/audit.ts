/**
 * Audit command - runs the AI provider to scan the codebase for code quality issues
 */

import { Command } from 'commander';
import {
  INightWatchConfig,
  PROVIDER_COMMANDS,
  createSpinner,
  createTable,
  dim,
  executeScriptWithOutput,
  getScriptPath,
  header,
  loadConfig,
  parseScriptResult,
} from '@night-watch/core';
import * as fs from 'fs';
import * as path from 'path';

export interface IAuditOptions {
  dryRun: boolean;
  timeout?: string;
  provider?: string;
}

/**
 * Build environment variables map from config and CLI options for audit
 */
export function buildEnvVars(
  config: INightWatchConfig,
  options: IAuditOptions,
): Record<string, string> {
  const env: Record<string, string> = {};

  env.NW_PROVIDER_CMD = PROVIDER_COMMANDS[config.provider];
  env.NW_AUDIT_MAX_RUNTIME = String(config.audit.maxRuntime);

  if (config.defaultBranch) {
    env.NW_DEFAULT_BRANCH = config.defaultBranch;
  }

  if (config.providerEnv) {
    Object.assign(env, config.providerEnv);
  }

  if (options.dryRun) {
    env.NW_DRY_RUN = '1';
  }

  env.NW_EXECUTION_CONTEXT = 'agent';

  return env;
}

/**
 * Register the audit command with the program
 */
export function auditCommand(program: Command): void {
  program
    .command('audit')
    .description('Run AI provider code audit now')
    .option('--dry-run', 'Show what would be executed without running')
    .option('--timeout <seconds>', 'Override max runtime in seconds')
    .option('--provider <string>', 'AI provider to use (claude or codex)')
    .action(async (options: IAuditOptions) => {
      const projectDir = process.cwd();
      let config = loadConfig(projectDir);

      if (options.timeout) {
        const timeout = parseInt(options.timeout, 10);
        if (!isNaN(timeout)) {
          config = { ...config, audit: { ...config.audit, maxRuntime: timeout } };
        }
      }

      if (options.provider) {
        config = { ...config, provider: options.provider as INightWatchConfig['provider'] };
      }

      const envVars = buildEnvVars(config, options);
      const scriptPath = getScriptPath('night-watch-audit-cron.sh');

      if (options.dryRun) {
        header('Dry Run: Code Auditor');

        header('Configuration');
        const configTable = createTable({ head: ['Setting', 'Value'] });
        configTable.push(['Provider', config.provider]);
        configTable.push(['Provider CLI', PROVIDER_COMMANDS[config.provider]]);
        configTable.push(['Max Runtime', `${config.audit.maxRuntime}s`]);
        configTable.push(['Report File', path.join(projectDir, 'logs', 'audit-report.md')]);
        console.log(configTable.toString());

        header('Provider Invocation');
        const providerCmd = PROVIDER_COMMANDS[config.provider];
        if (config.provider === 'claude') {
          dim(
            `  ${providerCmd} -p "<bundled night-watch-audit.md>" --dangerously-skip-permissions`,
          );
        } else {
          dim(`  ${providerCmd} --quiet --yolo --prompt "<bundled night-watch-audit.md>"`);
        }

        header('Command');
        dim(`  bash ${scriptPath} ${projectDir}`);
        console.log();

        process.exit(0);
      }

      const spinner = createSpinner('Running code audit...');
      spinner.start();

      try {
        const { exitCode, stdout, stderr } = await executeScriptWithOutput(
          scriptPath,
          [projectDir],
          envVars,
        );
        const scriptResult = parseScriptResult(`${stdout}\n${stderr}`);

        if (exitCode === 0) {
          if (scriptResult?.status === 'skip_clean') {
            spinner.succeed('Code audit complete — no actionable issues found');
          } else if (scriptResult?.status?.startsWith('skip_')) {
            spinner.succeed('Code audit skipped');
          } else {
            const reportPath = path.join(projectDir, 'logs', 'audit-report.md');
            if (!fs.existsSync(reportPath)) {
              spinner.fail('Code audit finished without a report file');
              process.exit(1);
            }
            spinner.succeed(`Code audit complete — report written to ${reportPath}`);
          }
        } else {
          const statusSuffix = scriptResult?.status ? ` (${scriptResult.status})` : '';
          const providerExit = scriptResult?.data?.provider_exit;
          const exitDetail = providerExit && providerExit !== String(exitCode) ? `, provider exit ${providerExit}` : '';
          spinner.fail(`Code audit exited with code ${exitCode}${statusSuffix}${exitDetail}`);
          // Print last audit log lines so the parent process captures the actual failure reason
          const logPath = path.join(projectDir, 'logs', 'audit.log');
          if (fs.existsSync(logPath)) {
            const logLines = fs.readFileSync(logPath, 'utf-8').split('\n').filter((l) => l.trim()).slice(-8);
            if (logLines.length > 0) {
              process.stderr.write(logLines.join('\n') + '\n');
            }
          }
          process.exit(exitCode || 1);
        }
      } catch (err) {
        spinner.fail(`Code audit failed: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });
}
