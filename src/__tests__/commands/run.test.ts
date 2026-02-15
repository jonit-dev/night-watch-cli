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

describe("run command", () => {
  let tempDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "night-watch-test-"));
    mockCwd.mockReturnValue(tempDir);

    // Save original environment
    originalEnv = { ...process.env };

    // Clear NW_* and ANTHROPIC_* environment variables
    for (const key of Object.keys(process.env)) {
      if (
        key.startsWith("NW_") ||
        key.startsWith("ANTHROPIC_") ||
        key === "API_TIMEOUT_MS"
      ) {
        delete process.env[key];
      }
    }

    vi.clearAllMocks();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });

    // Restore original environment
    for (const key of Object.keys(process.env)) {
      if (
        key.startsWith("NW_") ||
        key.startsWith("ANTHROPIC_") ||
        key === "API_TIMEOUT_MS"
      ) {
        delete process.env[key];
      }
    }
    for (const [key, value] of Object.entries(originalEnv)) {
      if (
        key.startsWith("NW_") ||
        key.startsWith("ANTHROPIC_") ||
        key === "API_TIMEOUT_MS"
      ) {
        process.env[key] = value;
      }
    }

    vi.clearAllMocks();
  });

  describe("buildEnvVars", () => {
    it("should pass config as env vars", () => {
      const config: INightWatchConfig = {
        prdDir: "docs/PRDs/night-watch",
        maxBudget: 5.0,
        reviewerMaxBudget: 3.0,
        maxRuntime: 7200,
        reviewerMaxRuntime: 3600,
        branchPrefix: "night-watch",
        branchPatterns: ["feat/", "night-watch/"],
        minReviewScore: 80,
        maxLogSize: 524288,
        cronSchedule: "0 0-15 * * *",
        reviewerSchedule: "0 0,3,6,9,12,15 * * *",
        claude: {},
      };
      const options: RunOptions = { dryRun: false };

      const env = buildEnvVars(config, options);

      expect(env.NW_MAX_BUDGET).toBe("5");
      expect(env.NW_MAX_RUNTIME).toBe("7200");
    });

    it("should inject claude provider env vars", () => {
      const config: INightWatchConfig = {
        prdDir: "docs/PRDs/night-watch",
        maxBudget: 5.0,
        reviewerMaxBudget: 3.0,
        maxRuntime: 7200,
        reviewerMaxRuntime: 3600,
        branchPrefix: "night-watch",
        branchPatterns: ["feat/", "night-watch/"],
        minReviewScore: 80,
        maxLogSize: 524288,
        cronSchedule: "0 0-15 * * *",
        reviewerSchedule: "0 0,3,6,9,12,15 * * *",
        claude: {
          apiKey: "test-api-key-12345",
          baseUrl: "https://custom.api.url",
          timeout: 60000,
        },
      };
      const options: RunOptions = { dryRun: false };

      const env = buildEnvVars(config, options);

      expect(env.ANTHROPIC_AUTH_TOKEN).toBe("test-api-key-12345");
      expect(env.ANTHROPIC_BASE_URL).toBe("https://custom.api.url");
      expect(env.API_TIMEOUT_MS).toBe("60000");
    });

    it("should respect --model flag", () => {
      const config: INightWatchConfig = {
        prdDir: "docs/PRDs/night-watch",
        maxBudget: 5.0,
        reviewerMaxBudget: 3.0,
        maxRuntime: 7200,
        reviewerMaxRuntime: 3600,
        branchPrefix: "night-watch",
        branchPatterns: ["feat/", "night-watch/"],
        minReviewScore: 80,
        maxLogSize: 524288,
        cronSchedule: "0 0-15 * * *",
        reviewerSchedule: "0 0,3,6,9,12,15 * * *",
        claude: {},
      };
      const options: RunOptions = { dryRun: false, model: "claude-3-opus-20240229" };

      const env = buildEnvVars(config, options);

      // Both opus and sonnet model should be set
      expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe("claude-3-opus-20240229");
      expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe("claude-3-opus-20240229");
    });

    it("should use config model when --model flag not provided", () => {
      const config: INightWatchConfig = {
        prdDir: "docs/PRDs/night-watch",
        maxBudget: 5.0,
        reviewerMaxBudget: 3.0,
        maxRuntime: 7200,
        reviewerMaxRuntime: 3600,
        branchPrefix: "night-watch",
        branchPatterns: ["feat/", "night-watch/"],
        minReviewScore: 80,
        maxLogSize: 524288,
        cronSchedule: "0 0-15 * * *",
        reviewerSchedule: "0 0,3,6,9,12,15 * * *",
        claude: {
          opusModel: "config-opus-model",
          sonnetModel: "config-sonnet-model",
        },
      };
      const options: RunOptions = { dryRun: false };

      const env = buildEnvVars(config, options);

      expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe("config-opus-model");
      expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe("config-sonnet-model");
    });
  });

  describe("applyCliOverrides", () => {
    it("should override budget with --budget flag", () => {
      const config: INightWatchConfig = {
        prdDir: "docs/PRDs/night-watch",
        maxBudget: 5.0,
        reviewerMaxBudget: 3.0,
        maxRuntime: 7200,
        reviewerMaxRuntime: 3600,
        branchPrefix: "night-watch",
        branchPatterns: ["feat/", "night-watch/"],
        minReviewScore: 80,
        maxLogSize: 524288,
        cronSchedule: "0 0-15 * * *",
        reviewerSchedule: "0 0,3,6,9,12,15 * * *",
        claude: {},
      };
      const options: RunOptions = { dryRun: false, budget: "15.75" };

      const overridden = applyCliOverrides(config, options);

      expect(overridden.maxBudget).toBe(15.75);
    });

    it("should override timeout with --timeout flag", () => {
      const config: INightWatchConfig = {
        prdDir: "docs/PRDs/night-watch",
        maxBudget: 5.0,
        reviewerMaxBudget: 3.0,
        maxRuntime: 7200,
        reviewerMaxRuntime: 3600,
        branchPrefix: "night-watch",
        branchPatterns: ["feat/", "night-watch/"],
        minReviewScore: 80,
        maxLogSize: 524288,
        cronSchedule: "0 0-15 * * *",
        reviewerSchedule: "0 0,3,6,9,12,15 * * *",
        claude: {},
      };
      const options: RunOptions = { dryRun: false, timeout: "1800" };

      const overridden = applyCliOverrides(config, options);

      expect(overridden.maxRuntime).toBe(1800);
    });

    it("should override API key with --api-key flag", () => {
      const config: INightWatchConfig = {
        prdDir: "docs/PRDs/night-watch",
        maxBudget: 5.0,
        reviewerMaxBudget: 3.0,
        maxRuntime: 7200,
        reviewerMaxRuntime: 3600,
        branchPrefix: "night-watch",
        branchPatterns: ["feat/", "night-watch/"],
        minReviewScore: 80,
        maxLogSize: 524288,
        cronSchedule: "0 0-15 * * *",
        reviewerSchedule: "0 0,3,6,9,12,15 * * *",
        claude: {},
      };
      const options: RunOptions = { dryRun: false, apiKey: "cli-api-key" };

      const overridden = applyCliOverrides(config, options);

      expect(overridden.claude.apiKey).toBe("cli-api-key");
    });

    it("should override API URL with --api-url flag", () => {
      const config: INightWatchConfig = {
        prdDir: "docs/PRDs/night-watch",
        maxBudget: 5.0,
        reviewerMaxBudget: 3.0,
        maxRuntime: 7200,
        reviewerMaxRuntime: 3600,
        branchPrefix: "night-watch",
        branchPatterns: ["feat/", "night-watch/"],
        minReviewScore: 80,
        maxLogSize: 524288,
        cronSchedule: "0 0-15 * * *",
        reviewerSchedule: "0 0,3,6,9,12,15 * * *",
        claude: {},
      };
      const options: RunOptions = { dryRun: false, apiUrl: "https://cli.api.url" };

      const overridden = applyCliOverrides(config, options);

      expect(overridden.claude.baseUrl).toBe("https://cli.api.url");
    });
  });
});
