/**
 * Global project registry for Night Watch CLI
 * Manages project entries via the SQLite repository layer.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { CONFIG_FILE_NAME, GLOBAL_CONFIG_DIR, REGISTRY_FILE_NAME } from "../constants.js";
import { getRepositories, resetRepositories } from "../storage/repositories/index.js";
import { closeDb } from "../storage/sqlite/client.js";
import { getProjectName } from "./status-data.js";

export interface IRegistryEntry {
  name: string;
  path: string;
}

/**
 * Get the path to the global registry file.
 * Kept for backward compatibility.
 */
export function getRegistryPath(): string {
  const base = process.env.NIGHT_WATCH_HOME || path.join(os.homedir(), GLOBAL_CONFIG_DIR);
  return path.join(base, REGISTRY_FILE_NAME);
}

/**
 * Load all registry entries from the SQLite repository.
 */
export function loadRegistry(): IRegistryEntry[] {
  const { projectRegistry } = getRepositories();
  return projectRegistry.getAll();
}

/**
 * Save a full set of registry entries (full replace).
 * Deletes all existing entries then upserts each provided entry in a transaction.
 */
export function saveRegistry(entries: IRegistryEntry[]): void {
  const { projectRegistry } = getRepositories();
  projectRegistry.clear();
  for (const entry of entries) {
    projectRegistry.upsert(entry);
  }
}

/**
 * Register a project in the global registry.
 * No-op if already registered by path. Returns the entry.
 */
export function registerProject(projectDir: string): IRegistryEntry {
  const resolvedPath = path.resolve(projectDir);
  const { projectRegistry } = getRepositories();
  const entries = projectRegistry.getAll();

  const existing = entries.find((e) => e.path === resolvedPath);
  if (existing) {
    return existing;
  }

  const name = getProjectName(resolvedPath);

  // Handle name collisions by appending directory basename
  const nameExists = entries.some((e) => e.name === name);
  const finalName = nameExists ? `${name}-${path.basename(resolvedPath)}` : name;

  const entry: IRegistryEntry = { name: finalName, path: resolvedPath };
  projectRegistry.upsert(entry);
  return entry;
}

/**
 * Remove a project from the registry by path.
 * Returns true if it was found and removed.
 */
export function unregisterProject(projectDir: string): boolean {
  const resolvedPath = path.resolve(projectDir);
  const { projectRegistry } = getRepositories();
  return projectRegistry.remove(resolvedPath);
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

export { closeDb, resetRepositories };
