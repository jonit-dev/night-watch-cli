import { describe, it, expect, vi, beforeEach } from "vitest";
import { execFile } from "child_process";

let mockExecFileImpl: ((args: string[]) => string) = () => "";

vi.mock("child_process", () => ({
  execFile: vi.fn((_cmd: string, _args: string[], _opts: unknown, cb?: (err: Error | null, result: { stdout: string; stderr: string }) => void) => {
    const callback = typeof _opts === "function" ? (_opts as typeof cb) : cb;
    try {
      const result = mockExecFileImpl(_args as string[]);
      callback?.(null, { stdout: result, stderr: "" });
    } catch (err) {
      callback?.(err instanceof Error ? err : new Error(String(err)), { stdout: "", stderr: "" });
    }
  }),
  exec: vi.fn(),
  execSync: vi.fn(),
  spawn: vi.fn(),
}));

import { graphql, getRepoNwo, getViewerLogin } from "@night-watch/core/board/providers/github-graphql.js";

const mockExecFile = vi.mocked(execFile);

describe("github-graphql helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecFileImpl = () => "";
  });

  describe("graphql", () => {
    it("executes gh api graphql with query", async () => {
      mockExecFileImpl = () =>
        JSON.stringify({ data: { viewer: { login: "octocat" } } });

      const result = await graphql<{ viewer: { login: string } }>(
        "query { viewer { login } }",
        {},
        "/tmp/test"
      );

      expect(result.viewer.login).toBe("octocat");
      expect(mockExecFile).toHaveBeenCalledWith(
        "gh",
        expect.arrayContaining(["api", "graphql", "-f", expect.stringContaining("query=")]),
        expect.objectContaining({ cwd: "/tmp/test" }),
        expect.any(Function)
      );
    });

    it("passes string variables with -f flag", async () => {
      mockExecFileImpl = () =>
        JSON.stringify({ data: { user: { id: "U_123" } } });

      await graphql<{ user: { id: string } }>(
        "query GetUser($login: String!) { user(login: $login) { id } }",
        { login: "octocat" },
        "/tmp/test"
      );

      const call = mockExecFile.mock.calls[0];
      const args = call[1] as string[];
      expect(args).toContain("-f");
      expect(args).toContain("login=octocat");
    });

    it("passes numeric variables with -F flag (capital F)", async () => {
      mockExecFileImpl = () =>
        JSON.stringify({ data: { project: { id: "P_123" } } });

      await graphql<{ project: { id: string } }>(
        "query GetProject($number: Int!) { project(number: $number) { id } }",
        { number: 42 },
        "/tmp/test"
      );

      const call = mockExecFile.mock.calls[0];
      const args = call[1] as string[];
      // -F is used for numeric values
      expect(args).toContain("-F");
      expect(args).toContain("number=42");
    });

    it("throws on GraphQL errors", async () => {
      mockExecFileImpl = () =>
        JSON.stringify({
          errors: [{ message: "Field 'invalid' doesn't exist" }],
        });

      await expect(
        graphql<{ data: unknown }>("query { invalid }", {}, "/tmp/test")
      ).rejects.toThrow("GraphQL error: Field 'invalid' doesn't exist");
    });

    it("throws on first error when multiple errors exist", async () => {
      mockExecFileImpl = () =>
        JSON.stringify({
          errors: [
            { message: "First error" },
            { message: "Second error" },
          ],
        });

      await expect(
        graphql<{ data: unknown }>("query { test }", {}, "/tmp/test")
      ).rejects.toThrow("GraphQL error: First error");
    });

    it("handles empty data response", async () => {
      mockExecFileImpl = () => JSON.stringify({ data: {} });

      const result = await graphql<{}>("query { __typename }", {}, "/tmp/test");
      expect(result).toEqual({});
    });

    it("uses correct options for child process", async () => {
      mockExecFileImpl = () => JSON.stringify({ data: {} });

      await graphql<{}>("query { __typename }", {}, "/tmp/project");

      const call = mockExecFile.mock.calls[0];
      expect(call[2]).toMatchObject({
        cwd: "/tmp/project",
        encoding: "utf-8",
      });
    });
  });

  describe("getRepoNwo", () => {
    it("returns owner/repo string", async () => {
      mockExecFileImpl = () => "owner/repo\n";

      const result = await getRepoNwo("/tmp/test");

      expect(result).toBe("owner/repo");
      expect(mockExecFile).toHaveBeenCalledWith(
        "gh",
        ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"],
        expect.objectContaining({ cwd: "/tmp/test" }),
        expect.any(Function)
      );
    });

    it("trims whitespace from output", async () => {
      mockExecFileImpl = () => "  owner/repo  \n";

      const result = await getRepoNwo("/tmp/test");

      expect(result).toBe("owner/repo");
    });
  });

  describe("getViewerLogin", () => {
    it("returns the authenticated user login", async () => {
      mockExecFileImpl = () =>
        JSON.stringify({ data: { viewer: { login: "testuser" } } });

      const result = await getViewerLogin("/tmp/test");

      expect(result).toBe("testuser");
    });

    it("uses graphql helper internally", async () => {
      mockExecFileImpl = () =>
        JSON.stringify({ data: { viewer: { login: "octocat" } } });

      await getViewerLogin("/tmp/test");

      const call = mockExecFile.mock.calls[0];
      const args = call[1] as string[];
      expect(args).toContain("api");
      expect(args).toContain("graphql");
    });
  });
});
