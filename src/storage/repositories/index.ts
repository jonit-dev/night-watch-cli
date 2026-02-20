/**
 * Repository factory for Night Watch CLI.
 * Returns singleton repository instances backed by the SQLite database.
 * Migrations are applied lazily on first access.
 */

import { getDb } from "../sqlite/client.js";
import { runMigrations } from "../sqlite/migrations.js";
import {
  IAgentPersonaRepository,
  IExecutionHistoryRepository,
  IPrdStateRepository,
  IProjectRegistryRepository,
  IRoadmapStateRepository,
  ISlackDiscussionRepository,
} from "./interfaces.js";
import { SqliteProjectRegistryRepository } from "./sqlite/project-registry-repository.js";
import { SqliteExecutionHistoryRepository } from "./sqlite/execution-history-repository.js";
import { SqlitePrdStateRepository } from "./sqlite/prd-state-repository.js";
import { SqliteRoadmapStateRepository } from "./sqlite/roadmap-state-repository.js";
import { SqliteAgentPersonaRepository } from "./sqlite/agent-persona-repository.js";
import { SqliteSlackDiscussionRepository } from "./sqlite/slack-discussion-repository.js";

export interface IRepositories {
  projectRegistry: IProjectRegistryRepository;
  executionHistory: IExecutionHistoryRepository;
  prdState: IPrdStateRepository;
  roadmapState: IRoadmapStateRepository;
  agentPersona: IAgentPersonaRepository;
  slackDiscussion: ISlackDiscussionRepository;
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
    const agentPersonaRepo = new SqliteAgentPersonaRepository(db);
    agentPersonaRepo.seedDefaultsOnFirstRun();
    // Always patch avatar URLs for built-in personas that are missing them
    agentPersonaRepo.patchDefaultAvatarUrls();
    _initialized = true;
  }

  return {
    projectRegistry: new SqliteProjectRegistryRepository(db),
    executionHistory: new SqliteExecutionHistoryRepository(db),
    prdState: new SqlitePrdStateRepository(db),
    roadmapState: new SqliteRoadmapStateRepository(db),
    agentPersona: new SqliteAgentPersonaRepository(db),
    slackDiscussion: new SqliteSlackDiscussionRepository(db),
  };
}

/**
 * Reset the initialization flag.
 * Primarily useful in tests when the database connection is recycled.
 */
export function resetRepositories(): void {
  _initialized = false;
}
