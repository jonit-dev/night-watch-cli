/**
 * Tests for execution history ledger
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

import {
  loadHistory,
  saveHistory,
  recordExecution,
  getLastExecution,
  isInCooldown,
  getHistoryPath,
  closeDb,
  resetRepositories,
} from "../../utils/execution-history.js";

// Use a temp directory so tests never touch the real ~/.night-watch/
let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nw-history-test-"));
  process.env.NIGHT_WATCH_HOME = tmpDir;
});

afterEach(() => {
  closeDb();
  resetRepositories();
  delete process.env.NIGHT_WATCH_HOME;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("execution-history", () => {
  describe("getHistoryPath", () => {
    it("should use NIGHT_WATCH_HOME when set", () => {
      expect(getHistoryPath()).toBe(path.join(tmpDir, "history.json"));
    });
  });

  describe("loadHistory", () => {
    it("should return empty history when no records exist", () => {
      expect(loadHistory()).toEqual({});
    });

    it("should return empty history when no records exist for invalid-JSON scenario", () => {
      // With SQLite backend, JSON file content is irrelevant — DB starts empty
      expect(loadHistory()).toEqual({});
    });

    it("should return empty history when no records exist for non-object scenario", () => {
      // With SQLite backend, JSON file content is irrelevant — DB starts empty
      expect(loadHistory()).toEqual({});
    });

    it("should load valid history saved via saveHistory", () => {
      const history: Parameters<typeof saveHistory>[0] = {
        "/projects/app": {
          "test.md": {
            records: [
              { timestamp: 1000, outcome: "failure", exitCode: 1, attempt: 1 },
            ],
          },
        },
      };
      saveHistory(history);
      expect(loadHistory()).toEqual(history);
    });
  });

  describe("saveHistory", () => {
    it("should persist history retrievable via loadHistory", () => {
      const history = {
        "/projects/app": {
          "test.md": {
            records: [
              { timestamp: 1000, outcome: "success" as const, exitCode: 0, attempt: 1 },
            ],
          },
        },
      };
      saveHistory(history);
      expect(loadHistory()).toEqual(history);
    });

    it("should create the DB directory if missing", () => {
      delete process.env.NIGHT_WATCH_HOME;
      closeDb();
      resetRepositories();
      const nested = path.join(tmpDir, "sub", "dir");
      process.env.NIGHT_WATCH_HOME = nested;
      saveHistory({});
      // SQLite DB is created in the nested directory
      expect(fs.existsSync(path.join(nested, "state.db"))).toBe(true);
    });

    it("should not create lock files (SQLite handles concurrency)", () => {
      saveHistory({});
      expect(fs.existsSync(path.join(tmpDir, "history.json.lock"))).toBe(false);
    });
  });

  describe("recordExecution", () => {
    it("should record execution and persist to the repository", () => {
      recordExecution("/projects/app", "feature.md", "failure", 1);
      const history = loadHistory();
      const resolved = path.resolve("/projects/app");
      expect(history[resolved]).toBeDefined();
      expect(history[resolved]["feature.md"].records).toHaveLength(1);
      expect(history[resolved]["feature.md"].records[0].outcome).toBe("failure");
      expect(history[resolved]["feature.md"].records[0].exitCode).toBe(1);
    });

    it("should append multiple records", () => {
      recordExecution("/projects/app", "feature.md", "failure", 1);
      recordExecution("/projects/app", "feature.md", "timeout", 124);
      const history = loadHistory();
      const resolved = path.resolve("/projects/app");
      expect(history[resolved]["feature.md"].records).toHaveLength(2);
      expect(history[resolved]["feature.md"].records[1].outcome).toBe("timeout");
    });

    it("should trim records to max 10 per PRD", () => {
      for (let i = 0; i < 12; i++) {
        recordExecution("/projects/app", "feature.md", "failure", 1, i + 1);
      }
      const history = loadHistory();
      const resolved = path.resolve("/projects/app");
      const records = history[resolved]["feature.md"].records;
      expect(records).toHaveLength(10);
      // Oldest records (attempt 1, 2) should be gone; newest (attempt 12) should be last
      expect(records[0].attempt).toBe(3);
      expect(records[9].attempt).toBe(12);
    });

    it("should isolate projects by path", () => {
      recordExecution("/projects/app-a", "feature.md", "failure", 1);
      recordExecution("/projects/app-b", "feature.md", "success", 0);
      const history = loadHistory();
      const resolvedA = path.resolve("/projects/app-a");
      const resolvedB = path.resolve("/projects/app-b");
      expect(history[resolvedA]["feature.md"].records[0].outcome).toBe("failure");
      expect(history[resolvedB]["feature.md"].records[0].outcome).toBe("success");
    });

    it("should isolate PRDs within the same project", () => {
      recordExecution("/projects/app", "prd-a.md", "failure", 1);
      recordExecution("/projects/app", "prd-b.md", "success", 0);
      const history = loadHistory();
      const resolved = path.resolve("/projects/app");
      expect(history[resolved]["prd-a.md"].records[0].outcome).toBe("failure");
      expect(history[resolved]["prd-b.md"].records[0].outcome).toBe("success");
    });
  });

  describe("getLastExecution", () => {
    it("should return null when no history exists", () => {
      expect(getLastExecution("/projects/app", "none.md")).toBeNull();
    });

    it("should return the most recent record", () => {
      recordExecution("/projects/app", "feature.md", "failure", 1, 1);
      recordExecution("/projects/app", "feature.md", "success", 0, 2);
      const last = getLastExecution("/projects/app", "feature.md");
      expect(last?.outcome).toBe("success");
      expect(last?.attempt).toBe(2);
    });
  });

  describe("isInCooldown", () => {
    it("should report not in cooldown when no history exists", () => {
      expect(isInCooldown("/projects/app", "none.md", 7200)).toBe(false);
    });

    it("should report not in cooldown when last record is success", () => {
      recordExecution("/projects/app", "feature.md", "success", 0);
      expect(isInCooldown("/projects/app", "feature.md", 7200)).toBe(false);
    });

    it("should report in cooldown when last failure is recent", () => {
      recordExecution("/projects/app", "feature.md", "failure", 1);
      // Just recorded, so it should be in cooldown with a large period
      expect(isInCooldown("/projects/app", "feature.md", 7200)).toBe(true);
    });

    it("should report in cooldown for timeout outcome", () => {
      recordExecution("/projects/app", "feature.md", "timeout", 124);
      expect(isInCooldown("/projects/app", "feature.md", 7200)).toBe(true);
    });

    it("should report in cooldown for rate_limited outcome", () => {
      recordExecution("/projects/app", "feature.md", "rate_limited", 1);
      expect(isInCooldown("/projects/app", "feature.md", 7200)).toBe(true);
    });

    it("should report not in cooldown when last failure is old", () => {
      const resolved = path.resolve("/projects/app");
      const history = {
        [resolved]: {
          "feature.md": {
            records: [
              { timestamp: Math.floor(Date.now() / 1000) - 10000, outcome: "failure" as const, exitCode: 1, attempt: 1 },
            ],
          },
        },
      };
      saveHistory(history);
      expect(isInCooldown("/projects/app", "feature.md", 7200)).toBe(false);
    });

    it("should not be affected by other projects", () => {
      recordExecution("/projects/app-a", "feature.md", "failure", 1);
      expect(isInCooldown("/projects/app-b", "feature.md", 7200)).toBe(false);
    });
  });
});
