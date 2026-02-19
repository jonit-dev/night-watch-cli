import { describe, it, expect, vi, beforeEach } from "vitest";
import { execFileSync } from "child_process";

vi.mock("child_process");

// Import the provider at the top level — the mock is already set up
import { GitHubProjectsProvider } from "@/board/providers/github-projects.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockExecFileSync = vi.mocked(execFileSync);

/** Wrap a data object in the GitHub GraphQL response envelope. */
function gqlResponse<T>(data: T): string {
  return JSON.stringify({ data });
}

/** Build a viewer login GraphQL response. */
function viewerLoginResponse(login = "octocat"): string {
  return gqlResponse({ viewer: { login } });
}

/** Build a user projectV2 GraphQL response. */
function projectV2Response(
  id = "project-node-id",
  title = "My Board",
  url = "https://github.com/users/octocat/projects/1"
): string {
  return gqlResponse({ user: { projectV2: { id, title, url } } });
}

/** Build a Status field GraphQL response with the five lifecycle columns. */
function statusFieldResponse(fieldId = "field-node-id"): string {
  return gqlResponse({
    node: {
      field: {
        id: fieldId,
        options: [
          { id: "opt-draft", name: "Draft" },
          { id: "opt-ready", name: "Ready" },
          { id: "opt-wip", name: "In Progress" },
          { id: "opt-review", name: "Review" },
          { id: "opt-done", name: "Done" },
        ],
      },
    },
  });
}

/** Build a project items GraphQL response. */
function makeItemsResponse(
  items: Array<{
    id: string;
    number: number;
    statusName?: string;
    title?: string;
  }>
): string {
  return gqlResponse({
    node: {
      items: {
        nodes: items.map((item) => ({
          id: `item-${item.id}`,
          content: {
            number: item.number,
            title: item.title ?? `Issue ${item.number}`,
            body: "body",
            url: `https://github.com/owner/repo/issues/${item.number}`,
            id: `issue-node-${item.id}`,
            labels: { nodes: [] },
            assignees: { nodes: [] },
          },
          fieldValues: {
            nodes: item.statusName
              ? [{ name: item.statusName, field: { name: "Status" } }]
              : [],
          },
        })),
      },
    },
  });
}

/**
 * Queue the three execFileSync calls needed to prime ensureProjectCache.
 * Returns the mock for chaining.
 */
function queueCachePrimingMocks(): void {
  mockExecFileSync
    .mockReturnValueOnce(viewerLoginResponse() as unknown as Buffer)
    .mockReturnValueOnce(projectV2Response() as unknown as Buffer)
    .mockReturnValueOnce(statusFieldResponse() as unknown as Buffer);
}

// ---------------------------------------------------------------------------
// Shared config
// ---------------------------------------------------------------------------

const mockConfig = {
  enabled: true,
  provider: "github" as const,
  projectNumber: 1,
  repo: "owner/repo",
};

const CWD = "/tmp/test-project";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GitHubProjectsProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // setupBoard
  // -------------------------------------------------------------------------

  describe("setupBoard", () => {
    it("creates a project and Status field with five columns", async () => {
      mockExecFileSync
        // viewer query { viewer { id login } }
        .mockReturnValueOnce(
          gqlResponse({
            viewer: { id: "user-node-id", login: "octocat" },
          }) as unknown as Buffer
        )
        // createProjectV2 mutation
        .mockReturnValueOnce(
          gqlResponse({
            createProjectV2: {
              projectV2: {
                id: "project-node-id",
                number: 42,
                url: "https://github.com/orgs/owner/projects/42",
                title: "My Board",
              },
            },
          }) as unknown as Buffer
        )
        // createProjectV2Field mutation
        .mockReturnValueOnce(
          gqlResponse({
            createProjectV2Field: {
              projectV2Field: {
                id: "field-node-id",
                options: [
                  { id: "opt-draft", name: "Draft" },
                  { id: "opt-ready", name: "Ready" },
                  { id: "opt-wip", name: "In Progress" },
                  { id: "opt-review", name: "Review" },
                  { id: "opt-done", name: "Done" },
                ],
              },
            },
          }) as unknown as Buffer
        );

      const provider = new GitHubProjectsProvider(mockConfig, CWD);
      const board = await provider.setupBoard("My Board");

      expect(board).toEqual({
        id: "project-node-id",
        title: "My Board",
        url: "https://github.com/orgs/owner/projects/42",
      });

      // Verify the Status-field mutation was called
      const calls = mockExecFileSync.mock.calls;
      const mutationCall = calls.find(
        (c) =>
          Array.isArray(c[1]) &&
          (c[1] as string[]).some((a) => a.includes("createProjectV2Field"))
      );
      expect(mutationCall).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // getBoard
  // -------------------------------------------------------------------------

  describe("getBoard", () => {
    it("returns null when projectNumber is not configured", async () => {
      const provider = new GitHubProjectsProvider(
        { enabled: true, provider: "github" },
        CWD
      );
      const board = await provider.getBoard();
      expect(board).toBeNull();
      expect(mockExecFileSync).not.toHaveBeenCalled();
    });

    it("returns null when the GitHub query throws", async () => {
      mockExecFileSync.mockImplementationOnce(() => {
        throw new Error("gh: not authenticated");
      });

      const provider = new GitHubProjectsProvider(mockConfig, CWD);
      const board = await provider.getBoard();
      expect(board).toBeNull();
    });

    it("returns board info when project is found via user query", async () => {
      mockExecFileSync
        .mockReturnValueOnce(viewerLoginResponse() as unknown as Buffer)
        .mockReturnValueOnce(projectV2Response() as unknown as Buffer);

      const provider = new GitHubProjectsProvider(mockConfig, CWD);
      const board = await provider.getBoard();

      expect(board).toEqual({
        id: "project-node-id",
        title: "My Board",
        url: "https://github.com/users/octocat/projects/1",
      });
    });
  });

  // -------------------------------------------------------------------------
  // getColumns
  // -------------------------------------------------------------------------

  describe("getColumns", () => {
    it("returns five lifecycle columns in correct order", async () => {
      queueCachePrimingMocks();

      const provider = new GitHubProjectsProvider(mockConfig, CWD);
      const columns = await provider.getColumns();

      expect(columns).toHaveLength(5);
      expect(columns.map((c) => c.name)).toEqual([
        "Draft",
        "Ready",
        "In Progress",
        "Review",
        "Done",
      ]);
      expect(columns.find((c) => c.name === "Draft")?.id).toBe("opt-draft");
    });

    it("throws when Status field is missing", async () => {
      mockExecFileSync
        .mockReturnValueOnce(viewerLoginResponse() as unknown as Buffer)
        .mockReturnValueOnce(projectV2Response() as unknown as Buffer)
        .mockReturnValueOnce(
          gqlResponse({
            node: {
              field: null,
            },
          }) as unknown as Buffer
        );

      const provider = new GitHubProjectsProvider(mockConfig, CWD);
      await expect(provider.getColumns()).rejects.toThrow(
        "Status field not found"
      );
    });

    it("throws when projectNumber is not configured", async () => {
      const provider = new GitHubProjectsProvider(
        { enabled: true, provider: "github" },
        CWD
      );
      await expect(provider.getColumns()).rejects.toThrow(
        "No projectNumber configured"
      );
    });
  });

  // -------------------------------------------------------------------------
  // createIssue
  // -------------------------------------------------------------------------

  describe("createIssue", () => {
    it("creates an issue and adds it to the board in Draft column by default", async () => {
      queueCachePrimingMocks();

      mockExecFileSync
        // gh issue create → returns URL
        .mockReturnValueOnce(
          "https://github.com/owner/repo/issues/7\n" as unknown as Buffer
        )
        // gh api repos/owner/repo/issues/7 --jq .node_id → returns node ID
        .mockReturnValueOnce("issue-node-id-7\n" as unknown as Buffer)
        // addProjectV2ItemById mutation
        .mockReturnValueOnce(
          gqlResponse({
            addProjectV2ItemById: { item: { id: "item-node-id-7" } },
          }) as unknown as Buffer
        )
        // updateProjectV2ItemFieldValue mutation (set Draft)
        .mockReturnValueOnce(
          gqlResponse({
            updateProjectV2ItemFieldValue: {
              projectV2Item: { id: "item-node-id-7" },
            },
          }) as unknown as Buffer
        )
        // gh issue view (called first inside getIssue — cache is already warm)
        .mockReturnValueOnce(
          JSON.stringify({
            number: 7,
            title: "New Feature",
            body: "Feature body",
            url: "https://github.com/owner/repo/issues/7",
            id: "issue-node-id-7",
            labels: [],
            assignees: [],
          }) as unknown as Buffer
        )
        // getAllIssues — project items (column resolution, cache already warm)
        .mockReturnValueOnce(
          makeItemsResponse([
            { id: "7", number: 7, title: "New Feature", statusName: "Draft" },
          ]) as unknown as Buffer
        );

      const provider = new GitHubProjectsProvider(mockConfig, CWD);
      const issue = await provider.createIssue({
        title: "New Feature",
        body: "Feature body",
      });

      expect(issue.number).toBe(7);
      expect(issue.title).toBe("New Feature");
      expect(issue.column).toBe("Draft");

      // Verify gh issue create was called with correct args
      const createCall = mockExecFileSync.mock.calls.find(
        (c) =>
          Array.isArray(c[1]) &&
          (c[1] as string[])[0] === "issue" &&
          (c[1] as string[])[1] === "create"
      );
      expect(createCall).toBeDefined();
      const createArgs = createCall![1] as string[];
      expect(createArgs).toContain("--title");
      expect(createArgs).toContain("New Feature");
      expect(createArgs).toContain("--repo");
      expect(createArgs).toContain("owner/repo");
    });

    it("places the issue in the specified column", async () => {
      queueCachePrimingMocks();

      mockExecFileSync
        // gh issue create → returns URL
        .mockReturnValueOnce(
          "https://github.com/owner/repo/issues/8\n" as unknown as Buffer
        )
        // gh api repos/owner/repo/issues/8 --jq .node_id
        .mockReturnValueOnce("issue-node-id-8\n" as unknown as Buffer)
        // addProjectV2ItemById
        .mockReturnValueOnce(
          gqlResponse({
            addProjectV2ItemById: { item: { id: "item-node-id-8" } },
          }) as unknown as Buffer
        )
        // updateProjectV2ItemFieldValue
        .mockReturnValueOnce(
          gqlResponse({
            updateProjectV2ItemFieldValue: {
              projectV2Item: { id: "item-node-id-8" },
            },
          }) as unknown as Buffer
        )
        // gh issue view (called first inside getIssue — cache is already warm)
        .mockReturnValueOnce(
          JSON.stringify({
            number: 8,
            title: "Ready Task",
            body: "body",
            url: "https://github.com/owner/repo/issues/8",
            id: "issue-node-id-8",
            labels: [],
            assignees: [],
          }) as unknown as Buffer
        )
        // getAllIssues — project items (column resolution, cache already warm)
        .mockReturnValueOnce(
          makeItemsResponse([
            { id: "8", number: 8, title: "Ready Task", statusName: "Ready" },
          ]) as unknown as Buffer
        );

      const provider = new GitHubProjectsProvider(mockConfig, CWD);
      const issue = await provider.createIssue({
        title: "Ready Task",
        body: "body",
        column: "Ready",
      });

      expect(issue.column).toBe("Ready");

      // Verify updateProjectV2ItemFieldValue used opt-ready
      const updateCall = mockExecFileSync.mock.calls.find(
        (c) =>
          Array.isArray(c[1]) &&
          (c[1] as string[]).some((a) =>
            a.includes("updateProjectV2ItemFieldValue")
          )
      );
      expect(updateCall).toBeDefined();
      const updateArgs = updateCall![1] as string[];
      expect(updateArgs).toContain("optionId=opt-ready");
    });
  });

  // -------------------------------------------------------------------------
  // moveIssue
  // -------------------------------------------------------------------------

  describe("moveIssue", () => {
    it("updates the Status field for the given issue", async () => {
      queueCachePrimingMocks();

      mockExecFileSync
        // getProjectItems (single query for item lookup)
        .mockReturnValueOnce(
          makeItemsResponse([
            { id: "5", number: 5, statusName: "Draft" },
          ]) as unknown as Buffer
        )
        // updateProjectV2ItemFieldValue
        .mockReturnValueOnce(
          gqlResponse({
            updateProjectV2ItemFieldValue: {
              projectV2Item: { id: "item-5" },
            },
          }) as unknown as Buffer
        );

      const provider = new GitHubProjectsProvider(mockConfig, CWD);
      await provider.moveIssue(5, "In Progress");

      // Verify updateProjectV2ItemFieldValue used opt-wip
      const updateCall = mockExecFileSync.mock.calls.find(
        (c) =>
          Array.isArray(c[1]) &&
          (c[1] as string[]).some((a) =>
            a.includes("updateProjectV2ItemFieldValue")
          )
      );
      expect(updateCall).toBeDefined();
      const updateArgs = updateCall![1] as string[];
      expect(updateArgs).toContain("optionId=opt-wip");
    });

    it("throws when the issue is not on the board", async () => {
      queueCachePrimingMocks();

      // getProjectItems — empty board
      mockExecFileSync.mockReturnValueOnce(
        gqlResponse({
          node: { items: { nodes: [] } },
        }) as unknown as Buffer
      );

      const provider = new GitHubProjectsProvider(mockConfig, CWD);
      await expect(provider.moveIssue(999, "Done")).rejects.toThrow(
        "Issue #999 not found on the project board"
      );
    });

    it("throws when target column is not in the option IDs", async () => {
      // Set up cache with incomplete options (missing "Done")
      mockExecFileSync
        .mockReturnValueOnce(viewerLoginResponse() as unknown as Buffer)
        .mockReturnValueOnce(projectV2Response() as unknown as Buffer)
        .mockReturnValueOnce(
          gqlResponse({
            node: {
              field: {
                id: "field-node-id",
                options: [
                  { id: "opt-draft", name: "Draft" },
                  { id: "opt-ready", name: "Ready" },
                  // Missing "Done" option
                ],
              },
            },
          }) as unknown as Buffer
        );

      mockExecFileSync.mockReturnValueOnce(
        makeItemsResponse([{ id: "5", number: 5, statusName: "Draft" }]) as unknown as Buffer
      );

      const provider = new GitHubProjectsProvider(mockConfig, CWD);
      await expect(provider.moveIssue(5, "Done")).rejects.toThrow(
        'Column "Done" not found on the project board'
      );
    });
  });

  // -------------------------------------------------------------------------
  // getIssuesByColumn
  // -------------------------------------------------------------------------

  describe("getIssuesByColumn", () => {
    it("filters issues by column status", async () => {
      queueCachePrimingMocks();

      mockExecFileSync.mockReturnValueOnce(
        makeItemsResponse([
          { id: "1", number: 1, statusName: "Draft" },
          { id: "2", number: 2, statusName: "In Progress" },
          { id: "3", number: 3, statusName: "In Progress" },
          { id: "4", number: 4, statusName: "Done" },
        ]) as unknown as Buffer
      );

      const provider = new GitHubProjectsProvider(mockConfig, CWD);
      const inProgress = await provider.getIssuesByColumn("In Progress");

      expect(inProgress).toHaveLength(2);
      expect(inProgress.every((i) => i.column === "In Progress")).toBe(true);
      expect(inProgress.map((i) => i.number)).toEqual([2, 3]);
    });
  });

  // -------------------------------------------------------------------------
  // closeIssue
  // -------------------------------------------------------------------------

  describe("closeIssue", () => {
    it("calls gh issue close with correct arguments", async () => {
      mockExecFileSync.mockReturnValueOnce("" as unknown as Buffer);

      const provider = new GitHubProjectsProvider(mockConfig, CWD);
      await provider.closeIssue(42);

      const call = mockExecFileSync.mock.calls[0];
      expect(call[0]).toBe("gh");
      const args = call[1] as string[];
      expect(args).toEqual(["issue", "close", "42", "--repo", "owner/repo"]);
    });
  });

  // -------------------------------------------------------------------------
  // commentOnIssue
  // -------------------------------------------------------------------------

  describe("commentOnIssue", () => {
    it("calls gh issue comment with correct arguments", async () => {
      mockExecFileSync.mockReturnValueOnce("" as unknown as Buffer);

      const provider = new GitHubProjectsProvider(mockConfig, CWD);
      await provider.commentOnIssue(10, "LGTM!");

      const call = mockExecFileSync.mock.calls[0];
      expect(call[0]).toBe("gh");
      const args = call[1] as string[];
      expect(args).toEqual([
        "issue",
        "comment",
        "10",
        "--repo",
        "owner/repo",
        "--body",
        "LGTM!",
      ]);
    });
  });

  // -------------------------------------------------------------------------
  // getAllIssues
  // -------------------------------------------------------------------------

  describe("getAllIssues", () => {
    it("returns all issues from project items", async () => {
      queueCachePrimingMocks();

      mockExecFileSync.mockReturnValueOnce(
        makeItemsResponse([
          { id: "1", number: 1, statusName: "Draft" },
          { id: "2", number: 2, statusName: "Done" },
        ]) as unknown as Buffer
      );

      const provider = new GitHubProjectsProvider(mockConfig, CWD);
      const issues = await provider.getAllIssues();

      expect(issues).toHaveLength(2);
      expect(issues[0].number).toBe(1);
      expect(issues[0].column).toBe("Draft");
      expect(issues[1].number).toBe(2);
      expect(issues[1].column).toBe("Done");
    });

    it("skips non-issue items (null content)", async () => {
      queueCachePrimingMocks();

      // Provide one real issue and one draft text item with null content
      mockExecFileSync.mockReturnValueOnce(
        gqlResponse({
          node: {
            items: {
              nodes: [
                {
                  id: "item-real",
                  content: {
                    number: 1,
                    title: "Real Issue",
                    body: "",
                    url: "https://github.com/owner/repo/issues/1",
                    id: "issue-node-1",
                    labels: { nodes: [] },
                    assignees: { nodes: [] },
                  },
                  fieldValues: {
                    nodes: [
                      { name: "Draft", field: { name: "Status" } },
                    ],
                  },
                },
                {
                  id: "item-text",
                  content: null,
                  fieldValues: { nodes: [] },
                },
              ],
            },
          },
        }) as unknown as Buffer
      );

      const provider = new GitHubProjectsProvider(mockConfig, CWD);
      const issues = await provider.getAllIssues();

      expect(issues).toHaveLength(1);
      expect(issues[0].number).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // getIssue
  // -------------------------------------------------------------------------

  describe("getIssue", () => {
    it("returns null when gh issue view fails", async () => {
      mockExecFileSync.mockImplementationOnce(() => {
        throw new Error("issue not found");
      });

      const provider = new GitHubProjectsProvider(mockConfig, CWD);
      const issue = await provider.getIssue(9999);
      expect(issue).toBeNull();
    });

    it("returns issue with column resolved from project board", async () => {
      mockExecFileSync
        // 1. gh issue view — called first (no cache needed)
        .mockReturnValueOnce(
          JSON.stringify({
            number: 3,
            title: "A PR",
            body: "ready for review",
            url: "https://github.com/owner/repo/issues/3",
            id: "issue-node-3",
            labels: [{ name: "bug" }],
            assignees: [{ login: "dev1" }],
          }) as unknown as Buffer
        )
        // 2-4. ensureProjectCache inside getAllIssues
        .mockReturnValueOnce(viewerLoginResponse() as unknown as Buffer)
        .mockReturnValueOnce(projectV2Response() as unknown as Buffer)
        .mockReturnValueOnce(statusFieldResponse() as unknown as Buffer)
        // 5. getAllIssues — project items (for column resolution)
        .mockReturnValueOnce(
          makeItemsResponse([
            { id: "3", number: 3, statusName: "Review" },
          ]) as unknown as Buffer
        );

      const provider = new GitHubProjectsProvider(mockConfig, CWD);
      const issue = await provider.getIssue(3);

      expect(issue).not.toBeNull();
      expect(issue!.number).toBe(3);
      expect(issue!.column).toBe("Review");
      expect(issue!.labels).toEqual(["bug"]);
      expect(issue!.assignees).toEqual(["dev1"]);
    });
  });
});
