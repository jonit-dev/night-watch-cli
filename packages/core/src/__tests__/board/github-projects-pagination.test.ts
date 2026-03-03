/**
 * Tests for GitHubProjectsProvider pagination behaviour.
 *
 * The provider's getAllIssues() and moveIssue() methods previously used a
 * hard-coded `items(first: 100)` GraphQL query with no cursor, silently
 * truncating boards that have more than 100 items.
 *
 * These tests verify that cursor-based pagination is now applied so that all
 * items across multiple pages are fetched and returned correctly.
 *
 * Strategy: mock `child_process.execFile` so that `promisify(execFile)` (used
 * inside the `graphql` helper) resolves with pre-built JSON payloads.  We
 * inspect the arguments passed on each call to verify the cursor is forwarded
 * correctly to subsequent requests.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock child_process BEFORE any imports that pull in the modules under test.
// ---------------------------------------------------------------------------
vi.mock("child_process", () => {
  const execFile = vi.fn();
  return { execFile };
});

import { execFile } from "child_process";
import { GitHubProjectsProvider } from "../../board/providers/github-projects.js";

// ---------------------------------------------------------------------------
// Helpers to build mock GraphQL response payloads
// ---------------------------------------------------------------------------

interface IMockItem {
  id: string;
  number: number;
  title?: string;
  status?: string;
}

function buildItemsPage(
  items: IMockItem[],
  hasNextPage: boolean,
  endCursor: string | null
) {
  return {
    data: {
      node: {
        items: {
          pageInfo: { hasNextPage, endCursor },
          nodes: items.map((item) => ({
            id: `item-${item.id}`,
            content: {
              number: item.number,
              title: item.title ?? `Issue #${item.number}`,
              body: "",
              url: `https://github.com/owner/repo/issues/${item.number}`,
              id: `issue-id-${item.number}`,
              labels: { nodes: [] },
              assignees: { nodes: [] },
            },
            fieldValues: {
              nodes: item.status
                ? [
                    {
                      name: item.status,
                      field: { name: "Status" },
                    },
                  ]
                : [],
            },
          })),
        },
      },
    },
  };
}

function buildStatusFieldResponse(projectId: string) {
  return {
    data: {
      node: {
        field: {
          id: `field-${projectId}`,
          options: [
            { id: "opt-draft", name: "Draft" },
            { id: "opt-ready", name: "Ready" },
            { id: "opt-inprogress", name: "In Progress" },
            { id: "opt-review", name: "Review" },
            { id: "opt-done", name: "Done" },
          ],
        },
      },
    },
  };
}

function buildUserProjectResponse(projectId: string, projectNumber: number) {
  return {
    data: {
      user: {
        projectV2: {
          id: projectId,
          number: projectNumber,
          title: "Night Watch",
          url: `https://github.com/users/owner/projects/${projectNumber}`,
        },
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Utility: make execFile resolve synchronously via the node callback convention
// ---------------------------------------------------------------------------

/**
 * Configures the execFile mock to return successive JSON payloads for each
 * call.  `child_process.execFile` uses the node error-first callback signature:
 *   execFile(file, args, options, callback)
 * When promisify wraps it the callback is appended automatically, so we just
 * call the last argument.
 */
function setExecFileResponses(responses: object[]) {
  let callIndex = 0;
  (execFile as ReturnType<typeof vi.fn>).mockImplementation(
    (...args: unknown[]) => {
      const callback = args[args.length - 1] as (
        err: null,
        result: { stdout: string; stderr: string }
      ) => void;
      const payload = responses[callIndex++] ?? { data: {} };
      callback(null, { stdout: JSON.stringify(payload), stderr: "" });
    }
  );
}

// ---------------------------------------------------------------------------
// Provider factory with pre-seeded project cache so tests skip the project
// discovery phase and go straight to the method under test.
// ---------------------------------------------------------------------------

function makeProvider(projectId = "proj-123", projectNumber = 1) {
  const provider = new GitHubProjectsProvider(
    { repo: "owner/repo", projectNumber },
    "/tmp/test-cwd"
  );

  // Seed the internal cache so ensureProjectCache() returns immediately
  // without making any GraphQL calls.
  // We access private fields via `as unknown as Record<string, unknown>`.
  const p = provider as unknown as Record<string, unknown>;
  p.cachedProjectId = projectId;
  p.cachedFieldId = `field-${projectId}`;
  p.cachedOptionIds = new Map<string, string>([
    ["Draft", "opt-draft"],
    ["Ready", "opt-ready"],
    ["In Progress", "opt-inprogress"],
    ["Review", "opt-review"],
    ["Done", "opt-done"],
  ]);

  return provider;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GitHubProjectsProvider — pagination", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // getAllIssues()
  // -------------------------------------------------------------------------

  describe("getAllIssues()", () => {
    it("returns all items from a single page when hasNextPage is false", async () => {
      const provider = makeProvider();

      // Single page with 3 items, no next page
      const page1 = buildItemsPage(
        [
          { id: "1", number: 1, status: "Draft" },
          { id: "2", number: 2, status: "Ready" },
          { id: "3", number: 3, status: "In Progress" },
        ],
        false,
        null
      );

      setExecFileResponses([page1]);

      const issues = await provider.getAllIssues();

      expect(issues).toHaveLength(3);
      expect(issues[0].number).toBe(1);
      expect(issues[1].number).toBe(2);
      expect(issues[2].number).toBe(3);

      // execFile was called exactly once (one GraphQL request)
      expect(execFile).toHaveBeenCalledTimes(1);
    });

    it("fetches the second page when hasNextPage is true on the first page", async () => {
      const provider = makeProvider();

      // Page 1: items 1-3, has a next page
      const page1 = buildItemsPage(
        [
          { id: "1", number: 1, status: "Draft" },
          { id: "2", number: 2, status: "Draft" },
          { id: "3", number: 3, status: "Ready" },
        ],
        true,
        "cursor-after-page-1"
      );

      // Page 2: items 4-5, no further pages
      const page2 = buildItemsPage(
        [
          { id: "4", number: 4, status: "In Progress" },
          { id: "5", number: 5, status: "Done" },
        ],
        false,
        null
      );

      setExecFileResponses([page1, page2]);

      const issues = await provider.getAllIssues();

      // All 5 items from both pages should be present
      expect(issues).toHaveLength(5);
      expect(issues.map((i) => i.number)).toEqual([1, 2, 3, 4, 5]);

      // execFile called twice: once per page
      expect(execFile).toHaveBeenCalledTimes(2);
    });

    it("passes the correct cursor on the second request", async () => {
      const provider = makeProvider();

      const page1 = buildItemsPage(
        [{ id: "1", number: 1, status: "Draft" }],
        true,
        "cursor-abc"
      );
      const page2 = buildItemsPage(
        [{ id: "2", number: 2, status: "Ready" }],
        false,
        null
      );

      setExecFileResponses([page1, page2]);

      await provider.getAllIssues();

      // Second call args should contain the cursor value
      const secondCallArgs = (execFile as ReturnType<typeof vi.fn>).mock
        .calls[1] as unknown[];
      const argsArray = secondCallArgs[1] as string[];
      const cursorFlagIndex = argsArray.indexOf("-f");
      // Find the argument that starts with "cursor="
      const cursorArg = argsArray.find((a) =>
        typeof a === "string" && a.startsWith("cursor=")
      );
      expect(cursorArg).toBe("cursor=cursor-abc");
      // Make the unused variable check happy
      void cursorFlagIndex;
    });

    it("accumulates items across three pages", async () => {
      const provider = makeProvider();

      const page1 = buildItemsPage(
        [{ id: "1", number: 1 }, { id: "2", number: 2 }],
        true,
        "cursor-1"
      );
      const page2 = buildItemsPage(
        [{ id: "3", number: 3 }, { id: "4", number: 4 }],
        true,
        "cursor-2"
      );
      const page3 = buildItemsPage(
        [{ id: "5", number: 5 }],
        false,
        null
      );

      setExecFileResponses([page1, page2, page3]);

      const issues = await provider.getAllIssues();

      expect(issues).toHaveLength(5);
      expect(execFile).toHaveBeenCalledTimes(3);
    });

    it("returns empty array when project board has no items", async () => {
      const provider = makeProvider();

      const emptyPage = buildItemsPage([], false, null);
      setExecFileResponses([emptyPage]);

      const issues = await provider.getAllIssues();

      expect(issues).toHaveLength(0);
      expect(execFile).toHaveBeenCalledTimes(1);
    });

    it("correctly maps column from Status field value across pages", async () => {
      const provider = makeProvider();

      const page1 = buildItemsPage(
        [{ id: "1", number: 1, status: "In Progress" }],
        true,
        "cursor-x"
      );
      const page2 = buildItemsPage(
        [{ id: "2", number: 2, status: "Done" }],
        false,
        null
      );

      setExecFileResponses([page1, page2]);

      const issues = await provider.getAllIssues();

      expect(issues[0].column).toBe("In Progress");
      expect(issues[1].column).toBe("Done");
    });
  });

  // -------------------------------------------------------------------------
  // moveIssue()
  // -------------------------------------------------------------------------

  describe("moveIssue()", () => {
    it("finds an item on the first page and moves it", async () => {
      const provider = makeProvider("proj-456");

      // Items page (for the lookup)
      const page1 = buildItemsPage(
        [
          { id: "1", number: 10, status: "Draft" },
          { id: "2", number: 20, status: "Ready" },
        ],
        false,
        null
      );

      // updateProjectV2ItemFieldValue mutation response
      const mutationResponse = {
        data: {
          updateProjectV2ItemFieldValue: {
            projectV2Item: { id: "item-1" },
          },
        },
      };

      setExecFileResponses([page1, mutationResponse]);

      await expect(provider.moveIssue(10, "Ready")).resolves.toBeUndefined();

      expect(execFile).toHaveBeenCalledTimes(2);
    });

    it("finds an item on the second page when hasNextPage is true", async () => {
      const provider = makeProvider("proj-789");

      // Page 1 does NOT contain issue #101 — simulates a 100+ item board
      const page1 = buildItemsPage(
        [{ id: "1", number: 1, status: "Draft" }],
        true,
        "cursor-move"
      );
      // Page 2 contains issue #101
      const page2 = buildItemsPage(
        [{ id: "101", number: 101, status: "Draft" }],
        false,
        null
      );
      // Mutation response
      const mutationResponse = {
        data: {
          updateProjectV2ItemFieldValue: {
            projectV2Item: { id: "item-101" },
          },
        },
      };

      setExecFileResponses([page1, page2, mutationResponse]);

      await expect(provider.moveIssue(101, "In Progress")).resolves.toBeUndefined();

      // Two lookup pages + one mutation = 3 calls
      expect(execFile).toHaveBeenCalledTimes(3);
    });

    it("throws when the issue is not found on any page", async () => {
      const provider = makeProvider("proj-999");

      const page1 = buildItemsPage(
        [{ id: "1", number: 1, status: "Draft" }],
        false,
        null
      );

      setExecFileResponses([page1]);

      await expect(provider.moveIssue(999, "Done")).rejects.toThrow(
        "Issue #999 not found on the project board."
      );
    });

    it("throws when the target column is invalid", async () => {
      // Seed a provider whose cachedOptionIds does NOT include "Backlog"
      const provider = makeProvider("proj-cols");

      const page1 = buildItemsPage(
        [{ id: "1", number: 5, status: "Draft" }],
        false,
        null
      );

      setExecFileResponses([page1]);

      await expect(
        provider.moveIssue(5, "Backlog" as "Draft")
      ).rejects.toThrow('Column "Backlog" not found on the project board.');
    });
  });

  // -------------------------------------------------------------------------
  // Edge case: exactly 100 items (hasNextPage === false, no second request)
  // -------------------------------------------------------------------------

  describe("edge cases", () => {
    it("does NOT make a second request when exactly 100 items exist (hasNextPage false)", async () => {
      const provider = makeProvider();

      const items: IMockItem[] = Array.from({ length: 100 }, (_, i) => ({
        id: String(i + 1),
        number: i + 1,
        status: "Draft",
      }));

      const page = buildItemsPage(items, false, null);
      setExecFileResponses([page]);

      const issues = await provider.getAllIssues();

      expect(issues).toHaveLength(100);
      // Only one GraphQL call — no unnecessary second request
      expect(execFile).toHaveBeenCalledTimes(1);
    });
  });
});
