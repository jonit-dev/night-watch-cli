/**
 * Tests for the QA command
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
  IQaOptions,
  parseQaPrNumbers,
  shouldSendQaNotification,
} from "@/cli/commands/qa.js";
import { INightWatchConfig } from "@night-watch/core/types.js";
import { sendNotifications } from "@night-watch/core/utils/notify.js";

// Helper to create a valid config with qa field
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
    qa: {
      enabled: true,
      schedule: "30 1,7,13,19 * * *",
      maxRuntime: 3600,
      branchPatterns: [],
      artifacts: "both",
      skipLabel: "skip-qa",
      autoInstallPlaywright: true,
    },
    ...overrides,
  } as INightWatchConfig;
}

describe("qa command", () => {
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
    it("should set NW_QA_MAX_RUNTIME from config", () => {
      const config = createTestConfig();
      const options: IQaOptions = { dryRun: false };

      const env = buildEnvVars(config, options);

      expect(env.NW_QA_MAX_RUNTIME).toBe("3600");
    });

    it("should use top-level branchPatterns when qa.branchPatterns is empty", () => {
      const config = createTestConfig({
        branchPatterns: ["feat/", "night-watch/"],
        qa: {
          enabled: true,
          schedule: "30 1,7,13,19 * * *",
          maxRuntime: 3600,
          branchPatterns: [],
          artifacts: "both",
          skipLabel: "skip-qa",
          autoInstallPlaywright: true,
        },
      });
      const options: IQaOptions = { dryRun: false };

      const env = buildEnvVars(config, options);

      expect(env.NW_BRANCH_PATTERNS).toBe("feat/,night-watch/");
    });

    it("should use qa.branchPatterns when non-empty", () => {
      const config = createTestConfig({
        branchPatterns: ["feat/", "night-watch/"],
        qa: {
          enabled: true,
          schedule: "30 1,7,13,19 * * *",
          maxRuntime: 3600,
          branchPatterns: ["qa/", "test/"],
          artifacts: "both",
          skipLabel: "skip-qa",
          autoInstallPlaywright: true,
        },
      });
      const options: IQaOptions = { dryRun: false };

      const env = buildEnvVars(config, options);

      expect(env.NW_BRANCH_PATTERNS).toBe("qa/,test/");
    });

    it("should set NW_QA_ARTIFACTS from config", () => {
      const config = createTestConfig();
      const options: IQaOptions = { dryRun: false };

      const env = buildEnvVars(config, options);

      expect(env.NW_QA_ARTIFACTS).toBe("both");
    });

    it("should set NW_QA_SKIP_LABEL from config", () => {
      const config = createTestConfig();
      const options: IQaOptions = { dryRun: false };

      const env = buildEnvVars(config, options);

      expect(env.NW_QA_SKIP_LABEL).toBe("skip-qa");
    });

    it("should set NW_QA_AUTO_INSTALL_PLAYWRIGHT to 1 when true", () => {
      const config = createTestConfig();
      const options: IQaOptions = { dryRun: false };

      const env = buildEnvVars(config, options);

      expect(env.NW_QA_AUTO_INSTALL_PLAYWRIGHT).toBe("1");
    });

    it("should set NW_QA_AUTO_INSTALL_PLAYWRIGHT to 0 when false", () => {
      const config = createTestConfig({
        qa: {
          enabled: true,
          schedule: "30 1,7,13,19 * * *",
          maxRuntime: 3600,
          branchPatterns: [],
          artifacts: "both",
          skipLabel: "skip-qa",
          autoInstallPlaywright: false,
        },
      });
      const options: IQaOptions = { dryRun: false };

      const env = buildEnvVars(config, options);

      expect(env.NW_QA_AUTO_INSTALL_PLAYWRIGHT).toBe("0");
    });

    it("should set NW_PROVIDER_CMD for claude provider", () => {
      const config = createTestConfig({ provider: "claude" });
      const options: IQaOptions = { dryRun: false };

      const env = buildEnvVars(config, options);

      expect(env.NW_PROVIDER_CMD).toBe("claude");
    });

    it("should set NW_PROVIDER_CMD for codex provider", () => {
      const config = createTestConfig({ provider: "codex" });
      const options: IQaOptions = { dryRun: false };

      const env = buildEnvVars(config, options);

      expect(env.NW_PROVIDER_CMD).toBe("codex");
    });

    it("should set NW_DRY_RUN when dryRun is true", () => {
      const config = createTestConfig();
      const options: IQaOptions = { dryRun: true };

      const env = buildEnvVars(config, options);

      expect(env.NW_DRY_RUN).toBe("1");
    });

    it("should not set NW_DRY_RUN when dryRun is false", () => {
      const config = createTestConfig();
      const options: IQaOptions = { dryRun: false };

      const env = buildEnvVars(config, options);

      expect(env.NW_DRY_RUN).toBeUndefined();
    });

    it("should set NW_EXECUTION_CONTEXT to agent", () => {
      const config = createTestConfig();
      const options: IQaOptions = { dryRun: false };

      const env = buildEnvVars(config, options);

      expect(env.NW_EXECUTION_CONTEXT).toBe("agent");
    });
  });

  describe("applyCliOverrides", () => {
    it("should override qa.maxRuntime with --timeout", () => {
      const config = createTestConfig();
      const options: IQaOptions = { dryRun: false, timeout: "1800" };

      const overridden = applyCliOverrides(config, options);

      expect(overridden.qa.maxRuntime).toBe(1800);
    });

    it("should override provider with --provider", () => {
      const config = createTestConfig();
      const options: IQaOptions = { dryRun: false, provider: "codex" };

      const overridden = applyCliOverrides(config, options);

      expect(overridden.provider).toBe("codex");
    });

    it("should not mutate original config", () => {
      const config = createTestConfig();
      const options: IQaOptions = { dryRun: false, timeout: "1800" };

      applyCliOverrides(config, options);

      expect(config.qa.maxRuntime).toBe(3600);
    });
  });

  describe("shouldSendQaNotification", () => {
    it("should send notifications when status is absent (legacy behavior)", () => {
      expect(shouldSendQaNotification(undefined)).toBe(true);
    });

    it("should suppress notifications for skip statuses", () => {
      expect(shouldSendQaNotification("skip_no_open_prs")).toBe(false);
      expect(shouldSendQaNotification("skip_all_passing")).toBe(false);
    });

    it("should send notifications for actionable outcomes", () => {
      expect(shouldSendQaNotification("success_tested")).toBe(true);
      expect(shouldSendQaNotification("failure")).toBe(true);
      expect(shouldSendQaNotification("timeout")).toBe(true);
    });
  });

  describe("parseQaPrNumbers", () => {
    it("parses a comma-separated list of PR references", () => {
      expect(parseQaPrNumbers("#25,#26,#27")).toEqual([25, 26, 27]);
    });

    it("ignores invalid and duplicate entries", () => {
      expect(parseQaPrNumbers("#25,foo,#25, ,#30")).toEqual([25, 30]);
    });

    it("returns empty when input is missing", () => {
      expect(parseQaPrNumbers(undefined)).toEqual([]);
      expect(parseQaPrNumbers("")).toEqual([]);
    });
  });

  describe("notification integration", () => {
    it("sendNotifications should be importable", () => {
      expect(typeof sendNotifications).toBe("function");
    });
  });
});
