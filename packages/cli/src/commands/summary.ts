/**
 * Summary command for Night Watch CLI
 * Shows a "morning briefing" combining job runs, PRs, and queue status
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { createTable, dim, getSummaryData, header, info, loadConfig } from '@night-watch/core';
import type { IPrInfo } from '@night-watch/core';

export interface ISummaryOptions {
  hours?: string;
  json?: boolean;
}

/**
 * Format duration from seconds to human-readable string (e.g., "8m 32s")
 */
function formatDuration(seconds: number | null): string {
  if (seconds === null) return '-';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins === 0) return `${secs}s`;
  return `${mins}m ${secs}s`;
}

/**
 * Format CI status with color coding
 */
function formatCiStatus(status: IPrInfo['ciStatus']): string {
  if (status === 'pass') return chalk.green('pass');
  if (status === 'fail') return chalk.red('fail');
  if (status === 'pending') return chalk.yellow('pending');
  return chalk.dim('unknown');
}

/**
 * Format review score with color coding
 */
function formatReviewScore(score: number | null): string {
  if (score === null) return chalk.dim('-');
  if (score >= 80) return chalk.green(String(score));
  if (score >= 60) return chalk.yellow(String(score));
  return chalk.red(String(score));
}

/**
 * Format job status with color coding
 */
function formatJobStatus(status: string): string {
  if (status === 'success') return chalk.green('success');
  if (status === 'failure') return chalk.red('failure');
  if (status === 'timeout') return chalk.yellow('timeout');
  if (status === 'rate_limited') return chalk.magenta('rate_limited');
  if (status === 'skipped') return chalk.dim('skipped');
  return chalk.dim(status);
}

/**
 * Extract project name from path
 */
function getProjectName(projectPath: string): string {
  return projectPath.split('/').pop() || projectPath;
}

/**
 * Format provider key for display
 */
function formatProvider(providerKey: string): string {
  return providerKey.split(':')[0] || providerKey;
}

/**
 * Summary command implementation
 */
export function summaryCommand(program: Command): void {
  program
    .command('summary')
    .description('Show a summary of recent Night Watch activity')
    .option('--hours <n>', 'Time window in hours (default: 12)', '12')
    .option('--json', 'Output summary as JSON')
    .action(async (options: ISummaryOptions) => {
      try {
        const projectDir = process.cwd();
        const config = loadConfig(projectDir);
        const hours = parseInt(options.hours || '12', 10);

        const data = await getSummaryData(projectDir, hours, config.branchPatterns);

        // Output as JSON if requested
        if (options.json) {
          console.log(JSON.stringify(data, null, 2));
          return;
        }

        // Print header
        console.log();
        console.log(chalk.bold.cyan(`Night Watch Summary (last ${data.windowHours}h)`));
        console.log(chalk.dim('─'.repeat(40)));
        console.log();

        // Jobs executed section
        if (data.jobRuns.length === 0) {
          info('No recent activity in this time window.');
          console.log();
          return;
        }

        // Job counts with colored indicators
        const countParts: string[] = [];
        if (data.counts.succeeded > 0) {
          countParts.push(chalk.green(`✓ ${data.counts.succeeded} succeeded`));
        }
        if (data.counts.failed > 0) {
          countParts.push(chalk.red(`✗ ${data.counts.failed} failed`));
        }
        if (data.counts.timedOut > 0) {
          countParts.push(chalk.yellow(`⏱ ${data.counts.timedOut} timed out`));
        }
        if (data.counts.rateLimited > 0) {
          countParts.push(chalk.magenta(`⏳ ${data.counts.rateLimited} rate limited`));
        }
        if (data.counts.skipped > 0) {
          countParts.push(chalk.dim(`${data.counts.skipped} skipped`));
        }

        console.log(`Jobs Executed: ${data.counts.total}`);
        if (countParts.length > 0) {
          console.log(`  ${countParts.join('   ')}`);
        }
        console.log();

        // Job runs table
        if (data.jobRuns.length > 0) {
          const table = createTable({
            head: ['Job', 'Status', 'Project', 'Provider', 'Duration'],
            colWidths: [12, 12, 20, 12, 12],
          });

          for (const run of data.jobRuns.slice(0, 10)) {
            table.push([
              run.jobType,
              formatJobStatus(run.status),
              getProjectName(run.projectPath),
              formatProvider(run.providerKey),
              formatDuration(run.durationSeconds),
            ]);
          }

          console.log(table.toString());
          if (data.jobRuns.length > 10) {
            dim(`  ... and ${data.jobRuns.length - 10} more`);
          }
          console.log();
        }

        // Open PRs section
        if (data.openPrs.length > 0) {
          header(`Open PRs (${data.openPrs.length})`);

          const prTable = createTable({
            head: ['#', 'Title', 'CI', 'Score'],
            colWidths: [6, 40, 10, 8],
          });

          for (const pr of data.openPrs) {
            const title = pr.title.length > 37 ? pr.title.substring(0, 34) + '...' : pr.title;
            prTable.push([
              String(pr.number),
              title,
              formatCiStatus(pr.ciStatus),
              formatReviewScore(pr.reviewScore),
            ]);
          }

          console.log(prTable.toString());
          console.log();
        }

        // Queue section
        if (data.pendingQueueItems.length > 0) {
          const jobTypes = [...new Set(data.pendingQueueItems.map((item) => item.jobType))];
          const projectNames = [...new Set(data.pendingQueueItems.map((item) => item.projectName))];
          dim(
            `Queue: ${data.pendingQueueItems.length} pending (${jobTypes.join(', ')}) for ${projectNames.join(', ')})`,
          );
          console.log();
        }

        // Action items or "all healthy" message
        if (data.actionItems.length > 0) {
          console.log(chalk.yellow('⚠ Action needed:'));
          for (const item of data.actionItems) {
            console.log(`  • ${item}`);
          }
        } else {
          console.log(chalk.green('✓ No action needed — all jobs healthy.'));
        }

        console.log();
      } catch (error) {
        console.error(
          `Error getting summary: ${error instanceof Error ? error.message : String(error)}`,
        );
        process.exit(1);
      }
    });
}
