/**
 * Tests for status command
 */

import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// Mock process.cwd to return our temp directory
let mockProjectDir: string;

vi.mock("child_process", () => ({
  execSync: vi.fn(),
  spawn: vi.fn(),
}));

vi.mock("../../utils/crontab.js", () => ({
  getEntries: vi.fn(() => []),
  getProjectEntries: vi.fn(() => []),
  generateMarker: vi.fn((name: string) => `# night-watch-cli: ${name}`),
}));

import { execSync } from "child_process";
import { getEntries, getProjectEntries } from "../../utils/crontab.js";

// Mock process.cwd before importing status module
const originalCwd = process.cwd;
process.cwd = () => mockProjectDir;

// Import after mocking
import { statusCommand } from "../../commands/status.js";
import { Command } from "commander";

describe("status command", () => {
  let tempDir: string;

  beforeEach(() => {
    vi.resetAllMocks();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "night-watch-status-test-"));
    mockProjectDir = tempDir;

    // Create basic package.json
    fs.writeFileSync(
      path.join(tempDir, "package.json"),
      JSON.stringify({ name: "test-project" })
    );

    // Create config file with no budget fields
    fs.writeFileSync(
      path.join(tempDir, "night-watch.config.json"),
      JSON.stringify({
        projectName: "test-project",
        defaultBranch: "main",
        provider: "claude",
        reviewerEnabled: true,
        prdDirectory: "docs/PRDs/night-watch",
        maxRuntime: 7200,
        reviewerMaxRuntime: 3600,
        cron: {
          executorSchedule: "0 0-21 * * *",
          reviewerSchedule: "0 0,3,6,9,12,15,18,21 * * *"
        },
        review: {
          minScore: 80,
          branchPatterns: ["feat/", "night-watch/"]
        },
        logging: {
          maxLogSize: 524288
        }
      }, null, 2)
    );

    // Mock getEntries
    vi.mocked(getEntries).mockReturnValue([]);
    vi.mocked(getProjectEntries).mockReturnValue([]);

    // Mock execSync for most operations
    vi.mocked(execSync).mockImplementation((cmd: string) => {
      if (cmd.includes("git rev-parse")) {
        throw new Error("not a git repo");
      }
      return "";
    });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  afterAll(() => {
    process.cwd = originalCwd;
  });

  describe("lock file status", () => {
    it("should show lock file status - not running", async () => {
      const program = new Command();
      statusCommand(program);

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await program.parseAsync(["node", "test", "status", "--json"]);

      const jsonOutput = JSON.parse(consoleSpy.mock.calls[0][0]);
      expect(jsonOutput.executor.running).toBe(false);
      expect(jsonOutput.executor.pid).toBeNull();
      expect(jsonOutput.reviewer.running).toBe(false);
      expect(jsonOutput.reviewer.pid).toBeNull();

      consoleSpy.mockRestore();
    });

    it("should show lock file status - running", async () => {
      // Create lock file with PID using the hashed runtime key
      const { executorLockPath } = await import("../../utils/status-data.js");
      const lockFile = executorLockPath(tempDir);
      fs.writeFileSync(lockFile, "12345");

      // Mock process.kill to return true (process exists)
      const originalKill = process.kill;
      (process as any).kill = vi.fn().mockReturnValue(true);

      try {
        const program = new Command();
        statusCommand(program);

        const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

        await program.parseAsync(["node", "test", "status", "--json"]);

        const jsonOutput = JSON.parse(consoleSpy.mock.calls[0][0]);
        expect(jsonOutput.executor.running).toBe(true);
        expect(jsonOutput.executor.pid).toBe(12345);

        consoleSpy.mockRestore();
      } finally {
        (process as any).kill = originalKill;
        if (fs.existsSync(lockFile)) {
          fs.unlinkSync(lockFile);
        }
      }
    });
  });

  describe("PRD counting", () => {
    it("should count pending and done PRDs", async () => {
      // Create PRD directory structure
      const prdDir = path.join(tempDir, "docs", "PRDs", "night-watch");
      fs.mkdirSync(prdDir, { recursive: true });
      fs.mkdirSync(path.join(prdDir, "done"), { recursive: true });

      // Create pending PRDs
      fs.writeFileSync(path.join(prdDir, "phase1.md"), "# Phase 1");
      fs.writeFileSync(path.join(prdDir, "phase2.md"), "# Phase 2");

      // Create done PRDs
      fs.writeFileSync(path.join(prdDir, "done", "phase0.md"), "# Phase 0");

      const program = new Command();
      statusCommand(program);

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await program.parseAsync(["node", "test", "status", "--json"]);

      const jsonOutput = JSON.parse(consoleSpy.mock.calls[0][0]);
      expect(jsonOutput.prds.pending).toBe(2);
      expect(jsonOutput.prds.done).toBe(1);

      consoleSpy.mockRestore();
    });

    it("should count claimed PRDs separately", async () => {
      // Create PRD directory structure
      const prdDir = path.join(tempDir, "docs", "PRDs", "night-watch");
      fs.mkdirSync(prdDir, { recursive: true });
      fs.mkdirSync(path.join(prdDir, "done"), { recursive: true });

      // Create pending PRDs
      fs.writeFileSync(path.join(prdDir, "phase1.md"), "# Phase 1");
      fs.writeFileSync(path.join(prdDir, "phase2.md"), "# Phase 2");

      // Create an active claim for phase1
      fs.writeFileSync(
        path.join(prdDir, "phase1.md.claim"),
        JSON.stringify({ timestamp: Math.floor(Date.now() / 1000), hostname: "test", pid: 1234 })
      );

      // Create done PRDs
      fs.writeFileSync(path.join(prdDir, "done", "phase0.md"), "# Phase 0");

      // Create executor lock file and mock process.kill to simulate running executor
      // This is required for cross-validation of in-progress status
      const { executorLockPath } = await import("../../utils/status-data.js");
      const lockPath = executorLockPath(tempDir);
      fs.writeFileSync(lockPath, "12345");

      const originalKill = process.kill;
      (process as any).kill = vi.fn().mockReturnValue(true);

      try {
        const program = new Command();
        statusCommand(program);

        const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

        await program.parseAsync(["node", "test", "status", "--json"]);

        const jsonOutput = JSON.parse(consoleSpy.mock.calls[0][0]);
        expect(jsonOutput.prds.pending).toBe(1);
        expect(jsonOutput.prds.claimed).toBe(1);
        expect(jsonOutput.prds.done).toBe(1);

        consoleSpy.mockRestore();
      } finally {
        (process as any).kill = originalKill;
        try { fs.unlinkSync(lockPath); } catch { /* ignore */ }
      }
    });
  });

  describe("crontab status", () => {
    it("should show installed crontab entries", async () => {
      // Mock crontab entries
      vi.mocked(getEntries).mockReturnValue([
        "0 * * * * night-watch run  # night-watch-cli: test-project",
        "0 0 * * * night-watch review  # night-watch-cli: test-project",
      ]);
      vi.mocked(getProjectEntries).mockReturnValue([]);

      const program = new Command();
      statusCommand(program);

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await program.parseAsync(["node", "test", "status", "--json"]);

      const jsonOutput = JSON.parse(consoleSpy.mock.calls[0][0]);
      expect(jsonOutput.crontab.installed).toBe(true);
      expect(jsonOutput.crontab.entries).toHaveLength(2);

      consoleSpy.mockRestore();
    });
  });

  describe("log files", () => {
    it("should show log file info", async () => {
      // Create log directory and file
      const logDir = path.join(tempDir, "logs");
      fs.mkdirSync(logDir, { recursive: true });
      fs.writeFileSync(
        path.join(logDir, "night-watch.log"),
        "Line 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6"
      );

      const program = new Command();
      statusCommand(program);

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await program.parseAsync(["node", "test", "status", "--json"]);

      const jsonOutput = JSON.parse(consoleSpy.mock.calls[0][0]);
      expect(jsonOutput.logs.executor.exists).toBe(true);
      expect(jsonOutput.logs.executor.size).toBeGreaterThan(0);
      expect(jsonOutput.logs.executor.lastLines).toHaveLength(5);

      consoleSpy.mockRestore();
    });
  });

  describe("configuration output", () => {
    it("should include provider field in JSON output", async () => {
      const program = new Command();
      statusCommand(program);

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await program.parseAsync(["node", "test", "status", "--json"]);

      const jsonOutput = JSON.parse(consoleSpy.mock.calls[0][0]);
      expect(jsonOutput.provider).toBe("claude");

      consoleSpy.mockRestore();
    });

    it("should include reviewerEnabled field in JSON output", async () => {
      const program = new Command();
      statusCommand(program);

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await program.parseAsync(["node", "test", "status", "--json"]);

      const jsonOutput = JSON.parse(consoleSpy.mock.calls[0][0]);
      expect(jsonOutput.reviewerEnabled).toBe(true);

      consoleSpy.mockRestore();
    });

    it("should show reviewer as Disabled when reviewerEnabled is false", async () => {
      // Update config to have reviewerEnabled: false
      fs.writeFileSync(
        path.join(tempDir, "night-watch.config.json"),
        JSON.stringify({
          projectName: "test-project",
          defaultBranch: "main",
          provider: "claude",
          reviewerEnabled: false,
          prdDirectory: "docs/PRDs/night-watch",
          maxRuntime: 7200,
          reviewerMaxRuntime: 3600,
          cron: {
            executorSchedule: "0 0-21 * * *",
            reviewerSchedule: "0 0,3,6,9,12,15,18,21 * * *"
          },
          review: {
            minScore: 80,
            branchPatterns: ["feat/", "night-watch/"]
          },
          logging: {
            maxLogSize: 524288
          }
        }, null, 2)
      );

      const program = new Command();
      statusCommand(program);

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await program.parseAsync(["node", "test", "status", "--json"]);

      const jsonOutput = JSON.parse(consoleSpy.mock.calls[0][0]);
      expect(jsonOutput.reviewerEnabled).toBe(false);

      consoleSpy.mockRestore();
    });

    it("should show codex provider when configured", async () => {
      // Update config to use codex provider
      fs.writeFileSync(
        path.join(tempDir, "night-watch.config.json"),
        JSON.stringify({
          projectName: "test-project",
          defaultBranch: "main",
          provider: "codex",
          reviewerEnabled: true,
          prdDirectory: "docs/PRDs/night-watch",
          maxRuntime: 7200,
          reviewerMaxRuntime: 3600,
          cron: {
            executorSchedule: "0 0-21 * * *",
            reviewerSchedule: "0 0,3,6,9,12,15,18,21 * * *"
          },
          review: {
            minScore: 80,
            branchPatterns: ["feat/", "night-watch/"]
          },
          logging: {
            maxLogSize: 524288
          }
        }, null, 2)
      );

      const program = new Command();
      statusCommand(program);

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await program.parseAsync(["node", "test", "status", "--json"]);

      const jsonOutput = JSON.parse(consoleSpy.mock.calls[0][0]);
      expect(jsonOutput.provider).toBe("codex");

      consoleSpy.mockRestore();
    });
  });
});
