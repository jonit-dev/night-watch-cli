/**
 * Tests for the slice command
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
  ISliceOptions,
} from "../../commands/slice.js";
import { INightWatchConfig, IRoadmapScannerConfig } from "../../types.js";

// Helper to create a valid config with roadmap scanner settings
function createTestConfig(overrides: Partial<INightWatchConfig> = {}): INightWatchConfig {
  const defaultRoadmapScanner: IRoadmapScannerConfig = {
    enabled: true,
    roadmapPath: "ROADMAP.md",
    autoScanInterval: 300,
    slicerSchedule: "0 */6 * * *",
    slicerMaxRuntime: 600,
  };

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
    cronScheduleOffset: 0,
    provider: "claude",
    reviewerEnabled: true,
    maxRetries: 3,
    prdPriority: [],
    providerEnv: {},
    notifications: { webhooks: [] },
    roadmapScanner: defaultRoadmapScanner,
    defaultBranch: "",
    ...overrides,
  };
}

describe("slice command", () => {
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
    it("should build correct env vars", () => {
      const config = createTestConfig();
      const options: ISliceOptions = { dryRun: false };

      const env = buildEnvVars(config, options);

      expect(env.NW_PROVIDER_CMD).toBe("claude");
      expect(env.NW_SLICER_MAX_RUNTIME).toBe("600");
      expect(env.NW_PRD_DIR).toBe("docs/PRDs/night-watch");
      expect(env.NW_ROADMAP_PATH).toBe("ROADMAP.md");
    });

    it("should include slicer max runtime in env", () => {
      const config = createTestConfig({
        roadmapScanner: {
          enabled: true,
          roadmapPath: "ROADMAP.md",
          autoScanInterval: 300,
          slicerSchedule: "0 */6 * * *",
          slicerMaxRuntime: 600,
        },
      });
      const options: ISliceOptions = { dryRun: false };

      const env = buildEnvVars(config, options);

      expect(env.NW_SLICER_MAX_RUNTIME).toBe("600");
    });

    it("should set NW_PROVIDER_CMD for codex provider", () => {
      const config = createTestConfig({ provider: "codex" });
      const options: ISliceOptions = { dryRun: false };

      const env = buildEnvVars(config, options);

      expect(env.NW_PROVIDER_CMD).toBe("codex");
    });

    it("should set NW_DRY_RUN when dryRun is true", () => {
      const config = createTestConfig();
      const options: ISliceOptions = { dryRun: true };

      const env = buildEnvVars(config, options);

      expect(env.NW_DRY_RUN).toBe("1");
    });

    it("should not set NW_DRY_RUN when dryRun is false", () => {
      const config = createTestConfig();
      const options: ISliceOptions = { dryRun: false };

      const env = buildEnvVars(config, options);

      expect(env.NW_DRY_RUN).toBeUndefined();
    });

    it("should include NW_EXECUTION_CONTEXT=agent", () => {
      const config = createTestConfig();
      const options: ISliceOptions = { dryRun: false };

      const env = buildEnvVars(config, options);

      expect(env.NW_EXECUTION_CONTEXT).toBe("agent");
    });

    it("should include providerEnv variables", () => {
      const config = createTestConfig({
        providerEnv: {
          ANTHROPIC_API_KEY: "test-key-123",
        },
      });
      const options: ISliceOptions = { dryRun: false };

      const env = buildEnvVars(config, options);

      expect(env.ANTHROPIC_API_KEY).toBe("test-key-123");
    });

    it("should set custom slicer max runtime", () => {
      const config = createTestConfig({
        roadmapScanner: {
          enabled: true,
          roadmapPath: "ROADMAP.md",
          autoScanInterval: 300,
          slicerSchedule: "0 */6 * * *",
          slicerMaxRuntime: 1800, // 30 minutes
        },
      });
      const options: ISliceOptions = { dryRun: false };

      const env = buildEnvVars(config, options);

      expect(env.NW_SLICER_MAX_RUNTIME).toBe("1800");
    });

    it("should set custom roadmap path", () => {
      const config = createTestConfig({
        roadmapScanner: {
          enabled: true,
          roadmapPath: "docs/ROADMAP.md",
          autoScanInterval: 300,
          slicerSchedule: "0 */6 * * *",
          slicerMaxRuntime: 600,
        },
      });
      const options: ISliceOptions = { dryRun: false };

      const env = buildEnvVars(config, options);

      expect(env.NW_ROADMAP_PATH).toBe("docs/ROADMAP.md");
    });
  });

  describe("applyCliOverrides", () => {
    it("should override timeout with --timeout flag", () => {
      const config = createTestConfig();
      const options: ISliceOptions = { dryRun: false, timeout: "1200" };

      const overridden = applyCliOverrides(config, options);

      expect(overridden.roadmapScanner.slicerMaxRuntime).toBe(1200);
    });

    it("should override provider with --provider flag", () => {
      const config = createTestConfig();
      const options: ISliceOptions = { dryRun: false, provider: "codex" };

      const overridden = applyCliOverrides(config, options);

      expect(overridden.provider).toBe("codex");
    });

    it("should not modify config when no overrides provided", () => {
      const config = createTestConfig();
      const options: ISliceOptions = { dryRun: false };

      const overridden = applyCliOverrides(config, options);

      expect(overridden.roadmapScanner.slicerMaxRuntime).toBe(600);
      expect(overridden.provider).toBe("claude");
    });

    it("should handle invalid timeout gracefully", () => {
      const config = createTestConfig();
      const options: ISliceOptions = { dryRun: false, timeout: "invalid" };

      const overridden = applyCliOverrides(config, options);

      // Should not override when parsing fails
      expect(overridden.roadmapScanner.slicerMaxRuntime).toBe(600);
    });
  });

  describe("command registration", () => {
    it("should register slice command", async () => {
      // Import the command registration function
      const { sliceCommand } = await import("../../commands/slice.js");

      const program = new Command();
      sliceCommand(program);

      expect(program.commands.map((c) => c.name())).toContain("slice");
    });
  });
});
