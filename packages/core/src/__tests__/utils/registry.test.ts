/**
 * Tests for project registry
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

import {
  loadRegistry,
  saveRegistry,
  registerProject,
  unregisterProject,
  validateRegistry,
  closeDb,
  resetRepositories,
} from "../../utils/registry.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nw-registry-test-"));
  process.env.NIGHT_WATCH_HOME = tmpDir;
});

afterEach(() => {
  closeDb();
  resetRepositories();
  delete process.env.NIGHT_WATCH_HOME;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("registry", () => {
  describe("loadRegistry", () => {
    it("should return empty array when no projects registered", () => {
      expect(loadRegistry()).toEqual([]);
    });
  });

  describe("registerProject", () => {
    it("should register a new project and return the entry", () => {
      const entry = registerProject(tmpDir);
      expect(entry.path).toBe(tmpDir);
      expect(typeof entry.name).toBe("string");
      expect(entry.name.length).toBeGreaterThan(0);
    });

    it("should be a no-op if the project is already registered", () => {
      const first = registerProject(tmpDir);
      const second = registerProject(tmpDir);
      expect(second.path).toBe(first.path);
      expect(second.name).toBe(first.name);
      expect(loadRegistry()).toHaveLength(1);
    });

    it("should handle name collision by appending directory basename", () => {
      // Create two directories that resolve to the same project name
      const dir1 = path.join(tmpDir, "project-a");
      const dir2 = path.join(tmpDir, "project-b");
      fs.mkdirSync(dir1);
      fs.mkdirSync(dir2);

      // Write same package.json name in both so they collide
      fs.writeFileSync(path.join(dir1, "package.json"), JSON.stringify({ name: "shared-name" }));
      fs.writeFileSync(path.join(dir2, "package.json"), JSON.stringify({ name: "shared-name" }));

      registerProject(dir1);
      registerProject(dir2);

      const entries = loadRegistry();
      expect(entries).toHaveLength(2);
      const names = entries.map((e) => e.name);
      expect(new Set(names).size).toBe(2);
    });
  });

  describe("unregisterProject", () => {
    it("should remove a registered project and return true", () => {
      registerProject(tmpDir);
      expect(loadRegistry()).toHaveLength(1);

      const removed = unregisterProject(tmpDir);
      expect(removed).toBe(true);
      expect(loadRegistry()).toHaveLength(0);
    });

    it("should return false when project is not registered", () => {
      const removed = unregisterProject("/nonexistent/path");
      expect(removed).toBe(false);
    });
  });

  describe("saveRegistry", () => {
    it("should replace all entries with the provided set", () => {
      registerProject(tmpDir);
      expect(loadRegistry()).toHaveLength(1);

      saveRegistry([
        { name: "project-one", path: "/path/one" },
        { name: "project-two", path: "/path/two" },
      ]);

      const entries = loadRegistry();
      expect(entries).toHaveLength(2);
      expect(entries.map((e) => e.name).sort()).toEqual(["project-one", "project-two"]);
    });

    it("should clear all entries when called with empty array", () => {
      registerProject(tmpDir);
      saveRegistry([]);
      expect(loadRegistry()).toHaveLength(0);
    });
  });

  describe("validateRegistry", () => {
    it("should classify real paths with config as valid", () => {
      fs.writeFileSync(path.join(tmpDir, "night-watch.config.json"), "{}");
      registerProject(tmpDir);

      const { valid, invalid } = validateRegistry();
      expect(valid).toHaveLength(1);
      expect(invalid).toHaveLength(0);
    });

    it("should classify missing paths as invalid", () => {
      saveRegistry([{ name: "gone", path: "/nonexistent/path/abc123" }]);

      const { valid, invalid } = validateRegistry();
      expect(valid).toHaveLength(0);
      expect(invalid).toHaveLength(1);
    });
  });
});
