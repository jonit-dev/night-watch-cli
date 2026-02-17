/**
 * Dashboard command for Night Watch CLI
 * Renders a full-screen TUI with 4 panes using blessed
 */

import { Command } from "commander";
import blessed from "blessed";
import { loadConfig } from "../config.js";
import {
  IStatusSnapshot,
  fetchStatusSnapshot,
  getLastLogLines,
} from "../utils/status-data.js";
import * as fs from "fs";

export interface IDashboardOptions {
  interval: string; // refresh interval in seconds
}

/**
 * Render the PRD Queue pane content from snapshot data.
 * Each PRD gets a colored status indicator and optional dependency list.
 */
export function renderPrdPane(prds: IStatusSnapshot["prds"]): string {
  if (prds.length === 0) {
    return "No PRD files found";
  }

  const lines: string[] = [];
  for (const prd of prds) {
    let indicator: string;
    switch (prd.status) {
      case "ready":
        indicator = "{green-fg}\u25cf{/green-fg}";
        break;
      case "blocked":
        indicator = "{yellow-fg}\u25cf{/yellow-fg}";
        break;
      case "in-progress":
        indicator = "{cyan-fg}\u25cf{/cyan-fg}";
        break;
      case "done":
        indicator = "{#888888-fg}\u25cf{/#888888-fg}";
        break;
    }

    let line = `${indicator} ${prd.name}`;
    if (prd.dependencies.length > 0) {
      line += ` (deps: ${prd.dependencies.join(", ")})`;
    }
    lines.push(line);
  }

  return lines.join("\n");
}

/**
 * Render the Process Status pane content from snapshot data.
 */
export function renderProcessPane(
  processes: IStatusSnapshot["processes"]
): string {
  const lines: string[] = [];
  for (const proc of processes) {
    if (proc.running) {
      lines.push(
        `{green-fg}\u25cf{/green-fg} ${proc.name}: Running (PID: ${proc.pid})`
      );
    } else {
      lines.push(`{white-fg}\u25cb{/white-fg} ${proc.name}: Not running`);
    }
  }
  return lines.join("\n");
}

/**
 * Render the PR Status pane content from snapshot data.
 */
export function renderPrPane(prs: IStatusSnapshot["prs"]): string {
  if (prs.length === 0) {
    return "No matching pull requests";
  }

  const lines: string[] = [];
  for (const pr of prs) {
    let ciIndicator: string;
    switch (pr.ciStatus) {
      case "pass":
        ciIndicator = "{green-fg}\u25cf{/green-fg}";
        break;
      case "fail":
        ciIndicator = "{red-fg}\u25cf{/red-fg}";
        break;
      case "pending":
        ciIndicator = "{yellow-fg}\u25cf{/yellow-fg}";
        break;
      default:
        ciIndicator = "{white-fg}\u25cf{/white-fg}";
        break;
    }

    const reviewLabel = pr.reviewScore !== null ? ` [Review: ${pr.reviewScore}%]` : "";
    lines.push(`${ciIndicator} #${pr.number} ${pr.title}${reviewLabel}`);
    lines.push(`    ${pr.branch}`);
  }
  return lines.join("\n");
}

/**
 * Render the Log Tail pane content from snapshot data.
 * Shows the last 20 lines from the most recent log file.
 */
export function renderLogPane(
  projectDir: string,
  logs: IStatusSnapshot["logs"]
): string {
  // Find the most recent log file that exists
  const existingLogs = logs.filter((l) => l.exists);

  if (existingLogs.length === 0) {
    return "No log files found";
  }

  // Pick the log with the most recent modification time
  let newestLog = existingLogs[0];
  let newestMtime = 0;
  for (const log of existingLogs) {
    try {
      const stat = fs.statSync(log.path);
      if (stat.mtimeMs > newestMtime) {
        newestMtime = stat.mtimeMs;
        newestLog = log;
      }
    } catch {
      // Ignore stat errors
    }
  }

  // Read the last 20 lines directly for the dashboard
  const lines = getLastLogLines(newestLog.path, 20);

  if (lines.length === 0) {
    return `${newestLog.name}.log: (empty)`;
  }

  return `--- ${newestLog.name}.log ---\n${lines.join("\n")}`;
}

export function dashboardCommand(program: Command): void {
  program
    .command("dashboard")
    .description("Live terminal dashboard")
    .option("--interval <seconds>", "Refresh interval in seconds", "10")
    .action(async (options: IDashboardOptions) => {
      const projectDir = process.cwd();
      const config = loadConfig(projectDir);

      // Create blessed screen
      const screen = blessed.screen({
        smartCSR: true,
        title: "Night Watch Dashboard",
        fullUnicode: true,
      });

      // Create header (full width, 3 rows)
      const headerBox = blessed.box({
        top: 0,
        left: 0,
        width: "100%",
        height: 3,
        content: "{center}Night Watch Dashboard{/center}",
        tags: true,
        style: { fg: "cyan", bold: true },
      });

      // Create 4 panes:
      // Top-left: PRD Queue (50% width, 40% height)
      const prdPane = blessed.box({
        top: 3,
        left: 0,
        width: "50%",
        height: "40%",
        label: "[ PRD Queue ]",
        border: { type: "line" },
        scrollable: true,
        alwaysScroll: true,
        scrollbar: { style: { bg: "blue" } },
        style: { border: { fg: "white" } },
        tags: true,
        content: "Loading...",
      });

      // Top-right: Process Status (50% width, 40% height)
      const processPane = blessed.box({
        top: 3,
        left: "50%",
        width: "50%",
        height: "40%",
        label: "[ Processes ]",
        border: { type: "line" },
        scrollable: true,
        alwaysScroll: true,
        scrollbar: { style: { bg: "blue" } },
        style: { border: { fg: "white" } },
        tags: true,
        content: "Loading...",
      });

      // Bottom-left: PR Status (50% width, 30% height)
      const prPane = blessed.box({
        top: "43%",
        left: 0,
        width: "50%",
        height: "30%",
        label: "[ Pull Requests ]",
        border: { type: "line" },
        scrollable: true,
        alwaysScroll: true,
        scrollbar: { style: { bg: "blue" } },
        style: { border: { fg: "white" } },
        tags: true,
        content: "Loading...",
      });

      // Bottom-right: Log Tail (50% width, 30% height)
      const logPane = blessed.box({
        top: "43%",
        left: "50%",
        width: "50%",
        height: "30%",
        label: "[ Logs ]",
        border: { type: "line" },
        scrollable: true,
        alwaysScroll: true,
        scrollbar: { style: { bg: "blue" } },
        style: { border: { fg: "white" } },
        tags: true,
        content: "Loading...",
      });

      // Footer (full width, 1 row)
      const footerBox = blessed.box({
        bottom: 0,
        left: 0,
        width: "100%",
        height: 1,
        content: " q:Quit  Tab:Focus  r:Refresh  \u2191\u2193:Scroll",
        style: { fg: "white", bg: "blue" },
      });

      // Append all elements
      screen.append(headerBox);
      screen.append(prdPane);
      screen.append(processPane);
      screen.append(prPane);
      screen.append(logPane);
      screen.append(footerBox);

      // Pane navigation
      const panes = [prdPane, processPane, prPane, logPane];
      let focusedPaneIndex = 0;

      const updatePaneFocus = () => {
        panes.forEach((pane, index) => {
          if (index === focusedPaneIndex) {
            pane.style.border = { fg: "cyan" };
            pane.focus();
          } else {
            pane.style.border = { fg: "white" };
          }
        });
        screen.render();
      };

      // Fetch initial data
      let snapshot = fetchStatusSnapshot(projectDir, config);

      // Render all panes from snapshot data
      const renderPanes = (snap: IStatusSnapshot) => {
        prdPane.setContent(renderPrdPane(snap.prds));
        processPane.setContent(renderProcessPane(snap.processes));
        prPane.setContent(renderPrPane(snap.prs));
        logPane.setContent(renderLogPane(snap.projectDir, snap.logs));
        // Auto-scroll log pane to bottom
        logPane.setScrollPerc(100);
      };

      // Auto-refresh setup
      const intervalSeconds = parseInt(options.interval, 10) || 10;
      let countdown = intervalSeconds;

      const updateHeader = () => {
        headerBox.setContent(
          `{center}Night Watch: ${snapshot.projectName} | Provider: ${config.provider} | Last refresh: ${snapshot.timestamp.toLocaleTimeString()} | Next: ${countdown}s{/center}`
        );
      };

      const refreshData = () => {
        snapshot = fetchStatusSnapshot(projectDir, config);
        renderPanes(snapshot);
        countdown = intervalSeconds;
        updateHeader();
        screen.render();
      };

      const timer = setInterval(() => {
        countdown--;
        updateHeader();
        screen.render();
        if (countdown <= 0) {
          refreshData();
        }
      }, 1000);

      // Initial render
      renderPanes(snapshot);
      updateHeader();

      // Wire keyboard handlers
      screen.key(["q", "escape"], () => {
        clearInterval(timer);
        screen.destroy();
        process.exit(0);
      });

      screen.key(["r"], () => {
        refreshData();
      });

      screen.key(["tab"], () => {
        focusedPaneIndex = (focusedPaneIndex + 1) % panes.length;
        updatePaneFocus();
      });

      screen.key(["up"], () => {
        panes[focusedPaneIndex].scroll(-1);
        screen.render();
      });

      screen.key(["down"], () => {
        panes[focusedPaneIndex].scroll(1);
        screen.render();
      });

      // Initial focus highlight
      updatePaneFocus();

      // Render
      screen.render();
    });
}
