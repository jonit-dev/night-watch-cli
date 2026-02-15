/**
 * Logs command for Night Watch CLI
 * View log output from executor and reviewer
 */

import { Command } from "commander";
import { spawn } from "child_process";
import * as path from "path";
import * as fs from "fs";
import { LOG_DIR } from "../constants.js";

export interface LogsOptions {
  lines?: string;
  follow?: boolean;
  type?: string;
}

/**
 * Get last N lines from a file
 */
function getLastLines(filePath: string, lineCount: number): string {
  if (!fs.existsSync(filePath)) {
    return `Log file not found: ${filePath}`;
  }

  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.trim().split("\n");
    return lines.slice(-lineCount).join("\n");
  } catch (error) {
    return `Error reading log file: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/**
 * Follow log file in real-time using tail -f
 */
function followLog(filePath: string): void {
  if (!fs.existsSync(filePath)) {
    console.log(`Log file not found: ${filePath}`);
    console.log("The log file will be created when the first execution runs.");
    return;
  }

  const tail = spawn("tail", ["-f", filePath], {
    stdio: "inherit",
  });

  tail.on("error", (error) => {
    console.error(`Error following log: ${error.message}`);
  });

  // Handle Ctrl+C gracefully
  process.on("SIGINT", () => {
    tail.kill();
    process.exit(0);
  });
}

/**
 * Logs command implementation
 */
export function logsCommand(program: Command): void {
  program
    .command("logs")
    .description("View night-watch log output")
    .option("-n, --lines <count>", "Number of lines to show", "50")
    .option("-f, --follow", "Follow log output (tail -f)")
    .option("-t, --type <type>", "Log type to view (run|review|all)", "all")
    .action(async (options: LogsOptions) => {
      try {
        const projectDir = process.cwd();
        const logDir = path.join(projectDir, LOG_DIR);
        const lineCount = parseInt(options.lines || "50", 10);

        const executorLog = path.join(logDir, "executor.log");
        const reviewerLog = path.join(logDir, "reviewer.log");

        // Determine which logs to show
        const logType = options.type?.toLowerCase() || "all";
        const showExecutor = logType === "all" || logType === "run" || logType === "executor";
        const showReviewer = logType === "all" || logType === "review" || logType === "reviewer";

        // Handle --follow mode
        if (options.follow) {
          if (logType === "all") {
            console.log("Note: Following all logs is not supported. Showing executor log.");
            console.log("Use --type review to follow reviewer log.\n");
          }

          const targetLog = showReviewer ? reviewerLog : executorLog;
          followLog(targetLog);
          return;
        }

        // Show static log output
        let output = "";

        if (showExecutor) {
          output += "=== Executor Log ===\n";
          output += `File: ${executorLog}\n\n`;
          output += getLastLines(executorLog, lineCount);
          output += "\n\n";
        }

        if (showReviewer) {
          output += "=== Reviewer Log ===\n";
          output += `File: ${reviewerLog}\n\n`;
          output += getLastLines(reviewerLog, lineCount);
          output += "\n";
        }

        console.log(output.trim());

        // Add tip
        console.log("\n---");
        console.log("Tip: Use -f to follow logs in real-time");
        console.log("     Use --type run or --type review to view specific logs");
      } catch (error) {
        console.error(
          `Error reading logs: ${error instanceof Error ? error.message : String(error)}`
        );
        process.exit(1);
      }
    });
}
