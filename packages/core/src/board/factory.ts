import { container } from '@/di/container.js';
import { SqliteKanbanIssueRepository } from '@/storage/repositories/sqlite/kanban-issue.repository.js';

import { GitHubProjectsProvider } from './providers/github-projects.js';
import { LocalKanbanProvider } from './providers/local-kanban.js';
import { IBoardProvider, IBoardProviderConfig } from './types.js';

export function createBoardProvider(config: IBoardProviderConfig, cwd: string): IBoardProvider {
  switch (config.provider) {
    case 'github':
      return new GitHubProjectsProvider(config, cwd);
    case 'local': {
      const repo = container.resolve(SqliteKanbanIssueRepository);
      return new LocalKanbanProvider(repo);
    }
    default:
      throw new Error(`Unsupported board provider: ${config.provider}. Supported: github, local`);
  }
}
