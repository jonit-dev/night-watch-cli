/**
 * Tests for cancel command
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// Mock process.cwd before importing the module
let mockProjectDir: string;

vi.mock("child_process", () => ({
  execSync: vi.fn(),
  spawn: vi.fn(),
}));

vi.mock("@night-watch/core/utils/crontab.js", () => ({
  getEntries: vi.fn(() => []),
  getProjectEntries: vi.fn(() => []),
  generateMarker: vi.fn((name: string) => `# night-watch-cli: ${name}`),
}));

import { execSync } from "child_process";
import { getEntries, getProjectEntries } from "@night-watch/core/utils/crontab.js";

// Mock process.cwd
const originalCwd = process.cwd;
process.cwd = () => mockProjectDir;

// Import after mocking
import {
  getLockFilePaths,
  isProcessRunning,
  performCancel,
  ICancelOptions,
} from "@/cli/commands/cancel.js";
import { projectRuntimeKey } from "@night-watch/core/utils/status-data.js";

describe("cancel command", () => {
  let tempDir: string;

  beforeEach(() => {
    vi.resetAllMocks();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "night-watch-cancel-test-"));
    mockProjectDir = tempDir;

    // Create basic package.json
    fs.writeFileSync(
      path.join(tempDir, "package.json"),
      JSON.stringify({ name: "test-project" })
    );

    // Create config file
    fs.writeFileSync(
      path.join(tempDir, "night-watch.config.json"),
      JSON.stringify({
        projectName: "test-project",
        defaultBranch: "main",
        provider: "claude",
        reviewerEnabled: true,
        prdDirectory: "docs/PRDs/night-watch",
        maxRuntime: 7200,
      })
    );

    // Mock getEntries
    vi.mocked(getEntries).mockReturnValue([]);
    vi.mocked(getProjectEntries).mockReturnValue([]);

    // Mock execSync
    vi.mocked(execSync).mockImplementation((cmd: string) => {
      if (cmd.includes("git rev-parse")) {
        throw new Error("not a git repo");
      }
      return "";
    });
  });

  afterEach(() => {
    // Clean up any lock files created during tests
    const lockPaths = getLockFilePaths(tempDir);
    for (const lockPath of Object.values(lockPaths)) {
      if (fs.existsSync(lockPath)) {
        fs.unlinkSync(lockPath);
      }
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  describe("getLockFilePaths", () => {
    it("should return correct lock file paths", () => {
      const runtimeKey = projectRuntimeKey(tempDir);
      const paths = getLockFilePaths(tempDir);

      expect(paths.executor).toBe(`/tmp/night-watch-${runtimeKey}.lock`);
      expect(paths.reviewer).toBe(`/tmp/night-watch-pr-reviewer-${runtimeKey}.lock`);
    });
  });

  describe("isProcessRunning", () => {
    it("should return false for non-existent process", () => {
      // Very high PID is unlikely to exist
      const result = isProcessRunning(99999999);
      expect(result).toBe(false);
    });
  });

  describe("performCancel", () => {
    it("should report not running when no lock file", async () => {
      const options: ICancelOptions = { type: "all" };
      const results = await performCancel(tempDir, options);

      expect(results).toHaveLength(2);
      expect(results[0].success).toBe(true);
      expect(results[0].message).toContain("not running");
      expect(results[1].success).toBe(true);
      expect(results[1].message).toContain("not running");
    });

    it("should detect stale lock files", async () => {
      const lockPaths = getLockFilePaths(tempDir);

      // Create stale lock files with non-existent PIDs
      fs.writeFileSync(lockPaths.executor, "99999998");
      fs.writeFileSync(lockPaths.reviewer, "99999997");

      // Verify files exist
      expect(fs.existsSync(lockPaths.executor)).toBe(true);
      expect(fs.existsSync(lockPaths.reviewer)).toBe(true);

      const options: ICancelOptions = { type: "all" };
      const results = await performCancel(tempDir, options);

      expect(results).toHaveLength(2);
      expect(results[0].success).toBe(true);
      expect(results[0].message).toContain("cleaned up stale lock file");
      expect(results[0].cleanedUp).toBe(true);
      expect(results[1].success).toBe(true);
      expect(results[1].message).toContain("cleaned up stale lock file");
      expect(results[1].cleanedUp).toBe(true);

      // Verify lock files were removed
      expect(fs.existsSync(lockPaths.executor)).toBe(false);
      expect(fs.existsSync(lockPaths.reviewer)).toBe(false);
    });

    it("should handle run type only", async () => {
      const options: ICancelOptions = { type: "run" };
      const results = await performCancel(tempDir, options);

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(true);
      expect(results[0].message).toContain("executor");
    });

    it("should handle review type only", async () => {
      const options: ICancelOptions = { type: "review" };
      const results = await performCancel(tempDir, options);

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(true);
      expect(results[0].message).toContain("reviewer");
    });
  });

  describe("CLI integration", () => {
    it("should show help with --type option", async () => {
      // Import commander and cancel command dynamically to test help
      const { Command } = await import("commander");
      const { cancelCommand } = await import("../../commands/cancel.js");

      const program = new Command();
      cancelCommand(program);

      // Configure output to capture help
      let helpOutput = "";
      program.configureOutput({
        writeOut: (str) => {
          helpOutput += str;
        },
        writeErr: (str) => {
          helpOutput += str;
        },
      });

      // Use exit mock to prevent process.exit from killing the test
      const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit called");
      });

      try {
        program.parse(["node", "test", "cancel", "--help"]);
      } catch {
        // Expected - process.exit was called for help
      }

      expect(helpOutput).toContain("--type");
      expect(helpOutput).toContain("run");
      expect(helpOutput).toContain("review");
      expect(helpOutput).toContain("all");

      exitSpy.mockRestore();
    });

    it("should reject invalid type option", async () => {
      const { Command } = await import("commander");
      const { cancelCommand } = await import("../../commands/cancel.js");

      const program = new Command();
      cancelCommand(program);

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      const exitSpy = vi.spyOn(process, "exit").mockImplementation((code) => {
        throw new Error(`process.exit(${code})`);
      });

      try {
        await program.parseAsync(["node", "test", "cancel", "--type", "invalid"]);
        expect.fail("Should have thrown");
      } catch (err) {
        expect((err as Error).message).toContain("process.exit(1)");
      }

      // Verify that the error function was called (which outputs via console.log)
      // The first call should be from uiError which contains the error message
      expect(consoleSpy).toHaveBeenCalled();

      // Get all the logged output and check it contains "Invalid type"
      const allCalls = consoleSpy.mock.calls.flat().join(" ");
      expect(allCalls).toContain("Invalid type");

      consoleSpy.mockRestore();
      exitSpy.mockRestore();
    });

    it("should accept valid type options", async () => {
      // Test that the program accepts all valid types without error
      const validTypes = ["run", "review", "all"];

      for (const type of validTypes) {
        // Should not throw for valid types when no lock files exist
        const results = await performCancel(tempDir, { type: type as "run" | "review" | "all" });
        expect(results.length).toBeGreaterThan(0);
        expect(results.every((r) => r.success)).toBe(true);
      }
    });
  });
});
