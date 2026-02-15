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
import {
  header,
  label,
  dim,
  info,
  error as uiError,
  createSpinner,
  createTable,
} from "../utils/ui.js";

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
        header("Dry Run: PRD Executor");

        // Configuration section with table
        header("Configuration");
        const configTable = createTable({ head: ["Setting", "Value"] });
        configTable.push(["Provider", config.provider]);
        configTable.push(["Provider CLI", PROVIDER_COMMANDS[config.provider]]);
        configTable.push(["PRD Directory", config.prdDir]);
        configTable.push(["Max Runtime", `${config.maxRuntime}s (${Math.floor(config.maxRuntime / 60)}min)`]);
        configTable.push(["Branch Prefix", config.branchPrefix]);
        console.log(configTable.toString());

        // Scan for PRDs
        header("PRD Status");
        const prdStatus = scanPrdDirectory(projectDir, config.prdDir);

        if (prdStatus.pending.length === 0) {
          dim("  Pending: (none)");
        } else {
          info(`Pending (${prdStatus.pending.length}):`);
          for (const prd of prdStatus.pending) {
            dim(`    - ${prd}`);
          }
        }

        if (prdStatus.completed.length === 0) {
          dim("  Completed: (none)");
        } else {
          info(`Completed (${prdStatus.completed.length}):`);
          for (const prd of prdStatus.completed.slice(0, 5)) {
            dim(`    - ${prd}`);
          }
          if (prdStatus.completed.length > 5) {
            dim(`    ... and ${prdStatus.completed.length - 5} more`);
          }
        }

        // Provider invocation command
        header("Provider Invocation");
        const providerCmd = PROVIDER_COMMANDS[config.provider];
        const autoFlag = config.provider === "claude" ? "--dangerously-skip-permissions" : "--yolo";
        dim(`  ${providerCmd} ${autoFlag} -p "/night-watch"`);

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
      const spinner = createSpinner("Running PRD executor...");
      spinner.start();

      try {
        const exitCode = await executeScript(scriptPath, [projectDir], envVars);
        if (exitCode === 0) {
          spinner.succeed("PRD executor completed successfully");
        } else {
          spinner.fail(`PRD executor exited with code ${exitCode}`);
        }
        process.exit(exitCode);
      } catch (err) {
        spinner.fail("Failed to execute run command");
        uiError(`${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });
}
