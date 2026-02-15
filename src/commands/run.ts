/**
 * Run command - executes the PRD cron script
 */

import { Command } from "commander";
import { loadConfig, getScriptPath } from "../config.js";
import { INightWatchConfig } from "../types.js";
import { executeScript } from "../utils/shell.js";

/**
 * Options for the run command
 */
export interface RunOptions {
  dryRun: boolean;
  budget?: string;
  timeout?: string;
  apiKey?: string;
  apiUrl?: string;
  model?: string;
}

/**
 * Build environment variables map from config and CLI options
 */
export function buildEnvVars(config: INightWatchConfig, options: RunOptions): Record<string, string> {
  const env: Record<string, string> = {};

  // Budget and runtime
  if (config.maxBudget !== undefined) {
    env.NW_MAX_BUDGET = String(config.maxBudget);
  }
  if (config.maxRuntime !== undefined) {
    env.NW_MAX_RUNTIME = String(config.maxRuntime);
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
 * Apply CLI flag overrides to the config
 */
export function applyCliOverrides(config: INightWatchConfig, options: RunOptions): INightWatchConfig {
  const overridden = { ...config };

  if (options.budget) {
    const budget = parseFloat(options.budget);
    if (!isNaN(budget)) {
      overridden.maxBudget = budget;
    }
  }

  if (options.timeout) {
    const timeout = parseInt(options.timeout, 10);
    if (!isNaN(timeout)) {
      overridden.maxRuntime = timeout;
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
 * Register the run command with the program
 */
export function runCommand(program: Command): void {
  program
    .command("run")
    .description("Run PRD executor now")
    .option("--dry-run", "Show what would be executed without running")
    .option("--budget <number>", "Override max budget in USD")
    .option("--timeout <seconds>", "Override max runtime in seconds")
    .option("--api-key <string>", "Claude API key")
    .option("--api-url <string>", "Claude API base URL")
    .option("--model <string>", "Model name (sets both opus and sonnet models)")
    .action(async (options: RunOptions) => {
      // Get the project directory (current working directory)
      const projectDir = process.cwd();

      // Load config from file and environment
      let config = loadConfig(projectDir);

      // Apply CLI flag overrides
      config = applyCliOverrides(config, options);

      // Build environment variables
      const envVars = buildEnvVars(config, options);

      // Get the script path
      const scriptPath = getScriptPath("night-watch-cron.sh");

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
        console.error("Failed to execute run command:", error);
        process.exit(1);
      }
    });
}
