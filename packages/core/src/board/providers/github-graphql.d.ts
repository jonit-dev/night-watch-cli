/**
 * Execute a GraphQL query/mutation against the GitHub API using the `gh` CLI.
 *
 * Variables with numeric values are passed using `-F` (capital F) so the GitHub
 * API receives them as numbers rather than strings.  All other values use `-f`.
 */
export declare function graphql<T>(query: string, variables: Record<string, unknown>, cwd: string): T;
/**
 * Return the "owner/repo" name for the current working directory using `gh repo view`.
 */
export declare function getRepoNwo(cwd: string): string;
/**
 * Return the authenticated GitHub user's login.
 */
export declare function getViewerLogin(cwd: string): string;
//# sourceMappingURL=github-graphql.d.ts.map