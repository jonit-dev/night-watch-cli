/**
 * Tests for checks utilities
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  checkGitRepo,
  checkNodeVersion,
  checkConfigFile,
  checkPrdDirectory,
  checkLogsDirectory,
  detectProviders,
} from "../../utils/checks.js";

// Mock child_process execSync
vi.mock("child_process", () => ({
  execSync: vi.fn(),
}));

import { execSync } from "child_process";

describe("checks utilities", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "checks-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  describe("checkGitRepo()", () => {
    it("should pass in git repo", () => {
      // Create .git directory
      fs.mkdirSync(path.join(tempDir, ".git"));

      const result = checkGitRepo(tempDir);

      expect(result.passed).toBe(true);
      expect(result.message).toContain("Git repository");
      expect(result.fixable).toBe(false);
    });

    it("should fail outside git repo", () => {
      const result = checkGitRepo(tempDir);

      expect(result.passed).toBe(false);
      expect(result.message).toContain("Not a git repository");
      expect(result.fixable).toBe(false);
    });
  });

  describe("checkNodeVersion()", () => {
    it("should pass for current node version", () => {
      const currentMajor = parseInt(process.version.replace(/^v/, "").split(".")[0], 10);
      const result = checkNodeVersion(currentMajor);

      expect(result.passed).toBe(true);
      expect(result.message).toContain(process.version);
    });

    it("should fail for unreasonably high minimum version", () => {
      const result = checkNodeVersion(999);

      expect(result.passed).toBe(false);
      expect(result.message).toContain("too old");
    });

    it("should pass when node version meets minimum", () => {
      const result = checkNodeVersion(18);

      // Current node is always >= 18 (our minimum)
      expect(result.passed).toBe(true);
      expect(result.message).toContain("Node.js version");
    });
  });

  describe("checkConfigFile()", () => {
    it("should pass for valid config file", () => {
      // Create valid config file
      fs.writeFileSync(
        path.join(tempDir, "night-watch.config.json"),
        JSON.stringify({ provider: "claude" })
      );

      const result = checkConfigFile(tempDir);

      expect(result.passed).toBe(true);
      expect(result.message).toContain("valid");
    });

    it("should fail for missing config file", () => {
      const result = checkConfigFile(tempDir);

      expect(result.passed).toBe(false);
      expect(result.message).toContain("not found");
    });

    it("should fail for invalid JSON", () => {
      // Create invalid JSON file
      fs.writeFileSync(
        path.join(tempDir, "night-watch.config.json"),
        "{ invalid json }"
      );

      const result = checkConfigFile(tempDir);

      expect(result.passed).toBe(false);
      expect(result.message).toContain("invalid JSON");
    });
  });

  describe("checkPrdDirectory()", () => {
    it("should pass when PRD directory exists", () => {
      const prdDir = "docs/PRDs/night-watch";
      const fullPrdPath = path.join(tempDir, prdDir);
      fs.mkdirSync(fullPrdPath, { recursive: true });

      const result = checkPrdDirectory(tempDir, prdDir);

      expect(result.passed).toBe(true);
      expect(result.message).toContain("PRD directory");
    });

    it("should count PRD files", () => {
      const prdDir = "docs/PRDs/night-watch";
      const fullPrdPath = path.join(tempDir, prdDir);
      fs.mkdirSync(fullPrdPath, { recursive: true });
      fs.writeFileSync(path.join(fullPrdPath, "test-prd.md"), "# Test PRD");
      fs.writeFileSync(path.join(fullPrdPath, "another.md"), "# Another");

      const result = checkPrdDirectory(tempDir, prdDir);

      expect(result.passed).toBe(true);
      expect(result.message).toContain("2 PRDs");
    });

    it("should fail when PRD directory is missing", () => {
      const result = checkPrdDirectory(tempDir, "docs/PRDs/night-watch");

      expect(result.passed).toBe(false);
      expect(result.fixable).toBe(true);
      expect(result.fix).toBeDefined();
    });

    it("should create PRD directory when fix is called", () => {
      const prdDir = "docs/PRDs/night-watch";
      const result = checkPrdDirectory(tempDir, prdDir);

      expect(result.passed).toBe(false);
      expect(result.fix).toBeDefined();

      // Call fix
      result.fix!();

      // Verify directory was created
      expect(fs.existsSync(path.join(tempDir, prdDir))).toBe(true);
      expect(fs.existsSync(path.join(tempDir, prdDir, "done"))).toBe(true);
    });

    it("should exclude NIGHT-WATCH-SUMMARY.md from count", () => {
      const prdDir = "docs/PRDs/night-watch";
      const fullPrdPath = path.join(tempDir, prdDir);
      fs.mkdirSync(fullPrdPath, { recursive: true });
      fs.writeFileSync(path.join(fullPrdPath, "test-prd.md"), "# Test PRD");
      fs.writeFileSync(path.join(fullPrdPath, "NIGHT-WATCH-SUMMARY.md"), "# Summary");

      const result = checkPrdDirectory(tempDir, prdDir);

      expect(result.passed).toBe(true);
      expect(result.message).toContain("1 PRD"); // Should only count test-prd.md
    });
  });

  describe("checkLogsDirectory()", () => {
    it("should pass when logs directory exists", () => {
      fs.mkdirSync(path.join(tempDir, "logs"));

      const result = checkLogsDirectory(tempDir);

      expect(result.passed).toBe(true);
      expect(result.message).toContain("Logs directory");
    });

    it("should fail and be fixable when logs directory is missing", () => {
      const result = checkLogsDirectory(tempDir);

      expect(result.passed).toBe(false);
      expect(result.fixable).toBe(true);
      expect(result.fix).toBeDefined();
    });

    it("should create logs directory when fix is called", () => {
      const result = checkLogsDirectory(tempDir);

      expect(result.fix).toBeDefined();
      result.fix!();

      expect(fs.existsSync(path.join(tempDir, "logs"))).toBe(true);
    });
  });

  describe("detectProviders()", () => {
    it("should return empty array when no providers available", () => {
      (execSync as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error("not found");
      });

      const providers = detectProviders();

      expect(providers).toEqual([]);
    });

    it("should return claude when claude CLI is available", () => {
      (execSync as ReturnType<typeof vi.fn>).mockImplementation((cmd: string) => {
        if (cmd.includes("claude")) {
          return "/usr/bin/claude";
        }
        throw new Error("not found");
      });

      const providers = detectProviders();

      expect(providers).toContain("claude");
      expect(providers).not.toContain("codex");
    });

    it("should return both providers when both CLIs are available", () => {
      (execSync as ReturnType<typeof vi.fn>).mockImplementation(() => {
        return "/usr/bin/provider";
      });

      const providers = detectProviders();

      expect(providers).toContain("claude");
      expect(providers).toContain("codex");
    });
  });
});
