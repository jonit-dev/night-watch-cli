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
 * container is initialized.
 */

import 'reflect-metadata';

import { container } from 'tsyringe';

import { SqliteAgentPersonaRepository } from '@/storage/repositories/sqlite/agent-persona.repository.js';
import { SqliteExecutionHistoryRepository } from '@/storage/repositories/sqlite/execution-history.repository.js';
import { SqlitePrdStateRepository } from '@/storage/repositories/sqlite/prd-state.repository.js';
import { SqliteProjectRegistryRepository } from '@/storage/repositories/sqlite/project-registry.repository.js';
import { SqliteRoadmapStateRepository } from '@/storage/repositories/sqlite/roadmap-state.repository.js';
import { createDbForDir } from '@/storage/sqlite/client.js';
import { runMigrations } from '@/storage/sqlite/migrations.js';

/** Opaque DB type inferred from the storage factory — avoids importing better-sqlite3 directly. */
type DbInstance = ReturnType<typeof createDbForDir>;

/** Token used to inject the raw better-sqlite3 Database instance. */
export const DATABASE_TOKEN = 'Database';

/**
 * Initialize the DI container with the SQLite database rooted at `projectDir`.
 * Safe to call multiple times — subsequent calls are no-ops if the Database token
 * is already registered.
 *
 * @param projectDir  The Night Watch home / project directory that contains (or will contain) state.db
 */
export function initContainer(projectDir: string): void {
  // Avoid double-registration if already initialized
  if (container.isRegistered(DATABASE_TOKEN)) {
    return;
  }

  // Create and configure the DB instance via the storage layer (respects SQL boundary rule)
  const db = createDbForDir(projectDir);

  // Run migrations so the schema is ready before repositories are ready
  runMigrations(db);

  // Register the DB instance by token so @inject('Database') in repository constructors resolves it
  container.registerInstance<DbInstance>(DATABASE_TOKEN, db);

  // Register each repository as a singleton. Tsyringe will auto-inject the Database via @inject('Database').
  container.registerSingleton(SqliteAgentPersonaRepository);
  container.registerSingleton(SqliteExecutionHistoryRepository);
  container.registerSingleton(SqlitePrdStateRepository);
  container.registerSingleton(SqliteProjectRegistryRepository);
  container.registerSingleton(SqliteRoadmapStateRepository);
}

/**
 * Returns true when the container has been initialized via initContainer().
 * Used by getRepositories() to decide whether to delegate to the DI container.
 */
export function isContainerInitialized(): boolean {
  return container.isRegistered(DATABASE_TOKEN);
}

export { container };
