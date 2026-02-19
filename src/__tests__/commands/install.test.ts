/**
 * Tests for install command core logic.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

vi.mock("child_process", () => ({
  execSync: vi.fn(),
}));

vi.mock("../../utils/crontab.js", () => ({
  generateMarker: (projectName: string) => `# night-watch-cli: ${projectName}`,
  getEntries: vi.fn(() => []),
  getProjectEntries: vi.fn(() => []),
  readCrontab: vi.fn(() => []),
  writeCrontab: vi.fn(),
}));

import { execSync } from "child_process";
import { performInstall } from "../../commands/install.js";
import { writeCrontab } from "../../utils/crontab.js";
import { INightWatchConfig } from "../../types.js";

function createTestConfig(overrides: Partial<INightWatchConfig> = {}): INightWatchConfig {
  return {
    defaultBranch: "",
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
    maxRetries: 3,
    provider: "claude",
    reviewerEnabled: true,
    providerEnv: {},
    notifications: { webhooks: [] },
    prdPriority: [],
    roadmapScanner: {
      enabled: false,
      roadmapPath: "ROADMAP.md",
      autoScanInterval: 300,
      slicerSchedule: "0 */6 * * *",
      slicerMaxRuntime: 600,
    },
    templatesDir: ".night-watch/templates",
    boardProvider: { enabled: true, provider: "github" as const },
    autoMerge: false,
    autoMergeMethod: "squash" as const,
    fallbackOnRateLimit: false,
    claudeModel: "sonnet" as const,
    qa: {
      enabled: false,
      schedule: "30 1,7,13,19 * * *",
      maxRuntime: 3600,
      branchPatterns: [],
      artifacts: "both" as const,
      skipLabel: "skip-qa",
      autoInstallPlaywright: true,
    },
    ...overrides,
  };
}

describe("install command", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "night-watch-install-test-"));
    vi.mocked(execSync).mockImplementation(
      ((command: string) => {
        if (command === "npm bin -g") {
          throw new Error("npm bin unavailable");
        }
        if (command === "which night-watch") {
          return "/opt/night-watch/bin/night-watch\n";
        }
        if (command === "which node") {
          return "/usr/local/bin/node\n";
        }
        return "";
      }) as unknown as typeof execSync
    );
    vi.clearAllMocks();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("should export NW_CLI_BIN and include required PATH dirs in entries", () => {
    const config = createTestConfig();
    const result = performInstall(tempDir, config);

    expect(result.success).toBe(true);
    expect(result.entries).toHaveLength(2);

    const executorEntry = result.entries[0];
    expect(executorEntry).toContain(
      'export PATH="/usr/local/bin:/opt/night-watch/bin:$PATH" && '
    );
    expect(executorEntry).toContain(
      "export NW_CLI_BIN='/opt/night-watch/bin/night-watch' && "
    );

    expect(writeCrontab).toHaveBeenCalledTimes(1);
  });

  it("should add slicer crontab entry when scanner enabled", () => {
    const config = createTestConfig({
      roadmapScanner: {
        enabled: true,
        roadmapPath: "ROADMAP.md",
        autoScanInterval: 300,
        slicerSchedule: "0 */6 * * *",
        slicerMaxRuntime: 600,
      },
    });
    const result = performInstall(tempDir, config);

    expect(result.success).toBe(true);
    expect(result.entries).toHaveLength(3); // executor, reviewer, slicer

    const slicerEntry = result.entries[2];
    expect(slicerEntry).toContain("' slice ");
    expect(slicerEntry).toContain("slicer.log");
    expect(slicerEntry).toContain("0 */6 * * *");
    expect(slicerEntry).toContain("# night-watch-cli:");
  });

  it("should skip slicer entry when scanner disabled", () => {
    const config = createTestConfig({
      roadmapScanner: {
        enabled: false,
        roadmapPath: "ROADMAP.md",
        autoScanInterval: 300,
        slicerSchedule: "0 */6 * * *",
        slicerMaxRuntime: 600,
      },
    });
    const result = performInstall(tempDir, config);

    expect(result.success).toBe(true);
    expect(result.entries).toHaveLength(2); // executor and reviewer only

    const hasSlicerEntry = result.entries.some((entry) => entry.includes("' slice "));
    expect(hasSlicerEntry).toBe(false);
  });

  it("should skip slicer entry with --no-slicer flag", () => {
    const config = createTestConfig({
      roadmapScanner: {
        enabled: true,
        roadmapPath: "ROADMAP.md",
        autoScanInterval: 300,
        slicerSchedule: "0 */6 * * *",
        slicerMaxRuntime: 600,
      },
    });
    const result = performInstall(tempDir, config, { noSlicer: true });

    expect(result.success).toBe(true);
    expect(result.entries).toHaveLength(2); // executor and reviewer only

    const hasSlicerEntry = result.entries.some((entry) => entry.includes("' slice "));
    expect(hasSlicerEntry).toBe(false);
  });

  it("should add QA crontab entry when qa.enabled is true", () => {
    const config = createTestConfig({
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
    const result = performInstall(tempDir, config);

    expect(result.success).toBe(true);
    // executor + reviewer + qa = 3
    expect(result.entries).toHaveLength(3);

    const qaEntry = result.entries[2];
    expect(qaEntry).toContain("' qa ");
    expect(qaEntry).toContain("qa.log");
    expect(qaEntry).toContain("30 1,7,13,19 * * *");
    expect(qaEntry).toContain("# night-watch-cli:");
  });

  it("should not include QA entry when qa.enabled is false", () => {
    const config = createTestConfig({
      qa: {
        enabled: false,
        schedule: "30 1,7,13,19 * * *",
        maxRuntime: 3600,
        branchPatterns: [],
        artifacts: "both",
        skipLabel: "skip-qa",
        autoInstallPlaywright: true,
      },
    });
    const result = performInstall(tempDir, config);

    expect(result.success).toBe(true);
    expect(result.entries).toHaveLength(2); // executor and reviewer only

    const hasQaEntry = result.entries.some((entry) => entry.includes("' qa "));
    expect(hasQaEntry).toBe(false);
  });

  it("should skip QA entry when --no-qa flag is set", () => {
    const config = createTestConfig({
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
    const result = performInstall(tempDir, config, { noQa: true });

    expect(result.success).toBe(true);
    expect(result.entries).toHaveLength(2); // executor and reviewer only

    const hasQaEntry = result.entries.some((entry) => entry.includes("' qa "));
    expect(hasQaEntry).toBe(false);
  });

  it("should skip QA entry when Commander passes qa=false from --no-qa", () => {
    const config = createTestConfig({
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
    const result = performInstall(tempDir, config, { qa: false });

    expect(result.success).toBe(true);
    expect(result.entries).toHaveLength(2); // executor and reviewer only

    const hasQaEntry = result.entries.some((entry) => entry.includes("' qa "));
    expect(hasQaEntry).toBe(false);
  });
});
