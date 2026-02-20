/**
 * Tests for Status tab render functions
 */

import { describe, it, expect } from "vitest";
import {
  renderPrdPane,
  renderProcessPane,
  renderPrPane,
  renderLogPane,
  sortPrdsByPriority,
} from "@/cli/commands/dashboard/tab-status.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

describe("tab-status render functions", () => {
  describe("renderPrdPane", () => {
    it("should return empty message when no PRDs", () => {
      expect(renderPrdPane([])).toBe("No PRD files found");
    });

    it("should render PRDs with status indicators", () => {
      const prds = [
        { name: "phase0", status: "ready" as const, dependencies: [], unmetDependencies: [] },
        { name: "phase1", status: "blocked" as const, dependencies: ["phase0"], unmetDependencies: ["phase0"] },
        { name: "phase2", status: "in-progress" as const, dependencies: [], unmetDependencies: [] },
        { name: "phase3", status: "done" as const, dependencies: [], unmetDependencies: [] },
      ];

      const result = renderPrdPane(prds);

      expect(result).toContain("phase0");
      expect(result).toContain("phase1");
      expect(result).toContain("phase2");
      expect(result).toContain("phase3");
      expect(result).toContain("{green-fg}");
      expect(result).toContain("{yellow-fg}");
      expect(result).toContain("{cyan-fg}");
      expect(result).toContain("{#888888-fg}");
      expect(result).toContain("(deps: phase0)");
    });

    it("should sort PRDs by priority when provided", () => {
      const prds = [
        { name: "alpha", status: "ready" as const, dependencies: [], unmetDependencies: [] },
        { name: "beta", status: "ready" as const, dependencies: [], unmetDependencies: [] },
        { name: "gamma", status: "ready" as const, dependencies: [], unmetDependencies: [] },
      ];

      const result = renderPrdPane(prds, ["gamma", "alpha", "beta"]);
      const lines = result.split("\n");

      expect(lines[0]).toContain("gamma");
      expect(lines[1]).toContain("alpha");
      expect(lines[2]).toContain("beta");
    });
  });

  describe("sortPrdsByPriority", () => {
    const prds = [
      { name: "alpha", status: "ready" as const, dependencies: [], unmetDependencies: [] },
      { name: "beta", status: "ready" as const, dependencies: [], unmetDependencies: [] },
      { name: "gamma", status: "ready" as const, dependencies: [], unmetDependencies: [] },
      { name: "delta", status: "ready" as const, dependencies: [], unmetDependencies: [] },
    ];

    it("should return original order when priority is empty", () => {
      const result = sortPrdsByPriority(prds, []);
      expect(result.map((p) => p.name)).toEqual(["alpha", "beta", "gamma", "delta"]);
    });

    it("should sort by priority order", () => {
      const result = sortPrdsByPriority(prds, ["gamma", "alpha"]);
      expect(result.map((p) => p.name)).toEqual(["gamma", "alpha", "beta", "delta"]);
    });

    it("should put unmentioned PRDs at the end alphabetically", () => {
      const result = sortPrdsByPriority(prds, ["delta"]);
      expect(result.map((p) => p.name)).toEqual(["delta", "alpha", "beta", "gamma"]);
    });

    it("should not mutate original array", () => {
      const original = [...prds];
      sortPrdsByPriority(prds, ["gamma"]);
      expect(prds.map((p) => p.name)).toEqual(original.map((p) => p.name));
    });
  });

  describe("renderProcessPane", () => {
    it("should render running and stopped processes", () => {
      const processes = [
        { name: "executor", running: true, pid: 12345 },
        { name: "reviewer", running: false, pid: null },
      ];

      const result = renderProcessPane(processes);

      expect(result).toContain("executor: Running (PID: 12345)");
      expect(result).toContain("reviewer: Not running");
    });

    it("should handle empty process list", () => {
      expect(renderProcessPane([])).toBe("");
    });
  });

  describe("renderPrPane", () => {
    it("should return empty message when no PRs", () => {
      expect(renderPrPane([])).toBe("No matching pull requests");
    });

    it("should render PRs with CI status and review scores", () => {
      const prs = [
        { number: 1, title: "Feature", branch: "feat/a", ciStatus: "pass" as const, reviewScore: 100 },
        { number: 2, title: "Fix", branch: "feat/b", ciStatus: "fail" as const, reviewScore: null },
      ];

      const result = renderPrPane(prs);

      expect(result).toContain("#1 Feature");
      expect(result).toContain("[Review: 100%]");
      expect(result).toContain("#2 Fix");
      expect(result).toContain("feat/a");
      expect(result).toContain("feat/b");
      expect(result).toContain("{green-fg}");
      expect(result).toContain("{red-fg}");
    });
  });

  describe("renderLogPane", () => {
    let tempDir: string;

    it("should return empty message when no logs exist", () => {
      const logs = [
        { name: "executor", path: "/tmp/nonexistent.log", exists: false, size: 0, lastLines: [] },
      ];
      expect(renderLogPane("/tmp", logs)).toBe("No log files found");
    });

    it("should render log content from existing file", () => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nw-log-test-"));
      const logPath = path.join(tempDir, "executor.log");
      fs.writeFileSync(logPath, "Line 1\nLine 2\nLine 3");

      const logs = [
        { name: "executor", path: logPath, exists: true, size: 100, lastLines: [] },
      ];

      const result = renderLogPane(tempDir, logs);

      expect(result).toContain("--- executor.log ---");
      expect(result).toContain("Line 1");
      expect(result).toContain("Line 3");

      fs.rmSync(tempDir, { recursive: true, force: true });
    });
  });
});
