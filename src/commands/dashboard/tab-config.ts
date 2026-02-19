/**
 * Config tab for the dashboard TUI
 * Allows viewing and editing all configuration fields
 */

import blessed from "blessed";
import { INightWatchConfig, IWebhookConfig, NotificationEvent, WebhookType } from "@/types.js";
import { VALID_PROVIDERS } from "@/constants.js";
import { saveConfig } from "@/utils/config-writer.js";
import { performUninstall } from "../uninstall.js";
import { performInstall } from "../install.js";
import { ITab, ITabContext } from "./types.js";

type FieldType = "string" | "number" | "boolean" | "enum" | "string[]" | "keyvalue" | "webhooks";

interface IConfigField {
  key: keyof INightWatchConfig;
  label: string;
  type: FieldType;
  options?: string[];
  validate?: (value: string) => string | null; // returns error message or null
}

const SENSITIVE_PATTERNS = /TOKEN|KEY|SECRET|PASSWORD/i;

const WEBHOOK_TYPES: WebhookType[] = ["slack", "discord", "telegram"];
const NOTIFICATION_EVENTS: NotificationEvent[] = [
  "run_started", "run_succeeded", "run_failed", "run_timeout", "review_completed",
];

/**
 * GLM-5 default provider environment configuration
 */
const GLM5_DEFAULTS: Record<string, string> = {
  ANTHROPIC_BASE_URL: "https://api.z.ai/api/anthropic",
  API_TIMEOUT_MS: "3000000",
  ANTHROPIC_DEFAULT_OPUS_MODEL: "glm-5",
  ANTHROPIC_DEFAULT_SONNET_MODEL: "glm-5",
};

export const CONFIG_FIELDS: IConfigField[] = [
  { key: "provider", label: "Provider", type: "enum", options: [...VALID_PROVIDERS] },
  { key: "reviewerEnabled", label: "Reviewer Enabled", type: "boolean" },
  { key: "defaultBranch", label: "Default Branch", type: "string" },
  { key: "prdDir", label: "PRD Directory", type: "string" },
  { key: "branchPrefix", label: "Branch Prefix", type: "string" },
  { key: "branchPatterns", label: "Branch Patterns", type: "string[]" },
  { key: "cronSchedule", label: "Executor Schedule", type: "string" },
  { key: "reviewerSchedule", label: "Reviewer Schedule", type: "string" },
  {
    key: "maxRuntime", label: "Max Runtime (s)", type: "number",
    validate: (v) => { const n = parseInt(v, 10); return isNaN(n) || n <= 0 ? "Must be a positive integer" : null; },
  },
  {
    key: "reviewerMaxRuntime", label: "Reviewer Max Runtime (s)", type: "number",
    validate: (v) => { const n = parseInt(v, 10); return isNaN(n) || n <= 0 ? "Must be a positive integer" : null; },
  },
  {
    key: "minReviewScore", label: "Min Review Score", type: "number",
    validate: (v) => { const n = parseInt(v, 10); return isNaN(n) || n < 0 || n > 100 ? "Must be 0-100" : null; },
  },
  {
    key: "maxLogSize", label: "Max Log Size (bytes)", type: "number",
    validate: (v) => { const n = parseInt(v, 10); return isNaN(n) || n <= 0 ? "Must be a positive integer" : null; },
  },
  { key: "providerEnv", label: "Provider Env Vars", type: "keyvalue" },
  { key: "notifications", label: "Notifications", type: "webhooks" },
];

function maskValue(key: string, value: string): string {
  if (SENSITIVE_PATTERNS.test(key) && value.length > 6) {
    return value.slice(0, 3) + "***" + value.slice(-3);
  }
  return value;
}

function formatFieldValue(config: INightWatchConfig, field: IConfigField): string {
  const value = config[field.key];
  if (field.type === "string[]" && Array.isArray(value)) {
    return (value as string[]).join(", ");
  }
  if (field.type === "keyvalue") {
    const env = value as Record<string, string>;
    const count = Object.keys(env).length;
    return count > 0 ? `${count} variable(s) set` : "(none)";
  }
  if (field.type === "webhooks") {
    const notif = value as INightWatchConfig["notifications"];
    return notif.webhooks.length > 0 ? `${notif.webhooks.length} webhook(s)` : "(none)";
  }
  return String(value);
}

/**
 * Create the Config editor tab
 */
export function createConfigTab(): ITab {
  const container = blessed.box({
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
    hidden: true,
  });

  const configList = blessed.list({
    top: 0,
    left: 0,
    width: "100%",
    height: "100%-3",
    border: { type: "line" },
    label: "[ Configuration ]",
    tags: true,
    scrollable: true,
    alwaysScroll: true,
    scrollbar: { style: { bg: "blue" } },
    style: {
      border: { fg: "cyan" },
      selected: { bg: "blue", fg: "white" },
      item: { fg: "white" },
    },
    keys: true,
    vi: false,
    mouse: false,
    interactive: true,
  } as blessed.Widgets.ListOptions<blessed.Widgets.ListElementStyle>);

  const statusBar = blessed.box({
    bottom: 0,
    left: 0,
    width: "100%",
    height: 3,
    border: { type: "line" },
    tags: true,
    style: { border: { fg: "white" } },
    content: "",
  });

  container.append(configList);
  container.append(statusBar);

  const pendingChanges: Partial<INightWatchConfig> = {};
  let currentConfig: INightWatchConfig | null = null;

  function buildListItems(config: INightWatchConfig): string[] {
    return CONFIG_FIELDS.map((field) => {
      const hasChange = field.key in pendingChanges;
      const value = hasChange
        ? formatFieldValue({ ...config, ...pendingChanges } as INightWatchConfig, field)
        : formatFieldValue(config, field);
      const marker = hasChange ? " {yellow-fg}*{/yellow-fg}" : "";
      const editHint = field.type === "keyvalue" || field.type === "webhooks" ? " {#888888-fg}(Enter to manage){/#888888-fg}" : "";
      return ` ${field.label}: ${value}${marker}${editHint}`;
    });
  }

  function updateStatusBar() {
    const changeCount = Object.keys(pendingChanges).length;
    if (changeCount > 0) {
      statusBar.setContent(
        ` {yellow-fg}${changeCount} unsaved change(s){/yellow-fg} | s:Save & Apply  u:Undo All`
      );
    } else {
      statusBar.setContent(" No pending changes");
    }
  }

  function refreshList(config: INightWatchConfig) {
    configList.setItems(buildListItems(config) as unknown as string[]);
    updateStatusBar();
  }

  // ── Key-Value Editor (providerEnv) ──────────────────────────────────────

  function showKeyValueEditor(ctx: ITabContext, config: INightWatchConfig) {
    const currentEnv: Record<string, string> = {
      ...(config.providerEnv || {}),
      ...((pendingChanges.providerEnv as Record<string, string>) || {}),
    };

    // If pendingChanges has providerEnv, use it entirely; otherwise merge from config
    const editableEnv: Record<string, string> = pendingChanges.providerEnv
      ? { ...(pendingChanges.providerEnv as Record<string, string>) }
      : { ...currentEnv };

    function buildItems(): string[] {
      const entries = Object.entries(editableEnv);
      if (entries.length === 0) return ["  (no variables set)"];
      return entries.map(([k, v]) => `  ${k} = ${maskValue(k, v)}`);
    }

    const kvList = blessed.list({
      top: "center",
      left: "center",
      width: "70%",
      height: Math.min(Object.keys(editableEnv).length + 4, 20),
      border: { type: "line" },
      label: "[ Provider Env Vars | a:Add  Enter:Edit  d:Delete  Esc:Done ]",
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

    kvList.setItems(buildItems() as unknown as string[]);

    ctx.setEditing(true);
    ctx.screen.append(kvList);
    kvList.focus();
    ctx.screen.render();

    function refreshKvList() {
      kvList.setItems(buildItems() as unknown as string[]);
      (kvList as unknown as { height: number }).height = Math.min(Object.keys(editableEnv).length + 4, 20);
      ctx.screen.render();
    }

    function promptTextbox(label: string, initialValue: string, cb: (val: string | null) => void) {
      const input = blessed.textbox({
        top: "center",
        left: "center",
        width: "50%",
        height: 3,
        border: { type: "line" },
        label: `[ ${label} ]`,
        tags: true,
        style: { border: { fg: "yellow" }, fg: "white" },
        inputOnFocus: true,
      } as blessed.Widgets.TextboxOptions);

      ctx.screen.append(input);
      input.setValue(initialValue);
      input.focus();
      ctx.screen.render();

      input.on("submit", (value: string) => {
        input.destroy();
        cb(value.trim());
      });
      input.on("cancel", () => {
        input.destroy();
        cb(null);
      });
    }

    kvList.key(["a"], () => {
      promptTextbox("Variable Name", "", (key) => {
        if (!key) { kvList.focus(); ctx.screen.render(); return; }
        promptTextbox(`Value for ${key}`, "", (value) => {
          if (value !== null) {
            editableEnv[key] = value;
            pendingChanges.providerEnv = { ...editableEnv };
            refreshKvList();
          }
          kvList.focus();
          ctx.screen.render();
        });
      });
    });

    kvList.key(["enter"], () => {
      const keys = Object.keys(editableEnv);
      if (keys.length === 0) return;
      const idx = (kvList as unknown as { selected: number }).selected;
      if (idx < 0 || idx >= keys.length) return;
      const selectedKey = keys[idx];
      promptTextbox(`Edit ${selectedKey}`, editableEnv[selectedKey], (value) => {
        if (value !== null) {
          editableEnv[selectedKey] = value;
          pendingChanges.providerEnv = { ...editableEnv };
          refreshKvList();
        }
        kvList.focus();
        ctx.screen.render();
      });
    });

    kvList.key(["d"], () => {
      const keys = Object.keys(editableEnv);
      if (keys.length === 0) return;
      const idx = (kvList as unknown as { selected: number }).selected;
      if (idx < 0 || idx >= keys.length) return;
      const selectedKey = keys[idx];
      delete editableEnv[selectedKey];
      pendingChanges.providerEnv = { ...editableEnv };
      refreshKvList();
    });

    kvList.key(["escape"], () => {
      kvList.destroy();
      ctx.setEditing(false);
      if (currentConfig) refreshList(currentConfig);
      configList.focus();
      ctx.screen.render();
    });
  }

  // ── Webhook Editor (notifications) ──────────────────────────────────────

  function showWebhookEditor(ctx: ITabContext, config: INightWatchConfig) {
    const currentNotif = pendingChanges.notifications
      ? (pendingChanges.notifications as INightWatchConfig["notifications"])
      : config.notifications;
    const editableWebhooks: IWebhookConfig[] = currentNotif.webhooks.map((w) => ({ ...w, events: [...w.events] }));

    function buildItems(): string[] {
      if (editableWebhooks.length === 0) return ["  (no webhooks configured)"];
      return editableWebhooks.map((w) => {
        const identifier = w.type === "telegram"
          ? `token:${maskValue("TOKEN", w.botToken || "")}`
          : (w.url ? maskValue("URL", w.url) : "no url");
        return `  [${w.type}] ${identifier} events: ${w.events.length}`;
      });
    }

    const whList = blessed.list({
      top: "center",
      left: "center",
      width: "70%",
      height: Math.min(editableWebhooks.length + 4, 20),
      border: { type: "line" },
      label: "[ Webhooks | a:Add  Enter:Edit  d:Delete  Esc:Done ]",
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

    whList.setItems(buildItems() as unknown as string[]);

    ctx.setEditing(true);
    ctx.screen.append(whList);
    whList.focus();
    ctx.screen.render();

    function refreshWhList() {
      whList.setItems(buildItems() as unknown as string[]);
      (whList as unknown as { height: number }).height = Math.min(editableWebhooks.length + 4, 20);
      ctx.screen.render();
    }

    function stageWebhookChanges() {
      pendingChanges.notifications = { webhooks: editableWebhooks.map((w) => ({ ...w, events: [...w.events] })) };
    }

    function promptTextbox(label: string, initialValue: string, cb: (val: string | null) => void) {
      const input = blessed.textbox({
        top: "center",
        left: "center",
        width: "50%",
        height: 3,
        border: { type: "line" },
        label: `[ ${label} ]`,
        tags: true,
        style: { border: { fg: "yellow" }, fg: "white" },
        inputOnFocus: true,
      } as blessed.Widgets.TextboxOptions);

      ctx.screen.append(input);
      input.setValue(initialValue);
      input.focus();
      ctx.screen.render();

      input.on("submit", (value: string) => { input.destroy(); cb(value.trim()); });
      input.on("cancel", () => { input.destroy(); cb(null); });
    }

    function selectType(cb: (type: WebhookType | null) => void) {
      const typeList = blessed.list({
        top: "center",
        left: "center",
        width: 30,
        height: WEBHOOK_TYPES.length + 2,
        border: { type: "line" },
        label: "[ Webhook Type ]",
        tags: true,
        style: { border: { fg: "yellow" }, selected: { bg: "blue", fg: "white" }, item: { fg: "white" } },
        keys: true,
        vi: false,
        interactive: true,
      } as blessed.Widgets.ListOptions<blessed.Widgets.ListElementStyle>);

      typeList.setItems(WEBHOOK_TYPES as unknown as string[]);
      ctx.screen.append(typeList);
      typeList.focus();
      ctx.screen.render();

      typeList.on("select", (_item: unknown, index: number) => {
        typeList.destroy();
        cb(WEBHOOK_TYPES[index]);
      });
      typeList.key(["escape"], () => { typeList.destroy(); cb(null); });
    }

    function selectEvents(current: NotificationEvent[], cb: (events: NotificationEvent[] | null) => void) {
      const selected = new Set(current);
      const evList = blessed.list({
        top: "center",
        left: "center",
        width: 40,
        height: NOTIFICATION_EVENTS.length + 3,
        border: { type: "line" },
        label: "[ Events | Space:Toggle  Enter:Done ]",
        tags: true,
        style: { border: { fg: "yellow" }, selected: { bg: "blue", fg: "white" }, item: { fg: "white" } },
        keys: true,
        vi: false,
        interactive: true,
      } as blessed.Widgets.ListOptions<blessed.Widgets.ListElementStyle>);

      function renderEvents() {
        evList.setItems(NOTIFICATION_EVENTS.map((e) =>
          `  ${selected.has(e) ? "[x]" : "[ ]"} ${e}`
        ) as unknown as string[]);
      }
      renderEvents();
      ctx.screen.append(evList);
      evList.focus();
      ctx.screen.render();

      evList.key(["space"], () => {
        const idx = (evList as unknown as { selected: number }).selected;
        if (idx >= 0 && idx < NOTIFICATION_EVENTS.length) {
          const ev = NOTIFICATION_EVENTS[idx];
          if (selected.has(ev)) selected.delete(ev); else selected.add(ev);
          renderEvents();
          evList.select(idx);
          ctx.screen.render();
        }
      });

      evList.key(["enter"], () => {
        evList.destroy();
        cb([...selected]);
      });
      evList.key(["escape"], () => { evList.destroy(); cb(null); });
    }

    function addWebhookWizard() {
      selectType((type) => {
        if (!type) { whList.focus(); ctx.screen.render(); return; }

        const webhook: IWebhookConfig = { type, events: [...NOTIFICATION_EVENTS] };

        const askCredentials = (done: (ok: boolean) => void) => {
          if (type === "telegram") {
            promptTextbox("Bot Token", "", (botToken) => {
              if (botToken === null) { done(false); return; }
              webhook.botToken = botToken;
              promptTextbox("Chat ID", "", (chatId) => {
                if (chatId === null) { done(false); return; }
                webhook.chatId = chatId;
                done(true);
              });
            });
          } else {
            promptTextbox("Webhook URL", "", (url) => {
              if (url === null) { done(false); return; }
              webhook.url = url;
              done(true);
            });
          }
        };

        askCredentials((ok) => {
          if (!ok) { whList.focus(); ctx.screen.render(); return; }
          selectEvents(webhook.events, (events) => {
            if (events === null) { whList.focus(); ctx.screen.render(); return; }
            webhook.events = events;
            editableWebhooks.push(webhook);
            stageWebhookChanges();
            refreshWhList();
            whList.focus();
            ctx.screen.render();
          });
        });
      });
    }

    function editWebhook(idx: number) {
      const webhook = editableWebhooks[idx];

      selectType((type) => {
        if (type === null) { whList.focus(); ctx.screen.render(); return; }
        webhook.type = type;

        const askCredentials = (done: (ok: boolean) => void) => {
          if (type === "telegram") {
            promptTextbox("Bot Token", webhook.botToken || "", (botToken) => {
              if (botToken === null) { done(false); return; }
              webhook.botToken = botToken;
              webhook.url = undefined;
              promptTextbox("Chat ID", webhook.chatId || "", (chatId) => {
                if (chatId === null) { done(false); return; }
                webhook.chatId = chatId;
                done(true);
              });
            });
          } else {
            promptTextbox("Webhook URL", webhook.url || "", (url) => {
              if (url === null) { done(false); return; }
              webhook.url = url;
              webhook.botToken = undefined;
              webhook.chatId = undefined;
              done(true);
            });
          }
        };

        askCredentials((ok) => {
          if (!ok) { whList.focus(); ctx.screen.render(); return; }
          selectEvents(webhook.events, (events) => {
            if (events === null) { whList.focus(); ctx.screen.render(); return; }
            webhook.events = events;
            stageWebhookChanges();
            refreshWhList();
            whList.focus();
            ctx.screen.render();
          });
        });
      });
    }

    whList.key(["a"], () => addWebhookWizard());

    whList.key(["enter"], () => {
      if (editableWebhooks.length === 0) return;
      const idx = (whList as unknown as { selected: number }).selected;
      if (idx >= 0 && idx < editableWebhooks.length) {
        editWebhook(idx);
      }
    });

    whList.key(["d"], () => {
      if (editableWebhooks.length === 0) return;
      const idx = (whList as unknown as { selected: number }).selected;
      if (idx >= 0 && idx < editableWebhooks.length) {
        editableWebhooks.splice(idx, 1);
        stageWebhookChanges();
        refreshWhList();
      }
    });

    whList.key(["escape"], () => {
      whList.destroy();
      ctx.setEditing(false);
      if (currentConfig) refreshList(currentConfig);
      configList.focus();
      ctx.screen.render();
    });
  }

  // ── GLM-5 Quick Setup ──────────────────────────────────────────────────

  function showGlm5Setup(ctx: ITabContext) {
    const inputBox = blessed.textbox({
      top: "center",
      left: "center",
      width: "60%",
      height: 3,
      border: { type: "line" },
      label: "[ GLM-5 Quick Setup: Enter API Key ]",
      tags: true,
      style: { border: { fg: "cyan" }, fg: "white" },
      inputOnFocus: true,
    } as blessed.Widgets.TextboxOptions);

    ctx.setEditing(true);
    ctx.screen.append(inputBox);
    inputBox.setValue("");
    inputBox.focus();
    ctx.screen.render();

    inputBox.on("submit", (value: string) => {
      const apiKey = value.trim();
      inputBox.destroy();
      ctx.setEditing(false);

      if (!apiKey) {
        ctx.showMessage("No API key provided", "error");
        configList.focus();
        ctx.screen.render();
        return;
      }

      pendingChanges.providerEnv = {
        ANTHROPIC_API_KEY: apiKey,
        ANTHROPIC_AUTH_TOKEN: apiKey,
        ...GLM5_DEFAULTS,
      };

      ctx.showMessage("GLM-5 configured. Press s to save.", "success");
      if (currentConfig) refreshList(currentConfig);
      configList.focus();
      ctx.screen.render();
    });

    inputBox.on("cancel", () => {
      inputBox.destroy();
      ctx.setEditing(false);
      configList.focus();
      ctx.screen.render();
    });
  }

  // ── Standard Editor ─────────────────────────────────────────────────────

  function showEditor(
    ctx: ITabContext,
    field: IConfigField,
    config: INightWatchConfig
  ) {
    if (field.type === "keyvalue") {
      showKeyValueEditor(ctx, config);
      return;
    }

    if (field.type === "webhooks") {
      showWebhookEditor(ctx, config);
      return;
    }

    const currentValue = field.key in pendingChanges
      ? String((pendingChanges as Record<string, unknown>)[field.key])
      : formatFieldValue(config, field);

    if (field.type === "enum" || field.type === "boolean") {
      const options = field.type === "boolean" ? ["true", "false"] : (field.options || []);
      const selectorList = blessed.list({
        top: "center",
        left: "center",
        width: Math.max(30, ...options.map((o) => o.length + 6)),
        height: options.length + 2,
        border: { type: "line" },
        label: `[ ${field.label} ]`,
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

      selectorList.setItems(options as unknown as string[]);

      // Pre-select current value
      const currentIdx = options.indexOf(currentValue);
      if (currentIdx >= 0) {
        selectorList.select(currentIdx);
      }

      ctx.setEditing(true);
      ctx.screen.append(selectorList);
      selectorList.focus();
      ctx.screen.render();

      selectorList.on("select", (_item: unknown, index: number) => {
        const selected = options[index];
        if (field.type === "boolean") {
          (pendingChanges as Record<string, unknown>)[field.key] = selected === "true";
        } else {
          (pendingChanges as Record<string, unknown>)[field.key] = selected;
        }
        selectorList.destroy();
        ctx.setEditing(false);
        refreshList(config);
        configList.focus();
        ctx.screen.render();
      });

      selectorList.key(["escape"], () => {
        selectorList.destroy();
        ctx.setEditing(false);
        configList.focus();
        ctx.screen.render();
      });
      return;
    }

    // Text input for string, number, string[]
    const inputBox = blessed.textbox({
      top: "center",
      left: "center",
      width: "60%",
      height: 3,
      border: { type: "line" },
      label: `[ ${field.label} ]`,
      tags: true,
      style: {
        border: { fg: "cyan" },
        fg: "white",
      },
      inputOnFocus: true,
    } as blessed.Widgets.TextboxOptions);

    ctx.setEditing(true);
    ctx.screen.append(inputBox);
    inputBox.setValue(currentValue);
    inputBox.focus();
    ctx.screen.render();

    inputBox.on("submit", (value: string) => {
      // Validate
      if (field.validate) {
        const error = field.validate(value);
        if (error) {
          ctx.showMessage(error, "error");
          inputBox.destroy();
          ctx.setEditing(false);
          configList.focus();
          ctx.screen.render();
          return;
        }
      }

      // Apply value
      if (field.type === "number") {
        (pendingChanges as Record<string, unknown>)[field.key] = parseInt(value, 10);
      } else if (field.type === "string[]") {
        (pendingChanges as Record<string, unknown>)[field.key] = value.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
      } else {
        (pendingChanges as Record<string, unknown>)[field.key] = value;
      }

      inputBox.destroy();
      ctx.setEditing(false);
      refreshList(config);
      configList.focus();
      ctx.screen.render();
    });

    inputBox.on("cancel", () => {
      inputBox.destroy();
      ctx.setEditing(false);
      configList.focus();
      ctx.screen.render();
    });
  }

  let activeKeyHandlers: Array<[string[], (...args: unknown[]) => void]> = [];
  let activeCtx: ITabContext | null = null;

  function bindKeys(ctx: ITabContext) {
    const handlers: Array<[string[], (...args: unknown[]) => void]> = [
      [["enter"], () => {
        const idx = (configList as unknown as { selected: number }).selected;
        if (idx === undefined || idx < 0 || idx >= CONFIG_FIELDS.length) return;
        const field = CONFIG_FIELDS[idx];
        if (currentConfig) {
          showEditor(ctx, field, currentConfig);
        }
      }],
      [["s"], () => {
        if (Object.keys(pendingChanges).length === 0) {
          ctx.showMessage("No changes to save", "info");
          return;
        }
        // Save config
        const result = saveConfig(ctx.projectDir, pendingChanges);
        if (!result.success) {
          ctx.showMessage(`Save failed: ${result.error}`, "error");
          return;
        }

        // Check if schedules changed - reinstall cron
        const scheduleChanged = "cronSchedule" in pendingChanges ||
          "reviewerSchedule" in pendingChanges ||
          "reviewerEnabled" in pendingChanges;

        if (scheduleChanged) {
          performUninstall(ctx.projectDir, { keepLogs: true });
          const newConfig = ctx.reloadConfig();
          const installResult = performInstall(ctx.projectDir, newConfig);
          if (!installResult.success) {
            ctx.showMessage(`Config saved but cron reinstall failed: ${installResult.error}`, "error");
          } else {
            ctx.showMessage("Config saved & cron reinstalled", "success");
          }
        } else {
          ctx.showMessage("Config saved", "success");
        }

        // Reload config
        currentConfig = ctx.reloadConfig();
        // Clear pending
        for (const key of Object.keys(pendingChanges)) {
          delete (pendingChanges as Record<string, unknown>)[key];
        }
        refreshList(currentConfig);
        ctx.screen.render();
      }],
      [["u"], () => {
        for (const key of Object.keys(pendingChanges)) {
          delete (pendingChanges as Record<string, unknown>)[key];
        }
        if (currentConfig) {
          refreshList(currentConfig);
        }
        ctx.showMessage("Changes undone", "info");
        ctx.screen.render();
      }],
      [["g"], () => {
        showGlm5Setup(ctx);
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
    name: "Config",
    container,
    activate(ctx: ITabContext) {
      ctx.setFooter(" \u2191\u2193:Navigate  Enter:Edit  g:GLM-5 Setup  s:Save  u:Undo  q:Quit");
      currentConfig = ctx.config;
      refreshList(currentConfig);
      configList.focus();
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
      // Only refresh if no pending changes (don't overwrite user edits)
      if (Object.keys(pendingChanges).length === 0) {
        currentConfig = ctx.config;
        refreshList(currentConfig);
      }
    },
    destroy() {
      // Nothing to clean up
    },
  };
}
