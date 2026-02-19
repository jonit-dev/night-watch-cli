/**
 * PRs command for Night Watch CLI
 * Lists matching PRs with their CI status and review scores
 */

import { Command } from "commander";
import chalk from "chalk";
import { loadConfig } from "../config.js";
import { IPrInfo, collectPrInfo } from "../utils/status-data.js";
import { createTable, dim, header, info } from "../utils/ui.js";

export interface IPrsOptions {
  json?: boolean;
  debug?: boolean;
}

/**
 * Format CI status with color coding
 */
function formatCiStatus(status: IPrInfo["ciStatus"]): string {
  switch (status) {
    case "pass":
      return chalk.green("pass");
    case "fail":
      return chalk.red("fail");
    case "pending":
      return chalk.yellow("pending");
    default:
      return chalk.dim("unknown");
  }
}

/**
 * Format review score with color coding
 */
function formatReviewScore(score: number | null): string {
  if (score === null) {
    return chalk.dim("-");
  }
  if (score >= 80) {
    return chalk.green(String(score));
  }
  if (score >= 60) {
    return chalk.yellow(String(score));
  }
  return chalk.red(String(score));
}

/**
 * Format PR data for JSON output
 */
interface IPrsJsonOutput {
  prs: IPrInfo[];
  count: number;
}

/**
 * PRs command implementation
 */
export function prsCommand(program: Command): void {
  program
    .command("prs")
    .description("List matching PRs with CI status and review scores")
    .option("--json", "Output PRs as JSON")
    .option("--debug", "Enable debug logging to show raw API data")
    .action(async (options: IPrsOptions) => {
      try {
        // Enable debug mode if requested
        if (options.debug) {
          process.env.DEBUG_PR_DATA = "1";
        }

        const projectDir = process.cwd();
        const config = loadConfig(projectDir);
        const prs = collectPrInfo(projectDir, config.branchPatterns);

        // Output as JSON if requested
        if (options.json) {
          const output: IPrsJsonOutput = {
            prs,
            count: prs.length,
          };
          console.log(JSON.stringify(output, null, 2));
          return;
        }

        // Print header
        console.log();
        console.log(chalk.bold.cyan("Night Watch PRs"));
        console.log(chalk.dim("-".repeat(40)));
        console.log();

        if (prs.length === 0) {
          info("No open PRs matching configured branch patterns found.");
          dim(`Branch patterns: ${config.branchPatterns.join(", ")}`);
          console.log();
          return;
        }

        header(`Open PRs (${prs.length})`);

        // Create and populate table
        const table = createTable({
          head: ["#", "Title", "Branch", "CI", "Score", "URL"],
          colWidths: [6, 30, 25, 10, 8, 50],
        });

        for (const pr of prs) {
          // Truncate title if too long
          const title = pr.title.length > 27 ? pr.title.substring(0, 24) + "..." : pr.title;
          // Truncate branch if too long
          const branch = pr.branch.length > 22 ? pr.branch.substring(0, 19) + "..." : pr.branch;

          table.push([
            String(pr.number),
            title,
            branch,
            formatCiStatus(pr.ciStatus),
            formatReviewScore(pr.reviewScore),
            pr.url,
          ]);
        }

        console.log(table.toString());
        console.log();
      } catch (error) {
        console.error(
          `Error listing PRs: ${error instanceof Error ? error.message : String(error)}`
        );
        process.exit(1);
      }
    });
}
