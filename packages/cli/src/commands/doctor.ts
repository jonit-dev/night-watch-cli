/**
 * Doctor command for Night Watch CLI
 * Validates environment setup and system health
 */

import { Command } from 'commander';
import {
  BUILT_IN_PRESETS,
  checkConfigFile,
  checkCrontabAccess,
  checkGhCli,
  checkGitRepo,
  checkLogsDirectory,
  checkNodeVersion,
  checkProviderCli,
  header,
  info,
  label,
  loadConfig,
  step,
  success,
  error as uiError,
  validateWebhook,
  warn,
} from '@night-watch/core';
import { fireTelemetryEvent } from './shared/telemetry.js';
import type { ICheckResult } from '@night-watch/core';
export { validateWebhook } from '@night-watch/core';

/**
 * Options for doctor command
 */
interface IDoctorOptions {
  fix: boolean;
}

function resolveDoctorErrorCategory(
  configPassed: boolean,
  providerPassed: boolean,
): 'config' | 'provider' | 'unknown' {
  if (!configPassed) {
    return 'config';
  }
  if (!providerPassed) {
    return 'provider';
  }
  return 'unknown';
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
      const totalChecks = 7;
      let checkNum = 1;
      let passedChecks = 0;
      let fixedChecks = 0;

      header('Night Watch Doctor');

      // Check 1: Node.js version
      const nodeResult = runCheck(
        checkNum++,
        totalChecks,
        'Node.js version',
        () => checkNodeVersion(22),
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

      // Check 4: Provider CLI — resolve the actual CLI command for preset providers
      // (e.g. glm-5 and glm-47 use the 'claude' binary with env vars)
      const resolvedProviderCli = BUILT_IN_PRESETS[config.provider]?.command ?? config.provider;
      const providerResult = runCheck(
        checkNum++,
        totalChecks,
        'provider CLI',
        () => checkProviderCli(resolvedProviderCli),
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

      // Check 6: Logs directory
      const logsResult = runCheck(
        checkNum++,
        totalChecks,
        'logs directory',
        () => checkLogsDirectory(projectDir),
        options,
      );
      if (logsResult.passed) passedChecks++;
      if (logsResult.fixed) fixedChecks++;

      // Check 7: Webhook configuration
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
        fireTelemetryEvent('doctor_failed', {
          command: 'doctor',
          errorCategory: resolveDoctorErrorCategory(configResult.passed, providerResult.passed),
          success: false,
          failure: true,
        });
        process.exit(1);
      }
    });
}
