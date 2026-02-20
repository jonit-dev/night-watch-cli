import { IBoardProvider, IBoardProviderConfig } from "./types.js";
import { GitHubProjectsProvider } from "./providers/github-projects.js";

export function createBoardProvider(config: IBoardProviderConfig, cwd: string): IBoardProvider {
  switch (config.provider) {
    case "github":
      return new GitHubProjectsProvider(config, cwd);
    default:
      throw new Error(`Unsupported board provider: ${config.provider}. Supported: github`);
  }
}
