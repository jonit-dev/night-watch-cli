/**
 * Logs command for Night Watch CLI
 * View log output from Night Watch jobs
 */

import { Command } from 'commander';
import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import {
  ANALYTICS_LOG_NAME,
  AUDIT_LOG_NAME,
  EXECUTOR_LOG_FILE,
  LOG_DIR,
  MERGER_LOG_NAME,
  PLANNER_LOG_NAME,
  QA_LOG_NAME,
  REVIEWER_LOG_FILE,
  dim,
  header,
} from '@night-watch/core';

export interface ILogsOptions {
  lines?: string;
  follow?: boolean;
  type?: string;
}

/**
 * Get last N lines from a file
 */
function getLastLines(filePath: string, lineCount: number): string {
  if (!fs.existsSync(filePath)) {
    return `Log file not found: ${filePath}`;
  }

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.trim().split('\n');
    return lines.slice(-lineCount).join('\n');
  } catch (error) {
    return `Error reading log file: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/**
 * Follow log file in real-time using tail -f
 */
function followLog(filePath: string): void {
  if (!fs.existsSync(filePath)) {
    console.log(`Log file not found: ${filePath}`);
    console.log('The log file will be created when the first execution runs.');
    return;
  }

  const tail = spawn('tail', ['-f', filePath], {
    stdio: 'inherit',
  });

  tail.on('error', (error) => {
    console.error(`Error following log: ${error.message}`);
  });

  // Handle Ctrl+C gracefully
  process.on('SIGINT', () => {
    tail.kill();
    process.exit(0);
  });
}

/**
 * Logs command implementation
 */
export function logsCommand(program: Command): void {
  program
    .command('logs')
    .description('View night-watch log output')
    .option('-n, --lines <count>', 'Number of lines to show', '50')
    .option('-f, --follow', 'Follow log output (tail -f)')
    .option(
      '-t, --type <type>',
      'Log type to view (executor|reviewer|qa|audit|planner|analytics|merger|all)',
      'all',
    )
    .action(async (options: ILogsOptions) => {
      try {
        const projectDir = process.cwd();
        const logDir = path.join(projectDir, LOG_DIR);
        const lineCount = parseInt(options.lines || '50', 10);

        const executorLog = path.join(logDir, EXECUTOR_LOG_FILE);
        const reviewerLog = path.join(logDir, REVIEWER_LOG_FILE);
        const qaLog = path.join(logDir, `${QA_LOG_NAME}.log`);
        const auditLog = path.join(logDir, `${AUDIT_LOG_NAME}.log`);
        const plannerLog = path.join(logDir, `${PLANNER_LOG_NAME}.log`);
        const analyticsLog = path.join(logDir, `${ANALYTICS_LOG_NAME}.log`);
        const mergerLog = path.join(logDir, `${MERGER_LOG_NAME}.log`);

        // Determine which logs to show
        const logType = options.type?.toLowerCase() || 'all';
        const showExecutor = logType === 'all' || logType === 'run' || logType === 'executor';
        const showReviewer = logType === 'all' || logType === 'review' || logType === 'reviewer';
        const showQa = logType === 'all' || logType === 'qa';
        const showAudit = logType === 'all' || logType === 'audit';
        const showPlanner =
          logType === 'all' || logType === 'planner' || logType === 'slice' || logType === 'slicer';
        const showAnalytics = logType === 'all' || logType === 'analytics';
        const showMerger = logType === 'all' || logType === 'merge' || logType === 'merger';

        // Handle --follow mode
        if (options.follow) {
          if (logType === 'all') {
            dim('Note: Following all logs is not supported. Showing executor log.');
            dim('Use --type reviewer|qa|audit|planner|analytics|merger for other logs.\n');
          }

          let targetLog = executorLog;
          if (showReviewer) targetLog = reviewerLog;
          else if (showQa) targetLog = qaLog;
          else if (showAudit) targetLog = auditLog;
          else if (showPlanner) targetLog = plannerLog;
          else if (showAnalytics) targetLog = analyticsLog;
          else if (showMerger) targetLog = mergerLog;
          followLog(targetLog);
          return;
        }

        // Show static log output
        console.log();

        if (showExecutor) {
          header('Executor Log');
          dim(`File: ${executorLog}`);
          console.log();
          console.log(getLastLines(executorLog, lineCount));
        }

        if (showReviewer) {
          header('Reviewer Log');
          dim(`File: ${reviewerLog}`);
          console.log();
          console.log(getLastLines(reviewerLog, lineCount));
        }

        if (showQa) {
          header('QA Log');
          dim(`File: ${qaLog}`);
          console.log();
          console.log(getLastLines(qaLog, lineCount));
        }

        if (showAudit) {
          header('Audit Log');
          dim(`File: ${auditLog}`);
          console.log();
          console.log(getLastLines(auditLog, lineCount));
        }

        if (showPlanner) {
          header('Planner Log');
          dim(`File: ${plannerLog}`);
          console.log();
          console.log(getLastLines(plannerLog, lineCount));
        }

        if (showAnalytics) {
          header('Analytics Log');
          dim(`File: ${analyticsLog}`);
          console.log();
          console.log(getLastLines(analyticsLog, lineCount));
        }

        if (showMerger) {
          header('Merger Log');
          dim(`File: ${mergerLog}`);
          console.log();
          console.log(getLastLines(mergerLog, lineCount));
        }

        // Add tip
        console.log();
        dim('---');
        dim('Tip: Use -f to follow logs in real-time');
        dim(
          '     Use --type executor|reviewer|qa|audit|planner|analytics|merger to view specific logs',
        );
      } catch (err) {
        console.error(`Error reading logs: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });
}
