/**
 * Dashboard command for Night Watch CLI
 * Tabbed TUI with Status, Config, Schedules, Actions, and Logs tabs
 */

import { Command } from 'commander';
import blessed from 'blessed';
import { fetchStatusSnapshot, loadConfig } from '@night-watch/core';
import { ITab, ITabContext } from './dashboard/types.js';
import { createStatusTab } from './dashboard/tab-status.js';
import { createConfigTab } from './dashboard/tab-config.js';
import { createSchedulesTab } from './dashboard/tab-schedules.js';
import { createActionsTab } from './dashboard/tab-actions.js';
import { createLogsTab } from './dashboard/tab-logs.js';

// Re-export render functions for backward compatibility (used by tests)
export {
  renderPrdPane,
  renderProcessPane,
  renderPrPane,
  renderLogPane,
} from './dashboard/tab-status.js';

export interface IDashboardOptions {
  interval: string; // refresh interval in seconds
}

/**
 * Show a temporary flash message overlay
 */
function showMessage(
  screen: blessed.Widgets.Screen,
  text: string,
  type: 'success' | 'error' | 'info',
  durationMs: number = 2000,
): void {
  const colors: Record<string, string> = { success: 'green', error: 'red', info: 'cyan' };
  const msgBox = blessed.box({
    top: 'center',
    left: 'center',
    width: Math.min(60, text.length + 6),
    height: 3,
    content: `{center}${text}{/center}`,
    tags: true,
    border: { type: 'line' },
    style: { border: { fg: colors[type] }, fg: 'white', bg: 'black' },
  });
  screen.append(msgBox);
  screen.render();
  setTimeout(() => {
    msgBox.destroy();
    screen.render();
  }, durationMs);
}

export function dashboardCommand(program: Command): void {
  program
    .command('dashboard')
    .description('Live terminal dashboard [experimental]')
    .option('--interval <seconds>', 'Refresh interval in seconds', '10')
    .action(async (options: IDashboardOptions) => {
      const projectDir = process.cwd();
      let config = loadConfig(projectDir);

      // Create blessed screen
      const screen = blessed.screen({
        smartCSR: true,
        title: 'Night Watch Dashboard',
        fullUnicode: true,
      });

      // --- Layout ---
      // Header: row 0, height 1
      const headerBox = blessed.box({
        top: 0,
        left: 0,
        width: '100%',
        height: 1,
        content: '{center}Night Watch Dashboard{/center}',
        tags: true,
        style: { fg: 'cyan', bold: true },
      });

      // Tab bar: row 1, height 1
      const tabBar = blessed.box({
        top: 1,
        left: 0,
        width: '100%',
        height: 1,
        tags: true,
        style: { fg: 'white', bg: 'black' },
        content: '',
      });

      // Content area: rows 2..n-2
      const contentArea = blessed.box({
        top: 2,
        left: 0,
        width: '100%',
        height: '100%-4',
      });

      // Footer: bottom row
      const footerBox = blessed.box({
        bottom: 0,
        left: 0,
        width: '100%',
        height: 1,
        content: '',
        tags: true,
        style: { fg: 'white', bg: 'blue' },
      });

      screen.append(headerBox);
      screen.append(tabBar);
      screen.append(contentArea);
      screen.append(footerBox);

      // --- Create tabs ---
      const tabs: ITab[] = [
        createStatusTab(),
        createConfigTab(),
        createSchedulesTab(),
        createActionsTab(),
        createLogsTab(),
      ];

      // Append all tab containers to content area
      for (const tab of tabs) {
        contentArea.append(tab.container);
      }

      // --- State ---
      let activeTabIndex = 0;
      let isEditing = false;
      let snapshot = fetchStatusSnapshot(projectDir, config);

      // --- Tab context ---
      const ctx: ITabContext = {
        screen,
        projectDir,
        config,
        snapshot,
        reloadConfig: () => {
          config = loadConfig(projectDir);
          ctx.config = config;
          return config;
        },
        refreshSnapshot: () => {
          snapshot = fetchStatusSnapshot(projectDir, config);
          ctx.snapshot = snapshot;
          return snapshot;
        },
        setFooter: (text: string) => {
          footerBox.setContent(text);
        },
        showMessage: (text: string, type: 'success' | 'error' | 'info', durationMs?: number) => {
          showMessage(screen, text, type, durationMs);
        },
        setEditing: (editing: boolean) => {
          isEditing = editing;
        },
      };

      // --- Tab bar rendering ---
      function renderTabBar() {
        const parts = tabs.map((tab, idx) => {
          const num = idx + 1;
          if (idx === activeTabIndex) {
            return `{white-bg}{black-fg} ${num}:${tab.name} {/black-fg}{/white-bg}`;
          }
          return ` {blue-fg}${num}:${tab.name}{/blue-fg} `;
        });
        tabBar.setContent(parts.join(''));
      }

      // --- Tab switching ---
      function switchTab(newIndex: number) {
        if (newIndex === activeTabIndex) return;
        if (newIndex < 0 || newIndex >= tabs.length) return;
        if (isEditing) return; // Don't switch while editing

        // Deactivate current tab
        tabs[activeTabIndex].deactivate();
        tabs[activeTabIndex].container.hide();

        // Activate new tab
        activeTabIndex = newIndex;
        tabs[activeTabIndex].container.show();
        renderTabBar();
        tabs[activeTabIndex].activate(ctx);
        screen.render();
      }

      // --- Header ---
      const intervalSeconds = parseInt(options.interval, 10) || 10;
      let countdown = intervalSeconds;

      function updateHeader() {
        headerBox.setContent(
          `{center}Night Watch: ${snapshot.projectName} | Provider: ${config.provider} | Last: ${snapshot.timestamp.toLocaleTimeString()} | Next: ${countdown}s{/center}`,
        );
      }

      // --- Refresh ---
      function refreshData() {
        config = loadConfig(projectDir);
        ctx.config = config;
        snapshot = fetchStatusSnapshot(projectDir, config);
        ctx.snapshot = snapshot;
        countdown = intervalSeconds;
        updateHeader();
        tabs[activeTabIndex].refresh(ctx);
        screen.render();
      }

      // --- Timer ---
      const timer = setInterval(() => {
        countdown--;
        updateHeader();
        screen.render();
        if (countdown <= 0) {
          refreshData();
        }
      }, 1000);

      // --- Global keyboard handlers ---
      screen.key(['q', 'escape'], () => {
        if (isEditing) return;
        clearInterval(timer);
        for (const tab of tabs) {
          tab.destroy();
        }
        screen.destroy();
        process.exit(0);
      });

      screen.key(['r'], () => {
        if (isEditing) return;
        refreshData();
      });

      // Tab switching via number keys
      for (let i = 0; i < tabs.length; i++) {
        const idx = i;
        screen.key([String(i + 1)], () => {
          if (isEditing) return;
          switchTab(idx);
        });
      }

      // Tab cycling is handled per-tab (Status tab uses Tab for pane focus)
      // Shift+Tab always cycles tabs
      screen.key(['S-tab'], () => {
        if (isEditing) return;
        const newIndex = (activeTabIndex - 1 + tabs.length) % tabs.length;
        switchTab(newIndex);
      });

      // --- Initial render ---
      // Show only the first tab's container
      for (let i = 0; i < tabs.length; i++) {
        if (i === 0) {
          tabs[i].container.show();
        } else {
          tabs[i].container.hide();
        }
      }

      renderTabBar();
      updateHeader();
      tabs[activeTabIndex].activate(ctx);
      screen.render();
    });
}
