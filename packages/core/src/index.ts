// Core package public API

export * from './types.js';
export * from './constants.js';
export * from './config.js';
export * from './board/types.js';
export * from './board/factory.js';
export * from './board/labels.js';
export { LocalKanbanProvider } from './board/providers/local-kanban.js';
export * from './board/roadmap-mapping.js';
export * from './storage/repositories/interfaces.js';
export * from './storage/repositories/index.js';
export { SqliteAgentPersonaRepository } from './storage/repositories/sqlite/agent-persona.repository.js';
export { SqliteKanbanIssueRepository } from './storage/repositories/sqlite/kanban-issue.repository.js';
export * from './storage/sqlite/client.js';
export * from './storage/sqlite/migrations.js';
export * from './storage/json-state-migrator.js';
export * from './di/container.js';
export * from './agents/soul-compiler.js';
export * from './utils/avatar-generator.js';
export * from './utils/logger.js';
export * from './utils/cancel.js';
export * from './utils/checks.js';
export * from './utils/config-writer.js';
export * from './utils/crontab.js';
export * from './utils/execution-history.js';
export * from './utils/github.js';
export * from './utils/notify.js';
export * from './utils/prd-states.js';
export * from './utils/prd-utils.js';
export * from './utils/registry.js';
export * from './utils/roadmap-context-compiler.js';
export * from './utils/roadmap-parser.js';
export * from './utils/roadmap-scanner.js';
export * from './utils/roadmap-state.js';
export * from './utils/script-result.js';
export * from './utils/shell.js';
export * from './utils/status-data.js';
export * from './utils/ui.js';
export * from './utils/webhook-validator.js';
export * from './templates/prd-template.js';
export * from './templates/slicer-prompt.js';
// Note: shared/types are re-exported selectively through types.ts to avoid duplicates.
// Import directly from '@night-watch/core/shared/types.js' if you need the full shared API contract.
export type {
  IAgentPersona,
  IAgentModelConfig,
  IAgentSoul,
  IAgentStyle,
  IAgentSkill,
  CreateAgentPersonaInput,
  UpdateAgentPersonaInput,
  IRoadmapContextOptions,
} from './shared/types.js';
