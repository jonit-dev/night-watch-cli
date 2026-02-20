/**
 * Repository factory for Night Watch CLI.
 * Returns singleton repository instances backed by the SQLite database.
 * Migrations are applied lazily on first access.
 *
 * When the DI container has been initialized (via initContainer()), all repositories
 * are resolved from the container. Otherwise, the legacy singleton path is used for
 * backwards compatibility with tests and CLI contexts that don't use DI.
 */
import { container, isContainerInitialized } from '@/di/container.js';
import { getDb } from "../sqlite/client.js";
import { runMigrations } from "../sqlite/migrations.js";
import { SqliteProjectRegistryRepository } from "./sqlite/project-registry.repository.js";
import { SqliteExecutionHistoryRepository } from "./sqlite/execution-history.repository.js";
import { SqlitePrdStateRepository } from "./sqlite/prd-state.repository.js";
import { SqliteRoadmapStateRepository } from "./sqlite/roadmap-state.repository.js";
import { SqliteAgentPersonaRepository } from "./sqlite/agent-persona.repository.js";
import { SqliteSlackDiscussionRepository } from "./sqlite/slack-discussion.repository.js";
let _initialized = false;
/**
 * Return the set of available repositories, initialising the database and
 * running schema migrations on first call.
 *
 * When the DI container has been initialized via initContainer(), repositories
 * are resolved from the container (singletons). Otherwise the legacy path using
 * the global getDb() singleton is used for backwards compatibility.
 */
export function getRepositories() {
    if (isContainerInitialized()) {
        return {
            projectRegistry: container.resolve(SqliteProjectRegistryRepository),
            executionHistory: container.resolve(SqliteExecutionHistoryRepository),
            prdState: container.resolve(SqlitePrdStateRepository),
            roadmapState: container.resolve(SqliteRoadmapStateRepository),
            agentPersona: container.resolve(SqliteAgentPersonaRepository),
            slackDiscussion: container.resolve(SqliteSlackDiscussionRepository),
        };
    }
    // Legacy path: use the global DB singleton (backwards compat for tests/CLI without DI)
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
export function resetRepositories() {
    _initialized = false;
}
//# sourceMappingURL=index.js.map