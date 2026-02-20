/**
 * PRDs command for Night Watch CLI
 * Lists all PRDs with their status (ready/blocked/in-progress/done) and dependencies
 */

import { Command } from "commander";
import chalk from "chalk";
import { loadConfig } from "@night-watch/core/config.js";
import {
  IPrdInfo,
  collectPrdInfo,
} from "@night-watch/core/utils/status-data.js";
import {
  createTable,
  dim,
  header,
} from "@night-watch/core/utils/ui.js";
import { execSync } from "child_process";

export interface IPrdsOptions {
  json?: boolean;
}

/**
 * Extended PRD info with PR branch for display purposes
 */
interface IPrdDisplay extends IPrdInfo {
  prBranch?: string;
}

/**
 * Get open PR branch names using gh CLI
 */
function getOpenPrBranches(projectDir: string): Set<string> {
  try {
    execSync("git rev-parse --git-dir", {
      cwd: projectDir,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch {
    return new Set();
  }

  try {
    execSync("which gh", { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
  } catch {
    return new Set();
  }

  try {
    const output = execSync("gh pr list --state open --json headRefName", {
      cwd: projectDir,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });

    const prs: Array<{ headRefName: string }> = JSON.parse(output);
    return new Set(prs.map((pr) => pr.headRefName));
  } catch {
    return new Set();
  }
}

/**
 * Derive a branch name from a PRD name
 * Converts "01-feature-name.md" or "01-feature-name" to potential branch patterns
 */
function deriveBranchPatterns(prdName: string, branchPrefix: string): string[] {
  // Remove .md extension if present
  const baseName = prdName.replace(/\.md$/, "");

  // Common patterns:
  // 1. night-watch/01-feature-name
  // 2. feat/01-feature-name
  // 3. feature/01-feature-name
  return [
    `${branchPrefix}${baseName}`,
    `feat/${baseName}`,
    `feature/${baseName}`,
  ];
}

/**
 * Find matching PR for a PRD
 */
function findMatchingPr(prdName: string, openPrBranches: Set<string>, branchPrefix: string): string | null {
  const patterns = deriveBranchPatterns(prdName, branchPrefix);

  for (const pattern of patterns) {
    // Check for exact match
    if (openPrBranches.has(pattern)) {
      return pattern;
    }

    // Check for partial match (branch might have additional suffix)
    for (const branch of openPrBranches) {
      if (branch === pattern || branch.startsWith(`${pattern}-`) || branch.startsWith(`${pattern}/`)) {
        return branch;
      }
    }
  }

  return null;
}

/**
 * Format status with color
 */
function formatStatus(status: IPrdInfo["status"]): string {
  switch (status) {
    case "ready":
      return chalk.green("ready");
    case "blocked":
      return chalk.yellow("blocked");
    case "in-progress":
      return chalk.cyan("in-progress");
    case "pending-review":
      return chalk.magenta("pending-review");
    case "done":
      return chalk.dim("done");
    default:
      return status;
  }
}

/**
 * Format dependencies list
 */
function formatDependencies(dependencies: string[], unmetDependencies: string[]): string {
  if (dependencies.length === 0) {
    return chalk.dim("-");
  }

  return dependencies.map((dep) => {
    const isUnmet = unmetDependencies.includes(dep);
    return isUnmet ? chalk.red(dep) : chalk.green(dep);
  }).join(", ");
}

/**
 * PRDs command implementation
 */
export function prdsCommand(program: Command): void {
  program
    .command("prds")
    .description("List all PRDs with their status and dependencies")
    .option("--json", "Output as JSON")
    .action(async (options: IPrdsOptions) => {
      try {
        const projectDir = process.cwd();
        const config = loadConfig(projectDir);

        // Collect PRD info using existing utility
        const prds = collectPrdInfo(projectDir, config.prdDir, config.maxRuntime);

        // Get open PR branches for in-progress detection
        const openPrBranches = getOpenPrBranches(projectDir);

        // Filter out summary file and update in-progress status based on open PRs
        const filteredPrds: IPrdDisplay[] = prds.filter((prd) =>
          !prd.name.toLowerCase().includes("night-watch-summary")
        );

        // Update status based on open PRs
        for (const prd of filteredPrds) {
          if (prd.status !== "done") {
            const matchingPr = findMatchingPr(prd.name, openPrBranches, config.branchPrefix);
            if (matchingPr) {
              prd.status = "in-progress";
              prd.prBranch = matchingPr;
            }
          }
        }

        // Sort: ready first, then blocked, then in-progress, then done
        const statusOrder: Record<IPrdInfo["status"], number> = {
          "ready": 0,
          "blocked": 1,
          "in-progress": 2,
          "pending-review": 3,
          "done": 4,
        };
        filteredPrds.sort((a, b) => statusOrder[a.status] - statusOrder[b.status]);

        // Output as JSON if requested
        if (options.json) {
          const jsonOutput = filteredPrds.map((prd) => ({
            name: prd.name,
            status: prd.status,
            dependencies: prd.dependencies,
            unmetDependencies: prd.unmetDependencies,
            pr: prd.prBranch || null,
          }));
          console.log(JSON.stringify(jsonOutput, null, 2));
          return;
        }

        // Display header
        header("PRD Status");

        if (filteredPrds.length === 0) {
          dim("No PRDs found.");
          return;
        }

        // Create and populate table
        const table = createTable({
          head: ["Name", "Status", "Dependencies", "PR"],
          colWidths: [35, 12, 40, 30],
        });

        for (const prd of filteredPrds) {
          const prBranch = prd.prBranch;
          table.push([
            prd.status === "done" ? chalk.dim(prd.name) : prd.name,
            formatStatus(prd.status),
            formatDependencies(prd.dependencies, prd.unmetDependencies),
            prBranch ? chalk.cyan(prBranch) : chalk.dim("-"),
          ]);
        }

        console.log(table.toString());

        // Summary counts
        const ready = filteredPrds.filter((p) => p.status === "ready").length;
        const blocked = filteredPrds.filter((p) => p.status === "blocked").length;
        const inProgress = filteredPrds.filter((p) => p.status === "in-progress").length;
        const pendingReview = filteredPrds.filter((p) => p.status === "pending-review").length;
        const done = filteredPrds.filter((p) => p.status === "done").length;

        console.log();
        dim(`  Ready: ${ready} | Blocked: ${blocked} | In Progress: ${inProgress} | Pending Review: ${pendingReview} | Done: ${done}`);
        console.log();

      } catch (error) {
        console.error(
          `Error listing PRDs: ${error instanceof Error ? error.message : String(error)}`
        );
        process.exit(1);
      }
    });
}
