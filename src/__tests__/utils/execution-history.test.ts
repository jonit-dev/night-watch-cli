/**
 * Tests for execution history ledger
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
} from "../../utils/execution-history.js";

// Use a temp directory so tests never touch the real ~/.night-watch/
let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nw-history-test-"));
  process.env.NIGHT_WATCH_HOME = tmpDir;
});

afterEach(() => {
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
    it("should return empty history when file does not exist", () => {
      expect(loadHistory()).toEqual({});
    });

    it("should return empty history for invalid JSON", () => {
      fs.writeFileSync(path.join(tmpDir, "history.json"), "not json");
      expect(loadHistory()).toEqual({});
    });

    it("should return empty history for non-object JSON", () => {
      fs.writeFileSync(path.join(tmpDir, "history.json"), "[1,2,3]");
      expect(loadHistory()).toEqual({});
    });

    it("should load valid history", () => {
      const history = {
        "/projects/app": {
          "test.md": {
            records: [
              { timestamp: 1000, outcome: "failure", exitCode: 1, attempt: 1 },
            ],
          },
        },
      };
      fs.writeFileSync(
        path.join(tmpDir, "history.json"),
        JSON.stringify(history)
      );
      expect(loadHistory()).toEqual(history);
    });
  });

  describe("saveHistory", () => {
    it("should write history to disk", () => {
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
      const content = fs.readFileSync(
        path.join(tmpDir, "history.json"),
        "utf-8"
      );
      expect(JSON.parse(content)).toEqual(history);
    });

    it("should create directory if missing", () => {
      delete process.env.NIGHT_WATCH_HOME;
      const nested = path.join(tmpDir, "sub", "dir");
      process.env.NIGHT_WATCH_HOME = nested;
      saveHistory({});
      expect(fs.existsSync(path.join(nested, "history.json"))).toBe(true);
    });
  });

  describe("recordExecution", () => {
    it("should record execution and persist to file", () => {
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
      // Manually write a record with an old timestamp
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
