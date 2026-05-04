/**
 * Analytics command - runs the Amplitude analytics job
 */

import { Command } from 'commander';
import {
  INightWatchConfig,
  createSpinner,
  createTable,
  header,
  info,
  loadConfig,
  resolveJobProvider,
  runAnalytics,
} from '@night-watch/core';
import { maybeApplyCronSchedulingDelay } from './shared/env-builder.js';
import { recordJobOutcome } from './shared/feedback.js';

export interface IAnalyticsOptions {
  dryRun: boolean;
  timeout?: string;
  provider?: string;
}

/**
 * Register the analytics command with the program
 */
export function analyticsCommand(program: Command): void {
  program
    .command('analytics')
    .description('Run Amplitude analytics job now')
    .option('--dry-run', 'Show what would be executed without running')
    .option('--timeout <seconds>', 'Override max runtime in seconds')
    .option('--provider <string>', 'AI provider to use (claude or codex)')
    .action(async (options: IAnalyticsOptions) => {
      const projectDir = process.cwd();
      let config = loadConfig(projectDir);

      if (options.timeout) {
        const timeout = parseInt(options.timeout, 10);
        if (!isNaN(timeout)) {
          config = { ...config, analytics: { ...config.analytics, maxRuntime: timeout } };
        }
      }

      if (options.provider) {
        config = {
          ...config,
          _cliProviderOverride: options.provider as INightWatchConfig['provider'],
        };
      }

      if (!config.analytics.enabled && !options.dryRun) {
        info('Analytics is disabled in config; skipping run.');
        process.exit(0);
      }

      // Validate Amplitude keys
      const apiKey = config.providerEnv?.AMPLITUDE_API_KEY;
      const secretKey = config.providerEnv?.AMPLITUDE_SECRET_KEY;
      if (!apiKey || !secretKey) {
        const now = Date.now();
        if (!options.dryRun) {
          try {
            recordJobOutcome({
              config,
              exitCode: 1,
              finishedAt: now,
              jobType: 'analytics',
              metadata: {
                missingAmplitudeCredentials: true,
              },
              projectDir,
              providerKey: resolveJobProvider(config, 'analytics'),
              startedAt: now,
              stderr:
                'AMPLITUDE_API_KEY and AMPLITUDE_SECRET_KEY must be set in providerEnv to run analytics.',
            });
          } catch {
            // Outcome persistence must not change command exit behavior.
          }
        }
        info(
          'AMPLITUDE_API_KEY and AMPLITUDE_SECRET_KEY must be set in providerEnv to run analytics.',
        );
        process.exit(1);
      }

      if (options.dryRun) {
        header('Dry Run: Analytics Job');

        const analyticsProvider = resolveJobProvider(config, 'analytics');

        header('Configuration');
        const configTable = createTable({ head: ['Setting', 'Value'] });
        configTable.push(['Provider', analyticsProvider]);
        configTable.push(['Max Runtime', `${config.analytics.maxRuntime}s`]);
        configTable.push(['Lookback Days', String(config.analytics.lookbackDays)]);
        configTable.push(['Target Column', config.analytics.targetColumn]);
        configTable.push(['Amplitude API Key', apiKey ? '***' + apiKey.slice(-4) : 'not set']);
        console.log(configTable.toString());
        console.log();

        process.exit(0);
      }

      const spinner = createSpinner('Running analytics job...');
      spinner.start();
      const startedAt = Date.now();

      try {
        await maybeApplyCronSchedulingDelay(config, 'analytics', projectDir);
        const result = await runAnalytics(config, projectDir);
        recordJobOutcome({
          config,
          exitCode: 0,
          finishedAt: Date.now(),
          jobType: 'analytics',
          metadata: {
            lookbackDays: config.analytics.lookbackDays,
            summary: result.summary,
          },
          projectDir,
          providerKey: resolveJobProvider(config, 'analytics'),
          startedAt,
          stdout: result.summary,
        });

        spinner.succeed(`Analytics complete — ${result.summary}`);
      } catch (err) {
        try {
          recordJobOutcome({
            config,
            exitCode: 1,
            finishedAt: Date.now(),
            jobType: 'analytics',
            metadata: {
              lookbackDays: config.analytics.lookbackDays,
            },
            projectDir,
            providerKey: resolveJobProvider(config, 'analytics'),
            startedAt,
            stderr: err instanceof Error ? err.message : String(err),
          });
        } catch {
          // Outcome persistence must not change command exit behavior.
        }
        spinner.fail(`Analytics failed: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });
}
