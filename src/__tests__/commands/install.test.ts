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
});
