/**
 * Tests for prds command
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

vi.mock("@night-watch/core/utils/crontab.js", () => ({
  getEntries: vi.fn(() => []),
  getProjectEntries: vi.fn(() => []),
  generateMarker: vi.fn((name: string) => `# night-watch-cli: ${name}`),
}));

import { execSync } from "child_process";

// Mock process.cwd before importing prds module
const originalCwd = process.cwd;
process.cwd = () => mockProjectDir;

// Import after mocking
import { prdsCommand } from "@/cli/commands/prds.js";
import { Command } from "commander";

describe("prds command", () => {
  let tempDir: string;

  beforeEach(() => {
    vi.resetAllMocks();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "night-watch-prds-test-"));
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
        prdDir: "docs/PRDs/night-watch",
        maxRuntime: 7200,
        branchPrefix: "night-watch/",
        branchPatterns: ["feat/", "night-watch/"],
      }, null, 2)
    );

    // Mock execSync for most operations
    vi.mocked(execSync).mockImplementation((cmd: string) => {
      if (cmd.includes("git rev-parse")) {
        throw new Error("not a git repo");
      }
      if (cmd.includes("which gh")) {
        throw new Error("gh not found");
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

  describe("listing PRDs", () => {
    it("should list pending PRDs", async () => {
      // Create PRD directory structure
      const prdDir = path.join(tempDir, "docs", "PRDs", "night-watch");
      fs.mkdirSync(prdDir, { recursive: true });
      fs.mkdirSync(path.join(prdDir, "done"), { recursive: true });

      // Create pending PRDs
      fs.writeFileSync(path.join(prdDir, "phase1.md"), "# Phase 1");
      fs.writeFileSync(path.join(prdDir, "phase2.md"), "# Phase 2");

      const program = new Command();
      prdsCommand(program);

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await program.parseAsync(["node", "test", "prds", "--json"]);

      const output = consoleSpy.mock.calls.map(call => call[0]).join("\n");
      const jsonOutput = JSON.parse(output);

      // Should have 2 pending PRDs
      expect(jsonOutput.length).toBe(2);

      // Both should be ready status (no dependencies)
      const names = jsonOutput.map((p: { name: string }) => p.name);
      expect(names).toContain("phase1");
      expect(names).toContain("phase2");

      // All pending PRDs should have ready status (no dependencies or PRs)
      const statuses = jsonOutput.map((p: { status: string }) => p.status);
      expect(statuses.every((s: string) => s === "ready")).toBe(true);

      consoleSpy.mockRestore();
    });

    it("should show done PRDs", async () => {
      // Create PRD directory structure
      const prdDir = path.join(tempDir, "docs", "PRDs", "night-watch");
      fs.mkdirSync(prdDir, { recursive: true });
      fs.mkdirSync(path.join(prdDir, "done"), { recursive: true });

      // Create done PRDs
      fs.writeFileSync(path.join(prdDir, "done", "phase0.md"), "# Phase 0");
      fs.writeFileSync(path.join(prdDir, "done", "phase-complete.md"), "# Phase Complete");

      const program = new Command();
      prdsCommand(program);

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await program.parseAsync(["node", "test", "prds", "--json"]);

      const output = consoleSpy.mock.calls.map(call => call[0]).join("\n");
      const jsonOutput = JSON.parse(output);

      // Should have 2 done PRDs
      expect(jsonOutput.length).toBe(2);

      // All should have done status
      const statuses = jsonOutput.map((p: { status: string }) => p.status);
      expect(statuses.every((s: string) => s === "done")).toBe(true);

      // Names should include the done PRDs
      const names = jsonOutput.map((p: { name: string }) => p.name);
      expect(names).toContain("phase0");
      expect(names).toContain("phase-complete");

      consoleSpy.mockRestore();
    });

    it("should detect blocked PRDs", async () => {
      // Create PRD directory structure
      const prdDir = path.join(tempDir, "docs", "PRDs", "night-watch");
      fs.mkdirSync(prdDir, { recursive: true });
      fs.mkdirSync(path.join(prdDir, "done"), { recursive: true });

      // Create a done PRD (dependency)
      fs.writeFileSync(path.join(prdDir, "done", "phase0.md"), "# Phase 0");

      // Create a blocked PRD (dependency not met)
      fs.writeFileSync(
        path.join(prdDir, "phase2.md"),
        `# Phase 2

**Depends on:** \`phase1.md\`

Content here.`
      );

      // Create a ready PRD (dependency met)
      fs.writeFileSync(
        path.join(prdDir, "phase1-followup.md"),
        `# Phase 1 Followup

**Depends on:** \`phase0.md\`

Content here.`
      );

      const program = new Command();
      prdsCommand(program);

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await program.parseAsync(["node", "test", "prds", "--json"]);

      const output = consoleSpy.mock.calls.map(call => call[0]).join("\n");
      const jsonOutput = JSON.parse(output);

      // Find the blocked PRD
      const blockedPrd = jsonOutput.find((p: { name: string }) => p.name === "phase2");
      expect(blockedPrd).toBeDefined();
      expect(blockedPrd.status).toBe("blocked");
      expect(blockedPrd.unmetDependencies).toContain("phase1.md");

      // Find the ready PRD (dependency met)
      const readyPrd = jsonOutput.find((p: { name: string }) => p.name === "phase1-followup");
      expect(readyPrd).toBeDefined();
      expect(readyPrd.status).toBe("ready");

      consoleSpy.mockRestore();
    });

    it("should output JSON with --json flag", async () => {
      // Create PRD directory structure
      const prdDir = path.join(tempDir, "docs", "PRDs", "night-watch");
      fs.mkdirSync(prdDir, { recursive: true });
      fs.mkdirSync(path.join(prdDir, "done"), { recursive: true });

      // Create some PRDs
      fs.writeFileSync(path.join(prdDir, "phase1.md"), "# Phase 1");
      fs.writeFileSync(path.join(prdDir, "done", "phase0.md"), "# Phase 0");

      const program = new Command();
      prdsCommand(program);

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await program.parseAsync(["node", "test", "prds", "--json"]);

      const output = consoleSpy.mock.calls.map(call => call[0]).join("\n");

      // Should parse without error
      const jsonOutput = JSON.parse(output);
      expect(Array.isArray(jsonOutput)).toBe(true);

      // Each item should have expected fields
      for (const item of jsonOutput) {
        expect(item).toHaveProperty("name");
        expect(item).toHaveProperty("status");
        expect(item).toHaveProperty("dependencies");
        expect(item).toHaveProperty("unmetDependencies");
        expect(item).toHaveProperty("pr");
      }

      consoleSpy.mockRestore();
    });
  });

  describe("PR detection", () => {
    it("should mark PRD as in-progress when matching PR exists", async () => {
      // Create PRD directory structure
      const prdDir = path.join(tempDir, "docs", "PRDs", "night-watch");
      fs.mkdirSync(prdDir, { recursive: true });

      // Create a PRD
      fs.writeFileSync(path.join(prdDir, "01-feature.md"), "# Feature");

      // Mock gh CLI to return an open PR
      vi.mocked(execSync).mockImplementation((cmd: string) => {
        if (cmd.includes("git rev-parse")) {
          return "";
        }
        if (cmd.includes("which gh")) {
          return "/usr/bin/gh";
        }
        if (cmd.includes("gh pr list")) {
          return JSON.stringify([
            { headRefName: "night-watch/01-feature" },
          ]);
        }
        return "";
      });

      const program = new Command();
      prdsCommand(program);

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await program.parseAsync(["node", "test", "prds", "--json"]);

      const output = consoleSpy.mock.calls.map(call => call[0]).join("\n");
      const jsonOutput = JSON.parse(output);

      // The PRD should be marked as in-progress
      const prd = jsonOutput.find((p: { name: string }) => p.name === "01-feature");
      expect(prd).toBeDefined();
      expect(prd.status).toBe("in-progress");
      expect(prd.pr).toBe("night-watch/01-feature");

      consoleSpy.mockRestore();
    });
  });

  describe("edge cases", () => {
    it("should handle empty PRD directory", async () => {
      // Create empty PRD directory structure
      const prdDir = path.join(tempDir, "docs", "PRDs", "night-watch");
      fs.mkdirSync(prdDir, { recursive: true });
      fs.mkdirSync(path.join(prdDir, "done"), { recursive: true });

      const program = new Command();
      prdsCommand(program);

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await program.parseAsync(["node", "test", "prds", "--json"]);

      const output = consoleSpy.mock.calls.map(call => call[0]).join("\n");
      const jsonOutput = JSON.parse(output);

      expect(jsonOutput).toEqual([]);

      consoleSpy.mockRestore();
    });

    it("should exclude NIGHT-WATCH-SUMMARY.md file", async () => {
      // Create PRD directory structure
      const prdDir = path.join(tempDir, "docs", "PRDs", "night-watch");
      fs.mkdirSync(prdDir, { recursive: true });

      // Create summary file and regular PRD
      fs.writeFileSync(path.join(prdDir, "NIGHT-WATCH-SUMMARY.md"), "# Summary");
      fs.writeFileSync(path.join(prdDir, "regular-prd.md"), "# Regular PRD");

      const program = new Command();
      prdsCommand(program);

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await program.parseAsync(["node", "test", "prds", "--json"]);

      const output = consoleSpy.mock.calls.map(call => call[0]).join("\n");
      const jsonOutput = JSON.parse(output);

      // Should only have the regular PRD, not the summary
      expect(jsonOutput.length).toBe(1);
      expect(jsonOutput[0].name).toBe("regular-prd");

      consoleSpy.mockRestore();
    });

    it("should handle PRD with no dependencies", async () => {
      // Create PRD directory structure
      const prdDir = path.join(tempDir, "docs", "PRDs", "night-watch");
      fs.mkdirSync(prdDir, { recursive: true });

      // Create PRD without dependencies
      fs.writeFileSync(path.join(prdDir, "standalone.md"), "# Standalone PRD\n\nNo dependencies here.");

      const program = new Command();
      prdsCommand(program);

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await program.parseAsync(["node", "test", "prds", "--json"]);

      const output = consoleSpy.mock.calls.map(call => call[0]).join("\n");
      const jsonOutput = JSON.parse(output);

      expect(jsonOutput.length).toBe(1);
      expect(jsonOutput[0].dependencies).toEqual([]);
      expect(jsonOutput[0].unmetDependencies).toEqual([]);
      expect(jsonOutput[0].status).toBe("ready");

      consoleSpy.mockRestore();
    });
  });
});
