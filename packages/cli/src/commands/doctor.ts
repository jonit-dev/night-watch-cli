/**
 * Doctor command for Night Watch CLI
 * Validates environment setup and system health
 */

import { Command } from 'commander';
import {
  IWebhookConfig,
  NotificationEvent,
  checkConfigFile,
  checkCrontabAccess,
  checkGhCli,
  checkGitRepo,
  checkLogsDirectory,
  checkNodeVersion,
  checkPrdDirectory,
  checkProviderCli,
  header,
  info,
  label,
  loadConfig,
  step,
  success,
  error as uiError,
  warn,
} from '@night-watch/core';
import type { ICheckResult } from '@night-watch/core';

/**
 * Validate a single webhook configuration and return a list of issues.
 * Returns an empty array if the webhook is valid.
 */
export function validateWebhook(webhook: IWebhookConfig): string[] {
  const issues: string[] = [];

  // Validate events
  if (!webhook.events || webhook.events.length === 0) {
    issues.push('No events configured');
  } else {
    const validEvents: NotificationEvent[] = [
      'run_started',
      'run_succeeded',
      'run_failed',
      'run_timeout',
      'review_completed',
      'pr_auto_merged',
      'rate_limit_fallback',
      'qa_completed',
    ];
    for (const event of webhook.events) {
      if (!validEvents.includes(event)) {
        issues.push(`Invalid event: ${event}`);
      }
    }
  }

  // Platform-specific validation
  switch (webhook.type) {
    case 'slack':
      if (!webhook.url) {
        issues.push('Missing URL');
      } else if (!webhook.url.startsWith('https://hooks.slack.com/')) {
        issues.push('URL should start with https://hooks.slack.com/');
      }
      break;
    case 'discord':
      if (!webhook.url) {
        issues.push('Missing URL');
      } else if (!webhook.url.startsWith('https://discord.com/api/webhooks/')) {
        issues.push('URL should start with https://discord.com/api/webhooks/');
      }
      break;
    case 'telegram':
      if (!webhook.botToken) {
        issues.push('Missing botToken');
      }
      if (!webhook.chatId) {
        issues.push('Missing chatId');
      }
      break;
    default:
      issues.push(`Unknown webhook type: ${webhook.type}`);
  }

  return issues;
}

/**
 * Options for doctor command
 */
interface IDoctorOptions {
  fix: boolean;
}

/**
 * Run a single check and print the result
 */
function runCheck(
  checkNum: number,
  total: number,
  checkName: string,
  checkFn: () => ICheckResult,
  options: IDoctorOptions,
): { passed: boolean; fixed: boolean } {
  step(checkNum, total, `Checking ${checkName}...`);
  const result = checkFn();

  if (result.passed) {
    success(result.message);
    return { passed: true, fixed: false };
  }

  // Check failed
  if (options.fix && result.fixable && result.fix) {
    result.fix();
    // Re-run check after fix
    const recheckResult = checkFn();
    if (recheckResult.passed) {
      success(`Fixed: ${checkName}`);
      return { passed: true, fixed: true };
    } else {
      uiError(`Failed to fix: ${checkName}`);
      return { passed: false, fixed: false };
    }
  }

  if (result.fixable) {
    warn(`${result.message} (run with --fix to auto-fix)`);
  } else {
    uiError(result.message);
  }
  return { passed: false, fixed: false };
}

/**
 * Register the doctor command on the program
 */
export function doctorCommand(program: Command): void {
  program
    .command('doctor')
    .description('Check Night Watch configuration and system health')
    .option('--fix', 'Automatically fix fixable issues')
    .action(async (options: IDoctorOptions) => {
      const projectDir = process.cwd();
      const config = loadConfig(projectDir);
      const totalChecks = 8;
      let checkNum = 1;
      let passedChecks = 0;
      let fixedChecks = 0;

      header('Night Watch Doctor');

      // Check 1: Node.js version
      const nodeResult = runCheck(
        checkNum++,
        totalChecks,
        'Node.js version',
        () => checkNodeVersion(18),
        options,
      );
      if (nodeResult.passed) passedChecks++;
      if (nodeResult.fixed) fixedChecks++;

      // Check 2: Git repository
      const gitResult = runCheck(
        checkNum++,
        totalChecks,
        'git repository',
        () => checkGitRepo(projectDir),
        options,
      );
      if (gitResult.passed) passedChecks++;
      if (gitResult.fixed) fixedChecks++;

      // Check 3: GitHub CLI
      const ghResult = runCheck(checkNum++, totalChecks, 'GitHub CLI', () => checkGhCli(), options);
      if (ghResult.passed) passedChecks++;
      if (ghResult.fixed) fixedChecks++;

      // Check 4: Provider CLI
      const providerResult = runCheck(
        checkNum++,
        totalChecks,
        'provider CLI',
        () => checkProviderCli(config.provider),
        options,
      );
      if (providerResult.passed) passedChecks++;
      if (providerResult.fixed) fixedChecks++;

      // Check 5: Config file
      const configResult = runCheck(
        checkNum++,
        totalChecks,
        'config file',
        () => checkConfigFile(projectDir),
        options,
      );
      if (configResult.passed) passedChecks++;
      if (configResult.fixed) fixedChecks++;

      // Check 6: PRD directory
      const prdResult = runCheck(
        checkNum++,
        totalChecks,
        'PRD directory',
        () => checkPrdDirectory(projectDir, config.prdDir),
        options,
      );
      if (prdResult.passed) passedChecks++;
      if (prdResult.fixed) fixedChecks++;

      // Check 7: Logs directory
      const logsResult = runCheck(
        checkNum++,
        totalChecks,
        'logs directory',
        () => checkLogsDirectory(projectDir),
        options,
      );
      if (logsResult.passed) passedChecks++;
      if (logsResult.fixed) fixedChecks++;

      // Check 8: Webhook configuration
      step(checkNum, totalChecks, 'Checking webhook configuration...');
      if (!config.notifications || config.notifications.webhooks.length === 0) {
        info('No webhooks configured (optional)');
        passedChecks++;
      } else {
        let webhookErrors = 0;
        for (const webhook of config.notifications.webhooks) {
          const issues = validateWebhook(webhook);
          if (issues.length === 0) {
            success(`${webhook.type} webhook: OK`);
          } else {
            for (const issue of issues) {
              warn(`${webhook.type} webhook: ${issue}`);
            }
            webhookErrors++;
          }
        }
        if (webhookErrors === 0) {
          success(`All ${config.notifications.webhooks.length} webhook(s) valid`);
          passedChecks++;
        }
      }

      // Check crontab access (non-blocking, informational only)
      const crontabResult = checkCrontabAccess();
      info(crontabResult.message);

      // Summary
      console.log();
      header('Summary');
      label('Checks passed', `${passedChecks}/${totalChecks}`);
      if (fixedChecks > 0) {
        label('Issues fixed', `${fixedChecks}`);
      }
      console.log();

      if (passedChecks === totalChecks) {
        success('All checks passed');
      } else {
        uiError('Issues found — fix errors above before running Night Watch');
        process.exit(1);
      }
    });
}
