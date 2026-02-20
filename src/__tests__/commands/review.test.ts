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
  IReviewOptions,
  parseAutoMergedPrNumbers,
  shouldSendReviewNotification,
} from "../../commands/review.js";
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
    autoMerge: false,
    autoMergeMethod: "squash",
    ...overrides,
  };
}

describe("review command", () => {
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
    it("should use reviewer-specific env vars", () => {
      const config = createTestConfig();
      const options: IReviewOptions = { dryRun: false };

      const env = buildEnvVars(config, options);

      // Should use NW_REVIEWER_* env vars
      expect(env.NW_REVIEWER_MAX_RUNTIME).toBe("3600");
      expect(env.NW_MIN_REVIEW_SCORE).toBe("80");
      expect(env.NW_BRANCH_PATTERNS).toBe("feat/,night-watch/");

      // Should NOT set NW_MAX_RUNTIME
      expect(env.NW_MAX_RUNTIME).toBeUndefined();
    });

    it("should set NW_PROVIDER_CMD for claude provider", () => {
      const config = createTestConfig();
      const options: IReviewOptions = { dryRun: false };

      const env = buildEnvVars(config, options);

      expect(env.NW_PROVIDER_CMD).toBe("claude");
    });

    it("should set NW_PROVIDER_CMD for codex provider", () => {
      const config = createTestConfig({ provider: "codex" });
      const options: IReviewOptions = { dryRun: false };

      const env = buildEnvVars(config, options);

      expect(env.NW_PROVIDER_CMD).toBe("codex");
    });

    it("should pass NW_DEFAULT_BRANCH when configured", () => {
      const config = createTestConfig({ defaultBranch: "main" });
      const options: IReviewOptions = { dryRun: false };

      const env = buildEnvVars(config, options);

      expect(env.NW_DEFAULT_BRANCH).toBe("main");
    });

    it("should set NW_DRY_RUN when dryRun is true", () => {
      const config = createTestConfig();
      const options: IReviewOptions = { dryRun: true };

      const env = buildEnvVars(config, options);

      expect(env.NW_DRY_RUN).toBe("1");
    });

    it("should not set NW_DRY_RUN when dryRun is false", () => {
      const config = createTestConfig();
      const options: IReviewOptions = { dryRun: false };

      const env = buildEnvVars(config, options);

      expect(env.NW_DRY_RUN).toBeUndefined();
    });

    it("should not set any ANTHROPIC_* environment variables", () => {
      const config = createTestConfig();
      const options: IReviewOptions = { dryRun: false };

      const env = buildEnvVars(config, options);

      // Ensure no ANTHROPIC_* vars are present
      for (const key of Object.keys(env)) {
        expect(key.startsWith("ANTHROPIC_")).toBe(false);
      }
    });

    it("should not set any budget-related environment variables", () => {
      const config = createTestConfig();
      const options: IReviewOptions = { dryRun: false };

      const env = buildEnvVars(config, options);

      // Ensure no budget vars are present
      expect(env.NW_MAX_BUDGET).toBeUndefined();
      expect(env.NW_REVIEWER_MAX_BUDGET).toBeUndefined();
    });

    it("should pass NW_AUTO_MERGE when enabled", () => {
      const config = createTestConfig({ autoMerge: true });
      const options: IReviewOptions = { dryRun: false };

      const env = buildEnvVars(config, options);

      expect(env.NW_AUTO_MERGE).toBe("1");
    });

    it("should not pass NW_AUTO_MERGE when disabled", () => {
      const config = createTestConfig({ autoMerge: false });
      const options: IReviewOptions = { dryRun: false };

      const env = buildEnvVars(config, options);

      expect(env.NW_AUTO_MERGE).toBeUndefined();
    });

    it("should pass NW_AUTO_MERGE_METHOD", () => {
      const config = createTestConfig({ autoMergeMethod: "rebase" });
      const options: IReviewOptions = { dryRun: false };

      const env = buildEnvVars(config, options);

      expect(env.NW_AUTO_MERGE_METHOD).toBe("rebase");
    });

    it("should default NW_AUTO_MERGE_METHOD to squash", () => {
      const config = createTestConfig();
      const options: IReviewOptions = { dryRun: false };

      const env = buildEnvVars(config, options);

      expect(env.NW_AUTO_MERGE_METHOD).toBe("squash");
    });
  });

  describe("applyCliOverrides", () => {
    it("should override reviewer timeout with --timeout flag", () => {
      const config = createTestConfig();
      const options: IReviewOptions = { dryRun: false, timeout: "2700" };

      const overridden = applyCliOverrides(config, options);

      // Should override reviewer timeout
      expect(overridden.reviewerMaxRuntime).toBe(2700);
    });

    it("should override provider with --provider flag", () => {
      const config = createTestConfig();
      const options: IReviewOptions = { dryRun: false, provider: "codex" };

      const overridden = applyCliOverrides(config, options);

      expect(overridden.provider).toBe("codex");
    });

    it("should override autoMerge with --auto-merge flag", () => {
      const config = createTestConfig({ autoMerge: false });
      const options: IReviewOptions = { dryRun: false, autoMerge: true };

      const overridden = applyCliOverrides(config, options);

      expect(overridden.autoMerge).toBe(true);
    });

    it("should not override autoMerge when flag is undefined", () => {
      const config = createTestConfig({ autoMerge: true });
      const options: IReviewOptions = { dryRun: false };

      const overridden = applyCliOverrides(config, options);

      expect(overridden.autoMerge).toBe(true);
    });

    it("should allow --auto-merge flag to disable autoMerge", () => {
      const config = createTestConfig({ autoMerge: true });
      const options: IReviewOptions = { dryRun: false, autoMerge: false };

      const overridden = applyCliOverrides(config, options);

      expect(overridden.autoMerge).toBe(false);
    });
  });

  describe("notification integration", () => {
    it("sendNotifications should be importable", () => {
      expect(typeof sendNotifications).toBe("function");
    });
  });

  describe("shouldSendReviewNotification", () => {
    it("should send notifications when status is absent (legacy behavior)", () => {
      expect(shouldSendReviewNotification(undefined)).toBe(true);
    });

    it("should suppress notifications for skip statuses", () => {
      expect(shouldSendReviewNotification("skip_no_open_prs")).toBe(false);
      expect(shouldSendReviewNotification("skip_all_passing")).toBe(false);
    });

    it("should send notifications for actionable outcomes", () => {
      expect(shouldSendReviewNotification("success_reviewed")).toBe(true);
      expect(shouldSendReviewNotification("failure")).toBe(true);
      expect(shouldSendReviewNotification("timeout")).toBe(true);
    });
  });

  describe("parseAutoMergedPrNumbers", () => {
    it("parses comma-separated #PR tokens", () => {
      expect(parseAutoMergedPrNumbers("#12,#34,#56")).toEqual([12, 34, 56]);
    });

    it("ignores invalid tokens and empty values", () => {
      expect(parseAutoMergedPrNumbers("#12,,abc,#x,#34")).toEqual([12, 34]);
    });

    it("returns empty array when value is missing", () => {
      expect(parseAutoMergedPrNumbers(undefined)).toEqual([]);
      expect(parseAutoMergedPrNumbers("")).toEqual([]);
    });
  });
});
