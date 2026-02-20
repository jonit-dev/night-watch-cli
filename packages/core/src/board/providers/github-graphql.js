import { execFileSync } from "child_process";
/**
 * Execute a GraphQL query/mutation against the GitHub API using the `gh` CLI.
 *
 * Variables with numeric values are passed using `-F` (capital F) so the GitHub
 * API receives them as numbers rather than strings.  All other values use `-f`.
 */
export function graphql(query, variables, cwd) {
    const args = ["api", "graphql", "-f", `query=${query}`];
    for (const [key, value] of Object.entries(variables)) {
        if (typeof value === "number") {
            args.push("-F", `${key}=${String(value)}`);
        }
        else {
            args.push("-f", `${key}=${String(value)}`);
        }
    }
    const output = execFileSync("gh", args, {
        cwd,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
    });
    const parsed = JSON.parse(output);
    if (parsed.errors?.length) {
        throw new Error(`GraphQL error: ${parsed.errors[0].message}`);
    }
    return parsed.data;
}
/**
 * Return the "owner/repo" name for the current working directory using `gh repo view`.
 */
export function getRepoNwo(cwd) {
    const output = execFileSync("gh", ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"], { cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
    return output.trim();
}
/**
 * Return the authenticated GitHub user's login.
 */
export function getViewerLogin(cwd) {
    const result = graphql(`query { viewer { login } }`, {}, cwd);
    return result.viewer.login;
}
//# sourceMappingURL=github-graphql.js.map