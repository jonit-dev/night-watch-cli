/**
 * Plan command - runs the AI provider with the prd-creator skill to plan a feature
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
  loadConfig,
  parseScriptResult,
  resolveJobProvider,
} from '@night-watch/core';
import { buildBaseEnvVars } from './shared/env-builder.js';
import * as path from 'path';

export interface IPlanOptions {
  dryRun: boolean;
  timeout?: string;
  provider?: string;
}

/**
 * Build environment variables for the plan command
 */
export function buildEnvVars(
  config: INightWatchConfig,
  options: IPlanOptions,
  task: string,
): Record<string, string> {
  const env = buildBaseEnvVars(config, 'planner', options.dryRun);

  env.NW_PLAN_MAX_RUNTIME = String(options.timeout ? parseInt(options.timeout, 10) : 1800);
  env.NW_PRD_DIR = config.prdDir;
  env.NW_PLAN_TASK = task;
  env.NW_CLAUDE_MODEL_ID =
    CLAUDE_MODEL_IDS[config.primaryFallbackModel ?? config.claudeModel ?? 'sonnet'];

  return env;
}

/**
 * Register the plan command with the program
 */
export function planCommand(program: Command): void {
  program
    .command('plan [task]')
    .description('Plan a feature: runs the prd-creator skill to write a PRD')
    .option('--dry-run', 'Show what would be executed without running')
    .option('--timeout <seconds>', 'Override max runtime in seconds')
    .option('--provider <string>', 'AI provider to use (claude or codex)')
    .action(async (task: string | undefined, options: IPlanOptions) => {
      const projectDir = process.cwd();
      let config = loadConfig(projectDir);

      if (options.provider) {
        config = {
          ...config,
          _cliProviderOverride: options.provider as INightWatchConfig['provider'],
        };
      }

      const resolvedTask = task ?? '';
      const envVars = buildEnvVars(config, options, resolvedTask);
      const scriptPath = getScriptPath('night-watch-plan-cron.sh');

      if (options.dryRun) {
        header('Dry Run: PRD Planner');

        const plannerProvider = resolveJobProvider(config, 'planner');

        header('Configuration');
        const configTable = createTable({ head: ['Setting', 'Value'] });
        configTable.push(['Provider', plannerProvider]);
        configTable.push(['Provider CLI', PROVIDER_COMMANDS[plannerProvider]]);
        configTable.push(['PRD Directory', config.prdDir]);
        configTable.push(['Task', resolvedTask || '(interactive)']);
        console.log(configTable.toString());

        header('Provider Invocation');
        if (plannerProvider === 'claude') {
          dim(`  ${PROVIDER_COMMANDS[plannerProvider]} -p "<prd-creator instructions + task>" --dangerously-skip-permissions`);
        } else {
          dim(`  ${PROVIDER_COMMANDS[plannerProvider]} exec --yolo "<prd-creator instructions + task>"`);
        }

        header('Command');
        dim(`  bash ${scriptPath} ${projectDir}`);
        console.log();

        process.exit(0);
      }

      const label = resolvedTask ? `Planning: ${resolvedTask}` : 'Running PRD planner...';
      const spinner = createSpinner(label);
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
          spinner.succeed(`PRD planner complete — PRD written to ${path.join(projectDir, config.prdDir)}/`);
        } else if (exitCode === 124) {
          spinner.fail('PRD planner timed out');
          process.exit(1);
        } else {
          const statusSuffix = scriptResult?.status ? ` (${scriptResult.status})` : '';
          spinner.fail(`PRD planner exited with code ${exitCode}${statusSuffix}`);
          process.exit(exitCode || 1);
        }
      } catch (err) {
        spinner.fail(`PRD planner failed: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });
}
