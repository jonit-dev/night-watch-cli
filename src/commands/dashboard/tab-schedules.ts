/**
 * Schedules tab for the dashboard TUI
 * View and manage crontab entries for executor and reviewer
 */

import blessed from "blessed";
import cronstrue from "cronstrue";
import { performInstall } from "../install.js";
import { performUninstall } from "../uninstall.js";
import { saveConfig } from "../../utils/config-writer.js";
import { ITab, ITabContext } from "./types.js";

/**
 * Convert a cron schedule to a human-readable description using cronstrue.
 */
export function cronToHuman(cron: string): string {
  const trimmed = cron.trim();
  if (!trimmed || trimmed.split(/\s+/).length !== 5) return cron;
  try {
    return cronstrue.toString(trimmed, { use24HourTimeFormat: true });
  } catch {
    return cron;
  }
}

/**
 * Common schedule presets for the selector UI
 */
export const SCHEDULE_PRESETS = [
  { label: "Every 15 minutes", cron: "*/15 * * * *" },
  { label: "Every 30 minutes", cron: "*/30 * * * *" },
  { label: "Hourly", cron: "0 * * * *" },
  { label: "Every 2 hours", cron: "0 */2 * * *" },
  { label: "Every 3 hours", cron: "0 */3 * * *" },
  { label: "Every 6 hours", cron: "0 */6 * * *" },
  { label: "Hourly 9am-9pm", cron: "0 9-21 * * *" },
  { label: "Twice daily (9,21)", cron: "0 9,21 * * *" },
  { label: "Daily at midnight", cron: "0 0 * * *" },
];

/**
 * Create the Schedules tab
 */
export function createSchedulesTab(): ITab {
  const container = blessed.box({
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
    hidden: true,
  });

  const crontabBox = blessed.box({
    top: 0,
    left: 0,
    width: "100%",
    height: "45%",
    label: "[ Current Crontab Entries ]",
    border: { type: "line" },
    scrollable: true,
    alwaysScroll: true,
    scrollbar: { style: { bg: "blue" } },
    style: { border: { fg: "cyan" } },
    tags: true,
    content: "Loading...",
  });

  const scheduleBox = blessed.box({
    top: "45%",
    left: 0,
    width: "100%",
    height: "55%",
    label: "[ Schedule Settings ]",
    border: { type: "line" },
    style: { border: { fg: "white" } },
    tags: true,
    content: "Loading...",
  });

  container.append(crontabBox);
  container.append(scheduleBox);

  function renderCrontab(ctx: ITabContext) {
    const { crontab } = ctx.snapshot;
    if (!crontab.installed || crontab.entries.length === 0) {
      crontabBox.setContent(
        "{yellow-fg}No crontab entries installed{/yellow-fg}\n\n" +
        "Press {bold}i{/bold} to install cron schedules."
      );
    } else {
      const lines = crontab.entries.map((entry, idx) => {
        // Extract the cron expression (first 5 fields)
        const parts = entry.trim().split(/\s+/);
        const cronExpr = parts.slice(0, 5).join(" ");
        const human = cronToHuman(cronExpr);
        return `{bold}Entry ${idx + 1}:{/bold} ${human}\n{#888888-fg}${entry}{/#888888-fg}`;
      });
      crontabBox.setContent(lines.join("\n\n"));
    }
  }

  function renderScheduleSettings(ctx: ITabContext) {
    const { config } = ctx;
    const executorHuman = cronToHuman(config.cronSchedule);
    const reviewerHuman = cronToHuman(config.reviewerSchedule);

    const lines = [
      `{bold}Executor Schedule:{/bold}  ${config.cronSchedule}`,
      `  ${executorHuman}`,
      "",
      `{bold}Reviewer Schedule:{/bold}  ${config.reviewerSchedule}`,
      `  ${reviewerHuman}`,
      "",
      `{bold}Reviewer Enabled:{/bold}  ${config.reviewerEnabled ? "{green-fg}Yes{/green-fg}" : "{red-fg}No{/red-fg}"}`,
      "",
      "{#888888-fg}Keys: e:Edit Executor  v:Edit Reviewer  i:Install  x:Uninstall  R:Reinstall{/#888888-fg}",
    ];

    scheduleBox.setContent(lines.join("\n"));
  }

  function applySchedule(ctx: ITabContext, field: "cronSchedule" | "reviewerSchedule", cronExpr: string) {
    const result = saveConfig(ctx.projectDir, { [field]: cronExpr });
    if (!result.success) {
      ctx.showMessage(`Save failed: ${result.error}`, "error");
      return;
    }
    performUninstall(ctx.projectDir, { keepLogs: true });
    const newConfig = ctx.reloadConfig();
    const installResult = performInstall(ctx.projectDir, newConfig);
    const human = cronToHuman(cronExpr);
    if (installResult.success) {
      ctx.showMessage(`Schedule saved: ${human}`, "success");
    } else {
      ctx.showMessage(`Saved but cron install failed: ${installResult.error}`, "error");
    }
    ctx.config = newConfig;
    const snap = ctx.refreshSnapshot();
    ctx.snapshot = snap;
    renderCrontab(ctx);
    renderScheduleSettings(ctx);
  }

  function showCustomCronInput(ctx: ITabContext, field: "cronSchedule" | "reviewerSchedule", label: string) {
    const currentValue = ctx.config[field];

    const inputBox = blessed.textbox({
      top: "center",
      left: "center",
      width: "60%",
      height: 3,
      border: { type: "line" },
      label: `[ Custom ${label} ]`,
      tags: true,
      style: { border: { fg: "cyan" }, fg: "white" },
      inputOnFocus: true,
    } as blessed.Widgets.TextboxOptions);

    ctx.screen.append(inputBox);
    inputBox.setValue(currentValue);
    inputBox.focus();
    ctx.screen.render();

    inputBox.on("submit", (value: string) => {
      const trimmed = value.trim();
      if (trimmed.split(/\s+/).length !== 5) {
        ctx.showMessage("Invalid cron expression (need 5 fields)", "error");
      } else {
        applySchedule(ctx, field, trimmed);
      }
      inputBox.destroy();
      ctx.setEditing(false);
      ctx.screen.render();
    });

    inputBox.on("cancel", () => {
      inputBox.destroy();
      ctx.setEditing(false);
      ctx.screen.render();
    });
  }

  function editSchedule(ctx: ITabContext, field: "cronSchedule" | "reviewerSchedule", label: string) {
    const presetItems = SCHEDULE_PRESETS.map((p) => ` ${p.label}  (${p.cron})`);
    presetItems.push(" Custom...");

    const selectorList = blessed.list({
      top: "center",
      left: "center",
      width: 50,
      height: presetItems.length + 2,
      border: { type: "line" },
      label: `[ ${label} ]`,
      tags: true,
      style: {
        border: { fg: "cyan" },
        selected: { bg: "blue", fg: "white" },
        item: { fg: "white" },
      },
      keys: true,
      vi: false,
      interactive: true,
    } as blessed.Widgets.ListOptions<blessed.Widgets.ListElementStyle>);

    selectorList.setItems(presetItems as unknown as string[]);

    // Pre-select current schedule if it matches a preset
    const currentCron = ctx.config[field];
    const matchIdx = SCHEDULE_PRESETS.findIndex((p) => p.cron === currentCron);
    if (matchIdx >= 0) {
      selectorList.select(matchIdx);
    }

    ctx.setEditing(true);
    ctx.screen.append(selectorList);
    selectorList.focus();
    ctx.screen.render();

    selectorList.on("select", (_item: unknown, index: number) => {
      selectorList.destroy();
      if (index === SCHEDULE_PRESETS.length) {
        // "Custom..." selected
        showCustomCronInput(ctx, field, label);
      } else {
        const preset = SCHEDULE_PRESETS[index];
        applySchedule(ctx, field, preset.cron);
        ctx.setEditing(false);
        ctx.screen.render();
      }
    });

    selectorList.key(["escape"], () => {
      selectorList.destroy();
      ctx.setEditing(false);
      ctx.screen.render();
    });
  }

  let activeKeyHandlers: Array<[string[], (...args: unknown[]) => void]> = [];
  let activeCtx: ITabContext | null = null;

  function bindKeys(ctx: ITabContext) {
    const handlers: Array<[string[], (...args: unknown[]) => void]> = [
      [["e"], () => editSchedule(ctx, "cronSchedule", "Executor Schedule")],
      [["v"], () => editSchedule(ctx, "reviewerSchedule", "Reviewer Schedule")],
      [["i"], () => {
        const result = performInstall(ctx.projectDir, ctx.config);
        if (result.success) {
          ctx.showMessage(`Cron installed (${result.entries.length} entries)`, "success");
        } else {
          ctx.showMessage(`Install failed: ${result.error}`, "error");
        }
        const snap = ctx.refreshSnapshot();
        ctx.snapshot = snap;
        renderCrontab(ctx);
        ctx.screen.render();
      }],
      [["x"], () => {
        const result = performUninstall(ctx.projectDir, { keepLogs: true });
        if (result.success) {
          ctx.showMessage(`Removed ${result.removedCount} cron entries`, "success");
        } else {
          ctx.showMessage(`Uninstall failed: ${result.error}`, "error");
        }
        const snap = ctx.refreshSnapshot();
        ctx.snapshot = snap;
        renderCrontab(ctx);
        ctx.screen.render();
      }],
      [["S-r"], () => {
        performUninstall(ctx.projectDir, { keepLogs: true });
        const result = performInstall(ctx.projectDir, ctx.config);
        if (result.success) {
          ctx.showMessage("Cron reinstalled", "success");
        } else {
          ctx.showMessage(`Reinstall failed: ${result.error}`, "error");
        }
        const snap = ctx.refreshSnapshot();
        ctx.snapshot = snap;
        renderCrontab(ctx);
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
    name: "Schedules",
    container,
    activate(ctx: ITabContext) {
      ctx.setFooter(" e:Executor  v:Reviewer  i:Install  x:Uninstall  R:Reinstall  q:Quit");
      renderCrontab(ctx);
      renderScheduleSettings(ctx);
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
      renderCrontab(ctx);
      renderScheduleSettings(ctx);
      ctx.screen.render();
    },
    destroy() {
      // Nothing to clean up
    },
  };
}
