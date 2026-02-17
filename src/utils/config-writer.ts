/**
 * Config writer utility for Night Watch CLI
 * Saves partial config changes to night-watch.config.json while preserving unknown keys
 */

import * as fs from "fs";
import * as path from "path";
import { CONFIG_FILE_NAME } from "../constants.js";
import { INightWatchConfig } from "../types.js";

export interface ISaveConfigResult {
  success: boolean;
  error?: string;
}

/**
 * Save partial config changes to the night-watch.config.json file.
 * Reads the existing file, merges changes, and writes back.
 * Preserves unknown keys (like $schema, projectName).
 */
export function saveConfig(
  projectDir: string,
  changes: Partial<INightWatchConfig>
): ISaveConfigResult {
  const configPath = path.join(projectDir, CONFIG_FILE_NAME);

  try {
    // Read existing file
    let existing: Record<string, unknown> = {};
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, "utf-8");
      existing = JSON.parse(content) as Record<string, unknown>;
    }

    // Merge changes (shallow merge for top-level keys, deep merge for notifications)
    const merged = { ...existing };
    for (const [key, value] of Object.entries(changes)) {
      if (value !== undefined) {
        if (key === "notifications" && existing.notifications && typeof existing.notifications === "object") {
          merged.notifications = { ...(existing.notifications as Record<string, unknown>), ...value as Record<string, unknown> };
        } else {
          merged[key] = value;
        }
      }
    }

    // Write back with consistent formatting
    fs.writeFileSync(configPath, JSON.stringify(merged, null, 2) + "\n");

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
