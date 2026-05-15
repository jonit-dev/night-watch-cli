/**
 * Manager command - runs the roadmap/project health manager.
 */

import { Command } from 'commander';
import * as path from 'path';
import * as Core from '@night-watch/core';
import type {
  INightWatchConfig,
  IManagerConfig,
  NotificationEvent,
  Provider,
} from '@night-watch/core';
import { maybeApplyCronSchedulingDelay } from './shared/env-builder.js';
import { recordJobOutcome } from './shared/feedback.js';

export interface IManagerOptions {
  dryRun?: boolean;
  json?: boolean;
  timeout?: string;
  provider?: string;
}

export interface IManagerRunOptions {
  dryRun: boolean;
  timeout?: number;
  provider?: Provider;
}

type RunManager = (
  projectDir: string,
  config: INightWatchConfig,
  options: IManagerRunOptions,
) => Promise<unknown>;

function resolveRunManager(): RunManager {
  const runManager = (Core as unknown as { runManager?: RunManager }).runManager;
  if (typeof runManager !== 'function') {
    throw new Error(
      'Manager runner is not available in @night-watch/core. Update core to include runManager(projectDir, config, options).',
    );
  }
  return runManager;
}

function writeJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function parseTimeout(timeout?: string): number | undefined {
  if (!timeout) return undefined;
  const parsed = parseInt(timeout, 10);
  return Number.isNaN(parsed) || parsed < 0 ? undefined : parsed;
}

export function buildManagerRunOptions(options: IManagerOptions): IManagerRunOptions {
  const timeout = parseTimeout(options.timeout);
  return {
    dryRun: options.dryRun === true,
    ...(timeout !== undefined ? { timeout } : {}),
    ...(options.provider ? { provider: options.provider } : {}),
  };
}

export function applyManagerCliOverrides(
  config: INightWatchConfig,
  options: IManagerOptions,
): INightWatchConfig {
  const timeout = parseTimeout(options.timeout);
  let overridden = config;

  if (timeout !== undefined) {
    overridden = {
      ...overridden,
      manager: {
        ...overridden.manager,
        maxRuntime: timeout,
      },
    };
  }

  if (options.provider) {
    overridden = {
      ...overridden,
      _cliProviderOverride: options.provider as INightWatchConfig['provider'],
    };
  }

  return overridden;
}

function getManagerConfig(config: INightWatchConfig): IManagerConfig {
  return config.manager;
}

function buildJsonResult(result: unknown, options: IManagerRunOptions): unknown {
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    return {
      ...result,
      dryRun: options.dryRun,
    };
  }
  return {
    dryRun: options.dryRun,
    result,
  };
}

function resultExitCode(result: unknown): number {
  if (!result || typeof result !== 'object') return 0;
  const record = result as Record<string, unknown>;
  if (record.ok === false || record.success === false || typeof record.error === 'string') {
    return 1;
  }
  return 0;
}

async function sendManagerNotifications(
  config: INightWatchConfig,
  projectDir: string,
  result: unknown,
): Promise<void> {
  if (!result || typeof result !== 'object') return;
  const decisions = (result as { notificationDecisions?: unknown }).notificationDecisions;
  if (!Array.isArray(decisions)) return;

  for (const decision of decisions) {
    if (!decision || typeof decision !== 'object') continue;
    const item = decision as {
      event?: NotificationEvent;
      shouldNotify?: boolean;
      title?: string;
      body?: string;
    };
    if (!item.shouldNotify || !item.event) continue;
    await Core.sendNotifications(config, {
      event: item.event,
      projectName: path.basename(projectDir),
      provider: Core.resolveJobProvider(config, 'manager'),
      exitCode: 0,
      failureReason: item.title,
      failureDetail: item.body,
    });
  }
}

function printHumanResult(result: unknown, options: IManagerRunOptions): void {
  const payload = buildJsonResult(result, options) as Record<string, unknown>;
  Core.header(options.dryRun ? 'Dry Run: Manager' : 'Manager Result');

  const table = Core.createTable({ head: ['Metric', 'Value'] });
  for (const key of [
    'summary',
    'findings',
    'createdIssues',
    'createdDrafts',
    'skippedDuplicates',
    'blockedItems',
  ]) {
    const value = payload[key];
    if (value === undefined) continue;
    table.push([key, Array.isArray(value) ? String(value.length) : String(value)]);
  }
  console.log(table.length > 0 ? table.toString() : JSON.stringify(payload, null, 2));
}

/**
 * Register the manager command with the program.
 */
export function managerCommand(program: Command): void {
  program
    .command('manager')
    .description('Run Manager to analyze roadmap, board, job status, and docs alignment')
    .option('--dry-run', 'Analyze without writing memory, docs, board issues, or notifications')
    .option('--json', 'Output structured JSON')
    .option('--timeout <seconds>', 'Override max runtime in seconds')
    .option('--provider <string>', 'AI provider to use (claude or codex)')
    .action(async (options: IManagerOptions) => {
      const projectDir = process.cwd();
      let config = Core.loadConfig(projectDir);
      config = applyManagerCliOverrides(config, options);
      const managerConfig = getManagerConfig(config);
      const runOptions = buildManagerRunOptions(options);

      if (!managerConfig.enabled && !runOptions.dryRun) {
        if (options.json) {
          writeJson({ dryRun: false, skipped: true, reason: 'manager-disabled' });
        } else {
          Core.info('Manager is disabled in config; skipping run.');
        }
        process.exit(0);
      }

      const startedAt = Date.now();
      let exitCode = 0;
      const run = async () => {
        if (!runOptions.dryRun) {
          await maybeApplyCronSchedulingDelay(config, 'manager', projectDir);
        }
        const runner = resolveRunManager();
        return runner(projectDir, config, runOptions);
      };

      try {
        const spinner = options.json ? null : Core.createSpinner('Running Manager...');
        spinner?.start();
        const result = await run();
        exitCode = resultExitCode(result);

        if (!runOptions.dryRun) {
          await sendManagerNotifications(config, projectDir, result);
          try {
            recordJobOutcome({
              config,
              exitCode,
              finishedAt: Date.now(),
              jobType: 'manager',
              metadata: buildJsonResult(result, runOptions) as Record<string, unknown>,
              projectDir,
              providerKey: Core.resolveJobProvider(config, 'manager'),
              startedAt,
              stdout: typeof result === 'string' ? result : JSON.stringify(result),
            });
          } catch {
            // Outcome persistence must not change command exit behavior.
          }
        }

        if (options.json) {
          writeJson(buildJsonResult(result, runOptions));
        } else {
          if (exitCode === 0) {
            spinner?.succeed('Manager completed successfully');
          } else {
            spinner?.fail('Manager completed with errors');
          }
          printHumanResult(result, runOptions);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (!runOptions.dryRun) {
          try {
            recordJobOutcome({
              config,
              exitCode: 1,
              finishedAt: Date.now(),
              jobType: 'manager',
              metadata: { error: message },
              projectDir,
              providerKey: Core.resolveJobProvider(config, 'manager'),
              startedAt,
              stderr: message,
            });
          } catch {
            // Outcome persistence must not change command exit behavior.
          }
        }

        if (options.json) {
          process.stderr.write(
            `${JSON.stringify({ dryRun: runOptions.dryRun, ok: false, error: message }, null, 2)}\n`,
          );
        } else {
          Core.error(`Manager failed: ${message}`);
        }
        process.exit(1);
      }
      process.exit(exitCode);
    });
}
