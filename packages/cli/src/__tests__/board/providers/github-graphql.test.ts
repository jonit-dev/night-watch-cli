import { describe, it, expect, vi, beforeEach } from "vitest";
import { execFileSync } from "child_process";

vi.mock("child_process");

import { graphql, getRepoNwo, getViewerLogin } from "@night-watch/core/board/providers/github-graphql.js";

const mockExecFileSync = vi.mocked(execFileSync);

describe("github-graphql helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("graphql", () => {
    it("executes gh api graphql with query", () => {
      mockExecFileSync.mockReturnValueOnce(
        JSON.stringify({ data: { viewer: { login: "octocat" } } }) as unknown as Buffer
      );

      const result = graphql<{ viewer: { login: string } }>(
        "query { viewer { login } }",
        {},
        "/tmp/test"
      );

      expect(result.viewer.login).toBe("octocat");
      expect(mockExecFileSync).toHaveBeenCalledWith(
        "gh",
        expect.arrayContaining(["api", "graphql", "-f", expect.stringContaining("query=")]),
        expect.objectContaining({ cwd: "/tmp/test" })
      );
    });

    it("passes string variables with -f flag", () => {
      mockExecFileSync.mockReturnValueOnce(
        JSON.stringify({ data: { user: { id: "U_123" } } }) as unknown as Buffer
      );

      graphql<{ user: { id: string } }>(
        "query GetUser($login: String!) { user(login: $login) { id } }",
        { login: "octocat" },
        "/tmp/test"
      );

      const call = mockExecFileSync.mock.calls[0];
      const args = call[1] as string[];
      expect(args).toContain("-f");
      expect(args).toContain("login=octocat");
    });

    it("passes numeric variables with -F flag (capital F)", () => {
      mockExecFileSync.mockReturnValueOnce(
        JSON.stringify({ data: { project: { id: "P_123" } } }) as unknown as Buffer
      );

      graphql<{ project: { id: string } }>(
        "query GetProject($number: Int!) { project(number: $number) { id } }",
        { number: 42 },
        "/tmp/test"
      );

      const call = mockExecFileSync.mock.calls[0];
      const args = call[1] as string[];
      // -F is used for numeric values
      expect(args).toContain("-F");
      expect(args).toContain("number=42");
    });

    it("throws on GraphQL errors", () => {
      mockExecFileSync.mockReturnValueOnce(
        JSON.stringify({
          errors: [{ message: "Field 'invalid' doesn't exist" }],
        }) as unknown as Buffer
      );

      expect(() =>
        graphql<{ data: unknown }>("query { invalid }", {}, "/tmp/test")
      ).toThrow("GraphQL error: Field 'invalid' doesn't exist");
    });

    it("throws on first error when multiple errors exist", () => {
      mockExecFileSync.mockReturnValueOnce(
        JSON.stringify({
          errors: [
            { message: "First error" },
            { message: "Second error" },
          ],
        }) as unknown as Buffer
      );

      expect(() =>
        graphql<{ data: unknown }>("query { test }", {}, "/tmp/test")
      ).toThrow("GraphQL error: First error");
    });

    it("handles empty data response", () => {
      mockExecFileSync.mockReturnValueOnce(
        JSON.stringify({ data: {} }) as unknown as Buffer
      );

      const result = graphql<{}>("query { __typename }", {}, "/tmp/test");
      expect(result).toEqual({});
    });

    it("uses correct stdio settings for child process", () => {
      mockExecFileSync.mockReturnValueOnce(
        JSON.stringify({ data: {} }) as unknown as Buffer
      );

      graphql<{}>("query { __typename }", {}, "/tmp/project");

      const call = mockExecFileSync.mock.calls[0];
      expect(call[2]).toMatchObject({
        cwd: "/tmp/project",
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      });
    });
  });

  describe("getRepoNwo", () => {
    it("returns owner/repo string", () => {
      mockExecFileSync.mockReturnValueOnce("owner/repo\n" as unknown as Buffer);

      const result = getRepoNwo("/tmp/test");

      expect(result).toBe("owner/repo");
      expect(mockExecFileSync).toHaveBeenCalledWith(
        "gh",
        ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"],
        expect.objectContaining({ cwd: "/tmp/test" })
      );
    });

    it("trims whitespace from output", () => {
      mockExecFileSync.mockReturnValueOnce("  owner/repo  \n" as unknown as Buffer);

      const result = getRepoNwo("/tmp/test");

      expect(result).toBe("owner/repo");
    });
  });

  describe("getViewerLogin", () => {
    it("returns the authenticated user login", () => {
      mockExecFileSync.mockReturnValueOnce(
        JSON.stringify({ data: { viewer: { login: "testuser" } } }) as unknown as Buffer
      );

      const result = getViewerLogin("/tmp/test");

      expect(result).toBe("testuser");
    });

    it("uses graphql helper internally", () => {
      mockExecFileSync.mockReturnValueOnce(
        JSON.stringify({ data: { viewer: { login: "octocat" } } }) as unknown as Buffer
      );

      getViewerLogin("/tmp/test");

      const call = mockExecFileSync.mock.calls[0];
      const args = call[1] as string[];
      expect(args).toContain("api");
      expect(args).toContain("graphql");
    });
  });
});
