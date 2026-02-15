/**
 * Review command - executes the PR reviewer cron script
 */

import { Command } from "commander";
import { loadConfig, getScriptPath } from "../config.js";
import { INightWatchConfig } from "../types.js";
import { executeScript } from "../utils/shell.js";

/**
 * Options for the review command
 */
export interface ReviewOptions {
  dryRun: boolean;
  budget?: string;
  timeout?: string;
  apiKey?: string;
  apiUrl?: string;
  model?: string;
}

/**
 * Build environment variables map from config and CLI options for reviewer
 */
export function buildEnvVars(config: INightWatchConfig, options: ReviewOptions): Record<string, string> {
  const env: Record<string, string> = {};

  // Budget and runtime for reviewer (uses NW_REVIEWER_* variables)
  if (config.reviewerMaxBudget !== undefined) {
    env.NW_REVIEWER_MAX_BUDGET = String(config.reviewerMaxBudget);
  }
  if (config.reviewerMaxRuntime !== undefined) {
    env.NW_REVIEWER_MAX_RUNTIME = String(config.reviewerMaxRuntime);
  }

  // Claude provider configuration
  if (config.claude.apiKey) {
    env.ANTHROPIC_AUTH_TOKEN = config.claude.apiKey;
  }
  if (config.claude.baseUrl) {
    env.ANTHROPIC_BASE_URL = config.claude.baseUrl;
  }
  if (config.claude.timeout !== undefined) {
    env.API_TIMEOUT_MS = String(config.claude.timeout);
  }

  // Model configuration - --model flag sets both opus and sonnet
  if (options.model) {
    env.ANTHROPIC_DEFAULT_OPUS_MODEL = options.model;
    env.ANTHROPIC_DEFAULT_SONNET_MODEL = options.model;
  } else {
    if (config.claude.opusModel) {
      env.ANTHROPIC_DEFAULT_OPUS_MODEL = config.claude.opusModel;
    }
    if (config.claude.sonnetModel) {
      env.ANTHROPIC_DEFAULT_SONNET_MODEL = config.claude.sonnetModel;
    }
  }

  return env;
}

/**
 * Apply CLI flag overrides to the config for reviewer
 */
export function applyCliOverrides(config: INightWatchConfig, options: ReviewOptions): INightWatchConfig {
  const overridden = { ...config };

  if (options.budget) {
    const budget = parseFloat(options.budget);
    if (!isNaN(budget)) {
      overridden.reviewerMaxBudget = budget;
    }
  }

  if (options.timeout) {
    const timeout = parseInt(options.timeout, 10);
    if (!isNaN(timeout)) {
      overridden.reviewerMaxRuntime = timeout;
    }
  }

  if (options.apiKey) {
    overridden.claude = { ...overridden.claude, apiKey: options.apiKey };
  }

  if (options.apiUrl) {
    overridden.claude = { ...overridden.claude, baseUrl: options.apiUrl };
  }

  return overridden;
}

/**
 * Register the review command with the program
 */
export function reviewCommand(program: Command): void {
  program
    .command("review")
    .description("Run PR reviewer now")
    .option("--dry-run", "Show what would be executed without running")
    .option("--budget <number>", "Override max budget in USD for reviewer")
    .option("--timeout <seconds>", "Override max runtime in seconds for reviewer")
    .option("--api-key <string>", "Claude API key")
    .option("--api-url <string>", "Claude API base URL")
    .option("--model <string>", "Model name (sets both opus and sonnet models)")
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
        console.log("=== Dry Run ===");
        console.log(`Script: ${scriptPath}`);
        console.log(`Project directory: ${projectDir}`);
        console.log("\nEnvironment variables:");
        for (const [key, value] of Object.entries(envVars)) {
          // Mask sensitive values
          const displayValue =
            key === "ANTHROPIC_AUTH_TOKEN" || key === "apiKey"
              ? "***"
              : value;
          console.log(`  ${key}=${displayValue}`);
        }
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
