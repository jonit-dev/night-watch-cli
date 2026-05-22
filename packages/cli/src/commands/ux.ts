/**
 * UX command - runs the Playwright-guided UX audit job.
 */

import { Command } from 'commander';
import {
  INightWatchConfig,
  acquireLock,
  createSpinner,
  createTable,
  header,
  info,
  loadConfig,
  releaseLock,
  removeJob,
  resolveJobProvider,
  runUx,
  uxLockPath,
} from '@night-watch/core';
import { maybeApplyCronSchedulingDelay } from './shared/env-builder.js';
import { recordJobOutcome } from './shared/feedback.js';

export interface IUxOptions {
  dryRun?: boolean;
  json?: boolean;
  timeout?: string;
  provider?: string;
}

function parseTimeout(timeout?: string): number | undefined {
  if (!timeout) return undefined;
  const parsed = parseInt(timeout, 10);
  return Number.isNaN(parsed) || parsed < 0 ? undefined : parsed;
}

export function applyUxCliOverrides(
  config: INightWatchConfig,
  options: IUxOptions,
): INightWatchConfig {
  let overridden = config;
  const timeout = parseTimeout(options.timeout);
  if (timeout !== undefined) {
    overridden = { ...overridden, ux: { ...overridden.ux, maxRuntime: timeout } };
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

function cleanupQueueEntry(): void {
  const queueId = process.env.NW_QUEUE_ENTRY_ID ? parseInt(process.env.NW_QUEUE_ENTRY_ID, 10) : NaN;
  if (Number.isNaN(queueId) || queueId < 1) return;
  removeJob(queueId);
}

function printDryRun(config: INightWatchConfig): void {
  header('Dry Run: UX Agent');
  const table = createTable({ head: ['Setting', 'Value'] });
  table.push(['Provider', resolveJobProvider(config, 'ux')]);
  table.push(['Enabled', config.ux.enabled ? 'yes' : 'no']);
  table.push(['Max Runtime', `${config.ux.maxRuntime}s`]);
  table.push(['Target Column', config.ux.targetColumn]);
  table.push(['Base URL', config.ux.baseUrl || '(not configured)']);
  table.push(['Start URL', config.ux.startUrl || '(not configured)']);
  table.push(['Flows', config.ux.flows.length > 0 ? config.ux.flows.join(', ') : '(discover)']);
  table.push(['Auto-install Playwright', config.ux.autoInstallPlaywright ? 'yes' : 'no']);
  table.push(['Max Issues', String(config.ux.maxIssues)]);
  console.log(table.toString());
}

export function uxCommand(program: Command): void {
  program
    .command('ux')
    .description('Run UX agent to inspect user flows and draft a prioritized report')
    .option('--dry-run', 'Show what would be executed without running')
    .option('--json', 'Output structured JSON')
    .option('--timeout <seconds>', 'Override max runtime in seconds')
    .option('--provider <string>', 'AI provider to use')
    .action(async (options: IUxOptions) => {
      const projectDir = process.cwd();
      let config = loadConfig(projectDir);
      config = applyUxCliOverrides(config, options);

      if (!config.ux.enabled && !options.dryRun) {
        cleanupQueueEntry();
        if (options.json) {
          writeJson({ skipped: true, reason: 'ux-disabled' });
        } else {
          info('UX agent is disabled in config; skipping run.');
        }
        process.exit(0);
      }

      if (options.dryRun) {
        if (options.json) {
          writeJson({
            dryRun: true,
            provider: resolveJobProvider(config, 'ux'),
            config: config.ux,
          });
        } else {
          printDryRun(config);
        }
        process.exit(0);
      }

      const spinner = options.json ? null : createSpinner('Running UX agent...');
      spinner?.start();
      const startedAt = Date.now();
      let exitCode = 0;
      const lockPath = uxLockPath(projectDir);
      let lockAcquired = false;

      try {
        await maybeApplyCronSchedulingDelay(config, 'ux', projectDir);
        lockAcquired = acquireLock(lockPath);
        if (!lockAcquired) {
          cleanupQueueEntry();
          if (options.json) {
            writeJson({ skipped: true, reason: 'ux-locked' });
          } else {
            spinner?.succeed('UX agent skipped: already running.');
          }
          process.exit(0);
        }

        const result = await runUx(config, projectDir);
        exitCode = result.issuesCreated >= 0 ? 0 : 1;

        try {
          recordJobOutcome({
            config,
            exitCode,
            finishedAt: Date.now(),
            jobType: 'ux',
            metadata: {
              findings: result.findings.length,
              issuesCreated: result.issuesCreated,
              reportUrl: result.reportUrl,
              summary: result.summary,
            },
            projectDir,
            providerKey: resolveJobProvider(config, 'ux'),
            startedAt,
            stdout: result.summary,
          });
        } catch {
          // Outcome persistence must not change command exit behavior.
        }

        if (options.json) {
          writeJson(result);
        } else {
          spinner?.succeed(`UX agent complete — ${result.summary}`);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        try {
          recordJobOutcome({
            config,
            exitCode: 1,
            finishedAt: Date.now(),
            jobType: 'ux',
            metadata: { error: message },
            projectDir,
            providerKey: resolveJobProvider(config, 'ux'),
            startedAt,
            stderr: message,
          });
        } catch {
          // Outcome persistence must not change command exit behavior.
        }
        if (options.json) {
          process.stderr.write(`${JSON.stringify({ ok: false, error: message }, null, 2)}\n`);
        } else {
          spinner?.fail(`UX agent failed: ${message}`);
        }
        process.exit(1);
      } finally {
        if (lockAcquired) {
          releaseLock(lockPath);
        }
        cleanupQueueEntry();
      }

      process.exit(exitCode);
    });
}
