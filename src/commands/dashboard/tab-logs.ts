/**
 * Logs tab for the dashboard TUI
 * Full-screen log viewer with file switching between executor and reviewer
 */

import blessed from "blessed";
import { getLastLogLines } from "@/utils/status-data.js";
import { ITab, ITabContext } from "./types.js";
import * as fs from "fs";
import * as path from "path";

const LOG_NAMES = ["executor", "reviewer"] as const;
const LOG_LINES = 200;

/**
 * Create the Logs tab
 */
export function createLogsTab(): ITab {
  const container = blessed.box({
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
    hidden: true,
  });

  const selectorBar = blessed.box({
    top: 0,
    left: 0,
    width: "100%",
    height: 1,
    tags: true,
    style: { fg: "white" },
    content: "",
  });

  const logContent = blessed.box({
    top: 1,
    left: 0,
    width: "100%",
    height: "100%-1",
    border: { type: "line" },
    label: "[ Log Content ]",
    tags: true,
    scrollable: true,
    alwaysScroll: true,
    scrollbar: { style: { bg: "blue" } },
    style: { border: { fg: "cyan" } },
    content: "Loading...",
  });

  container.append(selectorBar);
  container.append(logContent);

  let selectedLogIndex = 0;
  let userScrolled = false;
  let activeKeyHandlers: Array<[string[], (...args: unknown[]) => void]> = [];
  let activeCtx: ITabContext | null = null;

  function getLogPath(projectDir: string, logName: string): string {
    return path.join(projectDir, "logs", `${logName}.log`);
  }

  function updateSelector() {
    const tabs = LOG_NAMES.map((name, idx) => {
      if (idx === selectedLogIndex) {
        return `{white-bg}{black-fg} ${name}.log {/black-fg}{/white-bg}`;
      }
      return ` {blue-fg}${name}.log{/blue-fg} `;
    });
    selectorBar.setContent(" " + tabs.join("  "));
  }

  function loadLog(ctx: ITabContext) {
    const logName = LOG_NAMES[selectedLogIndex];
    const logPath = getLogPath(ctx.projectDir, logName);

    if (!fs.existsSync(logPath)) {
      logContent.setContent(`{yellow-fg}No ${logName}.log file found{/yellow-fg}\n\nLog will appear here once the ${logName} runs.`);
      logContent.setLabel(`[ ${logName}.log - not found ]`);
      return;
    }

    try {
      const stat = fs.statSync(logPath);
      const sizeKB = (stat.size / 1024).toFixed(1);
      logContent.setLabel(`[ ${logName}.log - ${sizeKB} KB ]`);
    } catch {
      logContent.setLabel(`[ ${logName}.log ]`);
    }

    const lines = getLastLogLines(logPath, LOG_LINES);
    if (lines.length === 0) {
      logContent.setContent(`${logName}.log: (empty)`);
    } else {
      logContent.setContent(lines.join("\n"));
    }

    if (!userScrolled) {
      logContent.setScrollPerc(100);
    }
  }

  function switchLog(ctx: ITabContext, index: number) {
    selectedLogIndex = index;
    userScrolled = false;
    updateSelector();
    loadLog(ctx);
    ctx.screen.render();
  }

  function bindKeys(ctx: ITabContext) {
    const handlers: Array<[string[], (...args: unknown[]) => void]> = [
      [["left"], () => {
        if (selectedLogIndex > 0) {
          switchLog(ctx, selectedLogIndex - 1);
        }
      }],
      [["right"], () => {
        if (selectedLogIndex < LOG_NAMES.length - 1) {
          switchLog(ctx, selectedLogIndex + 1);
        }
      }],
      [["up"], () => {
        userScrolled = true;
        logContent.scroll(-1);
        ctx.screen.render();
      }],
      [["down"], () => {
        logContent.scroll(1);
        ctx.screen.render();
      }],
      [["pageup"], () => {
        userScrolled = true;
        logContent.scroll(-(logContent.height as number - 2));
        ctx.screen.render();
      }],
      [["pagedown"], () => {
        logContent.scroll(logContent.height as number - 2);
        ctx.screen.render();
      }],
      [["g"], () => {
        userScrolled = true;
        logContent.scrollTo(0);
        ctx.screen.render();
      }],
      [["S-g"], () => {
        userScrolled = false;
        logContent.setScrollPerc(100);
        ctx.screen.render();
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
    name: "Logs",
    container,
    activate(ctx: ITabContext) {
      ctx.setFooter(" \u2190\u2191:Switch Log  \u2191\u2193:Scroll  g:Top  G:Bottom  PgUp/PgDn  q:Quit");
      updateSelector();
      loadLog(ctx);
      logContent.focus();
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
    refresh(ctx: ITabContext) {
      loadLog(ctx);
      ctx.screen.render();
    },
    destroy() {
      // Nothing to clean up
    },
  };
}
