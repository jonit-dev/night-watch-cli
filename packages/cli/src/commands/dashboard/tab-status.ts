/**
 * Status tab for the dashboard TUI
 * Shows the original 4-pane layout: PRD Queue, Processes, Pull Requests, Logs
 */

import blessed from 'blessed';
import { IStatusSnapshot, getLastLogLines, saveConfig } from '@night-watch/core';
import { ITab, ITabContext } from './types.js';
import * as fs from 'fs';

/**
 * Sort PRDs by priority order. PRDs in the priority list come first (in that order),
 * remaining PRDs follow alphabetically.
 */
export function sortPrdsByPriority(
  prds: IStatusSnapshot['prds'],
  priority: string[],
): IStatusSnapshot['prds'] {
  if (priority.length === 0) return prds;

  const priorityMap = new Map<string, number>();
  for (let i = 0; i < priority.length; i++) {
    priorityMap.set(priority[i], i);
  }

  return [...prds].sort((a, b) => {
    const aIdx = priorityMap.has(a.name) ? priorityMap.get(a.name)! : Infinity;
    const bIdx = priorityMap.has(b.name) ? priorityMap.get(b.name)! : Infinity;
    if (aIdx !== bIdx) return aIdx - bIdx;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Render the PRD Queue pane content from snapshot data.
 */
export function renderPrdPane(prds: IStatusSnapshot['prds'], priority?: string[]): string {
  if (prds.length === 0) {
    return 'No PRD files found';
  }

  const sorted = priority ? sortPrdsByPriority(prds, priority) : prds;

  const lines: string[] = [];
  for (const prd of sorted) {
    let indicator: string;
    switch (prd.status) {
      case 'ready':
        indicator = '{green-fg}\u25cf{/green-fg}';
        break;
      case 'blocked':
        indicator = '{yellow-fg}\u25cf{/yellow-fg}';
        break;
      case 'in-progress':
        indicator = '{cyan-fg}\u25cf{/cyan-fg}';
        break;
      case 'pending-review':
        indicator = '{yellow-fg}\u25cf{/yellow-fg}';
        break;
      case 'done':
        indicator = '{#888888-fg}\u25cf{/#888888-fg}';
        break;
      default:
        indicator = '{white-fg}\u25cf{/white-fg}';
    }

    let line = `${indicator} ${prd.name}`;
    if (prd.dependencies.length > 0) {
      line += ` (deps: ${prd.dependencies.join(', ')})`;
    }
    lines.push(line);
  }

  return lines.join('\n');
}

/**
 * Render the Process Status pane content from snapshot data.
 */
export function renderProcessPane(processes: IStatusSnapshot['processes']): string {
  const lines: string[] = [];
  for (const proc of processes) {
    if (proc.running) {
      lines.push(`{green-fg}\u25cf{/green-fg} ${proc.name}: Running (PID: ${proc.pid})`);
    } else {
      lines.push(`{white-fg}\u25cb{/white-fg} ${proc.name}: Not running`);
    }
  }
  return lines.join('\n');
}

/**
 * Render the PR Status pane content from snapshot data.
 */
export function renderPrPane(prs: IStatusSnapshot['prs']): string {
  if (prs.length === 0) {
    return 'No matching pull requests';
  }

  const lines: string[] = [];
  for (const pr of prs) {
    let ciIndicator: string;
    switch (pr.ciStatus) {
      case 'pass':
        ciIndicator = '{green-fg}\u25cf{/green-fg}';
        break;
      case 'fail':
        ciIndicator = '{red-fg}\u25cf{/red-fg}';
        break;
      case 'pending':
        ciIndicator = '{yellow-fg}\u25cf{/yellow-fg}';
        break;
      default:
        ciIndicator = '{white-fg}\u25cf{/white-fg}';
        break;
    }

    const reviewLabel = pr.reviewScore !== null ? ` [Review: ${pr.reviewScore}%]` : '';
    lines.push(`${ciIndicator} #${pr.number} ${pr.title}${reviewLabel}`);
    lines.push(`    ${pr.branch}`);
  }
  return lines.join('\n');
}

/**
 * Render the Log Tail pane content from snapshot data.
 */
export function renderLogPane(projectDir: string, logs: IStatusSnapshot['logs']): string {
  const existingLogs = logs.filter((l) => l.exists);

  if (existingLogs.length === 0) {
    return 'No log files found';
  }

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

  const lines = getLastLogLines(newestLog.path, 20);

  if (lines.length === 0) {
    return `${newestLog.name}.log: (empty)`;
  }

  return `--- ${newestLog.name}.log ---\n${lines.join('\n')}`;
}

/**
 * Create the Status tab with 4-pane layout
 */
export function createStatusTab(): ITab {
  const container = blessed.box({
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    hidden: true,
  });

  const prdPane = blessed.box({
    top: 0,
    left: 0,
    width: '50%',
    height: '50%',
    label: '[ PRD Queue ]',
    border: { type: 'line' },
    scrollable: true,
    alwaysScroll: true,
    scrollbar: { style: { bg: 'blue' } },
    style: { border: { fg: 'white' } },
    tags: true,
    content: 'Loading...',
  });

  const processPane = blessed.box({
    top: 0,
    left: '50%',
    width: '50%',
    height: '50%',
    label: '[ Processes ]',
    border: { type: 'line' },
    scrollable: true,
    alwaysScroll: true,
    scrollbar: { style: { bg: 'blue' } },
    style: { border: { fg: 'white' } },
    tags: true,
    content: 'Loading...',
  });

  const prPane = blessed.box({
    top: '50%',
    left: 0,
    width: '50%',
    height: '50%',
    label: '[ Pull Requests ]',
    border: { type: 'line' },
    scrollable: true,
    alwaysScroll: true,
    scrollbar: { style: { bg: 'blue' } },
    style: { border: { fg: 'white' } },
    tags: true,
    content: 'Loading...',
  });

  const logPane = blessed.box({
    top: '50%',
    left: '50%',
    width: '50%',
    height: '50%',
    label: '[ Logs ]',
    border: { type: 'line' },
    scrollable: true,
    alwaysScroll: true,
    scrollbar: { style: { bg: 'blue' } },
    style: { border: { fg: 'white' } },
    tags: true,
    content: 'Loading...',
  });

  container.append(prdPane);
  container.append(processPane);
  container.append(prPane);
  container.append(logPane);

  const panes = [prdPane, processPane, prPane, logPane];
  let focusedPaneIndex = 0;
  let keyHandlers: Array<{ key: string[]; handler: () => void }> = [];
  let activeCtx: ITabContext | null = null;

  // Reorder mode state
  let reorderMode = false;
  let reorderList: string[] = [];
  let reorderIndex = 0;
  let reorderKeyHandlers: Array<{ key: string[]; handler: () => void }> = [];

  function updatePaneFocus(screen: blessed.Widgets.Screen) {
    panes.forEach((pane, index) => {
      if (index === focusedPaneIndex) {
        pane.style.border = { fg: reorderMode && index === 0 ? 'yellow' : 'cyan' };
        pane.focus();
      } else {
        pane.style.border = { fg: 'white' };
      }
    });
    screen.render();
  }

  function renderPanes(ctx: ITabContext) {
    const snap = ctx.snapshot;
    prdPane.setContent(renderPrdPane(snap.prds, ctx.config.prdPriority));
    processPane.setContent(renderProcessPane(snap.processes));
    prPane.setContent(renderPrPane(snap.prs));
    logPane.setContent(renderLogPane(snap.projectDir, snap.logs));
    logPane.setScrollPerc(100);
  }

  function renderReorderList(screen: blessed.Widgets.Screen) {
    const lines = reorderList.map((name, idx) => {
      const marker = idx === reorderIndex ? '{bold}{cyan-fg}> ' : '  ';
      const end = idx === reorderIndex ? '{/cyan-fg}{/bold}' : '';
      return `${marker}${idx + 1}. ${name}${end}`;
    });
    prdPane.setContent(lines.join('\n'));
    screen.render();
  }

  function enterReorderMode(ctx: ITabContext) {
    // Only reorder non-done PRDs
    const nonDone = ctx.snapshot.prds.filter((p) => p.status !== 'done');
    if (nonDone.length === 0) {
      ctx.showMessage('No PRDs to reorder', 'info');
      return;
    }

    // Start with current priority order
    const sorted = sortPrdsByPriority(nonDone, ctx.config.prdPriority);
    reorderList = sorted.map((p) => p.name);
    reorderIndex = 0;
    reorderMode = true;

    // Switch focus to PRD pane
    focusedPaneIndex = 0;
    prdPane.setLabel('[ PRD Queue - Reordering ]');
    prdPane.style.border = { fg: 'yellow' };

    ctx.setEditing(true);
    ctx.setFooter(' \u2191\u2193:Navigate  K:Move Up  J:Move Down  Enter:Save  Esc:Cancel');

    renderReorderList(ctx.screen);

    const handlers: Array<{ key: string[]; handler: () => void }> = [
      {
        key: ['up'],
        handler: () => {
          if (reorderIndex > 0) reorderIndex--;
          renderReorderList(ctx.screen);
        },
      },
      {
        key: ['down'],
        handler: () => {
          if (reorderIndex < reorderList.length - 1) reorderIndex++;
          renderReorderList(ctx.screen);
        },
      },
      {
        key: ['S-k'],
        handler: () => {
          if (reorderIndex > 0) {
            [reorderList[reorderIndex - 1], reorderList[reorderIndex]] = [
              reorderList[reorderIndex],
              reorderList[reorderIndex - 1],
            ];
            reorderIndex--;
            renderReorderList(ctx.screen);
          }
        },
      },
      {
        key: ['S-j'],
        handler: () => {
          if (reorderIndex < reorderList.length - 1) {
            [reorderList[reorderIndex], reorderList[reorderIndex + 1]] = [
              reorderList[reorderIndex + 1],
              reorderList[reorderIndex],
            ];
            reorderIndex++;
            renderReorderList(ctx.screen);
          }
        },
      },
      {
        key: ['enter'],
        handler: () => {
          // Save priority to config
          const result = saveConfig(ctx.projectDir, { prdPriority: reorderList });
          if (result.success) {
            ctx.config = ctx.reloadConfig();
            ctx.showMessage('PRD priority saved', 'success');
          } else {
            ctx.showMessage(`Save failed: ${result.error}`, 'error');
          }
          exitReorderMode(ctx);
        },
      },
      {
        key: ['escape'],
        handler: () => {
          exitReorderMode(ctx);
        },
      },
    ];

    for (const { key, handler } of handlers) {
      ctx.screen.key(key, handler);
    }
    reorderKeyHandlers = handlers;
  }

  function exitReorderMode(ctx: ITabContext) {
    reorderMode = false;
    ctx.setEditing(false);

    // Unbind reorder keys
    for (const { key, handler } of reorderKeyHandlers) {
      for (const k of key) {
        ctx.screen.unkey(k, handler);
      }
    }
    reorderKeyHandlers = [];

    prdPane.setLabel('[ PRD Queue ]');
    ctx.setFooter(' Tab:Focus  \u2191\u2193:Scroll  p:Priority  r:Refresh  q:Quit');
    renderPanes(ctx);
    updatePaneFocus(ctx.screen);
  }

  return {
    name: 'Status',
    container,
    activate(ctx: ITabContext) {
      ctx.setFooter(' Tab:Focus  \u2191\u2193:Scroll  p:Priority  r:Refresh  q:Quit');
      renderPanes(ctx);
      updatePaneFocus(ctx.screen);

      keyHandlers = [
        {
          key: ['tab'],
          handler: () => {
            focusedPaneIndex = (focusedPaneIndex + 1) % panes.length;
            updatePaneFocus(ctx.screen);
          },
        },
        {
          key: ['up'],
          handler: () => {
            panes[focusedPaneIndex].scroll(-1);
            ctx.screen.render();
          },
        },
        {
          key: ['down'],
          handler: () => {
            panes[focusedPaneIndex].scroll(1);
            ctx.screen.render();
          },
        },
        {
          key: ['p'],
          handler: () => {
            if (!reorderMode && focusedPaneIndex === 0) {
              enterReorderMode(ctx);
            }
          },
        },
      ];

      for (const { key, handler } of keyHandlers) {
        ctx.screen.key(key, handler);
      }
      activeCtx = ctx;
    },
    deactivate() {
      if (activeCtx) {
        for (const { key, handler } of keyHandlers) {
          for (const k of key) {
            activeCtx.screen.unkey(k, handler);
          }
        }
        // Clean up reorder mode if active
        for (const { key, handler } of reorderKeyHandlers) {
          for (const k of key) {
            activeCtx.screen.unkey(k, handler);
          }
        }
        reorderKeyHandlers = [];
        reorderMode = false;
        activeCtx = null;
      }
      keyHandlers = [];
    },
    refresh(ctx: ITabContext) {
      if (!reorderMode) {
        renderPanes(ctx);
        ctx.screen.render();
      }
    },
    destroy() {
      // Nothing to clean up
    },
  };
}
