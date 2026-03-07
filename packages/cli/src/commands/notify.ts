/**
 * Notify command — sends a notification event via configured webhooks.
 * Designed for bash script integration.
 */

import { basename } from 'path';
import { Command } from 'commander';
import { loadConfig, sendNotifications } from '@night-watch/core';
import type { NotificationEvent } from '@night-watch/core';

const VALID_EVENTS: NotificationEvent[] = [
  'run_started',
  'run_succeeded',
  'run_failed',
  'run_timeout',
  'review_completed',
  'rate_limit_fallback',
  'pr_auto_merged',
  'qa_completed',
];

export function notifyCommand(program: Command): void {
  program
    .command('notify <event> <projectDir>')
    .description('Send a notification event via configured webhooks')
    .option('--prd <name>', 'PRD name')
    .option('--branch <name>', 'Branch name')
    .option('--provider <name>', 'Provider name')
    .option('--exit-code <n>', 'Exit code', '0')
    .option('--pr-number <n>', 'PR number')
    .action(
      async (
        event: string,
        projectDir: string,
        options: {
          prd?: string;
          branch?: string;
          provider?: string;
          exitCode: string;
          prNumber?: string;
        },
      ) => {
        if (!VALID_EVENTS.includes(event as NotificationEvent)) {
          process.stderr.write(
            `Invalid event: ${event}. Must be one of: ${VALID_EVENTS.join(', ')}\n`,
          );
          process.exit(2);
        }

        const config = loadConfig(projectDir);

        await sendNotifications(config, {
          event: event as NotificationEvent,
          projectName: basename(projectDir),
          prdName: options.prd,
          branchName: options.branch,
          provider: options.provider ?? config.provider,
          exitCode: parseInt(options.exitCode, 10) || 0,
          prNumber: options.prNumber ? parseInt(options.prNumber, 10) : undefined,
        });
      },
    );
}
