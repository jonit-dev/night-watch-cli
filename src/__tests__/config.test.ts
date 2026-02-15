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
  });

  afterEach(() => {
    // Clean up temp directory
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
  });

  describe("getDefaultConfig", () => {
    it("should return all default values", () => {
      const config = getDefaultConfig();

      expect(config.prdDir).toBe("docs/PRDs/night-watch");
      expect(config.maxBudget).toBe(5.0);
      expect(config.reviewerMaxBudget).toBe(3.0);
      expect(config.maxRuntime).toBe(7200);
      expect(config.reviewerMaxRuntime).toBe(3600);
      expect(config.branchPrefix).toBe("night-watch");
      expect(config.branchPatterns).toEqual(["feat/", "night-watch/"]);
      expect(config.minReviewScore).toBe(80);
      expect(config.maxLogSize).toBe(524288);
      expect(config.cronSchedule).toBe("0 0-15 * * *");
      expect(config.reviewerSchedule).toBe("0 0,3,6,9,12,15 * * *");
      expect(config.claude).toEqual({});
    });
  });

  describe("loadConfig", () => {
    it("should return defaults when no config file exists", () => {
      const config = loadConfig(tempDir);
      const defaults = getDefaultConfig();

      expect(config.prdDir).toBe(defaults.prdDir);
      expect(config.maxBudget).toBe(defaults.maxBudget);
      expect(config.reviewerMaxBudget).toBe(defaults.reviewerMaxBudget);
      expect(config.maxRuntime).toBe(defaults.maxRuntime);
      expect(config.reviewerMaxRuntime).toBe(defaults.reviewerMaxRuntime);
      expect(config.branchPrefix).toBe(defaults.branchPrefix);
      expect(config.branchPatterns).toEqual(defaults.branchPatterns);
      expect(config.minReviewScore).toBe(defaults.minReviewScore);
      expect(config.maxLogSize).toBe(defaults.maxLogSize);
      expect(config.cronSchedule).toBe(defaults.cronSchedule);
      expect(config.reviewerSchedule).toBe(defaults.reviewerSchedule);
      expect(config.claude).toEqual({});
    });

    it("should merge config file with defaults", () => {
      // Write a config file with some overrides
      const configPath = path.join(tempDir, "night-watch.config.json");
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          prdDir: "custom/prds",
          maxBudget: 10.0,
          maxRuntime: 3600,
          branchPatterns: ["custom/", "feature/"],
        })
      );

      const config = loadConfig(tempDir);

      // Check file overrides
      expect(config.prdDir).toBe("custom/prds");
      expect(config.maxBudget).toBe(10.0);
      expect(config.maxRuntime).toBe(3600);
      expect(config.branchPatterns).toEqual(["custom/", "feature/"]);

      // Check defaults preserved
      expect(config.reviewerMaxBudget).toBe(3.0);
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
          maxBudget: 10.0,
          maxRuntime: 3600,
          cronSchedule: "0 * * * *",
        })
      );

      // Set env vars to override
      process.env.NW_MAX_BUDGET = "15.0";
      process.env.NW_MAX_RUNTIME = "1800";
      process.env.NW_CRON_SCHEDULE = "0 0 * * *";

      const config = loadConfig(tempDir);

      // Env vars should win
      expect(config.maxBudget).toBe(15.0);
      expect(config.maxRuntime).toBe(1800);
      expect(config.cronSchedule).toBe("0 0 * * *");
    });

    it("should load claude provider config from file", () => {
      const configPath = path.join(tempDir, "night-watch.config.json");
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          claude: {
            apiKey: "test-api-key",
            baseUrl: "https://custom.api.url",
            opusModel: "claude-opus-custom",
            sonnetModel: "claude-sonnet-custom",
            timeout: 60000,
          },
        })
      );

      const config = loadConfig(tempDir);

      expect(config.claude.apiKey).toBe("test-api-key");
      expect(config.claude.baseUrl).toBe("https://custom.api.url");
      expect(config.claude.opusModel).toBe("claude-opus-custom");
      expect(config.claude.sonnetModel).toBe("claude-sonnet-custom");
      expect(config.claude.timeout).toBe(60000);
    });

    it("should let ANTHROPIC_* env vars override claude config", () => {
      // Write a config file with claude config
      const configPath = path.join(tempDir, "night-watch.config.json");
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          claude: {
            apiKey: "file-api-key",
            baseUrl: "https://file.api.url",
            opusModel: "file-opus-model",
            sonnetModel: "file-sonnet-model",
            timeout: 30000,
          },
        })
      );

      // Set env vars to override
      process.env.ANTHROPIC_AUTH_TOKEN = "env-api-key";
      process.env.ANTHROPIC_BASE_URL = "https://env.api.url";
      process.env.ANTHROPIC_DEFAULT_OPUS_MODEL = "env-opus-model";
      process.env.ANTHROPIC_DEFAULT_SONNET_MODEL = "env-sonnet-model";
      process.env.API_TIMEOUT_MS = "90000";

      const config = loadConfig(tempDir);

      // Env vars should win
      expect(config.claude.apiKey).toBe("env-api-key");
      expect(config.claude.baseUrl).toBe("https://env.api.url");
      expect(config.claude.opusModel).toBe("env-opus-model");
      expect(config.claude.sonnetModel).toBe("env-sonnet-model");
      expect(config.claude.timeout).toBe(90000);
    });

    it("should handle NW_REVIEWER_MAX_BUDGET env var", () => {
      process.env.NW_REVIEWER_MAX_BUDGET = "5.0";

      const config = loadConfig(tempDir);

      expect(config.reviewerMaxBudget).toBe(5.0);
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

      expect(config.maxBudget).toBe(defaults.maxBudget);
    });

    it("should ignore invalid numeric env vars", () => {
      process.env.NW_MAX_BUDGET = "not-a-number";
      process.env.NW_MAX_RUNTIME = "also-not-a-number";

      const config = loadConfig(tempDir);
      const defaults = getDefaultConfig();

      // Should fall back to defaults for invalid values
      expect(config.maxBudget).toBe(defaults.maxBudget);
      expect(config.maxRuntime).toBe(defaults.maxRuntime);
    });

    it("should merge partial claude config from file with env vars", () => {
      const configPath = path.join(tempDir, "night-watch.config.json");
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          claude: {
            apiKey: "file-api-key",
            baseUrl: "https://file.api.url",
          },
        })
      );

      // Set only some env vars
      process.env.ANTHROPIC_DEFAULT_OPUS_MODEL = "env-opus-model";

      const config = loadConfig(tempDir);

      // File values should be preserved for non-overridden fields
      expect(config.claude.apiKey).toBe("file-api-key");
      expect(config.claude.baseUrl).toBe("https://file.api.url");
      // Env var should override
      expect(config.claude.opusModel).toBe("env-opus-model");
      // Non-specified should be undefined
      expect(config.claude.sonnetModel).toBeUndefined();
      expect(config.claude.timeout).toBeUndefined();
    });

    it("should handle all NW_* env vars together", () => {
      process.env.NW_PRD_DIR = "custom/prds";
      process.env.NW_MAX_BUDGET = "20.0";
      process.env.NW_REVIEWER_MAX_BUDGET = "10.0";
      process.env.NW_MAX_RUNTIME = "14400";
      process.env.NW_REVIEWER_MAX_RUNTIME = "7200";
      process.env.NW_BRANCH_PREFIX = "bot";
      process.env.NW_BRANCH_PATTERNS = '["bot/", "auto/"]';
      process.env.NW_MIN_REVIEW_SCORE = "70";
      process.env.NW_MAX_LOG_SIZE = "2097152";
      process.env.NW_CRON_SCHEDULE = "0 */6 * * *";
      process.env.NW_REVIEWER_SCHEDULE = "0 */3 * * *";

      const config = loadConfig(tempDir);

      expect(config.prdDir).toBe("custom/prds");
      expect(config.maxBudget).toBe(20.0);
      expect(config.reviewerMaxBudget).toBe(10.0);
      expect(config.maxRuntime).toBe(14400);
      expect(config.reviewerMaxRuntime).toBe(7200);
      expect(config.branchPrefix).toBe("bot");
      expect(config.branchPatterns).toEqual(["bot/", "auto/"]);
      expect(config.minReviewScore).toBe(70);
      expect(config.maxLogSize).toBe(2097152);
      expect(config.cronSchedule).toBe("0 */6 * * *");
      expect(config.reviewerSchedule).toBe("0 */3 * * *");
    });
  });
});
