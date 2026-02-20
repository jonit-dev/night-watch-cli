import { GitHubProjectsProvider } from "./providers/github-projects.js";
export function createBoardProvider(config, cwd) {
    switch (config.provider) {
        case "github":
            return new GitHubProjectsProvider(config, cwd);
        default:
            throw new Error(`Unsupported board provider: ${config.provider}. Supported: github`);
    }
}
//# sourceMappingURL=factory.js.map