/**
 * Global project registry for Night Watch CLI
 * Manages ~/.night-watch/projects.json to track all registered projects
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { CONFIG_FILE_NAME, GLOBAL_CONFIG_DIR, REGISTRY_FILE_NAME } from "../constants.js";
import { getProjectName } from "./status-data.js";

export interface IRegistryEntry {
  name: string;
  path: string;
}

/**
 * Get the path to the global registry file
 */
export function getRegistryPath(): string {
  return path.join(os.homedir(), GLOBAL_CONFIG_DIR, REGISTRY_FILE_NAME);
}

/**
 * Load the global registry, returning [] if the file does not exist
 */
export function loadRegistry(): IRegistryEntry[] {
  const registryPath = getRegistryPath();
  if (!fs.existsSync(registryPath)) {
    return [];
  }
  try {
    const content = fs.readFileSync(registryPath, "utf-8");
    const parsed = JSON.parse(content);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed;
  } catch {
    return [];
  }
}

/**
 * Save the registry (full replace)
 */
export function saveRegistry(entries: IRegistryEntry[]): void {
  const registryPath = getRegistryPath();
  const dir = path.dirname(registryPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(registryPath, JSON.stringify(entries, null, 2) + "\n");
}

/**
 * Register a project in the global registry.
 * No-op if already registered by path. Returns the entry.
 */
export function registerProject(projectDir: string): IRegistryEntry {
  const resolvedPath = path.resolve(projectDir);
  const entries = loadRegistry();

  const existing = entries.find((e) => e.path === resolvedPath);
  if (existing) {
    return existing;
  }

  const name = getProjectName(resolvedPath);

  // Handle name collisions by appending directory basename
  const nameExists = entries.some((e) => e.name === name);
  const finalName = nameExists ? `${name}-${path.basename(resolvedPath)}` : name;

  const entry: IRegistryEntry = { name: finalName, path: resolvedPath };
  entries.push(entry);
  saveRegistry(entries);
  return entry;
}

/**
 * Remove a project from the registry by path.
 * Returns true if it was found and removed.
 */
export function unregisterProject(projectDir: string): boolean {
  const resolvedPath = path.resolve(projectDir);
  const entries = loadRegistry();
  const filtered = entries.filter((e) => e.path !== resolvedPath);
  if (filtered.length === entries.length) {
    return false;
  }
  saveRegistry(filtered);
  return true;
}

/**
 * Validate all registry entries.
 * Returns entries split into valid (path + config exist) and invalid.
 */
export function validateRegistry(): { valid: IRegistryEntry[]; invalid: IRegistryEntry[] } {
  const entries = loadRegistry();
  const valid: IRegistryEntry[] = [];
  const invalid: IRegistryEntry[] = [];

  for (const entry of entries) {
    if (fs.existsSync(entry.path) && fs.existsSync(path.join(entry.path, CONFIG_FILE_NAME))) {
      valid.push(entry);
    } else {
      invalid.push(entry);
    }
  }

  return { valid, invalid };
}
