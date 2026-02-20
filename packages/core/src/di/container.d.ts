/**
 * DI composition root for Night Watch CLI.
 * Bootstraps the Tsyringe container with the SQLite database and all repository singletons.
 *
 * Phase 2: Repositories decorated with @injectable() + @inject('Database') are resolved
 * via registerSingleton. The Database instance is registered via registerInstance so
 * tsyringe can auto-inject it by the DATABASE_TOKEN string token.
 *
 * Phase 5: Service classes (NotificationService, StatusService, RoadmapService) are
 * registered by the server package via extendContainerWithServices() after the core
 * container is initialized. Slack instances are registered by the composition root
 * (server/index.ts) after the config is loaded — they require runtime configuration
 * values (tokens, config) that are not available at container bootstrap time.
 */
import 'reflect-metadata';
import { container } from 'tsyringe';
/** Token used to inject the raw better-sqlite3 Database instance. */
export declare const DATABASE_TOKEN = "Database";
/**
 * Initialize the DI container with the SQLite database rooted at `projectDir`.
 * Safe to call multiple times — subsequent calls are no-ops if the Database token
 * is already registered.
 *
 * @param projectDir  The Night Watch home / project directory that contains (or will contain) state.db
 */
export declare function initContainer(projectDir: string): void;
/**
 * Returns true when the container has been initialized via initContainer().
 * Used by getRepositories() to decide whether to delegate to the DI container.
 */
export declare function isContainerInitialized(): boolean;
export { container };
//# sourceMappingURL=container.d.ts.map