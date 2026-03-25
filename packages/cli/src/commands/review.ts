/**
 * Review command - executes the PR reviewer cron script
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
  fetchPrDetailsByNumber,
  fetchReviewedPrDetails,
  getScriptPath,
  header,
  info,
  loadConfig,
  parseScriptResult,
  resolveJobProvider,
  sendNotifications,
  error as uiError,
} from '@night-watch/core';
import {
  buildBaseEnvVars,
  formatProviderDisplay,
  maybeApplyCronSchedulingDelay,
} from './shared/env-builder.js';
import type { IPrDetails } from '@night-watch/core';
import { execFileSync } from 'child_process';
import * as path from 'path';

/**
 * Options for the review command
 */
export interface IReviewOptions {
  dryRun: boolean;
  timeout?: string;
  provider?: string;
  autoMerge?: boolean;
}

/**
 * Review notifications should not fire for script-level skip/no-op outcomes.
 */
export function shouldSendReviewNotification(scriptStatus?: string): boolean {
  if (!scriptStatus) {
    return true;
  }
  if (scriptStatus === 'queued') {
    return false;
  }
  return !scriptStatus.startsWith('skip_');
}

/**
 * Review completion notifications are only valid for successful reviewer runs.
 * Guard against both non-zero exits and mismatched legacy status markers.
 */
export function shouldSendReviewCompletionNotification(
  exitCode: number,
  scriptStatus?: string,
): boolean {
  if (exitCode !== 0) {
    return false;
  }

  if (scriptStatus === 'failure' || scriptStatus === 'timeout') {
    return false;
  }

  return shouldSendReviewNotification(scriptStatus);
}

/**
 * Parse comma-separated PR numbers like "#12,#34" into numeric IDs.
 */
export function parseAutoMergedPrNumbers(raw?: string): number[] {
  if (!raw || raw.trim().length === 0) {
    return [];
  }
  return raw
    .split(',')
    .map((token) => parseInt(token.trim().replace(/^#/, ''), 10))
    .filter((value) => !Number.isNaN(value));
}

/**
 * Parse comma-separated PR numbers like "#12,#34" into numeric IDs.
 * Deduplicates while preserving order.
 */
export function parseReviewedPrNumbers(raw?: string): number[] {
  if (!raw || raw.trim().length === 0) {
    return [];
  }

  const seen = new Set<number>();
  return raw
    .split(',')
    .map((token) => parseInt(token.trim().replace(/^#/, ''), 10))
    .filter((value) => !Number.isNaN(value))
    .filter((value) => {
      if (seen.has(value)) {
        return false;
      }
      seen.add(value);
      return true;
    });
}

/**
 * Build per-PR review notification targets from the script result payload.
 * Legacy no_changes_needed is only trustworthy when exactly one PR was reviewed.
 */
export function buildReviewNotificationTargets(
  reviewedPrNumbers: number[],
  noChangesPrNumbers: number[],
  legacyNoChangesNeeded = false,
): Array<{ prNumber: number; noChangesNeeded: boolean }> {
  const uniqueReviewedPrNumbers = Array.from(new Set(reviewedPrNumbers));
  const noChangesSet = new Set(noChangesPrNumbers);

  if (legacyNoChangesNeeded && uniqueReviewedPrNumbers.length === 1) {
    noChangesSet.add(uniqueReviewedPrNumbers[0]);
  }

  return uniqueReviewedPrNumbers.map((prNumber) => ({
    prNumber,
    noChangesNeeded: noChangesSet.has(prNumber),
  }));
}

/**
 * Parse retry attempts from script result data.
 * Returns the number of attempts (defaults to 1 if not present or invalid).
 */
export function parseRetryAttempts(raw?: string): number {
  if (!raw) {
    return 1;
  }
  const parsed = parseInt(raw, 10);
  return Number.isNaN(parsed) || parsed < 1 ? 1 : parsed;
}

/**
 * Parse final review score from script result data.
 * Returns undefined when missing or invalid.
 */
export function parseFinalReviewScore(raw?: string): number | undefined {
  if (!raw) {
    return undefined;
  }
  const parsed = parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    return undefined;
  }
  return parsed;
}

/**
 * Post a "ready for human review" comment and add a label to the PR.
 * Silently ignores failures — gh CLI may not be available.
 */
export function postReadyForHumanReviewComment(
  prNumber: number,
  finalScore: number | undefined,
  cwd: string,
): void {
  const scoreNote =
    finalScore !== undefined ? ` (score: ${finalScore}/100)` : '';
  const body =
    `## ✅ Ready for Human Review\n\n` +
    `Night Watch has reviewed this PR${scoreNote} and found no issues requiring automated fixes.\n\n` +
    `This PR is ready for human code review and merge.`;

  try {
    execFileSync('gh', ['pr', 'comment', String(prNumber), '--body', body], {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch {
    // gh CLI unavailable or not authenticated — ignore
  }

  try {
    execFileSync('gh', ['pr', 'edit', String(prNumber), '--add-label', 'ready-for-review'], {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch {
    // Label may not exist yet — ignore
  }
}

/**
 * Build environment variables map from config and CLI options for reviewer
 */
export function buildEnvVars(
  config: INightWatchConfig,
  options: IReviewOptions,
): Record<string, string> {
  // Start with base env vars shared by all job types
  const env = buildBaseEnvVars(config, 'reviewer', options.dryRun);

  // Runtime for reviewer (uses NW_REVIEWER_* variables)
  env.NW_REVIEWER_MAX_RUNTIME = String(config.reviewerMaxRuntime);
  env.NW_REVIEWER_MAX_RETRIES = String(config.reviewerMaxRetries);
  env.NW_REVIEWER_RETRY_DELAY = String(config.reviewerRetryDelay);
  env.NW_REVIEWER_MAX_PRS_PER_RUN = String(config.reviewerMaxPrsPerRun);
  env.NW_MIN_REVIEW_SCORE = String(config.minReviewScore);
  env.NW_BRANCH_PATTERNS = config.branchPatterns.join(',');
  env.NW_PRD_DIR = config.prdDir;
  env.NW_CLAUDE_MODEL_ID =
    CLAUDE_MODEL_IDS[config.primaryFallbackModel ?? config.claudeModel ?? 'sonnet'];

  // Auto-merge configuration
  if (config.autoMerge) {
    env.NW_AUTO_MERGE = '1';
  }
  env.NW_AUTO_MERGE_METHOD = config.autoMergeMethod;

  return env;
}

/**
 * Apply CLI flag overrides to the config for reviewer
 */
export function applyCliOverrides(
  config: INightWatchConfig,
  options: IReviewOptions,
): INightWatchConfig {
  const overridden = { ...config };

  if (options.timeout) {
    const timeout = parseInt(options.timeout, 10);
    if (!isNaN(timeout)) {
      overridden.reviewerMaxRuntime = timeout;
    }
  }

  if (options.provider) {
    // Use _cliProviderOverride to ensure CLI flag takes precedence over jobProviders
    overridden._cliProviderOverride = options.provider as INightWatchConfig['provider'];
  }

  if (options.autoMerge !== undefined) {
    overridden.autoMerge = options.autoMerge;
  }

  return overridden;
}

interface ICheckStatus {
  name?: string;
  bucket?: string;
  state?: string;
  conclusion?: string;
}

/**
 * Whether a GitHub check entry should be treated as failing/action-required.
 */
export function isFailingCheck(check: ICheckStatus): boolean {
  const bucket = (check.bucket ?? '').toLowerCase();
  const state = (check.state ?? '').toLowerCase();
  const conclusion = (check.conclusion ?? '').toLowerCase();

  return (
    bucket === 'fail' ||
    bucket === 'cancel' ||
    state === 'failure' ||
    state === 'error' ||
    state === 'cancelled' ||
    conclusion === 'failure' ||
    conclusion === 'error' ||
    conclusion === 'cancelled' ||
    conclusion === 'timed_out' ||
    conclusion === 'action_required' ||
    conclusion === 'startup_failure' ||
    conclusion === 'stale'
  );
}

/**
 * Get a human-readable list of failing checks for a PR.
 */
export function getPrFailingChecks(prNumber: number): string[] {
  try {
    const result = execFileSync(
      'gh',
      ['pr', 'checks', String(prNumber), '--json', 'name,bucket,state,conclusion'],
      {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );

    const checks = JSON.parse(result.trim() || '[]') as ICheckStatus[];
    const failing = checks
      .filter((check) => isFailingCheck(check))
      .map(
        (check) =>
          `${check.name ?? 'unknown'} [state=${check.state ?? 'unknown'}, conclusion=${check.conclusion ?? 'unknown'}]`,
      );

    if (failing.length > 0) {
      return failing;
    }
  } catch {
    // Fall through to text-mode fallback.
  }

  try {
    const result = execFileSync('gh', ['pr', 'checks', String(prNumber)], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    return result
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .filter((line) =>
        /fail|error|cancel|timed[_ -]?out|action_required|startup_failure|stale/i.test(line),
      );
  } catch {
    return [];
  }
}

/**
 * Get open PRs that need work (matching branch patterns)
 */
function getOpenPrsNeedingWork(
  branchPatterns: string[],
): { number: number; title: string; branch: string }[] {
  try {
    // Build args array for safe shell execution
    const args = ['pr', 'list', '--state', 'open', '--json', 'number,title,headRefName'];
    for (const pattern of branchPatterns) {
      args.push('--head', pattern);
    }

    // Get open PRs as JSON using execFileSync for safe argument handling
    const result = execFileSync('gh', args, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const prs = JSON.parse(result.trim() || '[]');
    return prs.map((pr: { number: number; title: string; headRefName: string }) => ({
      number: pr.number,
      title: pr.title,
      branch: pr.headRefName,
    }));
  } catch {
    // gh CLI not available or not authenticated
    return [];
  }
}

/**
 * Register the review command with the program
 */
export function reviewCommand(program: Command): void {
  program
    .command('review')
    .description('Run PR reviewer now')
    .option('--dry-run', 'Show what would be executed without running')
    .option('--timeout <seconds>', 'Override max runtime in seconds for reviewer')
    .option('--provider <string>', 'AI provider to use (claude or codex)')
    .option('--auto-merge', 'Enable auto-merge for this run')
    .action(async (options: IReviewOptions) => {
      // Get the project directory (current working directory)
      const projectDir = process.cwd();

      // Load config from file and environment
      let config = loadConfig(projectDir);

      // Apply CLI flag overrides
      config = applyCliOverrides(config, options);

      if (!config.reviewerEnabled && !options.dryRun) {
        info('Reviewer is disabled in config; skipping review.');
        process.exit(0);
      }

      // Build environment variables
      const envVars = buildEnvVars(config, options);

      // Get the script path
      const scriptPath = getScriptPath('night-watch-pr-reviewer-cron.sh');

      if (options.dryRun) {
        header('Dry Run: PR Reviewer');

        // Resolve reviewer-specific provider
        const reviewerProvider = resolveJobProvider(config, 'reviewer');

        // Configuration section with table
        header('Configuration');
        const configTable = createTable({ head: ['Setting', 'Value'] });
        configTable.push(['Provider', reviewerProvider]);
        configTable.push(['Provider CLI', PROVIDER_COMMANDS[reviewerProvider]]);
        configTable.push([
          'Max Runtime',
          `${config.reviewerMaxRuntime}s (${Math.floor(config.reviewerMaxRuntime / 60)}min)`,
        ]);
        configTable.push(['Min Review Score', `${config.minReviewScore}/100`]);
        configTable.push(['Branch Patterns', config.branchPatterns.join(', ')]);
        configTable.push([
          'Auto-merge',
          config.autoMerge ? `Enabled (${config.autoMergeMethod})` : 'Disabled',
        ]);
        configTable.push(['Max Retry Attempts', String(config.reviewerMaxRetries)]);
        configTable.push(['Retry Delay', `${config.reviewerRetryDelay}s`]);
        configTable.push([
          'Max PRs Per Run',
          config.reviewerMaxPrsPerRun === 0 ? 'Unlimited' : String(config.reviewerMaxPrsPerRun),
        ]);
        console.log(configTable.toString());

        // Check for open PRs needing work
        header('Open PRs Needing Work');
        const openPrs = getOpenPrsNeedingWork(config.branchPatterns);

        if (openPrs.length === 0) {
          dim('  (no open PRs matching branch patterns)');
        } else {
          for (const pr of openPrs) {
            info(`#${pr.number}: ${pr.title}`);
            dim(`         Branch: ${pr.branch}`);
          }
        }

        // Provider invocation command
        header('Provider Invocation');
        if (reviewerProvider === 'claude') {
          dim('  claude -p "/night-watch-pr-reviewer" --dangerously-skip-permissions');
        } else {
          dim('  codex exec --yolo "/night-watch-pr-reviewer"');
        }

        // Environment variables
        header('Environment Variables');
        for (const [key, value] of Object.entries(envVars)) {
          dim(`  ${key}=${value}`);
        }

        // Full command that would be executed
        header('Command');
        dim(`  bash ${scriptPath} ${projectDir}`);
        console.log();

        process.exit(0);
      }

      // Preflight visibility: show currently failing checks before the fixer runs.
      const preflightOpenPrs = getOpenPrsNeedingWork(config.branchPatterns);
      const preflightFailures = preflightOpenPrs
        .map((pr) => ({
          prNumber: pr.number,
          title: pr.title,
          failingChecks: getPrFailingChecks(pr.number),
        }))
        .filter((entry) => entry.failingChecks.length > 0);

      if (preflightFailures.length > 0) {
        header('Preflight Failing Checks');
        for (const entry of preflightFailures) {
          info(`#${entry.prNumber}: ${entry.title}`);
          for (const check of entry.failingChecks) {
            dim(`  ${check}`);
          }
        }
      }

      // Execute the script with spinner
      const spinner = createSpinner('Running PR reviewer...');
      spinner.start();

      try {
        await maybeApplyCronSchedulingDelay(config, 'reviewer', projectDir);
        const { exitCode, stdout, stderr } = await executeScriptWithOutput(
          scriptPath,
          [projectDir],
          envVars,
        );
        const scriptResult = parseScriptResult(`${stdout}\n${stderr}`);

        if (exitCode === 0) {
          if (scriptResult?.status === 'queued') {
            spinner.succeed('PR reviewer queued — another job is currently running');
          } else if (scriptResult?.status?.startsWith('skip_')) {
            spinner.succeed('PR reviewer completed (no PRs needed review)');
          } else {
            spinner.succeed('PR reviewer completed successfully');
          }
        } else {
          spinner.fail(`PR reviewer exited with code ${exitCode}`);
        }

        // Send notifications (fire-and-forget, failures do not affect exit code)
        if (!options.dryRun) {
          const shouldNotifyCompletion = shouldSendReviewCompletionNotification(
            exitCode,
            scriptResult?.status,
          );

          if (!shouldNotifyCompletion) {
            info('Skipping review completion notification (review did not complete successfully)');
          }

          // Enrich with PR details (graceful — null if gh fails)
          let fallbackPrDetails: IPrDetails | null = null;
          if (shouldNotifyCompletion) {
            const reviewedPrNumbers = parseReviewedPrNumbers(scriptResult?.data.prs);
            const firstReviewedPrNumber = reviewedPrNumbers[0];
            if (firstReviewedPrNumber !== undefined) {
              fallbackPrDetails = fetchPrDetailsByNumber(firstReviewedPrNumber, projectDir);
            }

            if (!fallbackPrDetails) {
              fallbackPrDetails = fetchReviewedPrDetails(config.branchPatterns, projectDir);
            }
          }

          if (shouldNotifyCompletion) {
            // Extract retry attempts from script result
            const attempts = parseRetryAttempts(scriptResult?.data.attempts);
            const finalScore = parseFinalReviewScore(scriptResult?.data.final_score);
            const legacyNoChangesNeeded = scriptResult?.data.no_changes_needed === '1';
            const reviewedPrNumbers = parseReviewedPrNumbers(scriptResult?.data.prs);
            const noChangesPrNumbers = parseReviewedPrNumbers(scriptResult?.data.no_changes_prs);
            const fallbackPrNumber = fallbackPrDetails?.number;
            const notificationTargets = buildReviewNotificationTargets(
              reviewedPrNumbers.length > 0
                ? reviewedPrNumbers
                : fallbackPrNumber !== undefined
                  ? [fallbackPrNumber]
                  : [],
              noChangesPrNumbers,
              legacyNoChangesNeeded,
            );

            if (notificationTargets.length === 0) {
              const reviewEvent = legacyNoChangesNeeded
                ? ('review_ready_for_human' as const)
                : ('review_completed' as const);
              await sendNotifications(config, {
                event: reviewEvent,
                projectName: path.basename(projectDir),
                exitCode,
                provider: formatProviderDisplay(envVars.NW_PROVIDER_CMD, envVars.NW_PROVIDER_LABEL),
                prUrl: fallbackPrDetails?.url,
                prTitle: fallbackPrDetails?.title,
                prBody: fallbackPrDetails?.body,
                prNumber: fallbackPrDetails?.number,
                filesChanged: fallbackPrDetails?.changedFiles,
                additions: fallbackPrDetails?.additions,
                deletions: fallbackPrDetails?.deletions,
                attempts,
                finalScore,
              });
            } else {
              for (const target of notificationTargets) {
                const prDetails =
                  fallbackPrDetails?.number === target.prNumber
                    ? fallbackPrDetails
                    : fetchPrDetailsByNumber(target.prNumber, projectDir);

                if (target.noChangesNeeded && prDetails?.number) {
                  postReadyForHumanReviewComment(prDetails.number, finalScore, projectDir);
                }

                const reviewEvent = target.noChangesNeeded
                  ? ('review_ready_for_human' as const)
                  : ('review_completed' as const);
                await sendNotifications(config, {
                  event: reviewEvent,
                  projectName: path.basename(projectDir),
                  exitCode,
                  provider: formatProviderDisplay(envVars.NW_PROVIDER_CMD, envVars.NW_PROVIDER_LABEL),
                  prUrl: prDetails?.url,
                  prTitle: prDetails?.title,
                  prBody: prDetails?.body,
                  prNumber: prDetails?.number ?? target.prNumber,
                  filesChanged: prDetails?.changedFiles,
                  additions: prDetails?.additions,
                  deletions: prDetails?.deletions,
                  attempts,
                  finalScore,
                });
              }
            }
          }

          const autoMergedPrNumbers = parseAutoMergedPrNumbers(scriptResult?.data.auto_merged);
          if (autoMergedPrNumbers.length > 0) {
            const autoMergedPrNumber = autoMergedPrNumbers[0];
            const autoMergedPrDetails = fetchPrDetailsByNumber(autoMergedPrNumber, projectDir);
            const _mergeCtx = {
              event: 'pr_auto_merged' as const,
              projectName: path.basename(projectDir),
              exitCode,
              provider: formatProviderDisplay(envVars.NW_PROVIDER_CMD, envVars.NW_PROVIDER_LABEL),
              prNumber: autoMergedPrDetails?.number ?? autoMergedPrNumber,
              prUrl: autoMergedPrDetails?.url,
              prTitle: autoMergedPrDetails?.title,
              prBody: autoMergedPrDetails?.body,
              filesChanged: autoMergedPrDetails?.changedFiles,
              additions: autoMergedPrDetails?.additions,
              deletions: autoMergedPrDetails?.deletions,
            };
            await sendNotifications(config, _mergeCtx);
          }
        }

        process.exit(exitCode);
      } catch (err) {
        spinner.fail('Failed to execute review command');
        uiError(`${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });
}
