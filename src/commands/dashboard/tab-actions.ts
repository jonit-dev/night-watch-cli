/**
 * Actions tab for the dashboard TUI
 * Provides manual triggers for executor, reviewer, install, uninstall, and doctor
 */

import blessed from "blessed";
import { ChildProcess, spawn } from "child_process";
import { performInstall } from "../install.js";
import { performUninstall } from "../uninstall.js";
import { ITab, ITabContext } from "./types.js";

interface IAction {
  label: string;
  description: string;
  execute: (ctx: ITabContext, outputBox: blessed.Widgets.BoxElement) => void;
}

function spawnAction(
  args: string[],
  ctx: ITabContext,
  outputBox: blessed.Widgets.BoxElement,
  onDone?: () => void
): ChildProcess {
  outputBox.setContent("{cyan-fg}Starting...{/cyan-fg}\n");
  ctx.screen.render();

  const child = spawn("npx", ["tsx", "src/cli.ts", ...args], {
    cwd: ctx.projectDir,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env },
  });

  let output = "";
  const maxLines = 500;

  const appendOutput = (data: Buffer) => {
    output += data.toString();
    // Trim to last maxLines
    const lines = output.split("\n");
    if (lines.length > maxLines) {
      output = lines.slice(-maxLines).join("\n");
    }
    outputBox.setContent(output);
    outputBox.setScrollPerc(100);
    ctx.screen.render();
  };

  child.stdout?.on("data", appendOutput);
  child.stderr?.on("data", appendOutput);

  child.on("close", (code) => {
    const exitMsg = code === 0
      ? "\n{green-fg}--- Completed successfully ---{/green-fg}"
      : `\n{red-fg}--- Exited with code ${code} ---{/red-fg}`;
    output += exitMsg;
    outputBox.setContent(output);
    outputBox.setScrollPerc(100);
    ctx.screen.render();
    onDone?.();
  });

  child.on("error", (err) => {
    output += `\n{red-fg}Error: ${err.message}{/red-fg}`;
    outputBox.setContent(output);
    ctx.screen.render();
    onDone?.();
  });

  return child;
}

function buildActions(): IAction[] {
  return [
    {
      label: "Run PRD Executor",
      description: "Execute the next eligible PRD",
      execute: (ctx, outputBox) => {
        spawnAction(["run"], ctx, outputBox);
      },
    },
    {
      label: "Run PR Reviewer",
      description: "Review open pull requests",
      execute: (ctx, outputBox) => {
        spawnAction(["review"], ctx, outputBox);
      },
    },
    {
      label: "Run Executor (dry run)",
      description: "Preview executor without making changes",
      execute: (ctx, outputBox) => {
        spawnAction(["run", "--dry-run"], ctx, outputBox);
      },
    },
    {
      label: "Run Reviewer (dry run)",
      description: "Preview reviewer without making changes",
      execute: (ctx, outputBox) => {
        spawnAction(["review", "--dry-run"], ctx, outputBox);
      },
    },
    {
      label: "Install Cron",
      description: "Add crontab entries for automated execution",
      execute: (ctx, outputBox) => {
        const result = performInstall(ctx.projectDir, ctx.config);
        if (result.success) {
          outputBox.setContent(
            `{green-fg}Cron installed successfully!{/green-fg}\n\n` +
            `Entries added:\n${result.entries.map((e) => `  ${e}`).join("\n")}`
          );
          ctx.showMessage(`Installed ${result.entries.length} cron entries`, "success");
        } else {
          outputBox.setContent(`{red-fg}Install failed: ${result.error}{/red-fg}`);
          ctx.showMessage("Install failed", "error");
        }
        const snap = ctx.refreshSnapshot();
        ctx.snapshot = snap;
        ctx.screen.render();
      },
    },
    {
      label: "Uninstall Cron",
      description: "Remove crontab entries (keeps logs)",
      execute: (ctx, outputBox) => {
        const result = performUninstall(ctx.projectDir, { keepLogs: true });
        if (result.success) {
          outputBox.setContent(
            `{green-fg}Cron uninstalled.{/green-fg}\n` +
            `Removed ${result.removedCount} entries.`
          );
          ctx.showMessage(`Removed ${result.removedCount} entries`, "success");
        } else {
          outputBox.setContent(`{red-fg}Uninstall failed: ${result.error}{/red-fg}`);
          ctx.showMessage("Uninstall failed", "error");
        }
        const snap = ctx.refreshSnapshot();
        ctx.snapshot = snap;
        ctx.screen.render();
      },
    },
    {
      label: "Run Doctor",
      description: "Validate config and system health",
      execute: (ctx, outputBox) => {
        spawnAction(["doctor"], ctx, outputBox);
      },
    },
    {
      label: "View Status",
      description: "Show detailed status output",
      execute: (ctx, outputBox) => {
        spawnAction(["status", "--verbose"], ctx, outputBox);
      },
    },
  ];
}

/**
 * Create the Actions tab
 */
export function createActionsTab(): ITab {
  const container = blessed.box({
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
    hidden: true,
  });

  const actions = buildActions();

  const actionList = blessed.list({
    top: 0,
    left: 0,
    width: "100%",
    height: "40%",
    border: { type: "line" },
    label: "[ Actions ]",
    tags: true,
    scrollable: true,
    alwaysScroll: true,
    style: {
      border: { fg: "cyan" },
      selected: { bg: "blue", fg: "white" },
      item: { fg: "white" },
    },
    keys: true,
    vi: false,
    interactive: true,
  } as blessed.Widgets.ListOptions<blessed.Widgets.ListElementStyle>);

  actionList.setItems(
    actions.map((a) => ` ${a.label}  {#888888-fg}${a.description}{/#888888-fg}`) as unknown as string[]
  );

  const outputBox = blessed.box({
    top: "40%",
    left: 0,
    width: "100%",
    height: "60%",
    border: { type: "line" },
    label: "[ Output ]",
    tags: true,
    scrollable: true,
    alwaysScroll: true,
    scrollbar: { style: { bg: "blue" } },
    style: { border: { fg: "white" } },
    content: "Select an action and press Enter to execute.",
  });

  container.append(actionList);
  container.append(outputBox);

  let runningProcess: ChildProcess | null = null;
  let activeKeyHandlers: Array<[string[], (...args: unknown[]) => void]> = [];
  let activeCtx: ITabContext | null = null;

  function bindKeys(ctx: ITabContext) {
    const handlers: Array<[string[], (...args: unknown[]) => void]> = [
      [["enter"], () => {
        const idx = (actionList as unknown as { selected: number }).selected;
        if (idx === undefined || idx < 0 || idx >= actions.length) return;
        if (runningProcess) {
          ctx.showMessage("An action is already running. Press c to cancel.", "info");
          return;
        }
        actions[idx].execute(ctx, outputBox);
      }],
      [["c"], () => {
        if (runningProcess) {
          runningProcess.kill("SIGTERM");
          runningProcess = null;
          ctx.showMessage("Action cancelled", "info");
        }
      }],
    ];

    for (const [keys, handler] of handlers) {
      ctx.screen.key(keys, handler);
    }
    activeKeyHandlers = handlers;
  }

  function unbindKeys(ctx: ITabContext) {
    for (const [keys, handler] of activeKeyHandlers) {
      for (const key of keys) {
        ctx.screen.unkey(key, handler);
      }
    }
    activeKeyHandlers = [];
  }

  return {
    name: "Actions",
    container,
    activate(ctx: ITabContext) {
      ctx.setFooter(" \u2191\u2193:Navigate  Enter:Execute  c:Cancel  q:Quit");
      actionList.focus();
      activeCtx = ctx;
      bindKeys(ctx);
      ctx.screen.render();
    },
    deactivate() {
      if (activeCtx) {
        unbindKeys(activeCtx);
        activeCtx = null;
      }
    },
    refresh(_ctx: ITabContext) {
      // No auto-refresh needed for actions
    },
    destroy() {
      if (runningProcess) {
        runningProcess.kill("SIGTERM");
        runningProcess = null;
      }
    },
  };
}
