/**
 * PRD command group - manage PRD files
 */

import { Command } from "commander";
import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import { loadConfig } from "../config.js";
import { CLAIM_FILE_EXTENSION } from "../constants.js";
import {
  IPrdTemplateVars,
  renderPrdTemplate,
} from "../templates/prd-template.js";
import {
  createTable,
  dim,
  header,
  info,
  success,
  error as uiError,
} from "../utils/ui.js";

export interface IPrdCreateOptions {
  interactive: boolean;
  template?: string;
  deps?: string;
  phases?: string;
  number: boolean; // Commander inverts --no-number to number: false
}

/**
 * Slugify a name into a filename-safe string
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Get the next PRD number based on existing files in the directory
 */
export function getNextPrdNumber(prdDir: string): number {
  if (!fs.existsSync(prdDir)) return 1;
  const files = fs
    .readdirSync(prdDir)
    .filter((f) => f.endsWith(".md") && f !== "NIGHT-WATCH-SUMMARY.md");
  const numbers = files.map((f) => {
    const match = f.match(/^(\d+)-/);
    return match ? parseInt(match[1], 10) : 0;
  });
  return Math.max(0, ...numbers) + 1;
}

/**
 * Prompt the user for a value using readline
 */
function prompt(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim());
    });
  });
}

/**
 * Parse dependency references from PRD markdown content
 */
function parseDependencies(content: string): string[] {
  const match =
    content.match(/\*\*Depends on:\*\*\s*(.+)/i) ||
    content.match(/Depends on:\s*(.+)/i);
  if (!match) return [];
  return match[1]
    .split(",")
    .map((d) => d.replace(/`/g, "").trim())
    .filter(Boolean);
}

/**
 * Check if a claim file is active (not stale)
 */
function isClaimActive(claimPath: string, maxRuntime: number): { active: boolean; hostname?: string; pid?: number } {
  try {
    if (!fs.existsSync(claimPath)) {
      return { active: false };
    }
    const content = fs.readFileSync(claimPath, "utf-8");
    const claim = JSON.parse(content);
    const age = Math.floor(Date.now() / 1000) - claim.timestamp;
    if (age < maxRuntime) {
      return { active: true, hostname: claim.hostname, pid: claim.pid };
    }
    return { active: false };
  } catch {
    return { active: false };
  }
}

/**
 * Register the prd command group with the program
 */
export function prdCommand(program: Command): void {
  const prd = program
    .command("prd")
    .description("Manage PRD files");

  prd
    .command("create")
    .description("Generate a new PRD markdown file from template")
    .argument("<name>", "PRD name (used for title and filename)")
    .option("-i, --interactive", "Prompt for complexity, dependencies, and phase count", false)
    .option("-t, --template <path>", "Path to a custom template file")
    .option("--deps <files>", "Comma-separated dependency filenames")
    .option("--phases <count>", "Number of execution phases", "3")
    .option("--no-number", "Skip auto-numbering prefix")
    .action(async (name: string, options: IPrdCreateOptions) => {
      const projectDir = process.cwd();

      // Load config to get prdDir
      const config = loadConfig(projectDir);
      const prdDir = path.join(projectDir, config.prdDir);

      // Ensure the PRD directory exists
      if (!fs.existsSync(prdDir)) {
        fs.mkdirSync(prdDir, { recursive: true });
      }

      // Prepare template variables with defaults
      let complexityScore = 5;
      let dependsOn: string[] = [];
      let phaseCount = parseInt(options.phases ?? "3", 10);
      if (isNaN(phaseCount) || phaseCount < 1) {
        phaseCount = 3;
      }

      // Parse --deps flag
      if (options.deps) {
        dependsOn = options.deps
          .split(",")
          .map((d) => d.trim())
          .filter((d) => d.length > 0);
      }

      // Interactive mode: prompt for values
      if (options.interactive) {
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });

        try {
          // Prompt for complexity
          const complexityInput = await prompt(
            rl,
            "Complexity score (1-10, default 5): "
          );
          if (complexityInput) {
            const parsed = parseInt(complexityInput, 10);
            if (!isNaN(parsed) && parsed >= 1 && parsed <= 10) {
              complexityScore = parsed;
            }
          }

          // Prompt for dependencies
          const depsInput = await prompt(
            rl,
            "Dependencies (comma-separated filenames, or empty): "
          );
          if (depsInput) {
            dependsOn = depsInput
              .split(",")
              .map((d) => d.trim())
              .filter((d) => d.length > 0);
          }

          // Prompt for phases
          const phasesInput = await prompt(
            rl,
            `Number of phases (default ${phaseCount}): `
          );
          if (phasesInput) {
            const parsed = parseInt(phasesInput, 10);
            if (!isNaN(parsed) && parsed >= 1) {
              phaseCount = parsed;
            }
          }
        } finally {
          rl.close();
        }
      }

      // Determine complexity level from score
      let complexityLevel: IPrdTemplateVars["complexityLevel"];
      if (complexityScore <= 3) {
        complexityLevel = "LOW";
      } else if (complexityScore <= 7) {
        complexityLevel = "MEDIUM";
      } else {
        complexityLevel = "HIGH";
      }

      // Build filename
      const slug = slugify(name);
      let filename: string;

      if (options.number) {
        const nextNum = getNextPrdNumber(prdDir);
        const padded = String(nextNum).padStart(2, "0");
        filename = `${padded}-${slug}.md`;
      } else {
        filename = `${slug}.md`;
      }

      const filePath = path.join(prdDir, filename);

      // Refuse to overwrite existing files
      if (fs.existsSync(filePath)) {
        uiError(`File already exists: ${filePath}`);
        dim("Use a different name or remove the existing file.");
        process.exit(1);
      }

      // Load custom template if provided
      let customTemplate: string | undefined;
      if (options.template) {
        const templatePath = path.resolve(options.template);
        if (!fs.existsSync(templatePath)) {
          uiError(`Template file not found: ${templatePath}`);
          process.exit(1);
        }
        customTemplate = fs.readFileSync(templatePath, "utf-8");
      }

      // Render template
      const vars: IPrdTemplateVars = {
        title: name,
        dependsOn,
        complexityScore,
        complexityLevel,
        complexityBreakdown: [],
        phaseCount,
      };

      const content = renderPrdTemplate(vars, customTemplate);

      // Write the file
      fs.writeFileSync(filePath, content, "utf-8");

      header("PRD Created");
      success(`Created: ${filePath}`);
      info(`Title: ${name}`);
      dim(`Phases: ${phaseCount}`);
      if (dependsOn.length > 0) {
        dim(`Dependencies: ${dependsOn.join(", ")}`);
      }
    });

  prd
    .command("list")
    .description("List all PRDs with status")
    .option("--json", "Output as JSON")
    .action(async (options: { json: boolean }) => {
      const projectDir = process.cwd();
      const config = loadConfig(projectDir);
      const absolutePrdDir = path.join(projectDir, config.prdDir);
      const doneDir = path.join(absolutePrdDir, "done");

      // Scan pending PRDs
      const pending: Array<{ name: string; dependencies: string[]; claimed: boolean; claimInfo?: { hostname: string; pid: number } }> = [];
      if (fs.existsSync(absolutePrdDir)) {
        const files = fs
          .readdirSync(absolutePrdDir)
          .filter(
            (f) => f.endsWith(".md") && f !== "NIGHT-WATCH-SUMMARY.md"
          );
        for (const file of files) {
          const content = fs.readFileSync(
            path.join(absolutePrdDir, file),
            "utf-8"
          );
          const deps = parseDependencies(content);
          const claimPath = path.join(absolutePrdDir, file + CLAIM_FILE_EXTENSION);
          const claimStatus = isClaimActive(claimPath, config.maxRuntime);
          pending.push({ name: file, dependencies: deps, claimed: claimStatus.active, claimInfo: claimStatus.active ? { hostname: claimStatus.hostname!, pid: claimStatus.pid! } : undefined });
        }
      }

      // Scan done PRDs
      const done: Array<{ name: string; dependencies: string[] }> = [];
      if (fs.existsSync(doneDir)) {
        const files = fs
          .readdirSync(doneDir)
          .filter((f) => f.endsWith(".md"));
        for (const file of files) {
          const content = fs.readFileSync(
            path.join(doneDir, file),
            "utf-8"
          );
          const deps = parseDependencies(content);
          done.push({ name: file, dependencies: deps });
        }
      }

      if (options.json) {
        console.log(JSON.stringify({ pending, done }, null, 2));
        return;
      }

      header("PRD Status");

      if (pending.length === 0 && done.length === 0) {
        dim("  No PRDs found.");
        return;
      }

      const table = createTable({
        head: ["Name", "Status", "Dependencies"],
      });
      for (const prd of pending) {
        const status = prd.claimed ? "claimed" : "pending";
        const statusDisplay = prd.claimed && prd.claimInfo
          ? `claimed (${prd.claimInfo.hostname}:${prd.claimInfo.pid})`
          : status;
        table.push([
          prd.name,
          statusDisplay,
          prd.dependencies.join(", ") || "-",
        ]);
      }
      for (const prd of done) {
        table.push([
          prd.name,
          "done",
          prd.dependencies.join(", ") || "-",
        ]);
      }
      console.log(table.toString());
      const claimedCount = pending.filter(p => p.claimed).length;
      const pendingCount = pending.length - claimedCount;
      info(`${pendingCount} pending, ${claimedCount} claimed, ${done.length} done`);
    });
}
