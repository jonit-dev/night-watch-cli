/**
 * QA command - executes the QA cron script for PR test generation
 */

import { Command } from "commander";
import { getScriptPath, loadConfig } from "@/config.js";
import { INightWatchConfig } from "@/types.js";
import { executeScriptWithOutput } from "@/utils/shell.js";
import { sendNotifications } from "@/utils/notify.js";
import { PROVIDER_COMMANDS } from "@/constants.js";
import { fetchPrDetailsByNumber } from "@/utils/github.js";
import * as path from "path";
import { parseScriptResult } from "@/utils/script-result.js";
import {
  createSpinner,
  createTable,
  dim,
  header,
  info,
  error as uiError,
} from "@/utils/ui.js";

/**
 * Options for the qa command
 */
export interface IQaOptions {
  dryRun: boolean;
  timeout?: string;
  provider?: string;
}

/**
 * QA notifications should not fire for script-level skip/no-op outcomes.
 */
export function shouldSendQaNotification(scriptStatus?: string): boolean {
  if (!scriptStatus) {
    return true;
  }
  return !scriptStatus.startsWith("skip_");
}

/**
 * Parse PR numbers emitted by the QA script marker data (e.g. "#12,#34").
 */
export function parseQaPrNumbers(prsRaw?: string): number[] {
  if (!prsRaw) return [];

  const seen = new Set<number>();
  const numbers: number[] = [];
  for (const token of prsRaw.split(",")) {
    const parsed = parseInt(token.trim().replace(/^#/, ""), 10);
    if (Number.isNaN(parsed) || seen.has(parsed)) {
      continue;
    }
    seen.add(parsed);
    numbers.push(parsed);
  }
  return numbers;
}

/**
 * Build environment variables map from config and CLI options for QA
 */
export function buildEnvVars(config: INightWatchConfig, options: IQaOptions): Record<string, string> {
  const env: Record<string, string> = {};

  // Provider command - the actual CLI binary to call
  env.NW_PROVIDER_CMD = PROVIDER_COMMANDS[config.provider];

  // Default branch (empty = auto-detect in bash script)
  if (config.defaultBranch) {
    env.NW_DEFAULT_BRANCH = config.defaultBranch;
  }

  // Runtime for QA (uses NW_QA_* variables)
  env.NW_QA_MAX_RUNTIME = String(config.qa.maxRuntime);

  // Branch patterns: use qa-specific if non-empty, else top-level
  const branchPatterns = config.qa.branchPatterns.length > 0
    ? config.qa.branchPatterns
    : config.branchPatterns;
  env.NW_BRANCH_PATTERNS = branchPatterns.join(",");

  // QA-specific settings
  env.NW_QA_SKIP_LABEL = config.qa.skipLabel;
  env.NW_QA_ARTIFACTS = config.qa.artifacts;
  env.NW_QA_AUTO_INSTALL_PLAYWRIGHT = config.qa.autoInstallPlaywright ? "1" : "0";

  // Provider environment variables (API keys, base URLs, etc.)
  if (config.providerEnv) {
    Object.assign(env, config.providerEnv);
  }

  // Dry run flag
  if (options.dryRun) {
    env.NW_DRY_RUN = "1";
  }

  // Sandbox flag -- prevents the agent from modifying crontab during execution
  env.NW_EXECUTION_CONTEXT = "agent";

  return env;
}

/**
 * Apply CLI flag overrides to the config for QA
 */
export function applyCliOverrides(config: INightWatchConfig, options: IQaOptions): INightWatchConfig {
  const overridden = { ...config, qa: { ...config.qa } };

  if (options.timeout) {
    const timeout = parseInt(options.timeout, 10);
    if (!isNaN(timeout)) {
      overridden.qa.maxRuntime = timeout;
    }
  }

  if (options.provider) {
    overridden.provider = options.provider as INightWatchConfig["provider"];
  }

  return overridden;
}

/**
 * Register the qa command with the program
 */
export function qaCommand(program: Command): void {
  program
    .command("qa")
    .description("Run QA process now")
    .option("--dry-run", "Show what would be executed without running")
    .option("--timeout <seconds>", "Override max runtime in seconds for QA")
    .option("--provider <string>", "AI provider to use (claude or codex)")
    .action(async (options: IQaOptions) => {
      // Get the project directory (current working directory)
      const projectDir = process.cwd();

      // Load config from file and environment
      let config = loadConfig(projectDir);

      // Apply CLI flag overrides
      config = applyCliOverrides(config, options);

      // Build environment variables
      const envVars = buildEnvVars(config, options);

      // Get the script path
      const scriptPath = getScriptPath("night-watch-qa-cron.sh");

      if (options.dryRun) {
        header("Dry Run: QA Process");

        // Configuration section with table
        header("Configuration");
        const configTable = createTable({ head: ["Setting", "Value"] });
        configTable.push(["Provider", config.provider]);
        configTable.push(["Provider CLI", PROVIDER_COMMANDS[config.provider]]);
        configTable.push(["Max Runtime", `${config.qa.maxRuntime}s (${Math.floor(config.qa.maxRuntime / 60)}min)`]);
        const branchPatterns = config.qa.branchPatterns.length > 0
          ? config.qa.branchPatterns
          : config.branchPatterns;
        configTable.push(["Branch Patterns", branchPatterns.join(", ")]);
        configTable.push(["Skip Label", config.qa.skipLabel]);
        configTable.push(["Artifacts", config.qa.artifacts]);
        configTable.push(["Auto-install Playwright", config.qa.autoInstallPlaywright ? "Yes" : "No"]);
        console.log(configTable.toString());

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
      const spinner = createSpinner("Running QA process...");
      spinner.start();

      try {
        const { exitCode, stdout, stderr } = await executeScriptWithOutput(scriptPath, [projectDir], envVars);
        const scriptResult = parseScriptResult(`${stdout}\n${stderr}`);

        if (exitCode === 0) {
          if (scriptResult?.status?.startsWith("skip_")) {
            spinner.succeed("QA process completed (no PRs needed QA)");
          } else {
            spinner.succeed("QA process completed successfully");
          }
        } else {
          spinner.fail(`QA process exited with code ${exitCode}`);
        }

        // Send notifications (fire-and-forget, failures do not affect exit code)
        if (!options.dryRun) {
          const skipNotification = !shouldSendQaNotification(scriptResult?.status);

          if (skipNotification) {
            info("Skipping QA notification (no actionable QA result)");
          }

          if (!skipNotification) {
            const qaPrNumbers = parseQaPrNumbers(scriptResult?.data.prs);
            const primaryQaPr = qaPrNumbers[0];
            const prDetails = primaryQaPr
              ? fetchPrDetailsByNumber(primaryQaPr, projectDir)
              : null;
            const repo = scriptResult?.data.repo;
            const fallbackPrUrl =
              !prDetails?.url && primaryQaPr && repo
                ? `https://github.com/${repo}/pull/${primaryQaPr}`
                : undefined;

            await sendNotifications(config, {
              event: "qa_completed",
              projectName: path.basename(projectDir),
              exitCode,
              provider: config.provider,
              prNumber: prDetails?.number ?? primaryQaPr,
              prUrl: prDetails?.url ?? fallbackPrUrl,
              prTitle: prDetails?.title,
              prBody: prDetails?.body,
              filesChanged: prDetails?.changedFiles,
              additions: prDetails?.additions,
              deletions: prDetails?.deletions,
            });
          }
        }

        process.exit(exitCode);
      } catch (err) {
        spinner.fail("Failed to execute QA command");
        uiError(`${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });
}
