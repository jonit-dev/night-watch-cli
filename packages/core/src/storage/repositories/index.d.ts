/**
 * Repository factory for Night Watch CLI.
 * Returns singleton repository instances backed by the SQLite database.
 * Migrations are applied lazily on first access.
 *
 * When the DI container has been initialized (via initContainer()), all repositories
 * are resolved from the container. Otherwise, the legacy singleton path is used for
 * backwards compatibility with tests and CLI contexts that don't use DI.
 */
import { IAgentPersonaRepository, IExecutionHistoryRepository, IPrdStateRepository, IProjectRegistryRepository, IRoadmapStateRepository, ISlackDiscussionRepository } from "./interfaces.js";
export interface IRepositories {
    projectRegistry: IProjectRegistryRepository;
    executionHistory: IExecutionHistoryRepository;
    prdState: IPrdStateRepository;
    roadmapState: IRoadmapStateRepository;
    agentPersona: IAgentPersonaRepository;
    slackDiscussion: ISlackDiscussionRepository;
}
/**
 * Return the set of available repositories, initialising the database and
 * running schema migrations on first call.
 *
 * When the DI container has been initialized via initContainer(), repositories
 * are resolved from the container (singletons). Otherwise the legacy path using
 * the global getDb() singleton is used for backwards compatibility.
 */
export declare function getRepositories(): IRepositories;
/**
 * Reset the initialization flag.
 * Primarily useful in tests when the database connection is recycled.
 */
export declare function resetRepositories(): void;
//# sourceMappingURL=index.d.ts.map