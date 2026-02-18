/**
 * Tests for status data layer utilities
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

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
import {
  checkLockFile,
  collectLogInfo,
  collectPrdInfo,
  collectPrInfo,
  countOpenPRs,
  countPRDs,
  executorLockPath,
  fetchStatusSnapshot,
  getCrontabInfo,
  getLastLogLines,
  getLogInfo,
  getProjectName,
  isProcessRunning,
  parsePrdDependencies,
  projectRuntimeKey,
  reviewerLockPath,
} from "../../utils/status-data.js";
import { INightWatchConfig } from "../../types.js";

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
    provider: "claude",
    reviewerEnabled: true,
    providerEnv: {},
    notifications: { webhooks: [] },
    ...overrides,
  };
}

describe("status-data utilities", () => {
  let tempDir: string;

  beforeEach(() => {
    vi.resetAllMocks();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "night-watch-status-data-test-"));

    // Mock execSync to fail by default for git/gh commands
    vi.mocked(execSync).mockImplementation((cmd: string) => {
      if (cmd.includes("git rev-parse")) {
        throw new Error("not a git repo");
      }
      return "";
    });

    vi.mocked(getEntries).mockReturnValue([]);
    vi.mocked(getProjectEntries).mockReturnValue([]);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  describe("getProjectName", () => {
    it("should return name from package.json", () => {
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({ name: "my-project" })
      );
      expect(getProjectName(tempDir)).toBe("my-project");
    });

    it("should fall back to directory name if no package.json", () => {
      expect(getProjectName(tempDir)).toBe(path.basename(tempDir));
    });

    it("should fall back to directory name if package.json has no name", () => {
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({ version: "1.0.0" })
      );
      expect(getProjectName(tempDir)).toBe(path.basename(tempDir));
    });

    it("should fall back to directory name if package.json is invalid", () => {
      fs.writeFileSync(path.join(tempDir, "package.json"), "not json");
      expect(getProjectName(tempDir)).toBe(path.basename(tempDir));
    });
  });

  describe("isProcessRunning", () => {
    it("should return true when process exists", () => {
      const originalKill = process.kill;
      (process as any).kill = vi.fn().mockReturnValue(true);
      try {
        expect(isProcessRunning(12345)).toBe(true);
      } finally {
        (process as any).kill = originalKill;
      }
    });

    it("should return false when process does not exist", () => {
      const originalKill = process.kill;
      (process as any).kill = vi.fn().mockImplementation(() => {
        throw new Error("ESRCH");
      });
      try {
        expect(isProcessRunning(99999)).toBe(false);
      } finally {
        (process as any).kill = originalKill;
      }
    });
  });

  describe("checkLockFile", () => {
    it("should return not running when lock file does not exist", () => {
      const result = checkLockFile("/tmp/nonexistent-lock-file.lock");
      expect(result).toEqual({ running: false, pid: null });
    });

    it("should detect a running process from lock file", () => {
      const lockPath = path.join(tempDir, "test.lock");
      fs.writeFileSync(lockPath, "12345");

      const originalKill = process.kill;
      (process as any).kill = vi.fn().mockReturnValue(true);
      try {
        const result = checkLockFile(lockPath);
        expect(result.running).toBe(true);
        expect(result.pid).toBe(12345);
      } finally {
        (process as any).kill = originalKill;
      }
    });

    it("should detect a stopped process from lock file", () => {
      const lockPath = path.join(tempDir, "test.lock");
      fs.writeFileSync(lockPath, "99999");

      const originalKill = process.kill;
      (process as any).kill = vi.fn().mockImplementation(() => {
        throw new Error("ESRCH");
      });
      try {
        const result = checkLockFile(lockPath);
        expect(result.running).toBe(false);
        expect(result.pid).toBe(99999);
      } finally {
        (process as any).kill = originalKill;
      }
    });

    it("should handle invalid PID in lock file", () => {
      const lockPath = path.join(tempDir, "test.lock");
      fs.writeFileSync(lockPath, "not-a-number");

      const result = checkLockFile(lockPath);
      expect(result).toEqual({ running: false, pid: null });
    });
  });

  describe("projectRuntimeKey", () => {
    it("should return basename-hash format", () => {
      const key = projectRuntimeKey("/home/user/projects/my-project");
      expect(key).toMatch(/^my-project-[a-f0-9]{12}$/);
    });

    it("should produce different keys for different paths with same basename", () => {
      const key1 = projectRuntimeKey("/home/user1/my-project");
      const key2 = projectRuntimeKey("/home/user2/my-project");
      expect(key1).not.toBe(key2);
      expect(key1.startsWith("my-project-")).toBe(true);
      expect(key2.startsWith("my-project-")).toBe(true);
    });

    it("should produce stable keys for the same path", () => {
      const key1 = projectRuntimeKey("/home/user/projects/my-project");
      const key2 = projectRuntimeKey("/home/user/projects/my-project");
      expect(key1).toBe(key2);
    });
  });

  describe("executorLockPath / reviewerLockPath", () => {
    it("should use runtime key in executor lock path", () => {
      const lockPath = executorLockPath("/home/user/my-project");
      expect(lockPath).toMatch(/^\/tmp\/night-watch-my-project-[a-f0-9]{12}\.lock$/);
    });

    it("should use runtime key in reviewer lock path", () => {
      const lockPath = reviewerLockPath("/home/user/my-project");
      expect(lockPath).toMatch(/^\/tmp\/night-watch-pr-reviewer-my-project-[a-f0-9]{12}\.lock$/);
    });
  });

  describe("countPRDs", () => {
    it("should return zeros when PRD directory does not exist", () => {
      const result = countPRDs(tempDir, "docs/PRDs/night-watch", 7200);
      expect(result).toEqual({ pending: 0, claimed: 0, done: 0 });
    });

    it("should count pending and done PRDs", () => {
      const prdDir = path.join(tempDir, "docs", "PRDs", "night-watch");
      fs.mkdirSync(prdDir, { recursive: true });
      fs.mkdirSync(path.join(prdDir, "done"), { recursive: true });

      fs.writeFileSync(path.join(prdDir, "phase1.md"), "# Phase 1");
      fs.writeFileSync(path.join(prdDir, "phase2.md"), "# Phase 2");
      fs.writeFileSync(path.join(prdDir, "done", "phase0.md"), "# Phase 0");

      const result = countPRDs(tempDir, "docs/PRDs/night-watch", 7200);
      expect(result.pending).toBe(2);
      expect(result.claimed).toBe(0);
      expect(result.done).toBe(1);
    });

    it("should count claimed PRDs separately", () => {
      const prdDir = path.join(tempDir, "docs", "PRDs", "night-watch");
      fs.mkdirSync(prdDir, { recursive: true });

      fs.writeFileSync(path.join(prdDir, "phase1.md"), "# Phase 1");
      fs.writeFileSync(path.join(prdDir, "phase2.md"), "# Phase 2");

      // Active claim for phase1
      fs.writeFileSync(
        path.join(prdDir, "phase1.md.claim"),
        JSON.stringify({ timestamp: Math.floor(Date.now() / 1000), hostname: "test", pid: 1234 })
      );

      const result = countPRDs(tempDir, "docs/PRDs/night-watch", 7200);
      expect(result.pending).toBe(1);
      expect(result.claimed).toBe(1);
    });

    it("should treat expired claims as pending", () => {
      const prdDir = path.join(tempDir, "docs", "PRDs", "night-watch");
      fs.mkdirSync(prdDir, { recursive: true });

      fs.writeFileSync(path.join(prdDir, "phase1.md"), "# Phase 1");
      // Old claim (timestamp older than maxRuntime)
      fs.writeFileSync(
        path.join(prdDir, "phase1.md.claim"),
        JSON.stringify({ timestamp: Math.floor(Date.now() / 1000) - 10000, hostname: "test", pid: 1234 })
      );

      const result = countPRDs(tempDir, "docs/PRDs/night-watch", 7200);
      expect(result.pending).toBe(1);
      expect(result.claimed).toBe(0);
    });
  });

  describe("collectPrdInfo", () => {
    it("should return empty array when PRD directory does not exist", () => {
      const result = collectPrdInfo(tempDir, "docs/PRDs/night-watch", 7200);
      expect(result).toEqual([]);
    });

    it("should collect PRD info with correct statuses", () => {
      const prdDir = path.join(tempDir, "docs", "PRDs", "night-watch");
      fs.mkdirSync(prdDir, { recursive: true });
      fs.mkdirSync(path.join(prdDir, "done"), { recursive: true });

      fs.writeFileSync(path.join(prdDir, "phase1.md"), "# Phase 1");
      fs.writeFileSync(path.join(prdDir, "phase2.md"), "# Phase 2");
      fs.writeFileSync(path.join(prdDir, "done", "phase0.md"), "# Phase 0");

      // Active claim for phase1
      fs.writeFileSync(
        path.join(prdDir, "phase1.md.claim"),
        JSON.stringify({ timestamp: Math.floor(Date.now() / 1000), hostname: "test", pid: 1234 })
      );

      const result = collectPrdInfo(tempDir, "docs/PRDs/night-watch", 7200);
      expect(result).toHaveLength(3);

      const phase0 = result.find((p) => p.name === "phase0");
      expect(phase0).toBeDefined();
      expect(phase0!.status).toBe("done");

      const phase1 = result.find((p) => p.name === "phase1");
      expect(phase1).toBeDefined();
      expect(phase1!.status).toBe("in-progress");

      const phase2 = result.find((p) => p.name === "phase2");
      expect(phase2).toBeDefined();
      expect(phase2!.status).toBe("ready");
    });
  });

  describe("countOpenPRs", () => {
    it("should return 0 when not in a git repo", () => {
      const result = countOpenPRs(tempDir, ["feat/", "night-watch/"]);
      expect(result).toBe(0);
    });

    it("should return 0 when gh is not available", () => {
      vi.mocked(execSync).mockImplementation((cmd: string) => {
        if (cmd.includes("git rev-parse")) return ".git";
        if (cmd.includes("which gh")) throw new Error("not found");
        return "";
      });

      const result = countOpenPRs(tempDir, ["feat/", "night-watch/"]);
      expect(result).toBe(0);
    });

    it("should count matching PRs", () => {
      vi.mocked(execSync).mockImplementation((cmd: string) => {
        if (cmd.includes("git rev-parse")) return ".git";
        if (cmd.includes("which gh")) return "/usr/bin/gh";
        if (cmd.includes("gh pr list")) {
          return JSON.stringify([
            { headRefName: "feat/new-feature", number: 1 },
            { headRefName: "night-watch/phase-1", number: 2 },
            { headRefName: "fix/bugfix", number: 3 },
          ]);
        }
        return "";
      });

      const result = countOpenPRs(tempDir, ["feat/", "night-watch/"]);
      expect(result).toBe(2);
    });
  });

  describe("collectPrInfo", () => {
    it("should return empty array when not in a git repo", () => {
      const result = collectPrInfo(tempDir, ["feat/", "night-watch/"]);
      expect(result).toEqual([]);
    });

    it("should collect matching PR info with no CI data", () => {
      vi.mocked(execSync).mockImplementation((cmd: string) => {
        if (cmd.includes("git rev-parse")) return ".git";
        if (cmd.includes("which gh")) return "/usr/bin/gh";
        if (cmd.includes("gh pr list")) {
          return JSON.stringify([
            { headRefName: "feat/new-feature", number: 1, title: "New Feature", url: "https://github.com/test/repo/pull/1" },
            { headRefName: "night-watch/phase-1", number: 2, title: "Phase 1", url: "https://github.com/test/repo/pull/2" },
            { headRefName: "fix/bugfix", number: 3, title: "Bugfix", url: "https://github.com/test/repo/pull/3" },
          ]);
        }
        return "";
      });

      const result = collectPrInfo(tempDir, ["feat/", "night-watch/"]);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        number: 1,
        title: "New Feature",
        branch: "feat/new-feature",
        url: "https://github.com/test/repo/pull/1",
        ciStatus: "unknown",
        reviewScore: null,
      });
      expect(result[1]).toEqual({
        number: 2,
        title: "Phase 1",
        branch: "night-watch/phase-1",
        url: "https://github.com/test/repo/pull/2",
        ciStatus: "unknown",
        reviewScore: null,
      });
    });

    it("should derive CI status and review score from gh data", () => {
      vi.mocked(execSync).mockImplementation((cmd: string) => {
        if (cmd.includes("git rev-parse")) return ".git";
        if (cmd.includes("which gh")) return "/usr/bin/gh";
        if (cmd.includes("gh pr list")) {
          return JSON.stringify([
            {
              headRefName: "feat/passing",
              number: 1,
              title: "Passing PR",
              url: "https://github.com/test/repo/pull/1",
              // CheckRun format: status + conclusion
              statusCheckRollup: [{ status: "COMPLETED", conclusion: "SUCCESS" }],
              reviewDecision: "APPROVED",
            },
            {
              headRefName: "feat/failing",
              number: 2,
              title: "Failing PR",
              url: "https://github.com/test/repo/pull/2",
              statusCheckRollup: [{ status: "COMPLETED", conclusion: "FAILURE" }],
              reviewDecision: "CHANGES_REQUESTED",
            },
            {
              headRefName: "feat/pending",
              number: 3,
              title: "Pending PR",
              url: "https://github.com/test/repo/pull/3",
              // In-progress check has no conclusion yet
              statusCheckRollup: [{ status: "IN_PROGRESS", conclusion: null }],
              reviewDecision: "REVIEW_REQUIRED",
            },
          ]);
        }
        return "";
      });

      const result = collectPrInfo(tempDir, ["feat/"]);
      expect(result).toHaveLength(3);

      expect(result[0].ciStatus).toBe("pass");
      expect(result[0].reviewScore).toBe(100);

      expect(result[1].ciStatus).toBe("fail");
      expect(result[1].reviewScore).toBe(0);

      expect(result[2].ciStatus).toBe("pending");
      expect(result[2].reviewScore).toBe(null);
    });
  });

  describe("getLastLogLines", () => {
    it("should return empty array when file does not exist", () => {
      const result = getLastLogLines("/tmp/nonexistent-log.log", 5);
      expect(result).toEqual([]);
    });

    it("should return last N lines", () => {
      const logPath = path.join(tempDir, "test.log");
      fs.writeFileSync(logPath, "Line 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6");

      const result = getLastLogLines(logPath, 3);
      expect(result).toEqual(["Line 4", "Line 5", "Line 6"]);
    });

    it("should return all lines when file has fewer than N lines", () => {
      const logPath = path.join(tempDir, "test.log");
      fs.writeFileSync(logPath, "Line 1\nLine 2");

      const result = getLastLogLines(logPath, 5);
      expect(result).toEqual(["Line 1", "Line 2"]);
    });
  });

  describe("getLogInfo", () => {
    it("should return info for existing log file", () => {
      const logPath = path.join(tempDir, "test.log");
      fs.writeFileSync(logPath, "Line 1\nLine 2\nLine 3");

      const result = getLogInfo(logPath);
      expect(result.exists).toBe(true);
      expect(result.size).toBeGreaterThan(0);
      expect(result.lastLines).toEqual(["Line 1", "Line 2", "Line 3"]);
      expect(result.path).toBe(logPath);
    });

    it("should return info for non-existing log file", () => {
      const result = getLogInfo("/tmp/nonexistent-log-file.log");
      expect(result.exists).toBe(false);
      expect(result.size).toBe(0);
      expect(result.lastLines).toEqual([]);
    });
  });

  describe("collectLogInfo", () => {
    it("should collect info for both executor and reviewer logs", () => {
      const logDir = path.join(tempDir, "logs");
      fs.mkdirSync(logDir, { recursive: true });
      fs.writeFileSync(path.join(logDir, "executor.log"), "Executor line 1");

      const result = collectLogInfo(tempDir);
      expect(result).toHaveLength(2);

      const executorLog = result.find((l) => l.name === "executor");
      expect(executorLog).toBeDefined();
      expect(executorLog!.exists).toBe(true);
      expect(executorLog!.size).toBeGreaterThan(0);

      const reviewerLog = result.find((l) => l.name === "reviewer");
      expect(reviewerLog).toBeDefined();
      expect(reviewerLog!.exists).toBe(false);
    });
  });

  describe("getCrontabInfo", () => {
    it("should return not installed when no entries", () => {
      vi.mocked(getEntries).mockReturnValue([]);
      vi.mocked(getProjectEntries).mockReturnValue([]);

      const result = getCrontabInfo("test-project", tempDir);
      expect(result.installed).toBe(false);
      expect(result.entries).toEqual([]);
    });

    it("should return installed with entries", () => {
      vi.mocked(getEntries).mockReturnValue([
        "0 * * * * night-watch run  # night-watch-cli: test-project",
      ]);
      vi.mocked(getProjectEntries).mockReturnValue([]);

      const result = getCrontabInfo("test-project", tempDir);
      expect(result.installed).toBe(true);
      expect(result.entries).toHaveLength(1);
    });

    it("should deduplicate entries from both sources", () => {
      const entry = "0 * * * * night-watch run  # night-watch-cli: test-project";
      vi.mocked(getEntries).mockReturnValue([entry]);
      vi.mocked(getProjectEntries).mockReturnValue([entry]);

      const result = getCrontabInfo("test-project", tempDir);
      expect(result.entries).toHaveLength(1);
    });
  });

  describe("parsePrdDependencies", () => {
    it("should parse 'depends on' line", () => {
      const prdPath = path.join(tempDir, "phase2.md");
      fs.writeFileSync(
        prdPath,
        "# Phase 2\n\nDepends on: `phase0`, `phase1`\n\nSome content."
      );

      const result = parsePrdDependencies(prdPath);
      expect(result).toEqual(["phase0", "phase1"]);
    });

    it("should handle no dependencies", () => {
      const prdPath = path.join(tempDir, "phase1.md");
      fs.writeFileSync(prdPath, "# Phase 1\n\nNo dependency info here.");

      const result = parsePrdDependencies(prdPath);
      expect(result).toEqual([]);
    });

    it("should handle missing file", () => {
      const result = parsePrdDependencies("/tmp/nonexistent-prd-file.md");
      expect(result).toEqual([]);
    });

    it("should handle depends on without backticks", () => {
      const prdPath = path.join(tempDir, "phase3.md");
      fs.writeFileSync(
        prdPath,
        "# Phase 3\n\nDepends on: phase1, phase2\n\nSome content."
      );

      const result = parsePrdDependencies(prdPath);
      expect(result).toEqual(["phase1", "phase2"]);
    });

    it("should handle bold markdown depends on format", () => {
      const prdPath = path.join(tempDir, "phase4.md");
      fs.writeFileSync(
        prdPath,
        "# Phase 4\n\n**Depends on:** `phase1`, `phase2`\n\nSome content."
      );

      const result = parsePrdDependencies(prdPath);
      expect(result).toEqual(["phase1", "phase2"]);
    });

    it("should return empty array for bold depends on with no deps", () => {
      const prdPath = path.join(tempDir, "phase5.md");
      fs.writeFileSync(
        prdPath,
        "# Phase 5\n\n**Depends on:**\n\nSome content."
      );

      const result = parsePrdDependencies(prdPath);
      expect(result).toEqual([]);
    });
  });

  describe("collectPrdInfo with dependencies", () => {
    it("should mark PRDs with unmet dependencies as blocked", () => {
      const prdDir = path.join(tempDir, "docs", "PRDs", "night-watch");
      fs.mkdirSync(prdDir, { recursive: true });
      fs.mkdirSync(path.join(prdDir, "done"), { recursive: true });

      // phase0 is done
      fs.writeFileSync(path.join(prdDir, "done", "phase0.md"), "# Phase 0");
      // phase1 depends on phase0 (which is done) => ready
      fs.writeFileSync(
        path.join(prdDir, "phase1.md"),
        "# Phase 1\n\nDepends on: `phase0`"
      );
      // phase2 depends on phase1 (which is NOT done) => blocked
      fs.writeFileSync(
        path.join(prdDir, "phase2.md"),
        "# Phase 2\n\nDepends on: `phase1`"
      );

      const result = collectPrdInfo(tempDir, "docs/PRDs/night-watch", 7200);

      const phase1 = result.find((p) => p.name === "phase1");
      expect(phase1).toBeDefined();
      expect(phase1!.status).toBe("ready");
      expect(phase1!.dependencies).toEqual(["phase0"]);
      expect(phase1!.unmetDependencies).toEqual([]);

      const phase2 = result.find((p) => p.name === "phase2");
      expect(phase2).toBeDefined();
      expect(phase2!.status).toBe("blocked");
      expect(phase2!.dependencies).toEqual(["phase1"]);
      expect(phase2!.unmetDependencies).toEqual(["phase1"]);
    });

    it("should resolve deps with .md extension against done PRDs", () => {
      const prdDir = path.join(tempDir, "docs", "PRDs", "night-watch");
      fs.mkdirSync(prdDir, { recursive: true });
      fs.mkdirSync(path.join(prdDir, "done"), { recursive: true });

      // phase0 is done (stored as phase0.md, name becomes "phase0")
      fs.writeFileSync(path.join(prdDir, "done", "phase0.md"), "# Phase 0");
      // phase1 depends on "phase0.md" (with extension) => should still resolve as ready
      fs.writeFileSync(
        path.join(prdDir, "phase1.md"),
        "# Phase 1\n\n**Depends on:** `phase0.md`"
      );

      const result = collectPrdInfo(tempDir, "docs/PRDs/night-watch", 7200);

      const phase1 = result.find((p) => p.name === "phase1");
      expect(phase1).toBeDefined();
      expect(phase1!.status).toBe("ready");
      expect(phase1!.unmetDependencies).toEqual([]);
    });
  });

  describe("fetchStatusSnapshot", () => {
    it("should return all expected fields", () => {
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({ name: "test-project" })
      );

      const config = makeConfig();
      const snapshot = fetchStatusSnapshot(tempDir, config);

      expect(snapshot.projectName).toBe("test-project");
      expect(snapshot.projectDir).toBe(tempDir);
      expect(snapshot.config).toBe(config);
      expect(Array.isArray(snapshot.prds)).toBe(true);
      expect(Array.isArray(snapshot.processes)).toBe(true);
      expect(snapshot.processes).toHaveLength(2);
      expect(snapshot.processes[0].name).toBe("executor");
      expect(snapshot.processes[1].name).toBe("reviewer");
      expect(Array.isArray(snapshot.prs)).toBe(true);
      expect(Array.isArray(snapshot.logs)).toBe(true);
      expect(snapshot.logs).toHaveLength(2);
      expect(snapshot.crontab).toHaveProperty("installed");
      expect(snapshot.crontab).toHaveProperty("entries");
      expect(snapshot.timestamp).toBeInstanceOf(Date);
    });

    it("should detect PRDs in the snapshot", () => {
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({ name: "test-project" })
      );

      const prdDir = path.join(tempDir, "docs", "PRDs", "night-watch");
      fs.mkdirSync(prdDir, { recursive: true });
      fs.mkdirSync(path.join(prdDir, "done"), { recursive: true });

      fs.writeFileSync(path.join(prdDir, "phase1.md"), "# Phase 1");
      fs.writeFileSync(path.join(prdDir, "done", "phase0.md"), "# Phase 0");

      const config = makeConfig();
      const snapshot = fetchStatusSnapshot(tempDir, config);

      expect(snapshot.prds).toHaveLength(2);
      expect(snapshot.prds.find((p) => p.name === "phase1")?.status).toBe("ready");
      expect(snapshot.prds.find((p) => p.name === "phase0")?.status).toBe("done");
    });

    it("should detect log files in the snapshot", () => {
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({ name: "test-project" })
      );

      const logDir = path.join(tempDir, "logs");
      fs.mkdirSync(logDir, { recursive: true });
      fs.writeFileSync(path.join(logDir, "executor.log"), "Log line 1\nLog line 2");

      const config = makeConfig();
      const snapshot = fetchStatusSnapshot(tempDir, config);

      const executorLog = snapshot.logs.find((l) => l.name === "executor");
      expect(executorLog).toBeDefined();
      expect(executorLog!.exists).toBe(true);
      expect(executorLog!.lastLines).toEqual(["Log line 1", "Log line 2"]);

      const reviewerLog = snapshot.logs.find((l) => l.name === "reviewer");
      expect(reviewerLog).toBeDefined();
      expect(reviewerLog!.exists).toBe(false);
    });

    it("should include crontab info in the snapshot", () => {
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({ name: "test-project" })
      );

      vi.mocked(getEntries).mockReturnValue([
        "0 * * * * night-watch run  # night-watch-cli: test-project",
      ]);

      const config = makeConfig();
      const snapshot = fetchStatusSnapshot(tempDir, config);

      expect(snapshot.crontab.installed).toBe(true);
      expect(snapshot.crontab.entries).toHaveLength(1);
    });
  });
});
