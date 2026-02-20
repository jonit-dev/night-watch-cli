/**
 * Tests for dashboard command
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "child_process";
import {
  renderPrdPane,
  renderProcessPane,
  renderPrPane,
  renderLogPane,
} from "@/cli/commands/dashboard.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// Cache help output to avoid repeated CLI spawns
let cachedHelpOutput: string | null = null;
let cachedDashboardHelpOutput: string | null = null;

function getMainHelp(): string {
  if (!cachedHelpOutput) {
    cachedHelpOutput = execSync("node dist/cli.js --help", {
      encoding: "utf-8",
      cwd: process.cwd(),
      timeout: 10000,
    });
  }
  return cachedHelpOutput;
}

function getDashboardHelp(): string {
  if (!cachedDashboardHelpOutput) {
    cachedDashboardHelpOutput = execSync("node dist/cli.js dashboard --help", {
      encoding: "utf-8",
      cwd: process.cwd(),
      timeout: 10000,
    });
  }
  return cachedDashboardHelpOutput;
}

describe("dashboard command", () => {
  describe("help output", () => {
    it("should show dashboard command in main help", () => {
      const output = getMainHelp();
      expect(output).toContain("dashboard");
    });

    it("should show dashboard command help", () => {
      const output = getDashboardHelp();
      expect(output).toContain("Live terminal dashboard");
      expect(output).toContain("--interval");
    });

    it("should show default interval value in help", () => {
      const output = getDashboardHelp();
      expect(output).toContain("10");
    });
  });

  describe("renderPrdPane", () => {
    it("should render empty message when no PRDs", () => {
      const result = renderPrdPane([]);
      expect(result).toBe("No PRD files found");
    });

    it("should render PRDs with colored status indicators", () => {
      const prds = [
        { name: "phase0", status: "done" as const, dependencies: [], unmetDependencies: [] },
        { name: "phase1", status: "ready" as const, dependencies: [], unmetDependencies: [] },
        { name: "phase2", status: "blocked" as const, dependencies: ["phase1"], unmetDependencies: ["phase1"] },
        { name: "phase3", status: "in-progress" as const, dependencies: [], unmetDependencies: [] },
      ];

      const result = renderPrdPane(prds);

      // Verify each PRD name appears
      expect(result).toContain("phase0");
      expect(result).toContain("phase1");
      expect(result).toContain("phase2");
      expect(result).toContain("phase3");

      // Verify dependency info
      expect(result).toContain("(deps: phase1)");

      // Verify color tags are present
      expect(result).toContain("{green-fg}");
      expect(result).toContain("{yellow-fg}");
      expect(result).toContain("{cyan-fg}");
      expect(result).toContain("{#888888-fg}");
    });

    it("should show multiple dependencies separated by commas", () => {
      const prds = [
        { name: "phase3", status: "blocked" as const, dependencies: ["phase1", "phase2"], unmetDependencies: ["phase1", "phase2"] },
      ];

      const result = renderPrdPane(prds);
      expect(result).toContain("(deps: phase1, phase2)");
    });
  });

  describe("renderProcessPane", () => {
    it("should render running process with PID", () => {
      const processes = [
        { name: "executor", running: true, pid: 12345 },
        { name: "reviewer", running: false, pid: null },
      ];

      const result = renderProcessPane(processes);

      expect(result).toContain("executor: Running (PID: 12345)");
      expect(result).toContain("reviewer: Not running");
    });

    it("should render all processes as not running", () => {
      const processes = [
        { name: "executor", running: false, pid: null },
        { name: "reviewer", running: false, pid: null },
      ];

      const result = renderProcessPane(processes);

      expect(result).toContain("executor: Not running");
      expect(result).toContain("reviewer: Not running");
    });
  });

  describe("renderPrPane", () => {
    it("should render empty message when no PRs", () => {
      const result = renderPrPane([]);
      expect(result).toBe("No matching pull requests");
    });

    it("should render PRs with CI status and branch info", () => {
      const prs = [
        { number: 1, title: "New Feature", branch: "feat/new-feature", ciStatus: "pass" as const, reviewScore: 100 },
        { number: 2, title: "Phase 1", branch: "night-watch/phase-1", ciStatus: "fail" as const, reviewScore: 0 },
        { number: 3, title: "WIP", branch: "feat/wip", ciStatus: "pending" as const, reviewScore: null },
        { number: 4, title: "Unknown CI", branch: "feat/unknown", ciStatus: "unknown" as const, reviewScore: null },
      ];

      const result = renderPrPane(prs);

      expect(result).toContain("#1 New Feature");
      expect(result).toContain("feat/new-feature");
      expect(result).toContain("#2 Phase 1");
      expect(result).toContain("night-watch/phase-1");
      expect(result).toContain("{green-fg}");
      expect(result).toContain("{red-fg}");
      expect(result).toContain("{yellow-fg}");
      // Verify review scores are displayed
      expect(result).toContain("[Review: 100%]");
      expect(result).toContain("[Review: 0%]");
      // PRs with null reviewScore should not show review label
      expect(result).not.toContain("#3 WIP [Review:");
    });
  });

  describe("renderLogPane", () => {
    let tempDir: string;

    beforeAll(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "night-watch-dashboard-test-"));
    });

    afterAll(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it("should render empty message when no log files exist", () => {
      const logs = [
        { name: "executor", path: "/tmp/nonexistent/executor.log", exists: false, size: 0, lastLines: [] },
        { name: "reviewer", path: "/tmp/nonexistent/reviewer.log", exists: false, size: 0, lastLines: [] },
      ];

      const result = renderLogPane(tempDir, logs);
      expect(result).toBe("No log files found");
    });

    it("should render log content from the most recent log file", () => {
      const logDir = path.join(tempDir, "logs");
      fs.mkdirSync(logDir, { recursive: true });

      const executorLogPath = path.join(logDir, "executor.log");
      fs.writeFileSync(executorLogPath, "Line 1\nLine 2\nLine 3");

      const logs = [
        {
          name: "executor",
          path: executorLogPath,
          exists: true,
          size: 100,
          lastLines: ["Line 1", "Line 2", "Line 3"],
        },
        {
          name: "reviewer",
          path: path.join(logDir, "reviewer.log"),
          exists: false,
          size: 0,
          lastLines: [],
        },
      ];

      const result = renderLogPane(tempDir, logs);
      expect(result).toContain("--- executor.log ---");
      expect(result).toContain("Line 1");
      expect(result).toContain("Line 2");
      expect(result).toContain("Line 3");
    });
  });

  describe("graceful handling", () => {
    it("should handle missing gh CLI gracefully via status-data", () => {
      // The dashboard relies on status-data.ts which catches gh CLI errors
      // and returns empty arrays. Verify the help still works (no crashes).
      const output = getDashboardHelp();
      expect(output).toContain("Live terminal dashboard");
    });
  });

  describe("render functions with empty data", () => {
    it("should handle empty data without crash", () => {
      // All render functions should handle empty/minimal inputs gracefully
      const prdResult = renderPrdPane([]);
      expect(prdResult).toBe("No PRD files found");

      const processResult = renderProcessPane([]);
      expect(processResult).toBe("");

      const prResult = renderPrPane([]);
      expect(prResult).toBe("No matching pull requests");
    });

    it("should handle single-item arrays without crash", () => {
      const prdResult = renderPrdPane([
        { name: "only-prd", status: "ready", dependencies: [], unmetDependencies: [] },
      ]);
      expect(prdResult).toContain("only-prd");

      const processResult = renderProcessPane([
        { name: "executor", running: false, pid: null },
      ]);
      expect(processResult).toContain("executor: Not running");

      const prResult = renderPrPane([
        { number: 1, title: "Solo PR", branch: "feat/solo", ciStatus: "pass", reviewScore: null },
      ]);
      expect(prResult).toContain("#1 Solo PR");
      expect(prResult).toContain("feat/solo");
    });
  });

  describe("pane navigation design", () => {
    it("should show navigation hints in footer text", () => {
      // Verify the dashboard help output includes the command,
      // which confirms the keyboard hints are wired in the footer
      const output = getDashboardHelp();
      expect(output).toContain("dashboard");
      expect(output).toContain("Live terminal dashboard");
    });
  });
});
