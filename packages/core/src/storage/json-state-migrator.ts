/**
 * JSON → SQLite migration logic for Night Watch CLI.
 * Reads legacy JSON state files and inserts their contents into SQLite
 * via the repository layer. Safe to run multiple times (idempotent).
 */

import * as fs from "fs";
import * as path from "path";

import { CONFIG_FILE_NAME } from "../constants.js";
import { getDb } from "./sqlite/client.js";
import { getRepositories } from "./repositories/index.js";
import type { IRegistryEntry } from "../utils/registry.js";
import type { IExecutionRecord } from "../utils/execution-history.js";
import type { IPrdStateEntry } from "../utils/prd-states.js";
import type { IRoadmapState } from "../utils/roadmap-state.js";

export interface IMigrationResult {
  projectsMigrated: number;
  historyRecordsMigrated: number;
  prdStatesMigrated: number;
  roadmapStatesMigrated: number;
  backupDir: string;
  alreadyMigrated: boolean;
}

/** Shape of legacy projects.json */
type ILegacyProjectsJson = IRegistryEntry[];

/** Shape of legacy history.json */
type ILegacyHistoryJson = Record<
  string,
  Record<string, { records: IExecutionRecord[] }>
>;

/** Shape of legacy prd-states.json */
type ILegacyPrdStatesJson = Record<string, Record<string, IPrdStateEntry>>;

/**
 * Attempt to parse a JSON file, returning null if the file does not exist
 * or its content cannot be parsed.
 */
function tryReadJson<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

/**
 * Copy a file to the backup directory if it exists.
 */
function backupFile(src: string, backupDir: string): void {
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(backupDir, path.basename(src)));
  }
}

/**
 * Collect all PRD directories from the registered projects by reading each
 * project's night-watch.config.json. Falls back to the default "docs/PRDs/night-watch"
 * directory when the config cannot be read.
 */
function collectPrdDirs(projectPaths: string[]): string[] {
  const prdDirs: string[] = [];

  for (const projectPath of projectPaths) {
    const configPath = path.join(projectPath, CONFIG_FILE_NAME);
    let prdDir = "docs/PRDs/night-watch";

    if (fs.existsSync(configPath)) {
      try {
        const config = JSON.parse(fs.readFileSync(configPath, "utf-8")) as {
          prdDir?: string;
        };
        if (typeof config.prdDir === "string" && config.prdDir.length > 0) {
          prdDir = config.prdDir;
        }
      } catch {
        // use default
      }
    }

    const fullPrdDir = path.join(projectPath, prdDir);
    if (fs.existsSync(fullPrdDir)) {
      prdDirs.push(fullPrdDir);
    }
  }

  return prdDirs;
}

/**
 * Migrate legacy JSON state files into SQLite.
 *
 * The migration is idempotent: if the key "json_migration_completed" already
 * exists in schema_meta the function returns early without touching the DB.
 *
 * @param nightWatchHome - Path to the Night Watch home directory
 *   (e.g. ~/.night-watch or the value of NIGHT_WATCH_HOME).
 */
export function migrateJsonToSqlite(nightWatchHome: string): IMigrationResult {
  const db = getDb();
  const { projectRegistry, executionHistory, prdState, roadmapState } =
    getRepositories();

  // --- Idempotency check ---
  const alreadyDone = db
    .prepare<[], { key: string }>(
      "SELECT key FROM schema_meta WHERE key = 'json_migration_completed'"
    )
    .get();

  if (alreadyDone) {
    return {
      projectsMigrated: 0,
      historyRecordsMigrated: 0,
      prdStatesMigrated: 0,
      roadmapStatesMigrated: 0,
      backupDir: "",
      alreadyMigrated: true,
    };
  }

  // --- Backup directory ---
  const backupDir = path.join(
    nightWatchHome,
    "backups",
    `json-migration-${Date.now()}`
  );
  fs.mkdirSync(backupDir, { recursive: true });

  const projectsJsonPath = path.join(nightWatchHome, "projects.json");
  const historyJsonPath = path.join(nightWatchHome, "history.json");
  const prdStatesJsonPath = path.join(nightWatchHome, "prd-states.json");

  backupFile(projectsJsonPath, backupDir);
  backupFile(historyJsonPath, backupDir);
  backupFile(prdStatesJsonPath, backupDir);

  // --- Migrate projects.json ---
  let projectsMigrated = 0;

  const legacyProjects =
    tryReadJson<ILegacyProjectsJson>(projectsJsonPath) ?? [];

  const migrateProjects = db.transaction(() => {
    for (const entry of legacyProjects) {
      if (
        typeof entry.name === "string" &&
        typeof entry.path === "string" &&
        entry.name.length > 0 &&
        entry.path.length > 0
      ) {
        projectRegistry.upsert(entry);
        projectsMigrated++;
      }
    }
  });
  migrateProjects();

  // --- Migrate history.json ---
  let historyRecordsMigrated = 0;

  const legacyHistory =
    tryReadJson<ILegacyHistoryJson>(historyJsonPath) ?? {};

  const migrateHistory = db.transaction(() => {
    for (const [projectPath, prdMap] of Object.entries(legacyHistory)) {
      for (const [prdFile, prdHistory] of Object.entries(prdMap)) {
        if (!Array.isArray(prdHistory.records)) {
          continue;
        }
        for (const record of prdHistory.records) {
          if (
            typeof record.timestamp !== "number" ||
            typeof record.outcome !== "string" ||
            typeof record.exitCode !== "number" ||
            typeof record.attempt !== "number"
          ) {
            continue;
          }
          executionHistory.addRecord(projectPath, prdFile, record);
          historyRecordsMigrated++;
        }
      }
    }
  });
  migrateHistory();

  // --- Migrate prd-states.json ---
  let prdStatesMigrated = 0;

  const legacyPrdStates =
    tryReadJson<ILegacyPrdStatesJson>(prdStatesJsonPath) ?? {};

  const migratePrdStates = db.transaction(() => {
    for (const [projectDir, prdMap] of Object.entries(legacyPrdStates)) {
      for (const [prdName, entry] of Object.entries(prdMap)) {
        if (
          typeof entry.status === "string" &&
          typeof entry.branch === "string" &&
          typeof entry.timestamp === "number"
        ) {
          prdState.set(projectDir, prdName, entry);
          prdStatesMigrated++;
        }
      }
    }
  });
  migratePrdStates();

  // --- Migrate .roadmap-state.json files ---
  let roadmapStatesMigrated = 0;

  const projectPaths = legacyProjects.map((e) => e.path);
  const prdDirs = collectPrdDirs(projectPaths);

  const migrateRoadmapStates = db.transaction(() => {
    for (const prdDir of prdDirs) {
      const stateFilePath = path.join(prdDir, ".roadmap-state.json");
      const state = tryReadJson<IRoadmapState>(stateFilePath);

      if (state === null) {
        continue;
      }

      if (
        typeof state.version !== "number" ||
        typeof state.items !== "object" ||
        state.items === null
      ) {
        continue;
      }

      // Back up the .roadmap-state.json alongside the other backup files
      const backupName = `roadmap-state-${Buffer.from(prdDir).toString("base64url").slice(0, 32)}.json`;
      try {
        fs.copyFileSync(stateFilePath, path.join(backupDir, backupName));
      } catch {
        // non-fatal — backup is best-effort
      }

      roadmapState.save(prdDir, {
        version: state.version,
        lastScan: typeof state.lastScan === "string" ? state.lastScan : "",
        items: state.items,
      });
      roadmapStatesMigrated++;
    }
  });
  migrateRoadmapStates();

  // --- Record completion ---
  db.prepare(
    `INSERT OR REPLACE INTO schema_meta (key, value)
     VALUES ('json_migration_completed', ?)`
  ).run(new Date().toISOString());

  return {
    projectsMigrated,
    historyRecordsMigrated,
    prdStatesMigrated,
    roadmapStatesMigrated,
    backupDir,
    alreadyMigrated: false,
  };
}
