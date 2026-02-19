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
  resolveRunNotificationEvent,
} from "../../commands/run.js";
import { applyScheduleOffset, buildCronPathPrefix } from "../../commands/install.js";
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
    maxRetries: 3,
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
      expect(env.NW_BRANCH_PREFIX).toBe("night-watch");
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

    it("should pass custom NW_BRANCH_PREFIX from config", () => {
      const config = createTestConfig({ branchPrefix: "automation" });
      const options: IRunOptions = { dryRun: false };

      const env = buildEnvVars(config, options);

      expect(env.NW_BRANCH_PREFIX).toBe("automation");
    });

    it("should not set NW_PRD_PRIORITY when prdPriority is empty", () => {
      const config = createTestConfig({ prdPriority: [] });
      const options: IRunOptions = { dryRun: false };

      const env = buildEnvVars(config, options);

      expect(env.NW_PRD_PRIORITY).toBeUndefined();
    });

    it("should include NW_EXECUTION_CONTEXT=agent", () => {
      const config = createTestConfig();
      const options: IRunOptions = { dryRun: false };

      const env = buildEnvVars(config, options);

      expect(env.NW_EXECUTION_CONTEXT).toBe("agent");
    });

    it("should include NW_MAX_RETRIES from config", () => {
      const config = createTestConfig({ maxRetries: 5 });
      const options: IRunOptions = { dryRun: false };

      const env = buildEnvVars(config, options);

      expect(env.NW_MAX_RETRIES).toBe("5");
    });

    it("should default NW_MAX_RETRIES to 3", () => {
      const config = createTestConfig();
      const options: IRunOptions = { dryRun: false };

      const env = buildEnvVars(config, options);

      expect(env.NW_MAX_RETRIES).toBe("3");
    });

    it("should clamp NW_MAX_RETRIES to a minimum of 1", () => {
      const config = createTestConfig({ maxRetries: 0 });
      const options: IRunOptions = { dryRun: false };

      const env = buildEnvVars(config, options);

      expect(env.NW_MAX_RETRIES).toBe("1");
    });

    it("should include NW_CLI_BIN for nested CLI calls", () => {
      const config = createTestConfig();
      const options: IRunOptions = { dryRun: false };

      const env = buildEnvVars(config, options);

      expect(env.NW_CLI_BIN).toBe(process.argv[1]);
    });

    it("sets NW_BOARD_ENABLED when boardProvider is enabled and projectNumber is set", () => {
      const config = createTestConfig({
        boardProvider: { enabled: true, provider: "github", projectNumber: 42 },
      });
      const options: IRunOptions = { dryRun: false };

      const env = buildEnvVars(config, options);

      expect(env.NW_BOARD_ENABLED).toBe("true");
    });

    it("sets NW_BOARD_ENABLED when boardProvider is enabled even without projectNumber", () => {
      const config = createTestConfig({
        boardProvider: { enabled: true, provider: "github" },
      });
      const options: IRunOptions = { dryRun: false };

      const env = buildEnvVars(config, options);

      expect(env.NW_BOARD_ENABLED).toBe("true");
    });

    it("does not set NW_BOARD_ENABLED when boardProvider explicitly disabled", () => {
      const config = createTestConfig({
        boardProvider: { enabled: false, provider: "github", projectNumber: 42 },
      });
      const options: IRunOptions = { dryRun: false };

      const env = buildEnvVars(config, options);

      expect(env.NW_BOARD_ENABLED).toBeUndefined();
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

  describe("resolveRunNotificationEvent", () => {
    it("should map timeout exit to run_timeout", () => {
      expect(resolveRunNotificationEvent(124, "failure")).toBe("run_timeout");
    });

    it("should map non-zero exit to run_failed", () => {
      expect(resolveRunNotificationEvent(1, "failure")).toBe("run_failed");
    });

    it("should map success_open_pr to run_succeeded", () => {
      expect(resolveRunNotificationEvent(0, "success_open_pr")).toBe("run_succeeded");
    });

    it("should suppress notifications for skip/no-op statuses", () => {
      expect(resolveRunNotificationEvent(0, "skip_no_eligible_prd")).toBeNull();
      expect(resolveRunNotificationEvent(0, "success_already_merged")).toBeNull();
    });
  });

  describe("applyScheduleOffset", () => {
    it("should replace minute field with offset", () => {
      expect(applyScheduleOffset("0 0-21 * * *", 15)).toBe("15 0-21 * * *");
    });

    it("should not change complex minute expressions", () => {
      expect(applyScheduleOffset("*/5 * * * *", 15)).toBe("*/5 * * * *");
    });

    it("should noop when offset is 0", () => {
      expect(applyScheduleOffset("0 0-21 * * *", 0)).toBe("0 0-21 * * *");
    });

    it("should handle reviewer schedule with comma-separated hours", () => {
      expect(applyScheduleOffset("0 0,3,6,9,12,15,18,21 * * *", 20)).toBe("20 0,3,6,9,12,15,18,21 * * *");
    });

    it("should not change comma-separated minutes", () => {
      expect(applyScheduleOffset("0,30 * * * *", 15)).toBe("0,30 * * * *");
    });
  });

  describe("buildCronPathPrefix", () => {
    it("should include both node and night-watch bin directories", () => {
      expect(buildCronPathPrefix("/usr/local/bin", "/opt/night-watch/bin/night-watch")).toBe(
        'export PATH="/usr/local/bin:/opt/night-watch/bin:$PATH" && '
      );
    });

    it("should not duplicate path entries", () => {
      expect(buildCronPathPrefix("/usr/local/bin", "/usr/local/bin/night-watch")).toBe(
        'export PATH="/usr/local/bin:$PATH" && '
      );
    });

    it("should ignore non-path night-watch command names", () => {
      expect(buildCronPathPrefix("/usr/local/bin", "night-watch")).toBe(
        'export PATH="/usr/local/bin:$PATH" && '
      );
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
