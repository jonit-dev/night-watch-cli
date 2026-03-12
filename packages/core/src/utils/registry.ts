/**
 * Global project registry for Night Watch CLI
 * Manages project entries via the SQLite repository layer.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { CONFIG_FILE_NAME, GLOBAL_CONFIG_DIR, REGISTRY_FILE_NAME } from '../constants.js';
import { getRepositories, resetRepositories } from '../storage/repositories/index.js';
import { getDb } from '../storage/sqlite/client.js';
import { closeDb } from '../storage/sqlite/client.js';
import { generateMarker, removeEntriesForProject } from './crontab.js';
import { getProjectName } from './status-data.js';

export interface IRegistryEntry {
  name: string;
  path: string;
}

function readLegacyRegistryEntries(): IRegistryEntry[] {
  const registryPath = getRegistryPath();
  if (!fs.existsSync(registryPath)) {
    return [];
  }

  try {
    const raw = fs.readFileSync(registryPath, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(
      (entry): entry is IRegistryEntry =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof entry.name === 'string' &&
        entry.name.length > 0 &&
        typeof entry.path === 'string' &&
        entry.path.length > 0,
    );
  } catch {
    return [];
  }
}

function loadRegistryEntriesWithLegacyFallback(): IRegistryEntry[] {
  const { projectRegistry } = getRepositories();
  const entries = projectRegistry.getAll();
  if (entries.length > 0) {
    return entries;
  }

  const db = getDb();
  const alreadyHydrated = db
    .prepare<[], { value: string }>(
      "SELECT value FROM schema_meta WHERE key = 'legacy_projects_json_hydrated'",
    )
    .get();
  if (alreadyHydrated) {
    return [];
  }

  const legacyEntries = readLegacyRegistryEntries();
  if (legacyEntries.length === 0) {
    return [];
  }

  db.transaction(() => {
    for (const entry of legacyEntries) {
      projectRegistry.upsert(entry);
    }

    db.prepare(
      `INSERT INTO schema_meta (key, value) VALUES ('legacy_projects_json_hydrated', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run(new Date().toISOString());
  })();

  return projectRegistry.getAll();
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
  return loadRegistryEntriesWithLegacyFallback();
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
  const entries = loadRegistryEntriesWithLegacyFallback();

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
  loadRegistryEntriesWithLegacyFallback();
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

/**
 * Remove all project-specific data from the global SQLite database.
 * Does NOT remove the project from the registry — use removeProject() for full cleanup.
 */
export function pruneProjectData(projectDir: string): void {
  const resolvedPath = path.resolve(projectDir);
  const db = getDb();

  db.transaction(() => {
    db.prepare('DELETE FROM execution_history WHERE project_path = ?').run(resolvedPath);
    db.prepare('DELETE FROM prd_states WHERE project_path = ?').run(resolvedPath);
    db.prepare('DELETE FROM job_queue WHERE project_path = ?').run(resolvedPath);
    db.prepare('DELETE FROM job_runs WHERE project_path = ?').run(resolvedPath);
    // roadmap_states keyed by prd_dir (e.g., /path/to/project/docs/prds)
    db.prepare('DELETE FROM roadmap_states WHERE prd_dir LIKE ?').run(`${resolvedPath}%`);
  })();
}

export interface IRemoveProjectResult {
  cronEntriesRemoved: number;
  unregistered: boolean;
  dataPruned: boolean;
}

/**
 * Fully remove a project: uninstall cron jobs, prune DB data, and unregister.
 */
export function removeProject(projectDir: string): IRemoveProjectResult {
  const resolvedPath = path.resolve(projectDir);
  const projectName = getProjectName(resolvedPath);
  const marker = generateMarker(projectName);

  // 1. Remove cron entries
  const cronEntriesRemoved = removeEntriesForProject(resolvedPath, marker);

  // 2. Prune all project-specific data from global DB
  pruneProjectData(resolvedPath);

  // 3. Remove from projects registry
  const unregistered = unregisterProject(resolvedPath);

  return { cronEntriesRemoved, unregistered, dataPruned: true };
}

export { closeDb, resetRepositories };
