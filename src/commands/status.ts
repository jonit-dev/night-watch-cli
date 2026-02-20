/**
 * Status command for Night Watch CLI
 * Shows current status including lock files, PRDs, PRs, and logs
 */

import { Command } from "commander";
import chalk from "chalk";
import { loadConfig } from "../config.js";
import {
  fetchStatusSnapshot,
} from "../utils/status-data.js";
import {
  createTable,
  dim,
  formatInstalledStatus,
  formatRunningStatus,
  header,
} from "../utils/ui.js";

export interface IStatusOptions {
  verbose?: boolean;
  json?: boolean;
}

interface IStatusInfo {
  projectName: string;
  projectDir: string;
  provider: string;
  reviewerEnabled: boolean;
  autoMerge: boolean;
  autoMergeMethod: string;
  executor: {
    running: boolean;
    pid: number | null;
  };
  reviewer: {
    running: boolean;
    pid: number | null;
  };
  prds: {
    pending: number;
    claimed: number;
    done: number;
  };
  prs: {
    open: number;
  };
  crontab: {
    installed: boolean;
    entries: string[];
  };
  logs: {
    executor?: {
      path: string;
      lastLines: string[];
      exists: boolean;
      size: number;
    };
    reviewer?: {
      path: string;
      lastLines: string[];
      exists: boolean;
      size: number;
    };
  };
}

/**
 * Format bytes to human-readable size
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

/**
 * Status command implementation
 */
export function statusCommand(program: Command): void {
  program
    .command("status")
    .description("Show current night-watch status")
    .option("-v, --verbose", "Show detailed status information")
    .option("--json", "Output status as JSON")
    .action(async (options: IStatusOptions) => {
      try {
        const projectDir = process.cwd();
        const config = loadConfig(projectDir);
        const snapshot = fetchStatusSnapshot(projectDir, config);

        // Derive legacy status shape from snapshot for backward-compatible JSON output
        const executorProc = snapshot.processes.find((p) => p.name === "executor");
        const reviewerProc = snapshot.processes.find((p) => p.name === "reviewer");
        const executorLog = snapshot.logs.find((l) => l.name === "executor");
        const reviewerLog = snapshot.logs.find((l) => l.name === "reviewer");

        const pendingPrds = snapshot.prds.filter((p) => p.status === "ready" || p.status === "blocked").length;
        const claimedPrds = snapshot.prds.filter((p) => p.status === "in-progress").length;
        const donePrds = snapshot.prds.filter((p) => p.status === "done").length;

        const status: IStatusInfo = {
          projectName: snapshot.projectName,
          projectDir: snapshot.projectDir,
          provider: config.provider,
          reviewerEnabled: config.reviewerEnabled,
          autoMerge: config.autoMerge,
          autoMergeMethod: config.autoMergeMethod,
          executor: { running: executorProc?.running ?? false, pid: executorProc?.pid ?? null },
          reviewer: { running: reviewerProc?.running ?? false, pid: reviewerProc?.pid ?? null },
          prds: { pending: pendingPrds, claimed: claimedPrds, done: donePrds },
          prs: { open: snapshot.prs.length },
          crontab: snapshot.crontab,
          logs: {
            executor: executorLog ? { path: executorLog.path, lastLines: executorLog.lastLines, exists: executorLog.exists, size: executorLog.size } : undefined,
            reviewer: reviewerLog ? { path: reviewerLog.path, lastLines: reviewerLog.lastLines, exists: reviewerLog.exists, size: reviewerLog.size } : undefined,
          },
        };

        // Output as JSON if requested
        if (options.json) {
          console.log(JSON.stringify(status, null, 2));
          return;
        }

        // Print formatted status dashboard
        console.log();
        console.log(chalk.bold.cyan(`Night Watch Status: ${status.projectName}`));
        console.log(chalk.dim("─".repeat(40)));
        console.log();
        dim(`Project Directory: ${status.projectDir}`);

        // Configuration section with table
        header("Configuration");
        const configTable = createTable({ head: ["Setting", "Value"] });
        configTable.push(["Provider", status.provider]);
        configTable.push(["Reviewer", status.reviewerEnabled ? "Enabled" : "Disabled"]);
        configTable.push(["Auto-merge", status.autoMerge ? `Enabled (${status.autoMergeMethod})` : "Disabled"]);
        console.log(configTable.toString());

        // Process status section with colored indicators
        header("Process Status");
        const processTable = createTable({ head: ["Process", "Status"] });
        processTable.push(["Executor", formatRunningStatus(status.executor.running, status.executor.pid)]);
        processTable.push(["Reviewer", formatRunningStatus(status.reviewer.running, status.reviewer.pid)]);
        console.log(processTable.toString());

        // PRD status section with table
        header("PRD Status");
        const prdTable = createTable({ head: ["Status", "Count"] });
        prdTable.push(["Pending", String(status.prds.pending)]);
        prdTable.push(["Claimed", String(status.prds.claimed)]);
        prdTable.push(["Completed", String(status.prds.done)]);
        console.log(prdTable.toString());

        // PR status section with table
        header("PR Status");
        const prTable = createTable({ head: ["Type", "Count"] });
        prTable.push(["Open PRs (night-watch/feat branches)", String(status.prs.open)]);
        console.log(prTable.toString());

        // Crontab status section with colored output
        header("Crontab Status");
        console.log(`  ${formatInstalledStatus(status.crontab.installed)}`);
        if (status.crontab.installed && options.verbose) {
          console.log();
          dim("  Entries:");
          status.crontab.entries.forEach((entry) => dim(`    ${entry}`));
        }
        console.log();

        // Log status section with table
        header("Log Files");
        const logTable = createTable({ head: ["Log", "Size", "Status"] });
        if (status.logs.executor) {
          logTable.push([
            "Executor",
            status.logs.executor.exists ? formatBytes(status.logs.executor.size) : "-",
            status.logs.executor.exists ? "Exists" : "Not found",
          ]);
        }
        if (status.logs.reviewer) {
          logTable.push([
            "Reviewer",
            status.logs.reviewer.exists ? formatBytes(status.logs.reviewer.size) : "-",
            status.logs.reviewer.exists ? "Exists" : "Not found",
          ]);
        }
        console.log(logTable.toString());

        // Show last lines in verbose mode
        if (options.verbose) {
          if (status.logs.executor?.exists && status.logs.executor.lastLines.length > 0) {
            dim("  Executor last 5 lines:");
            status.logs.executor.lastLines.forEach((line) => dim(`    ${line}`));
          }
          if (status.logs.reviewer?.exists && status.logs.reviewer.lastLines.length > 0) {
            dim("  Reviewer last 5 lines:");
            status.logs.reviewer.lastLines.forEach((line) => dim(`    ${line}`));
          }
        }

        // Tips section with dim styling
        header("Commands");
        dim("  night-watch install  - Install crontab entries");
        dim("  night-watch logs     - View logs");
        dim("  night-watch run      - Run executor now");
        dim("  night-watch review   - Run reviewer now");
        console.log();
      } catch (error) {
        console.error(
          `Error getting status: ${error instanceof Error ? error.message : String(error)}`
        );
        process.exit(1);
      }
    });
}
