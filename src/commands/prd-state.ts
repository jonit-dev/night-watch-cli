/**
 * prd-state command — manage PRD state entries in ~/.night-watch/prd-states.json
 * Used by bash scripts to track pending-review state without moving files.
 *
 * Subcommands:
 *   set <projectDir> <prdName> pending-review [--branch <branch>]
 *   clear <projectDir> <prdName>
 *   list <projectDir> [--status <status>]
 */

import { Command } from "commander";
import {
  clearPrdState,
  listPrdStatesByStatus,
  writePrdState,
} from "../utils/prd-states.js";

export function prdStateCommand(program: Command): void {
  const prdState = program
    .command("prd-state")
    .description("Manage PRD state entries in ~/.night-watch/prd-states.json");

  prdState
    .command("set <projectDir> <prdName>")
    .description("Set a PRD state to pending-review")
    .option("--branch <branch>", "Branch name associated with the PR", "")
    .action((projectDir: string, prdName: string, options: { branch: string }) => {
      writePrdState(projectDir, prdName, {
        status: "pending-review",
        branch: options.branch,
        timestamp: Math.floor(Date.now() / 1000),
      });
    });

  prdState
    .command("clear <projectDir> <prdName>")
    .description("Remove a PRD state entry")
    .action((projectDir: string, prdName: string) => {
      clearPrdState(projectDir, prdName);
    });

  prdState
    .command("list <projectDir>")
    .description("List PRD names with a given state (default: pending-review)")
    .option("--status <status>", "Filter by status", "pending-review")
    .action((projectDir: string, options: { status: string }) => {
      if (options.status !== "pending-review") {
        // Future statuses can be added here
        return;
      }
      const names = listPrdStatesByStatus(projectDir, "pending-review");
      for (const name of names) {
        console.log(name);
      }
    });
}
