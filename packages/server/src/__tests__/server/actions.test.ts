/**
 * Tests for server action endpoints
 */

import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import request from "supertest";
import { createApp } from "../../index.js";
import { INightWatchConfig } from "@night-watch/core/types.js";

// Mock process.cwd to return our temp directory
let mockProjectDir: string;

vi.mock("child_process", () => ({
  execSync: vi.fn(),
  spawn: vi.fn(),
}));

vi.mock("@night-watch/core/utils/crontab.js", () => ({
  getEntries: vi.fn(() => []),
  getProjectEntries: vi.fn(() => []),
  generateMarker: vi.fn((name: string) => `# night-watch-cli: ${name}`),
}));

import { execSync, spawn } from "child_process";
import { getEntries, getProjectEntries } from "@night-watch/core/utils/crontab.js";

// Mock process.cwd before importing server module
const originalCwd = process.cwd;
process.cwd = () => mockProjectDir;

describe("server actions API", () => {
  let tempDir: string;
  let app: any;

  beforeEach(() => {
    vi.resetAllMocks();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "night-watch-actions-test-"));
    mockProjectDir = tempDir;

    // Create basic package.json
    fs.writeFileSync(
      path.join(tempDir, "package.json"),
      JSON.stringify({ name: "test-project" })
    );

    // Create config file
    const configData = {
      projectName: "test-project",
      defaultBranch: "main",
      provider: "claude",
      reviewerEnabled: true,
      prdDirectory: "docs/PRDs/night-watch",
      maxRuntime: 7200,
      reviewerMaxRuntime: 3600,
      cron: {
        executorSchedule: "0 0-21 * * *",
        reviewerSchedule: "0 0,3,6,9,12,15,18,21 * * *"
      },
      review: {
        minScore: 80,
        branchPatterns: ["feat/", "night-watch/"]
      },
      logging: {
        maxLogSize: 524288
      }
    };
    fs.writeFileSync(
      path.join(tempDir, "night-watch.config.json"),
      JSON.stringify(configData, null, 2)
    );

    // Create PRD directory
    const prdDir = path.join(tempDir, "docs", "PRDs", "night-watch");
    fs.mkdirSync(prdDir, { recursive: true });
    fs.mkdirSync(path.join(prdDir, "done"), { recursive: true });

    // Create some PRD files
    fs.writeFileSync(path.join(prdDir, "phase1.md"), "# Phase 1\n\nSome content.");
    fs.writeFileSync(path.join(prdDir, "phase2.md"), "# Phase 2\n\nOther content.");

    // Create log directory and files
    const logDir = path.join(tempDir, "logs");
    fs.mkdirSync(logDir, { recursive: true });
    fs.writeFileSync(path.join(logDir, "executor.log"), "Executor log line 1\n");
    fs.writeFileSync(path.join(logDir, "reviewer.log"), "Reviewer log line 1\n");

    // Mock getEntries
    vi.mocked(getEntries).mockReturnValue([]);
    vi.mocked(getProjectEntries).mockReturnValue([]);

    // Mock execSync
    vi.mocked(execSync).mockImplementation((cmd: string) => {
      if (cmd.includes("git rev-parse")) {
        return "true";
      }
      if (cmd.includes("which claude")) {
        return "/usr/bin/claude";
      }
      return "";
    });

    // Mock spawn
    vi.mocked(spawn).mockReturnValue({
      pid: 12345,
      unref: vi.fn(),
      on: vi.fn(),
    } as any);

    // Create app
    app = createApp(tempDir);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  afterAll(() => {
    process.cwd = originalCwd;
  });

  describe("POST /api/actions/run", () => {
    it("spawns executor without prdName when body is empty", async () => {
      const response = await request(app)
        .post("/api/actions/run")
        .send({});

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("started", true);
      expect(response.body).toHaveProperty("pid", 12345);

      // Verify spawn was called with correct arguments
      expect(vi.mocked(spawn)).toHaveBeenCalledWith(
        "night-watch",
        ["run"],
        expect.objectContaining({
          detached: true,
          stdio: "ignore",
          cwd: tempDir,
        })
      );

      // Verify env does NOT have NW_PRD_PRIORITY
      const spawnCall = vi.mocked(spawn).mock.calls[0];
      const env = spawnCall[2]?.env as NodeJS.ProcessEnv | undefined;
      expect(env?.NW_PRD_PRIORITY).toBeUndefined();
    });

    it("sets NW_PRD_PRIORITY env var when prdName is provided", async () => {
      const response = await request(app)
        .post("/api/actions/run")
        .send({ prdName: "my-feature-prd" });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("started", true);

      // Verify spawn was called with NW_PRD_PRIORITY in env
      expect(vi.mocked(spawn)).toHaveBeenCalledWith(
        "night-watch",
        ["run"],
        expect.objectContaining({
          detached: true,
          stdio: "ignore",
          cwd: tempDir,
          env: expect.objectContaining({
            NW_PRD_PRIORITY: "my-feature-prd",
          }),
        })
      );
    });

    it("does not set NW_PRD_PRIORITY for non-run commands", async () => {
      const response = await request(app)
        .post("/api/actions/review")
        .send({ prdName: "my-feature-prd" });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("started", true);

      // Verify spawn was called for review without NW_PRD_PRIORITY
      expect(vi.mocked(spawn)).toHaveBeenCalledWith(
        "night-watch",
        ["review"],
        expect.objectContaining({
          detached: true,
          stdio: "ignore",
          cwd: tempDir,
        })
      );

      // Verify env does NOT have NW_PRD_PRIORITY (review command)
      const spawnCall = vi.mocked(spawn).mock.calls[0];
      const env = spawnCall[2]?.env as NodeJS.ProcessEnv | undefined;
      expect(env?.NW_PRD_PRIORITY).toBeUndefined();
    });
  });

  describe("POST /api/actions/clear-lock", () => {
    it("returns 409 when executor is actively running", async () => {
      // Create a lock file with a running PID
      const lockDir = "/tmp";
      const lockFileName = `night-watch-${path.basename(tempDir)}-${require("crypto").createHash("sha1").update(tempDir).digest("hex").slice(0, 12)}.lock`;
      const lockPath = path.join(lockDir, lockFileName);

      fs.writeFileSync(lockPath, "12345");

      // Mock process.kill to simulate running process
      const originalKill = process.kill;
      (process as any).kill = vi.fn().mockReturnValue(true);

      try {
        const response = await request(app).post("/api/actions/clear-lock");

        expect(response.status).toBe(409);
        expect(response.body).toHaveProperty("error");
        expect(response.body.error).toContain("actively running");

        // Lock file should still exist
        expect(fs.existsSync(lockPath)).toBe(true);
      } finally {
        (process as any).kill = originalKill;
        // Clean up lock file
        try {
          fs.unlinkSync(lockPath);
        } catch {
          // Ignore cleanup errors
        }
      }
    });

    it("removes stale lock and returns cleared: true", async () => {
      // Create a lock file with a non-running PID (stale)
      const lockDir = "/tmp";
      const lockFileName = `night-watch-${path.basename(tempDir)}-${require("crypto").createHash("sha1").update(tempDir).digest("hex").slice(0, 12)}.lock`;
      const lockPath = path.join(lockDir, lockFileName);

      fs.writeFileSync(lockPath, "99999");

      // Create an orphaned claim file
      const prdDir = path.join(tempDir, "docs", "PRDs", "night-watch");
      const claimPath = path.join(prdDir, "phase1.md.claim");
      fs.writeFileSync(
        claimPath,
        JSON.stringify({ timestamp: Math.floor(Date.now() / 1000), hostname: "test", pid: 99999 })
      );

      // Mock process.kill to simulate process NOT running
      const originalKill = process.kill;
      (process as any).kill = vi.fn().mockImplementation(() => {
        throw new Error("ESRCH");
      });

      try {
        // Verify files exist before clearing
        expect(fs.existsSync(lockPath)).toBe(true);
        expect(fs.existsSync(claimPath)).toBe(true);

        const response = await request(app).post("/api/actions/clear-lock");

        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty("cleared", true);

        // Lock file should be removed
        expect(fs.existsSync(lockPath)).toBe(false);

        // Claim file should also be cleaned up
        expect(fs.existsSync(claimPath)).toBe(false);
      } finally {
        (process as any).kill = originalKill;
        // Clean up lock file if it still exists
        try {
          fs.unlinkSync(lockPath);
        } catch {
          // Ignore cleanup errors
        }
      }
    });

    it("returns cleared: true even when no lock file exists", async () => {
      // Mock process.kill to simulate process NOT running
      const originalKill = process.kill;
      (process as any).kill = vi.fn().mockImplementation(() => {
        throw new Error("ESRCH");
      });

      try {
        const response = await request(app).post("/api/actions/clear-lock");

        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty("cleared", true);
      } finally {
        (process as any).kill = originalKill;
      }
    });
  });
});
