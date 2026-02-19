/**
 * Board command group — manage the PRD tracking board
 */

import { Command } from "commander";
import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import { loadConfig } from "@/config.js";
import { saveConfig } from "@/utils/config-writer.js";
import { createBoardProvider } from "@/board/factory.js";
import { BOARD_COLUMNS, BoardColumnName, IBoardProvider } from "@/board/types.js";
import { INightWatchConfig } from "@/types.js";
import {
  createTable,
  dim,
  header,
  info,
  success,
  warn,
} from "@/utils/ui.js";
import chalk from "chalk";

/** Wrap an async action body so provider errors surface as clean messages. */
async function run(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    console.error(chalk.red((err as Error).message));
    process.exit(1);
  }
}

/**
 * Return a ready-to-use board provider, or exit with an error if not enabled.
 */
function getProvider(config: INightWatchConfig, cwd: string): IBoardProvider {
  if (config.boardProvider?.enabled === false) {
    console.error(
      "Board provider is disabled. Remove boardProvider.enabled: false from night-watch.config.json to re-enable."
    );
    process.exit(1);
  }
  const bp = config.boardProvider ?? { enabled: true, provider: "github" as const };
  return createBoardProvider(bp, cwd);
}

function defaultBoardTitle(cwd: string): string {
  return `${path.basename(cwd)} Night Watch`;
}

/**
 * Ensure the project has a configured board number.
 * If missing, auto-create a board and persist projectNumber to config.
 */
async function ensureBoardConfigured(
  config: INightWatchConfig,
  cwd: string,
  provider: IBoardProvider,
  options?: { quiet?: boolean }
): Promise<void> {
  if (config.boardProvider?.projectNumber) {
    return;
  }

  const title = defaultBoardTitle(cwd);
  if (!options?.quiet) {
    info(`No board configured. Creating "${title}"…`);
  }
  const boardInfo = await provider.setupBoard(title);

  const result = saveConfig(cwd, {
    boardProvider: {
      ...config.boardProvider,
      enabled: config.boardProvider?.enabled ?? true,
      provider: config.boardProvider?.provider ?? "github",
      projectNumber: boardInfo.number,
    },
  });
  if (!result.success) {
    throw new Error(`Failed to save config: ${result.error}`);
  }

  if (!options?.quiet) {
    success(`Board configured (#${boardInfo.number})`);
  }
}

/**
 * Prompt the user for a yes/no confirmation via readline.
 * Returns true when the user confirms.
 */
async function confirmPrompt(question: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === "y");
    });
  });
}

/**
 * Register the board command group with the program.
 */
export function boardCommand(program: Command): void {
  const board = program.command("board").description("Manage the PRD tracking board");

  // ---------------------------------------------------------------------------
  // board setup
  // ---------------------------------------------------------------------------
  board
    .command("setup")
    .description("Create the Night Watch project board and persist its number to config")
    .option("--title <title>", "Board title (default: <repo-folder> Night Watch)")
    .action(async (options: { title?: string }) =>
      run(async () => {
        const cwd = process.cwd();
        const config = loadConfig(cwd);
        const provider = getProvider(config, cwd);

        // Warn if already configured
        if (config.boardProvider?.projectNumber) {
          warn(
            `Board already set up (project #${config.boardProvider.projectNumber}).`
          );
          const confirmed = await confirmPrompt("Re-run setup? This will create a new board. [y/N] ");
          if (!confirmed) {
            dim("Aborted.");
            return;
          }
        }

        const boardTitle = options.title?.trim() || defaultBoardTitle(cwd);
        info(`Creating board "${boardTitle}"…`);
        const boardInfo = await provider.setupBoard(boardTitle);

        // Persist the project number
        const result = saveConfig(cwd, {
          boardProvider: {
            ...config.boardProvider,
            projectNumber: boardInfo.number,
          },
        });

        if (!result.success) {
          console.error(`Failed to save config: ${result.error}`);
          process.exit(1);
        }

        const columns = await provider.getColumns();

        header("Board Created");
        success(`URL: ${boardInfo.url}`);
        info("Columns:");
        for (const col of columns) {
          dim(`  • ${col.name}`);
        }
      })
    );

  // ---------------------------------------------------------------------------
  // board create-prd <title>
  // ---------------------------------------------------------------------------
  board
    .command("create-prd")
    .description("Create a new issue on the board and add it in the Draft column")
    .argument("<title>", "Issue title")
    .option("--body <text>", "Issue body text")
    .option("--body-file <path>", "Read issue body from a file")
    .option("--column <name>", "Target column (default: Draft)", "Draft")
    .option("--label <name>", "Label to apply to the issue")
    .action(
      async (
        title: string,
        options: { body?: string; bodyFile?: string; column: string; label?: string }
      ) =>
        run(async () => {
          const cwd = process.cwd();
          const config = loadConfig(cwd);
          const provider = getProvider(config, cwd);
          await ensureBoardConfigured(config, cwd, provider);

          // Validate column name
          if (!BOARD_COLUMNS.includes(options.column as BoardColumnName)) {
            console.error(
              `Invalid column "${options.column}". Valid columns: ${BOARD_COLUMNS.join(", ")}`
            );
            process.exit(1);
          }

          let body = options.body ?? "";
          if (options.bodyFile) {
            const filePath = options.bodyFile;
            if (!fs.existsSync(filePath)) {
              console.error(`File not found: ${filePath}`);
              process.exit(1);
            }
            body = fs.readFileSync(filePath, "utf-8");
          }

          const issue = await provider.createIssue({
            title,
            body,
            column: options.column as BoardColumnName,
            labels: options.label ? [options.label] : undefined,
          });

          console.log(chalk.green(`Created issue #${issue.number}: ${issue.title}`));
          console.log(chalk.green(`URL: ${issue.url}`));
        })
    );

  // ---------------------------------------------------------------------------
  // board status
  // ---------------------------------------------------------------------------
  board
    .command("status")
    .description("Show the current state of all issues grouped by column")
    .option("--json", "Output raw JSON")
    .action(async (options: { json: boolean }) =>
      run(async () => {
        const cwd = process.cwd();
        const config = loadConfig(cwd);
        const provider = getProvider(config, cwd);
        await ensureBoardConfigured(config, cwd, provider, { quiet: options.json });

        const issues = await provider.getAllIssues();

        if (options.json) {
          console.log(JSON.stringify(issues, null, 2));
          return;
        }

        // Group by column
        const grouped: Record<string, typeof issues> = {};
        for (const issue of issues) {
          const col = issue.column ?? "Uncategorised";
          if (!grouped[col]) grouped[col] = [];
          grouped[col].push(issue);
        }

        header("Board Status");

        if (issues.length === 0) {
          dim("No issues found on the board.");
          return;
        }

        const table = createTable({ head: ["Column", "#", "Title"] });

        for (const [col, colIssues] of Object.entries(grouped)) {
          for (const issue of colIssues) {
            table.push([col, String(issue.number), issue.title]);
          }
        }

        console.log(table.toString());

        // Summary per column
        info("Summary:");
        for (const [col, colIssues] of Object.entries(grouped)) {
          dim(`  ${col}: ${colIssues.length} issue${colIssues.length === 1 ? "" : "s"}`);
        }
        dim(`  Total: ${issues.length}`);
      })
    );

  // ---------------------------------------------------------------------------
  // board next-issue
  // ---------------------------------------------------------------------------
  board
    .command("next-issue")
    .description("Return the next issue from a column (default: Ready)")
    .option("--column <name>", "Column to fetch from", "Ready")
    .option("--json", "Output full issue JSON (for agent consumption)")
    .action(async (options: { column: string; json: boolean }) =>
      run(async () => {
        const cwd = process.cwd();
        const config = loadConfig(cwd);
        const provider = getProvider(config, cwd);
        await ensureBoardConfigured(config, cwd, provider, { quiet: options.json });

        const issues = await provider.getIssuesByColumn(options.column as BoardColumnName);

        if (issues.length === 0) {
          if (options.json) {
            return;
          }
          console.log(`No issues found in ${options.column}`);
          return;
        }

        const issue = issues[0];

        if (options.json) {
          console.log(JSON.stringify(issue, null, 2));
          return;
        }

        console.log(`#${issue.number} ${issue.title}`);
        if (issue.body) {
          const preview = issue.body.slice(0, 200);
          const suffix = issue.body.length > 200 ? "…" : "";
          dim(preview + suffix);
        }
      })
    );

  // ---------------------------------------------------------------------------
  // board move-issue <number>
  // ---------------------------------------------------------------------------
  board
    .command("move-issue")
    .description("Move an issue to a different column")
    .argument("<number>", "Issue number")
    .requiredOption("--column <name>", "Target column name")
    .action(async (number: string, options: { column: string }) =>
      run(async () => {
        const cwd = process.cwd();
        const config = loadConfig(cwd);
        const provider = getProvider(config, cwd);
        await ensureBoardConfigured(config, cwd, provider);

        await provider.moveIssue(parseInt(number, 10), options.column as BoardColumnName);

        success(`Moved issue #${number} to ${options.column}`);
      })
    );

  // ---------------------------------------------------------------------------
  // board comment <number>
  // ---------------------------------------------------------------------------
  board
    .command("comment")
    .description("Add a comment to an issue")
    .argument("<number>", "Issue number")
    .requiredOption("--body <text>", "Comment body text")
    .action(async (number: string, options: { body: string }) =>
      run(async () => {
        const cwd = process.cwd();
        const config = loadConfig(cwd);
        const provider = getProvider(config, cwd);
        await ensureBoardConfigured(config, cwd, provider);

        await provider.commentOnIssue(parseInt(number, 10), options.body);

        success(`Comment added to issue #${number}`);
      })
    );

  // ---------------------------------------------------------------------------
  // board close-issue <number>
  // ---------------------------------------------------------------------------
  board
    .command("close-issue")
    .description("Close an issue and move it to Done")
    .argument("<number>", "Issue number")
    .action(async (number: string) =>
      run(async () => {
        const cwd = process.cwd();
        const config = loadConfig(cwd);
        const provider = getProvider(config, cwd);
        await ensureBoardConfigured(config, cwd, provider);

        const issueNumber = parseInt(number, 10);
        await provider.closeIssue(issueNumber);
        await provider.moveIssue(issueNumber, "Done");

        success(`Closed issue #${number} and moved to Done`);
      })
    );
}
