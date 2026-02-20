/**
 * Shared interfaces for the dashboard tab system
 */

import blessed from "blessed";
import { INightWatchConfig } from "@night-watch/core/types.js";
import { IStatusSnapshot } from "@night-watch/core/utils/status-data.js";

/**
 * Context passed to each tab for accessing shared state and utilities
 */
export interface ITabContext {
  screen: blessed.Widgets.Screen;
  projectDir: string;
  config: INightWatchConfig;
  snapshot: IStatusSnapshot;
  /** Reload config from disk after a save */
  reloadConfig: () => INightWatchConfig;
  /** Re-fetch status snapshot with current config */
  refreshSnapshot: () => IStatusSnapshot;
  /** Update the footer text with tab-specific shortcuts */
  setFooter: (text: string) => void;
  /** Show a temporary flash message (success/error/info) */
  showMessage: (text: string, type: "success" | "error" | "info", durationMs?: number) => void;
  /** Set the editing state to suppress global key handlers */
  setEditing: (editing: boolean) => void;
}

/**
 * Interface that each dashboard tab must implement
 */
export interface ITab {
  /** Display name for the tab bar */
  name: string;
  /** The blessed container element for this tab's content */
  container: blessed.Widgets.BoxElement;
  /** Called when the tab becomes active */
  activate: (ctx: ITabContext) => void;
  /** Called when the tab is deactivated */
  deactivate: () => void;
  /** Called on the global refresh timer tick */
  refresh: (ctx: ITabContext) => void;
  /** Called to clean up before screen destruction */
  destroy: () => void;
}
