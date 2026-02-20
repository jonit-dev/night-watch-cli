/**
 * Retry command — Move a completed PRD back to pending for re-execution.
 */

import { Command } from "commander";
import * as fs from "fs";
import * as path from "path";
import { loadConfig } from "@night-watch/core/config.js";
import {
  dim,
  info,
  success,
  error as uiError,
} from "@night-watch/core/utils/ui.js";

/**
 * Normalize the PRD name to ensure it has .md extension
 */
function normalizePrdName(name: string): string {
  if (!name.endsWith(".md")) {
    return `${name}.md`;
  }
  return name;
}

/**
 * Get list of PRD files in the done directory
 */
function getDonePrds(doneDir: string): string[] {
  if (!fs.existsSync(doneDir)) {
    return [];
  }
  return fs.readdirSync(doneDir).filter((f) => f.endsWith(".md"));
}

/**
 * Register the retry command with the program
 */
export function retryCommand(program: Command): void {
  program
    .command("retry <prdName>")
    .description("Move a completed PRD from done/ back to pending")
    .action((prdName: string) => {
      const projectDir = process.cwd();
      const config = loadConfig(projectDir);
      const prdDir = path.join(projectDir, config.prdDir);
      const doneDir = path.join(prdDir, "done");

      // Normalize the PRD name
      const normalizedPrdName = normalizePrdName(prdName);

      // Check if PRD is already pending (exists in prdDir root)
      const pendingPath = path.join(prdDir, normalizedPrdName);
      if (fs.existsSync(pendingPath)) {
        info(`"${normalizedPrdName}" is already pending, nothing to retry.`);
        return;
      }

      // Check if PRD exists in done directory
      const donePath = path.join(doneDir, normalizedPrdName);
      if (fs.existsSync(donePath)) {
        // Move from done to pending
        fs.renameSync(donePath, pendingPath);
        success(`Moved "${normalizedPrdName}" back to pending.`);
        dim(`From: ${donePath}`);
        dim(`To:   ${pendingPath}`);
        return;
      }

      // PRD not found anywhere
      uiError(`PRD "${normalizedPrdName}" not found.`);

      // List available PRDs in done directory
      const donePrds = getDonePrds(doneDir);
      if (donePrds.length > 0) {
        info(`Available PRDs in done/:`);
        for (const prd of donePrds) {
          dim(`  - ${prd}`);
        }
      } else {
        info("No PRDs found in done/ directory.");
      }

      process.exit(1);
    });
}
