/**
 * Tests for the review command
 *
 * These tests focus on testing the exported helper functions directly,
 * which is more reliable than mocking the entire module system.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

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
  ReviewOptions,
} from "../../commands/review.js";
import { INightWatchConfig } from "../../types.js";

describe("review command", () => {
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
    it("should use reviewer-specific env vars", () => {
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
      const options: ReviewOptions = { dryRun: false };

      const env = buildEnvVars(config, options);

      // Should use NW_REVIEWER_* env vars
      expect(env.NW_REVIEWER_MAX_BUDGET).toBe("3");
      expect(env.NW_REVIEWER_MAX_RUNTIME).toBe("3600");

      // Should NOT set NW_MAX_BUDGET or NW_MAX_RUNTIME
      expect(env.NW_MAX_BUDGET).toBeUndefined();
      expect(env.NW_MAX_RUNTIME).toBeUndefined();
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
          apiKey: "review-api-key",
          baseUrl: "https://review.api.url",
          timeout: 45000,
        },
      };
      const options: ReviewOptions = { dryRun: false };

      const env = buildEnvVars(config, options);

      expect(env.ANTHROPIC_AUTH_TOKEN).toBe("review-api-key");
      expect(env.ANTHROPIC_BASE_URL).toBe("https://review.api.url");
      expect(env.API_TIMEOUT_MS).toBe("45000");
    });

    it("should respect --model flag for reviewer", () => {
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
      const options: ReviewOptions = { dryRun: false, model: "claude-3-sonnet" };

      const env = buildEnvVars(config, options);

      // Both opus and sonnet model should be set
      expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe("claude-3-sonnet");
      expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe("claude-3-sonnet");
    });
  });

  describe("applyCliOverrides", () => {
    it("should override reviewer budget with --budget flag", () => {
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
      const options: ReviewOptions = { dryRun: false, budget: "10.00" };

      const overridden = applyCliOverrides(config, options);

      // Should override reviewer budget
      expect(overridden.reviewerMaxBudget).toBe(10);
    });

    it("should override reviewer timeout with --timeout flag", () => {
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
      const options: ReviewOptions = { dryRun: false, timeout: "2700" };

      const overridden = applyCliOverrides(config, options);

      // Should override reviewer timeout
      expect(overridden.reviewerMaxRuntime).toBe(2700);
    });
  });
});
