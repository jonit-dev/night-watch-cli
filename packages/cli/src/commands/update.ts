/**
 * Update command for Night Watch CLI
 * Reinstalls global CLI and refreshes cron entries for one or more projects.
 */

import { spawnSync } from "child_process";
import { Command } from "commander";
import * as fs from "fs";
import * as path from "path";
import { dim, success, error as uiError, warn } from "@night-watch/core/utils/ui.js";

export const DEFAULT_GLOBAL_SPEC = "@jonit-dev/night-watch-cli@latest";

export interface IUpdateOptions {
  projects?: string;
  globalSpec: string;
  noGlobal?: boolean;
}

/**
 * Parse project directories from a comma-separated CLI option.
 * Defaults to current working directory when option is omitted.
 */
export function parseProjectDirs(projects: string | undefined, cwd: string): string[] {
  if (!projects || projects.trim().length === 0) {
    return [cwd];
  }

  const dirs = projects
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => path.resolve(cwd, entry));

  return Array.from(new Set(dirs));
}

function runCommand(command: string, args: string[], cwd?: string): void {
  const result = spawnSync(command, args, {
    cwd,
    env: process.env,
    stdio: "inherit",
  });

  if (result.error) {
    throw result.error;
  }

  if ((result.status ?? 1) !== 0) {
    const location = cwd ? ` in ${cwd}` : "";
    throw new Error(`Command failed${location}: ${command} ${args.join(" ")}`);
  }
}

function resolveNightWatchBin(): string {
  const result = spawnSync("which", ["night-watch"], {
    encoding: "utf-8",
    env: process.env,
  });

  if (result.status === 0 && typeof result.stdout === "string" && result.stdout.trim().length > 0) {
    return result.stdout.trim();
  }

  return "night-watch";
}

/**
 * Register update command.
 */
export function updateCommand(program: Command): void {
  program
    .command("update")
    .description("Update global CLI and refresh cron for project(s)")
    .option(
      "--projects <dirs>",
      "Comma-separated project directories (default: current directory)"
    )
    .option(
      "--global-spec <spec>",
      "npm package spec used for global install",
      DEFAULT_GLOBAL_SPEC
    )
    .option("--no-global", "Skip global npm install and only refresh project cron")
    .action(async (options: IUpdateOptions) => {
      try {
        const cwd = process.cwd();
        const projectDirs = parseProjectDirs(options.projects, cwd);

        if (!options.noGlobal) {
          dim(`Updating global install: npm install -g ${options.globalSpec}`);
          runCommand("npm", ["install", "-g", options.globalSpec]);
          success("Global CLI update completed.");
        }

        const nightWatchBin = resolveNightWatchBin();

        for (const projectDir of projectDirs) {
          if (!fs.existsSync(projectDir) || !fs.statSync(projectDir).isDirectory()) {
            warn(`Skipping invalid project directory: ${projectDir}`);
            continue;
          }

          dim(`Refreshing cron in ${projectDir}`);
          runCommand(nightWatchBin, ["uninstall"], projectDir);
          runCommand(nightWatchBin, ["install"], projectDir);
          success(`Refreshed project: ${projectDir}`);
        }

        success("Update completed.");
      } catch (err) {
        uiError(`Update failed: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });
}
