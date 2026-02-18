/**
 * Repository factory for Night Watch CLI.
 * Returns singleton repository instances backed by the SQLite database.
 * Migrations are applied lazily on first access.
 */

import { getDb } from "../sqlite/client.js";
import { runMigrations } from "../sqlite/migrations.js";
import {
  IExecutionHistoryRepository,
  IPrdStateRepository,
  IProjectRegistryRepository,
  IRoadmapStateRepository,
} from "./interfaces.js";
import { SqliteProjectRegistryRepository } from "./sqlite/project-registry-repository.js";
import { SqliteExecutionHistoryRepository } from "./sqlite/execution-history-repository.js";
import { SqlitePrdStateRepository } from "./sqlite/prd-state-repository.js";
import { SqliteRoadmapStateRepository } from "./sqlite/roadmap-state-repository.js";

export interface IRepositories {
  projectRegistry: IProjectRegistryRepository;
  executionHistory: IExecutionHistoryRepository;
  prdState: IPrdStateRepository;
  roadmapState: IRoadmapStateRepository;
}

let _initialized = false;

/**
 * Return the set of available repositories, initialising the database and
 * running schema migrations on first call.
 */
export function getRepositories(): IRepositories {
  const db = getDb();

  if (!_initialized) {
    runMigrations(db);
    _initialized = true;
  }

  return {
    projectRegistry: new SqliteProjectRegistryRepository(db),
    executionHistory: new SqliteExecutionHistoryRepository(db),
    prdState: new SqlitePrdStateRepository(db),
    roadmapState: new SqliteRoadmapStateRepository(db),
  };
}

/**
 * Reset the initialization flag.
 * Primarily useful in tests when the database connection is recycled.
 */
export function resetRepositories(): void {
  _initialized = false;
}
