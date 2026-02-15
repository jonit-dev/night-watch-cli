/**
 * Tests for the Night Watch CLI configuration loader
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { loadConfig, getDefaultConfig } from "../config.js";
import { INightWatchConfig } from "../types.js";

describe("config", () => {
  let tempDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Create a temporary directory for each test
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "night-watch-test-"));

    // Save original environment
    originalEnv = { ...process.env };

    // Clear NW_* environment variables
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("NW_")) {
        delete process.env[key];
      }
    }
  });

  afterEach(() => {
    // Clean up temp directory
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
  });

  describe("getDefaultConfig", () => {
    it("should return all default values", () => {
      const config = getDefaultConfig();

      expect(config.prdDir).toBe("docs/PRDs/night-watch");
      expect(config.maxRuntime).toBe(7200);
      expect(config.reviewerMaxRuntime).toBe(3600);
      expect(config.branchPrefix).toBe("night-watch");
      expect(config.branchPatterns).toEqual(["feat/", "night-watch/"]);
      expect(config.minReviewScore).toBe(80);
      expect(config.maxLogSize).toBe(524288);
      expect(config.cronSchedule).toBe("0 0-15 * * *");
      expect(config.reviewerSchedule).toBe("0 0,3,6,9,12,15 * * *");
    });

    it("should return defaults with provider and reviewerEnabled", () => {
      const config = getDefaultConfig();

      expect(config.provider).toBe("claude");
      expect(config.reviewerEnabled).toBe(true);
    });
  });

  describe("loadConfig", () => {
    it("should return defaults when no config file exists", () => {
      const config = loadConfig(tempDir);
      const defaults = getDefaultConfig();

      expect(config.prdDir).toBe(defaults.prdDir);
      expect(config.maxRuntime).toBe(defaults.maxRuntime);
      expect(config.reviewerMaxRuntime).toBe(defaults.reviewerMaxRuntime);
      expect(config.branchPrefix).toBe(defaults.branchPrefix);
      expect(config.branchPatterns).toEqual(defaults.branchPatterns);
      expect(config.minReviewScore).toBe(defaults.minReviewScore);
      expect(config.maxLogSize).toBe(defaults.maxLogSize);
      expect(config.cronSchedule).toBe(defaults.cronSchedule);
      expect(config.reviewerSchedule).toBe(defaults.reviewerSchedule);
      expect(config.provider).toBe("claude");
      expect(config.reviewerEnabled).toBe(true);
    });

    it("should merge config file with defaults", () => {
      // Write a config file with some overrides
      const configPath = path.join(tempDir, "night-watch.config.json");
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          prdDir: "custom/prds",
          maxRuntime: 3600,
          branchPatterns: ["custom/", "feature/"],
          provider: "claude",
          reviewerEnabled: true,
        })
      );

      const config = loadConfig(tempDir);

      // Check file overrides
      expect(config.prdDir).toBe("custom/prds");
      expect(config.maxRuntime).toBe(3600);
      expect(config.branchPatterns).toEqual(["custom/", "feature/"]);

      // Check defaults preserved
      expect(config.reviewerMaxRuntime).toBe(3600);
      expect(config.branchPrefix).toBe("night-watch");
      expect(config.minReviewScore).toBe(80);
      expect(config.maxLogSize).toBe(524288);
      expect(config.cronSchedule).toBe("0 0-15 * * *");
      expect(config.reviewerSchedule).toBe("0 0,3,6,9,12,15 * * *");
    });

    it("should let env vars override config file", () => {
      // Write a config file
      const configPath = path.join(tempDir, "night-watch.config.json");
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          maxRuntime: 3600,
          cronSchedule: "0 * * * *",
          provider: "claude",
          reviewerEnabled: true,
        })
      );

      // Set env vars to override
      process.env.NW_MAX_RUNTIME = "1800";
      process.env.NW_CRON_SCHEDULE = "0 0 * * *";

      const config = loadConfig(tempDir);

      // Env vars should win
      expect(config.maxRuntime).toBe(1800);
      expect(config.cronSchedule).toBe("0 0 * * *");
    });

    it("should merge provider from config file", () => {
      const configPath = path.join(tempDir, "night-watch.config.json");
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          provider: "codex",
          reviewerEnabled: false,
        })
      );

      const config = loadConfig(tempDir);

      expect(config.provider).toBe("codex");
      expect(config.reviewerEnabled).toBe(false);
    });

    it("should handle NW_PROVIDER env var", () => {
      process.env.NW_PROVIDER = "codex";

      const config = loadConfig(tempDir);

      expect(config.provider).toBe("codex");
    });

    it("should handle NW_REVIEWER_ENABLED env var", () => {
      process.env.NW_REVIEWER_ENABLED = "false";

      const config = loadConfig(tempDir);

      expect(config.reviewerEnabled).toBe(false);
    });

    it("should fallback to default for invalid NW_PROVIDER", () => {
      process.env.NW_PROVIDER = "invalid";

      const config = loadConfig(tempDir);

      expect(config.provider).toBe("claude");
    });

    it("should handle NW_REVIEWER_ENABLED with '1' value", () => {
      process.env.NW_REVIEWER_ENABLED = "0";

      const config = loadConfig(tempDir);

      expect(config.reviewerEnabled).toBe(false);
    });

    it("should handle NW_REVIEWER_ENABLED with 'true' value", () => {
      // First set reviewerEnabled to false in a config file
      const configPath = path.join(tempDir, "night-watch.config.json");
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          provider: "claude",
          reviewerEnabled: false,
        })
      );

      // Then override with env var
      process.env.NW_REVIEWER_ENABLED = "true";

      const config = loadConfig(tempDir);

      expect(config.reviewerEnabled).toBe(true);
    });

    it("should handle NW_REVIEWER_MAX_RUNTIME env var", () => {
      process.env.NW_REVIEWER_MAX_RUNTIME = "7200";

      const config = loadConfig(tempDir);

      expect(config.reviewerMaxRuntime).toBe(7200);
    });

    it("should handle NW_REVIEWER_SCHEDULE env var", () => {
      process.env.NW_REVIEWER_SCHEDULE = "0 */2 * * *";

      const config = loadConfig(tempDir);

      expect(config.reviewerSchedule).toBe("0 */2 * * *");
    });

    it("should handle NW_BRANCH_PREFIX env var", () => {
      process.env.NW_BRANCH_PREFIX = "auto";

      const config = loadConfig(tempDir);

      expect(config.branchPrefix).toBe("auto");
    });

    it("should handle NW_BRANCH_PATTERNS as JSON array", () => {
      process.env.NW_BRANCH_PATTERNS = '["auto/", "bot/"]';

      const config = loadConfig(tempDir);

      expect(config.branchPatterns).toEqual(["auto/", "bot/"]);
    });

    it("should handle NW_BRANCH_PATTERNS as comma-separated string", () => {
      process.env.NW_BRANCH_PATTERNS = "auto/, bot/";

      const config = loadConfig(tempDir);

      expect(config.branchPatterns).toEqual(["auto/", "bot/"]);
    });

    it("should handle NW_MIN_REVIEW_SCORE env var", () => {
      process.env.NW_MIN_REVIEW_SCORE = "90";

      const config = loadConfig(tempDir);

      expect(config.minReviewScore).toBe(90);
    });

    it("should handle NW_MAX_LOG_SIZE env var", () => {
      process.env.NW_MAX_LOG_SIZE = "1048576";

      const config = loadConfig(tempDir);

      expect(config.maxLogSize).toBe(1048576);
    });

    it("should handle NW_PRD_DIR env var", () => {
      process.env.NW_PRD_DIR = "docs/prd";

      const config = loadConfig(tempDir);

      expect(config.prdDir).toBe("docs/prd");
    });

    it("should ignore invalid JSON config file", () => {
      const configPath = path.join(tempDir, "night-watch.config.json");
      fs.writeFileSync(configPath, "{ invalid json }");

      // Should not throw and return defaults
      const config = loadConfig(tempDir);
      const defaults = getDefaultConfig();

      expect(config.maxRuntime).toBe(defaults.maxRuntime);
    });

    it("should ignore invalid numeric env vars", () => {
      process.env.NW_MAX_RUNTIME = "also-not-a-number";

      const config = loadConfig(tempDir);
      const defaults = getDefaultConfig();

      // Should fall back to defaults for invalid values
      expect(config.maxRuntime).toBe(defaults.maxRuntime);
    });

    it("should handle all NW_* env vars together", () => {
      process.env.NW_PRD_DIR = "custom/prds";
      process.env.NW_MAX_RUNTIME = "14400";
      process.env.NW_REVIEWER_MAX_RUNTIME = "7200";
      process.env.NW_BRANCH_PREFIX = "bot";
      process.env.NW_BRANCH_PATTERNS = '["bot/", "auto/"]';
      process.env.NW_MIN_REVIEW_SCORE = "70";
      process.env.NW_MAX_LOG_SIZE = "2097152";
      process.env.NW_CRON_SCHEDULE = "0 */6 * * *";
      process.env.NW_REVIEWER_SCHEDULE = "0 */3 * * *";
      process.env.NW_PROVIDER = "codex";
      process.env.NW_REVIEWER_ENABLED = "false";

      const config = loadConfig(tempDir);

      expect(config.prdDir).toBe("custom/prds");
      expect(config.maxRuntime).toBe(14400);
      expect(config.reviewerMaxRuntime).toBe(7200);
      expect(config.branchPrefix).toBe("bot");
      expect(config.branchPatterns).toEqual(["bot/", "auto/"]);
      expect(config.minReviewScore).toBe(70);
      expect(config.maxLogSize).toBe(2097152);
      expect(config.cronSchedule).toBe("0 */6 * * *");
      expect(config.reviewerSchedule).toBe("0 */3 * * *");
      expect(config.provider).toBe("codex");
      expect(config.reviewerEnabled).toBe(false);
    });
  });
});
