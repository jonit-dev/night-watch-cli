/**
 * Slice command - executes the roadmap slicer to create PRDs from roadmap items
 */

import { Command } from "commander";
import { loadConfig } from "../config.js";
import { INightWatchConfig, NotificationEvent } from "../types.js";
import { sendNotifications } from "../utils/notify.js";
import { PROVIDER_COMMANDS } from "../constants.js";
import * as path from "path";
import {
  createSpinner,
  createTable,
  dim,
  header,
  info,
  error as uiError,
} from "../utils/ui.js";
import {
  getRoadmapStatus,
  sliceNextItem,
} from "../utils/roadmap-scanner.js";
import type { ISliceResult } from "../utils/roadmap-scanner.js";

/**
 * Options for the slice command
 */
export interface ISliceOptions {
  dryRun: boolean;
  timeout?: string;
  provider?: string;
}

/**
 * Build environment variables map from config and CLI options for slicer
 */
export function buildEnvVars(config: INightWatchConfig, options: ISliceOptions): Record<string, string> {
  const env: Record<string, string> = {};

  // Provider command - the actual CLI binary to call
  env.NW_PROVIDER_CMD = PROVIDER_COMMANDS[config.provider];

  // Slicer runtime
  env.NW_SLICER_MAX_RUNTIME = String(config.roadmapScanner.slicerMaxRuntime);

  // PRD directory for slicer output
  env.NW_PRD_DIR = config.prdDir;

  // Roadmap path
  env.NW_ROADMAP_PATH = config.roadmapScanner.roadmapPath;

  // Provider environment variables (API keys, base URLs, etc.)
  if (config.providerEnv) {
    Object.assign(env, config.providerEnv);
  }

  // Dry run flag
  if (options.dryRun) {
    env.NW_DRY_RUN = "1";
  }

  // Sandbox flag - prevents the agent from modifying crontab during execution
  env.NW_EXECUTION_CONTEXT = "agent";

  return env;
}

/**
 * Apply CLI flag overrides to the config for slicer
 */
export function applyCliOverrides(config: INightWatchConfig, options: ISliceOptions): INightWatchConfig {
  const overridden = { ...config };

  if (options.timeout) {
    const timeout = parseInt(options.timeout, 10);
    if (!isNaN(timeout)) {
      overridden.roadmapScanner = {
        ...overridden.roadmapScanner,
        slicerMaxRuntime: timeout,
      };
    }
  }

  if (options.provider) {
    overridden.provider = options.provider as INightWatchConfig["provider"];
  }

  return overridden;
}

/**
 * Register the slice command with the program
 */
export function sliceCommand(program: Command): void {
  program
    .command("slice")
    .description("Run roadmap slicer to create PRD from next roadmap item")
    .option("--dry-run", "Show what would be executed without running")
    .option("--timeout <seconds>", "Override max runtime in seconds for slicer")
    .option("--provider <string>", "AI provider to use (claude or codex)")
    .action(async (options: ISliceOptions) => {
      // Get the project directory (current working directory)
      const projectDir = process.cwd();

      // Load config from file and environment
      let config = loadConfig(projectDir);

      // Apply CLI flag overrides
      config = applyCliOverrides(config, options);

      // Build environment variables
      const envVars = buildEnvVars(config, options);

      if (options.dryRun) {
        header("Dry Run: Roadmap Slicer");

        // Configuration section with table
        header("Configuration");
        const configTable = createTable({ head: ["Setting", "Value"] });
        configTable.push(["Provider", config.provider]);
        configTable.push(["Provider CLI", PROVIDER_COMMANDS[config.provider]]);
        configTable.push(["PRD Directory", config.prdDir]);
        configTable.push(["Roadmap Path", config.roadmapScanner.roadmapPath]);
        configTable.push(["Slicer Max Runtime", `${config.roadmapScanner.slicerMaxRuntime}s (${Math.floor(config.roadmapScanner.slicerMaxRuntime / 60)}min)`]);
        configTable.push(["Slicer Schedule", config.roadmapScanner.slicerSchedule]);
        configTable.push(["Scanner Enabled", config.roadmapScanner.enabled ? "Yes" : "No"]);
        console.log(configTable.toString());

        // Get roadmap status
        header("Roadmap Status");
        const roadmapStatus = getRoadmapStatus(projectDir, config);

        if (!config.roadmapScanner.enabled) {
          dim("  Roadmap scanner is disabled");
        } else if (roadmapStatus.status === "no-roadmap") {
          dim(`  ROADMAP.md not found at ${config.roadmapScanner.roadmapPath}`);
        } else {
          const statusTable = createTable({ head: ["Metric", "Count"] });
          statusTable.push(["Total Items", roadmapStatus.totalItems]);
          statusTable.push(["Processed", roadmapStatus.processedItems]);
          statusTable.push(["Pending", roadmapStatus.pendingItems]);
          statusTable.push(["Status", roadmapStatus.status]);
          console.log(statusTable.toString());

          // Show pending items
          if (roadmapStatus.pendingItems > 0) {
            header("Pending Items");
            const pendingItems = roadmapStatus.items.filter((item) => !item.processed && !item.checked);
            for (const item of pendingItems.slice(0, 10)) {
              info(`  - ${item.title}`);
              if (item.section) {
                dim(`    Section: ${item.section}`);
              }
            }
            if (pendingItems.length > 10) {
              dim(`  ... and ${pendingItems.length - 10} more`);
            }
          }
        }

        // Provider invocation command
        header("Provider Invocation");
        const providerCmd = PROVIDER_COMMANDS[config.provider];
        const autoFlag = config.provider === "claude" ? "--dangerously-skip-permissions" : "--yolo";
        dim(`  ${providerCmd} ${autoFlag} -p "/night-watch-slicer"`);

        // Environment variables
        header("Environment Variables");
        for (const [key, value] of Object.entries(envVars)) {
          dim(`  ${key}=${value}`);
        }

        // Full command that would be executed
        header("Action");
        dim("  Would invoke sliceNextItem() to process one roadmap item");
        console.log();

        process.exit(0);
      }

      // Check if roadmap scanner is enabled
      if (!config.roadmapScanner.enabled) {
        uiError("Roadmap scanner is disabled. Enable it in night-watch.config.json to use the slicer.");
        process.exit(1);
      }

      // Execute the slicer with spinner
      const spinner = createSpinner("Running roadmap slicer...");
      spinner.start();

      try {
        const result: ISliceResult = await sliceNextItem(projectDir, config);

        if (result.sliced) {
          spinner.succeed(`Slicer completed successfully: Created ${result.file}`);
        } else if (result.error) {
          if (result.error === "No pending items to process") {
            spinner.succeed("No pending items to process");
          } else {
            spinner.fail(`Slicer failed: ${result.error}`);
          }
        }

        // Send notifications (fire-and-forget, failures do not affect exit code)
        const exitCode = result.sliced ? 0 : (result.error === "No pending items to process" ? 0 : 1);

        if (!options.dryRun && result.sliced) {
          const event: NotificationEvent = "run_succeeded";

          await sendNotifications(config, {
            event,
            projectName: path.basename(projectDir),
            exitCode,
            provider: config.provider,
            prTitle: result.item?.title,
          });
        }

        process.exit(exitCode);
      } catch (err) {
        spinner.fail("Failed to execute slice command");
        uiError(`${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });
}
