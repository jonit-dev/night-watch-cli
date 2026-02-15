/**
 * Run command - executes the PRD cron script
 */

import { Command } from "commander";
import { loadConfig, getScriptPath } from "../config.js";
import { INightWatchConfig } from "../types.js";
import { executeScript } from "../utils/shell.js";
import { PROVIDER_COMMANDS, DEFAULT_PRD_DIR } from "../constants.js";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

/**
 * Options for the run command
 */
export interface RunOptions {
  dryRun: boolean;
  timeout?: string;
  provider?: string;
}

/**
 * Build environment variables map from config and CLI options
 */
export function buildEnvVars(config: INightWatchConfig, options: RunOptions): Record<string, string> {
  const env: Record<string, string> = {};

  // Provider command - the actual CLI binary to call
  env.NW_PROVIDER_CMD = PROVIDER_COMMANDS[config.provider];

  // Runtime
  env.NW_MAX_RUNTIME = String(config.maxRuntime);

  // Dry run flag
  if (options.dryRun) {
    env.NW_DRY_RUN = "1";
  }

  return env;
}

/**
 * Apply CLI flag overrides to the config
 */
export function applyCliOverrides(config: INightWatchConfig, options: RunOptions): INightWatchConfig {
  const overridden = { ...config };

  if (options.timeout) {
    const timeout = parseInt(options.timeout, 10);
    if (!isNaN(timeout)) {
      overridden.maxRuntime = timeout;
    }
  }

  if (options.provider) {
    overridden.provider = options.provider as INightWatchConfig["provider"];
  }

  return overridden;
}

/**
 * Scan the PRD directory for eligible PRD files
 */
function scanPrdDirectory(projectDir: string, prdDir: string): { pending: string[]; completed: string[] } {
  const absolutePrdDir = path.join(projectDir, prdDir);
  const doneDir = path.join(absolutePrdDir, "done");

  const pending: string[] = [];
  const completed: string[] = [];

  // Scan main PRD directory for pending PRDs
  if (fs.existsSync(absolutePrdDir)) {
    const entries = fs.readdirSync(absolutePrdDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".md") && entry.name !== "NIGHT-WATCH-SUMMARY.md") {
        pending.push(entry.name);
      }
    }
  }

  // Scan done directory for completed PRDs
  if (fs.existsSync(doneDir)) {
    const entries = fs.readdirSync(doneDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".md")) {
        completed.push(entry.name);
      }
    }
  }

  return { pending, completed };
}

/**
 * Register the run command with the program
 */
export function runCommand(program: Command): void {
  program
    .command("run")
    .description("Run PRD executor now")
    .option("--dry-run", "Show what would be executed without running")
    .option("--timeout <seconds>", "Override max runtime in seconds")
    .option("--provider <string>", "AI provider to use (claude or codex)")
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
        console.log("=== Dry Run: PRD Executor ===\n");

        // Configuration section
        console.log("Configuration:");
        console.log(`  Provider:         ${config.provider}`);
        console.log(`  Provider CLI:     ${PROVIDER_COMMANDS[config.provider]}`);
        console.log(`  PRD Directory:    ${config.prdDir}`);
        console.log(`  Max Runtime:      ${config.maxRuntime}s (${Math.floor(config.maxRuntime / 60)}min)`);
        console.log(`  Branch Prefix:    ${config.branchPrefix}`);

        // Scan for PRDs
        console.log("\nPRD Status:");
        const prdStatus = scanPrdDirectory(projectDir, config.prdDir);

        if (prdStatus.pending.length === 0) {
          console.log("  Pending:          (none)");
        } else {
          console.log(`  Pending (${prdStatus.pending.length}):`);
          for (const prd of prdStatus.pending) {
            console.log(`    - ${prd}`);
          }
        }

        if (prdStatus.completed.length === 0) {
          console.log("  Completed:        (none)");
        } else {
          console.log(`  Completed (${prdStatus.completed.length}):`);
          for (const prd of prdStatus.completed.slice(0, 5)) {
            console.log(`    - ${prd}`);
          }
          if (prdStatus.completed.length > 5) {
            console.log(`    ... and ${prdStatus.completed.length - 5} more`);
          }
        }

        // Provider invocation command
        console.log("\nProvider Invocation:");
        const providerCmd = PROVIDER_COMMANDS[config.provider];
        const autoFlag = config.provider === "claude" ? "--dangerously-skip-permissions" : "--yolo";
        console.log(`  ${providerCmd} ${autoFlag} -p "/night-watch"`);

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
        console.error("Failed to execute run command:", error);
        process.exit(1);
      }
    });
}
