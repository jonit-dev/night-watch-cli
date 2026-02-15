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
  RunOptions,
} from "../../commands/run.js";
import { INightWatchConfig } from "../../types.js";

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
    cronSchedule: "0 0-15 * * *",
    reviewerSchedule: "0 0,3,6,9,12,15 * * *",
    provider: "claude",
    reviewerEnabled: true,
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
      const options: RunOptions = { dryRun: false };

      const env = buildEnvVars(config, options);

      expect(env.NW_MAX_RUNTIME).toBe("7200");
      expect(env.NW_PROVIDER_CMD).toBe("claude");
    });

    it("should set NW_PROVIDER_CMD for codex provider", () => {
      const config = createTestConfig({ provider: "codex", reviewerEnabled: false });
      const options: RunOptions = { dryRun: false };

      const env = buildEnvVars(config, options);

      expect(env.NW_PROVIDER_CMD).toBe("codex");
    });

    it("should set NW_DRY_RUN when dryRun is true", () => {
      const config = createTestConfig();
      const options: RunOptions = { dryRun: true };

      const env = buildEnvVars(config, options);

      expect(env.NW_DRY_RUN).toBe("1");
    });

    it("should not set NW_DRY_RUN when dryRun is false", () => {
      const config = createTestConfig();
      const options: RunOptions = { dryRun: false };

      const env = buildEnvVars(config, options);

      expect(env.NW_DRY_RUN).toBeUndefined();
    });

    it("should not set any ANTHROPIC_* environment variables", () => {
      const config = createTestConfig();
      const options: RunOptions = { dryRun: false };

      const env = buildEnvVars(config, options);

      // Ensure no ANTHROPIC_* vars are present
      for (const key of Object.keys(env)) {
        expect(key.startsWith("ANTHROPIC_")).toBe(false);
      }
    });

    it("should not set any budget-related environment variables", () => {
      const config = createTestConfig();
      const options: RunOptions = { dryRun: false };

      const env = buildEnvVars(config, options);

      // Ensure no budget vars are present
      expect(env.NW_MAX_BUDGET).toBeUndefined();
      expect(env.NW_REVIEWER_MAX_BUDGET).toBeUndefined();
    });
  });

  describe("applyCliOverrides", () => {
    it("should override timeout with --timeout flag", () => {
      const config = createTestConfig();
      const options: RunOptions = { dryRun: false, timeout: "1800" };

      const overridden = applyCliOverrides(config, options);

      expect(overridden.maxRuntime).toBe(1800);
    });

    it("should override provider with --provider flag", () => {
      const config = createTestConfig();
      const options: RunOptions = { dryRun: false, provider: "codex" };

      const overridden = applyCliOverrides(config, options);

      expect(overridden.provider).toBe("codex");
    });
  });
});
