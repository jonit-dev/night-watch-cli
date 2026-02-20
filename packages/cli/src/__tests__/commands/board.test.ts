/**
 * Tests for the board command group.
 *
 * All external dependencies (factory, config, config-writer) are mocked so that
 * we can drive the commands through their action handlers without a real GitHub
 * connection.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Command } from "commander";
import * as path from "path";

// ---------------------------------------------------------------------------
// Mock provider — shared across all tests
// ---------------------------------------------------------------------------

const mockProvider = {
  setupBoard: vi.fn(),
  getBoard: vi.fn(),
  getColumns: vi.fn(),
  createIssue: vi.fn(),
  getIssue: vi.fn(),
  getIssuesByColumn: vi.fn(),
  getAllIssues: vi.fn(),
  moveIssue: vi.fn(),
  closeIssue: vi.fn(),
  commentOnIssue: vi.fn(),
};

// ---------------------------------------------------------------------------
// Module mocks — must appear before any import of the mocked modules
// ---------------------------------------------------------------------------

vi.mock("@night-watch/core/board/factory.js", () => ({
  createBoardProvider: vi.fn(() => mockProvider),
}));

vi.mock("@night-watch/core/config.js", () => ({
  loadConfig: vi.fn(),
}));

vi.mock("@night-watch/core/utils/config-writer.js", () => ({
  saveConfig: vi.fn(() => ({ success: true })),
}));

// Prevent readline from blocking tests (used by board setup confirmation)
vi.mock("readline", () => ({
  createInterface: vi.fn(() => ({
    question: vi.fn((_q: string, cb: (answer: string) => void) => cb("n")),
    close: vi.fn(),
  })),
}));

// ---------------------------------------------------------------------------
// Import after mocks are registered
// ---------------------------------------------------------------------------

import { boardCommand } from "@/cli/commands/board.js";
import { createBoardProvider } from "@night-watch/core/board/factory.js";
import { loadConfig } from "@night-watch/core/config.js";
import { saveConfig } from "@night-watch/core/utils/config-writer.js";
import type { INightWatchConfig } from "@night-watch/core/types.js";
import type { IBoardIssue } from "@night-watch/core/board/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal INightWatchConfig with board provider enabled.
 */
function makeConfig(overrides: Partial<INightWatchConfig> = {}): INightWatchConfig {
  return {
    defaultBranch: "main",
    prdDir: "docs/PRDs/night-watch",
    maxRuntime: 7200,
    reviewerMaxRuntime: 3600,
    branchPrefix: "night-watch",
    branchPatterns: ["feat/", "night-watch/"],
    minReviewScore: 80,
    maxLogSize: 524288,
    cronSchedule: "0 0-21 * * *",
    reviewerSchedule: "0 0,3,6,9,12,15,18,21 * * *",
    cronScheduleOffset: 0,
    maxRetries: 3,
    provider: "claude",
    reviewerEnabled: true,
    providerEnv: {},
    notifications: { webhooks: [] },
    prdPriority: [],
    roadmapScanner: {
      enabled: false,
      roadmapPath: "ROADMAP.md",
      autoScanInterval: 300,
      slicerSchedule: "0 */6 * * *",
      slicerMaxRuntime: 600,
    },
    templatesDir: ".night-watch/templates",
    boardProvider: {
      enabled: true,
      provider: "github",
    },
    ...overrides,
  };
}

/**
 * Build a minimal IBoardIssue for test responses.
 */
function makeIssue(overrides: Partial<IBoardIssue> = {}): IBoardIssue {
  return {
    id: "I_1",
    number: 42,
    title: "Test Issue",
    body: "Issue body content",
    url: "https://github.com/owner/repo/issues/42",
    column: "Ready",
    labels: [],
    assignees: [],
    ...overrides,
  };
}

/**
 * Parse the Commander program and invoke the matching sub-command action.
 * Returns a promise that resolves when the action completes.
 */
async function runCommand(args: string[]): Promise<void> {
  const program = new Command();
  // Prevent commander from printing errors and exiting during tests
  program.exitOverride();
  program.configureOutput({
    writeErr: () => {},
    writeOut: () => {},
  });

  boardCommand(program);
  await program.parseAsync(["node", "night-watch", ...args]);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("board commands", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    mockProvider.setupBoard.mockResolvedValue({
      id: "PVT_auto",
      number: 7,
      title: "night-watch-cli Night Watch",
      url: "https://github.com/users/alice/projects/7",
    });

    // Default: loadConfig returns an enabled board provider config
    vi.mocked(loadConfig).mockReturnValue(makeConfig());
  });

  // -------------------------------------------------------------------------
  // board setup
  // -------------------------------------------------------------------------
  describe("board setup", () => {
    it("creates board and persists projectNumber returned by provider", async () => {
      mockProvider.setupBoard.mockResolvedValue({
        id: "PVT_1",
        number: 7,
        title: "Night Watch",
        url: "https://github.com/users/alice/projects/7",
      });
      mockProvider.getColumns.mockResolvedValue([
        { id: "opt1", name: "Draft" },
        { id: "opt2", name: "Ready" },
        { id: "opt3", name: "In Progress" },
        { id: "opt4", name: "Review" },
        { id: "opt5", name: "Done" },
      ]);

      await runCommand(["board", "setup"]);

      expect(mockProvider.setupBoard).toHaveBeenCalledWith(
        `${path.basename(process.cwd())} Night Watch`
      );
      expect(saveConfig).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          boardProvider: expect.objectContaining({ projectNumber: 7 }),
        })
      );
    });

    it("warns if board already configured and aborts when user says no", async () => {
      vi.mocked(loadConfig).mockReturnValue(
        makeConfig({
          boardProvider: { enabled: true, provider: "github", projectNumber: 3 },
        })
      );

      // readline mock returns "n" by default — setup should abort
      await runCommand(["board", "setup"]);

      // setupBoard should NOT have been called because user aborted
      expect(mockProvider.setupBoard).not.toHaveBeenCalled();
    });

    it("exits if boardProvider is explicitly disabled", async () => {
      vi.mocked(loadConfig).mockReturnValue(
        makeConfig({ boardProvider: { enabled: false, provider: "github" } })
      );

      const exitSpy = vi.spyOn(process, "exit").mockImplementation((code) => {
        throw new Error(`process.exit(${code})`);
      });

      await expect(runCommand(["board", "setup"])).rejects.toThrow("process.exit(1)");

      exitSpy.mockRestore();
    });
  });

  // -------------------------------------------------------------------------
  // board create-prd
  // -------------------------------------------------------------------------
  describe("board create-prd", () => {
    it("auto-creates and persists board when projectNumber is missing", async () => {
      vi.mocked(loadConfig).mockReturnValue(
        makeConfig({ boardProvider: { enabled: true, provider: "github" } })
      );
      mockProvider.setupBoard.mockResolvedValue({
        id: "PVT_2",
        number: 42,
        title: "night-watch-cli Night Watch",
        url: "https://github.com/users/alice/projects/42",
      });
      mockProvider.createIssue.mockResolvedValue(makeIssue({ number: 42, title: "Bootstrapped" }));

      await runCommand(["board", "create-prd", "Bootstrapped"]);

      expect(mockProvider.setupBoard).toHaveBeenCalled();
      expect(saveConfig).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          boardProvider: expect.objectContaining({ projectNumber: 42 }),
        })
      );
      expect(mockProvider.createIssue).toHaveBeenCalled();
    });

    it("creates issue in Draft column by default", async () => {
      const issue = makeIssue({ number: 10, column: "Draft", title: "My PRD" });
      mockProvider.createIssue.mockResolvedValue(issue);

      await runCommand(["board", "create-prd", "My PRD"]);

      expect(mockProvider.createIssue).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "My PRD",
          column: "Draft",
        })
      );

      // Confirm output contains the issue number and URL
      const allOutput = consoleSpy.mock.calls.flat().join(" ");
      expect(allOutput).toContain("10");
      expect(allOutput).toContain(issue.url);
    });

    it("creates issue in specified column with --column", async () => {
      const issue = makeIssue({ number: 11, column: "Ready" });
      mockProvider.createIssue.mockResolvedValue(issue);

      await runCommand(["board", "create-prd", "Ready PRD", "--column", "Ready"]);

      expect(mockProvider.createIssue).toHaveBeenCalledWith(
        expect.objectContaining({ column: "Ready" })
      );
    });

    it("passes body text when --body is provided", async () => {
      mockProvider.createIssue.mockResolvedValue(makeIssue());

      await runCommand([
        "board",
        "create-prd",
        "PRD with body",
        "--body",
        "The description",
      ]);

      expect(mockProvider.createIssue).toHaveBeenCalledWith(
        expect.objectContaining({ body: "The description" })
      );
    });

    it("passes label when --label is provided", async () => {
      mockProvider.createIssue.mockResolvedValue(makeIssue());

      await runCommand([
        "board",
        "create-prd",
        "Labelled PRD",
        "--label",
        "prd",
      ]);

      expect(mockProvider.createIssue).toHaveBeenCalledWith(
        expect.objectContaining({ labels: ["prd"] })
      );
    });

    it("exits with error when column name is invalid", async () => {
      const exitSpy = vi.spyOn(process, "exit").mockImplementation((code) => {
        throw new Error(`process.exit(${code})`);
      });

      await expect(
        runCommand(["board", "create-prd", "Bad Column", "--column", "InvalidColumn"])
      ).rejects.toThrow("process.exit(1)");

      expect(mockProvider.createIssue).not.toHaveBeenCalled();
      const errOutput = consoleErrSpy.mock.calls.flat().join(" ");
      expect(errOutput).toContain("Invalid column");
      expect(errOutput).toContain("InvalidColumn");

      exitSpy.mockRestore();
    });
  });

  // -------------------------------------------------------------------------
  // board next-issue
  // -------------------------------------------------------------------------
  describe("board next-issue", () => {
    it("returns first Ready issue as JSON with --json flag", async () => {
      const issue = makeIssue({ number: 5, title: "First Ready", column: "Ready" });
      mockProvider.getIssuesByColumn.mockResolvedValue([issue]);

      await runCommand(["board", "next-issue", "--json"]);

      expect(mockProvider.getIssuesByColumn).toHaveBeenCalledWith("Ready");

      const jsonOutput = consoleSpy.mock.calls.flat().join("\n");
      const parsed = JSON.parse(jsonOutput);
      expect(parsed.number).toBe(5);
      expect(parsed.title).toBe("First Ready");
    });

    it("prints human-readable output without --json", async () => {
      const issue = makeIssue({ number: 6, title: "Human Readable", column: "Ready" });
      mockProvider.getIssuesByColumn.mockResolvedValue([issue]);

      await runCommand(["board", "next-issue"]);

      const allOutput = consoleSpy.mock.calls.flat().join(" ");
      expect(allOutput).toContain("6");
      expect(allOutput).toContain("Human Readable");
    });

    it("queries the specified column when --column is provided", async () => {
      mockProvider.getIssuesByColumn.mockResolvedValue([makeIssue({ column: "In Progress" })]);

      await runCommand(["board", "next-issue", "--column", "In Progress"]);

      expect(mockProvider.getIssuesByColumn).toHaveBeenCalledWith("In Progress");
    });

    it("prints no issues message when column is empty", async () => {
      mockProvider.getIssuesByColumn.mockResolvedValue([]);

      await runCommand(["board", "next-issue", "--column", "Draft"]);

      const allOutput = consoleSpy.mock.calls.flat().join(" ");
      expect(allOutput).toContain("No issues found in Draft");
    });

    it("prints no output for --json when no issue is available", async () => {
      mockProvider.getIssuesByColumn.mockResolvedValue([]);

      await runCommand(["board", "next-issue", "--json"]);

      expect(consoleSpy).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // board move-issue
  // -------------------------------------------------------------------------
  describe("board move-issue", () => {
    it("moves issue to the specified column", async () => {
      mockProvider.moveIssue.mockResolvedValue(undefined);

      await runCommand(["board", "move-issue", "42", "--column", "In Progress"]);

      expect(mockProvider.moveIssue).toHaveBeenCalledWith(42, "In Progress");

      const allOutput = consoleSpy.mock.calls.flat().join(" ");
      expect(allOutput).toContain("42");
      expect(allOutput).toContain("In Progress");
    });

    it("propagates provider errors", async () => {
      mockProvider.moveIssue.mockRejectedValue(new Error("Issue not found on board"));

      await expect(
        runCommand(["board", "move-issue", "999", "--column", "Done"])
      ).rejects.toThrow();

      expect(mockProvider.moveIssue).toHaveBeenCalledWith(999, "Done");
    });
  });

  // -------------------------------------------------------------------------
  // board comment
  // -------------------------------------------------------------------------
  describe("board comment", () => {
    it("adds a comment to an issue", async () => {
      mockProvider.commentOnIssue.mockResolvedValue(undefined);

      await runCommand([
        "board",
        "comment",
        "42",
        "--body",
        "Great progress!",
      ]);

      expect(mockProvider.commentOnIssue).toHaveBeenCalledWith(42, "Great progress!");

      const allOutput = consoleSpy.mock.calls.flat().join(" ");
      expect(allOutput).toContain("42");
    });
  });

  // -------------------------------------------------------------------------
  // board close-issue
  // -------------------------------------------------------------------------
  describe("board close-issue", () => {
    it("closes issue and moves it to Done", async () => {
      mockProvider.closeIssue.mockResolvedValue(undefined);
      mockProvider.moveIssue.mockResolvedValue(undefined);

      await runCommand(["board", "close-issue", "42"]);

      expect(mockProvider.closeIssue).toHaveBeenCalledWith(42);
      expect(mockProvider.moveIssue).toHaveBeenCalledWith(42, "Done");

      const allOutput = consoleSpy.mock.calls.flat().join(" ");
      expect(allOutput).toContain("42");
      expect(allOutput).toContain("Done");
    });
  });

  // -------------------------------------------------------------------------
  // board status
  // -------------------------------------------------------------------------
  describe("board status", () => {
    it("groups issues by column and prints a table", async () => {
      mockProvider.getAllIssues.mockResolvedValue([
        makeIssue({ number: 1, title: "Issue One", column: "Draft" }),
        makeIssue({ number: 2, title: "Issue Two", column: "Ready" }),
        makeIssue({ number: 3, title: "Issue Three", column: "Ready" }),
      ]);

      await runCommand(["board", "status"]);

      expect(mockProvider.getAllIssues).toHaveBeenCalled();

      const allOutput = consoleSpy.mock.calls.flat().join(" ");
      expect(allOutput).toContain("Issue One");
      expect(allOutput).toContain("Issue Two");
      expect(allOutput).toContain("Issue Three");
    });

    it("outputs raw JSON with --json flag", async () => {
      const issues = [
        makeIssue({ number: 1, column: "Draft" }),
        makeIssue({ number: 2, column: "Ready" }),
      ];
      mockProvider.getAllIssues.mockResolvedValue(issues);

      await runCommand(["board", "status", "--json"]);

      const jsonOutput = consoleSpy.mock.calls.flat().join("\n");
      const parsed = JSON.parse(jsonOutput) as IBoardIssue[];
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(2);
    });

    it("prints a message when there are no issues", async () => {
      mockProvider.getAllIssues.mockResolvedValue([]);

      await runCommand(["board", "status"]);

      const allOutput = consoleSpy.mock.calls.flat().join(" ");
      expect(allOutput).toContain("No issues found");
    });
  });

  // -------------------------------------------------------------------------
  // command registration
  // -------------------------------------------------------------------------
  describe("command registration", () => {
    it("registers the board command on the program", () => {
      const program = new Command();
      boardCommand(program);
      expect(program.commands.map((c) => c.name())).toContain("board");
    });

    it("registers all expected subcommands", () => {
      const program = new Command();
      boardCommand(program);

      const boardCmd = program.commands.find((c) => c.name() === "board");
      expect(boardCmd).toBeDefined();

      const subNames = boardCmd!.commands.map((c) => c.name());
      expect(subNames).toContain("setup");
      expect(subNames).toContain("create-prd");
      expect(subNames).toContain("status");
      expect(subNames).toContain("next-issue");
      expect(subNames).toContain("move-issue");
      expect(subNames).toContain("comment");
      expect(subNames).toContain("close-issue");
    });
  });
});
