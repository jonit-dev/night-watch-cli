/**
 * Review command - executes the PR reviewer cron script
 */

import { Command } from "commander";
import { loadConfig, getScriptPath } from "../config.js";
import { INightWatchConfig } from "../types.js";
import { executeScript } from "../utils/shell.js";
import { PROVIDER_COMMANDS } from "../constants.js";
import { execSync } from "child_process";

/**
 * Options for the review command
 */
export interface ReviewOptions {
  dryRun: boolean;
  timeout?: string;
  provider?: string;
}

/**
 * Build environment variables map from config and CLI options for reviewer
 */
export function buildEnvVars(config: INightWatchConfig, options: ReviewOptions): Record<string, string> {
  const env: Record<string, string> = {};

  // Provider command - the actual CLI binary to call
  env.NW_PROVIDER_CMD = PROVIDER_COMMANDS[config.provider];

  // Runtime for reviewer (uses NW_REVIEWER_* variables)
  env.NW_REVIEWER_MAX_RUNTIME = String(config.reviewerMaxRuntime);

  // Dry run flag
  if (options.dryRun) {
    env.NW_DRY_RUN = "1";
  }

  return env;
}

/**
 * Apply CLI flag overrides to the config for reviewer
 */
export function applyCliOverrides(config: INightWatchConfig, options: ReviewOptions): INightWatchConfig {
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
    .action(async (options: ReviewOptions) => {
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
        console.log("=== Dry Run: PR Reviewer ===\n");

        // Configuration section
        console.log("Configuration:");
        console.log(`  Provider:         ${config.provider}`);
        console.log(`  Provider CLI:     ${PROVIDER_COMMANDS[config.provider]}`);
        console.log(`  Max Runtime:      ${config.reviewerMaxRuntime}s (${Math.floor(config.reviewerMaxRuntime / 60)}min)`);
        console.log(`  Min Review Score: ${config.minReviewScore}/100`);
        console.log(`  Branch Patterns:  ${config.branchPatterns.join(", ")}`);

        // Check for open PRs needing work
        console.log("\nOpen PRs Needing Work:");
        const openPrs = getOpenPrsNeedingWork(config.branchPatterns);

        if (openPrs.length === 0) {
          console.log("  (no open PRs matching branch patterns)");
        } else {
          for (const pr of openPrs) {
            console.log(`  #${pr.number}: ${pr.title}`);
            console.log(`           Branch: ${pr.branch}`);
          }
        }

        // Provider invocation command
        console.log("\nProvider Invocation:");
        const providerCmd = PROVIDER_COMMANDS[config.provider];
        const autoFlag = config.provider === "claude" ? "--dangerously-skip-permissions" : "--yolo";
        console.log(`  ${providerCmd} ${autoFlag} -p "/night-watch-pr-reviewer"`);

        // Environment variables
        console.log("\nEnvironment Variables:");
        for (const [key, value] of Object.entries(envVars)) {
          console.log(`  ${key}=${value}`);
        }

        // Full command that would be executed
        console.log("\nCommand that would be executed:");
        console.log(`  bash ${scriptPath} ${projectDir}`);

        process.exit(0);
      }

      // Execute the script
      try {
        const exitCode = await executeScript(scriptPath, [projectDir], envVars);
        process.exit(exitCode);
      } catch (error) {
        console.error("Failed to execute review command:", error);
        process.exit(1);
      }
    });
}
