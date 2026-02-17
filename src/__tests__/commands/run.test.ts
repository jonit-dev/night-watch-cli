/**
 * Tests for the run command
 *
 * These tests focus on testing the exported helper functions directly,
 * which is more reliable than mocking the entire module system.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { Command } from "commander";

// Mock console methods before importing
const mockConsoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
const mockConsoleError = vi.spyOn(console, "error").mockImplementation(() => {});

// Mock process.exit
const mockExit = vi.spyOn(process, "exit").mockImplementation((code) => {
  throw new Error(`process.exit(${code})`);
});

// Mock process.cwd
const mockCwd = vi.spyOn(process, "cwd");

// Import after setting up mocks
import {
  buildEnvVars,
  applyCliOverrides,
  IRunOptions,
  scanPrdDirectory,
} from "../../commands/run.js";
import { INightWatchConfig } from "../../types.js";
import { sendNotifications } from "../../utils/notify.js";

// Helper to create a valid config without budget fields
function createTestConfig(overrides: Partial<INightWatchConfig> = {}): INightWatchConfig {
  return {
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
    prdPriority: [],
    ...overrides,
  };
}

describe("run command", () => {
  let tempDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "night-watch-test-"));
    mockCwd.mockReturnValue(tempDir);

    // Save original environment
    originalEnv = { ...process.env };

    // Clear NW_* environment variables
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("NW_")) {
        delete process.env[key];
      }
    }

    vi.clearAllMocks();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });

    // Restore original environment
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("NW_")) {
        delete process.env[key];
      }
    }
    for (const [key, value] of Object.entries(originalEnv)) {
      if (key.startsWith("NW_")) {
        process.env[key] = value;
      }
    }

    vi.clearAllMocks();
  });

  describe("buildEnvVars", () => {
    it("should pass config as env vars", () => {
      const config = createTestConfig();
      const options: IRunOptions = { dryRun: false };

      const env = buildEnvVars(config, options);

      expect(env.NW_MAX_RUNTIME).toBe("7200");
      expect(env.NW_PROVIDER_CMD).toBe("claude");
      expect(env.NW_PRD_DIR).toBe("docs/PRDs/night-watch");
    });

    it("should set NW_PROVIDER_CMD for codex provider", () => {
      const config = createTestConfig({ provider: "codex", reviewerEnabled: false });
      const options: IRunOptions = { dryRun: false };

      const env = buildEnvVars(config, options);

      expect(env.NW_PROVIDER_CMD).toBe("codex");
    });

    it("should set NW_DRY_RUN when dryRun is true", () => {
      const config = createTestConfig();
      const options: IRunOptions = { dryRun: true };

      const env = buildEnvVars(config, options);

      expect(env.NW_DRY_RUN).toBe("1");
    });

    it("should not set NW_DRY_RUN when dryRun is false", () => {
      const config = createTestConfig();
      const options: IRunOptions = { dryRun: false };

      const env = buildEnvVars(config, options);

      expect(env.NW_DRY_RUN).toBeUndefined();
    });

    it("should not set any ANTHROPIC_* environment variables", () => {
      const config = createTestConfig();
      const options: IRunOptions = { dryRun: false };

      const env = buildEnvVars(config, options);

      // Ensure no ANTHROPIC_* vars are present
      for (const key of Object.keys(env)) {
        expect(key.startsWith("ANTHROPIC_")).toBe(false);
      }
    });

    it("should not set any budget-related environment variables", () => {
      const config = createTestConfig();
      const options: IRunOptions = { dryRun: false };

      const env = buildEnvVars(config, options);

      // Ensure no budget vars are present
      expect(env.NW_MAX_BUDGET).toBeUndefined();
      expect(env.NW_REVIEWER_MAX_BUDGET).toBeUndefined();
    });

    it("should set NW_PRD_PRIORITY when prdPriority is non-empty", () => {
      const config = createTestConfig({ prdPriority: ["phase2", "phase0", "phase1"] });
      const options: IRunOptions = { dryRun: false };

      const env = buildEnvVars(config, options);

      expect(env.NW_PRD_PRIORITY).toBe("phase2:phase0:phase1");
    });

    it("should not set NW_PRD_PRIORITY when prdPriority is empty", () => {
      const config = createTestConfig({ prdPriority: [] });
      const options: IRunOptions = { dryRun: false };

      const env = buildEnvVars(config, options);

      expect(env.NW_PRD_PRIORITY).toBeUndefined();
    });
  });

  describe("applyCliOverrides", () => {
    it("should override timeout with --timeout flag", () => {
      const config = createTestConfig();
      const options: IRunOptions = { dryRun: false, timeout: "1800" };

      const overridden = applyCliOverrides(config, options);

      expect(overridden.maxRuntime).toBe(1800);
    });

    it("should override provider with --provider flag", () => {
      const config = createTestConfig();
      const options: IRunOptions = { dryRun: false, provider: "codex" };

      const overridden = applyCliOverrides(config, options);

      expect(overridden.provider).toBe("codex");
    });
  });

  describe("notification integration", () => {
    it("sendNotifications should be importable", () => {
      expect(typeof sendNotifications).toBe("function");
    });
  });

  describe("scanPrdDirectory", () => {
    it("should detect claimed PRDs", () => {
      // Create PRD directory
      const prdDir = "docs/PRDs/night-watch";
      const absolutePrdDir = path.join(tempDir, prdDir);
      fs.mkdirSync(absolutePrdDir, { recursive: true });

      // Create a PRD file
      fs.writeFileSync(path.join(absolutePrdDir, "01-feature.md"), "# Feature");

      // Create an active claim
      fs.writeFileSync(
        path.join(absolutePrdDir, "01-feature.md.claim"),
        JSON.stringify({ timestamp: Math.floor(Date.now() / 1000), hostname: "test-host", pid: 9999 })
      );

      const result = scanPrdDirectory(tempDir, prdDir, 7200);

      expect(result.pending).toHaveLength(1);
      expect(result.pending[0].name).toBe("01-feature.md");
      expect(result.pending[0].claimed).toBe(true);
      expect(result.pending[0].claimInfo).toEqual({
        hostname: "test-host",
        pid: 9999,
        timestamp: expect.any(Number),
      });
    });

    it("should treat stale claims as unclaimed", () => {
      const prdDir = "docs/PRDs/night-watch";
      const absolutePrdDir = path.join(tempDir, prdDir);
      fs.mkdirSync(absolutePrdDir, { recursive: true });

      fs.writeFileSync(path.join(absolutePrdDir, "01-feature.md"), "# Feature");

      // Create a stale claim (old timestamp)
      fs.writeFileSync(
        path.join(absolutePrdDir, "01-feature.md.claim"),
        JSON.stringify({ timestamp: 1000000000, hostname: "old-host", pid: 1111 })
      );

      const result = scanPrdDirectory(tempDir, prdDir, 7200);

      expect(result.pending).toHaveLength(1);
      expect(result.pending[0].name).toBe("01-feature.md");
      expect(result.pending[0].claimed).toBe(false);
      expect(result.pending[0].claimInfo).toBeNull();
    });
  });
});
