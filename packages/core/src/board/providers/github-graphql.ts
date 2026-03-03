import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

/**
 * Execute a GraphQL query/mutation against the GitHub API using the `gh` CLI.
 *
 * Variables with numeric values are passed using `-F` (capital F) so the GitHub
 * API receives them as numbers rather than strings.  All other values use `-f`.
 */
export async function graphql<T>(
  query: string,
  variables: Record<string, unknown>,
  cwd: string
): Promise<T> {
  const args = ["api", "graphql", "-f", `query=${query}`];

  for (const [key, value] of Object.entries(variables)) {
    if (typeof value === "number") {
      args.push("-F", `${key}=${String(value)}`);
    } else {
      args.push("-f", `${key}=${String(value)}`);
    }
  }

  const { stdout: output } = await execFileAsync("gh", args, {
    cwd,
    encoding: "utf-8",
  });

  const parsed = JSON.parse(output) as {
    data?: T;
    errors?: Array<{ message: string }>;
  };

  if (parsed.errors?.length) {
    throw new Error(`GraphQL error: ${parsed.errors[0].message}`);
  }

  return parsed.data as T;
}

/**
 * Return the "owner/repo" name for the current working directory using `gh repo view`.
 */
export async function getRepoNwo(cwd: string): Promise<string> {
  const { stdout: output } = await execFileAsync(
    "gh",
    ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"],
    { cwd, encoding: "utf-8" }
  );
  return output.trim();
}

/**
 * Return the authenticated GitHub user's login.
 */
export async function getViewerLogin(cwd: string): Promise<string> {
  const result = await graphql<{ viewer: { login: string } }>(
    `query { viewer { login } }`,
    {},
    cwd
  );
  return result.viewer.login;
}
