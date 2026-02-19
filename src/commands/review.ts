/**
 * Review command - executes the PR reviewer cron script
 */

import { Command } from "commander";
import { getScriptPath, loadConfig } from "../config.js";
import { INightWatchConfig } from "../types.js";
import { executeScriptWithOutput } from "../utils/shell.js";
import { sendNotifications } from "../utils/notify.js";
import { type IPrDetails, fetchPrDetailsByNumber, fetchReviewedPrDetails } from "../utils/github.js";
import { PROVIDER_COMMANDS } from "../constants.js";
import { execSync } from "child_process";
import * as path from "path";
import { parseScriptResult } from "../utils/script-result.js";
import {
  createSpinner,
  createTable,
  dim,
  header,
  info,
  error as uiError,
} from "../utils/ui.js";

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
  return !scriptStatus.startsWith("skip_");
}

/**
 * Parse comma-separated PR numbers like "#12,#34" into numeric IDs.
 */
export function parseAutoMergedPrNumbers(raw?: string): number[] {
  if (!raw || raw.trim().length === 0) {
    return [];
  }
  return raw
    .split(",")
    .map((token) => parseInt(token.trim().replace(/^#/, ""), 10))
    .filter((value) => !Number.isNaN(value));
}

/**
 * Build environment variables map from config and CLI options for reviewer
 */
export function buildEnvVars(config: INightWatchConfig, options: IReviewOptions): Record<string, string> {
  const env: Record<string, string> = {};

  // Provider command - the actual CLI binary to call
  env.NW_PROVIDER_CMD = PROVIDER_COMMANDS[config.provider];

  // Default branch (empty = auto-detect in bash script)
  if (config.defaultBranch) {
    env.NW_DEFAULT_BRANCH = config.defaultBranch;
  }

  // Runtime for reviewer (uses NW_REVIEWER_* variables)
  env.NW_REVIEWER_MAX_RUNTIME = String(config.reviewerMaxRuntime);
  env.NW_MIN_REVIEW_SCORE = String(config.minReviewScore);
  env.NW_BRANCH_PATTERNS = config.branchPatterns.join(",");

  // Provider environment variables (API keys, base URLs, etc.)
  if (config.providerEnv) {
    Object.assign(env, config.providerEnv);
  }

  // Dry run flag
  if (options.dryRun) {
    env.NW_DRY_RUN = "1";
  }

  // Auto-merge configuration
  if (config.autoMerge) {
    env.NW_AUTO_MERGE = "1";
  }
  env.NW_AUTO_MERGE_METHOD = config.autoMergeMethod;

  // Sandbox flag — prevents the agent from modifying crontab during execution
  env.NW_EXECUTION_CONTEXT = "agent";

  return env;
}

/**
 * Apply CLI flag overrides to the config for reviewer
 */
export function applyCliOverrides(config: INightWatchConfig, options: IReviewOptions): INightWatchConfig {
  const overridden = { ...config };

  if (options.timeout) {
    const timeout = parseInt(options.timeout, 10);
    if (!isNaN(timeout)) {
      overridden.reviewerMaxRuntime = timeout;
    }
  }

  if (options.provider) {
    overridden.provider = options.provider as INightWatchConfig["provider"];
  }

  if (options.autoMerge !== undefined) {
    overridden.autoMerge = options.autoMerge;
  }

  return overridden;
}

/**
 * Get open PRs that need work (matching branch patterns)
 */
function getOpenPrsNeedingWork(branchPatterns: string[]): { number: number; title: string; branch: string }[] {
  try {
    // Build the search query for PRs matching branch patterns
    const headFilter = branchPatterns.map((p) => `--head "${p}"`).join(" ");

    // Get open PRs as JSON
    const result = execSync(
      `gh pr list --state open --json number,title,headRefName ${headFilter} 2>/dev/null || echo "[]"`,
      {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      }
    );

    const prs = JSON.parse(result.trim() || "[]");
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
    .command("review")
    .description("Run PR reviewer now")
    .option("--dry-run", "Show what would be executed without running")
    .option("--timeout <seconds>", "Override max runtime in seconds for reviewer")
    .option("--provider <string>", "AI provider to use (claude or codex)")
    .option("--auto-merge", "Enable auto-merge for this run")
    .action(async (options: IReviewOptions) => {
      // Get the project directory (current working directory)
      const projectDir = process.cwd();

      // Load config from file and environment
      let config = loadConfig(projectDir);

      // Apply CLI flag overrides
      config = applyCliOverrides(config, options);

      // Build environment variables
      const envVars = buildEnvVars(config, options);

      // Get the script path
      const scriptPath = getScriptPath("night-watch-pr-reviewer-cron.sh");

      if (options.dryRun) {
        header("Dry Run: PR Reviewer");

        // Configuration section with table
        header("Configuration");
        const configTable = createTable({ head: ["Setting", "Value"] });
        configTable.push(["Provider", config.provider]);
        configTable.push(["Provider CLI", PROVIDER_COMMANDS[config.provider]]);
        configTable.push(["Max Runtime", `${config.reviewerMaxRuntime}s (${Math.floor(config.reviewerMaxRuntime / 60)}min)`]);
        configTable.push(["Min Review Score", `${config.minReviewScore}/100`]);
        configTable.push(["Branch Patterns", config.branchPatterns.join(", ")]);
        configTable.push(["Auto-merge", config.autoMerge ? `Enabled (${config.autoMergeMethod})` : "Disabled"]);
        console.log(configTable.toString());

        // Check for open PRs needing work
        header("Open PRs Needing Work");
        const openPrs = getOpenPrsNeedingWork(config.branchPatterns);

        if (openPrs.length === 0) {
          dim("  (no open PRs matching branch patterns)");
        } else {
          for (const pr of openPrs) {
            info(`#${pr.number}: ${pr.title}`);
            dim(`         Branch: ${pr.branch}`);
          }
        }

        // Provider invocation command
        header("Provider Invocation");
        const providerCmd = PROVIDER_COMMANDS[config.provider];
        const autoFlag = config.provider === "claude" ? "--dangerously-skip-permissions" : "--yolo";
        dim(`  ${providerCmd} ${autoFlag} -p "/night-watch-pr-reviewer"`);

        // Environment variables
        header("Environment Variables");
        for (const [key, value] of Object.entries(envVars)) {
          dim(`  ${key}=${value}`);
        }

        // Full command that would be executed
        header("Command");
        dim(`  bash ${scriptPath} ${projectDir}`);
        console.log();

        process.exit(0);
      }

      // Execute the script with spinner
      const spinner = createSpinner("Running PR reviewer...");
      spinner.start();

      try {
        const { exitCode, stdout, stderr } = await executeScriptWithOutput(scriptPath, [projectDir], envVars);
        const scriptResult = parseScriptResult(`${stdout}\n${stderr}`);

        if (exitCode === 0) {
          if (scriptResult?.status?.startsWith("skip_")) {
            spinner.succeed("PR reviewer completed (no PRs needed review)");
          } else {
            spinner.succeed("PR reviewer completed successfully");
          }
        } else {
          spinner.fail(`PR reviewer exited with code ${exitCode}`);
        }

        // Send notifications (fire-and-forget, failures do not affect exit code)
        if (!options.dryRun) {
          const skipNotification = !shouldSendReviewNotification(scriptResult?.status);

          if (skipNotification) {
            info("Skipping review notification (no actionable review result)");
          }

          // Enrich with PR details (graceful — null if gh fails)
          let prDetails: IPrDetails | null = null;
          if (!skipNotification && exitCode === 0) {
            const prsRaw = scriptResult?.data.prs;
            const firstPrToken = prsRaw?.split(",")[0]?.trim();
            if (firstPrToken) {
              const parsedNumber = parseInt(firstPrToken.replace(/^#/, ""), 10);
              if (!Number.isNaN(parsedNumber)) {
                prDetails = fetchPrDetailsByNumber(parsedNumber, projectDir);
              }
            }

            if (!prDetails) {
              prDetails = fetchReviewedPrDetails(config.branchPatterns, projectDir);
            }
          }

          if (!skipNotification) {
            await sendNotifications(config, {
              event: "review_completed",
              projectName: path.basename(projectDir),
              exitCode,
              provider: config.provider,
              prUrl: prDetails?.url,
              prTitle: prDetails?.title,
              prBody: prDetails?.body,
              prNumber: prDetails?.number,
              filesChanged: prDetails?.changedFiles,
              additions: prDetails?.additions,
              deletions: prDetails?.deletions,
            });
          }

          const autoMergedPrNumbers = parseAutoMergedPrNumbers(scriptResult?.data.auto_merged);
          if (autoMergedPrNumbers.length > 0) {
            const autoMergedPrNumber = autoMergedPrNumbers[0];
            const autoMergedPrDetails = fetchPrDetailsByNumber(autoMergedPrNumber, projectDir);
            await sendNotifications(config, {
              event: "pr_auto_merged",
              projectName: path.basename(projectDir),
              exitCode,
              provider: config.provider,
              prNumber: autoMergedPrDetails?.number ?? autoMergedPrNumber,
              prUrl: autoMergedPrDetails?.url,
              prTitle: autoMergedPrDetails?.title,
              prBody: autoMergedPrDetails?.body,
              filesChanged: autoMergedPrDetails?.changedFiles,
              additions: autoMergedPrDetails?.additions,
              deletions: autoMergedPrDetails?.deletions,
            });
          }
        }

        process.exit(exitCode);
      } catch (err) {
        spinner.fail("Failed to execute review command");
        uiError(`${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });
}
