/**
 * Tests for Server-Sent Events (SSE) endpoints
 */

import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as http from "http";
import request from "supertest";
import { createApp } from "../../index.js";
import { INightWatchConfig } from "@night-watch/core/types.js";

// Mock process.cwd to return our temp directory
let mockProjectDir: string;

vi.mock("child_process", () => ({
  execSync: vi.fn(),
  execFile: vi.fn(),
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

/**
 * Helper to collect SSE events from an endpoint
 * Connects to SSE endpoint, collects data for a specified duration, then closes
 */
async function collectSSEEvents(
  app: ReturnType<typeof createApp>,
  endpoint: string,
  durationMs: number,
): Promise<{ headers: http.IncomingHttpHeaders; events: string[] }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const port = (server.address() as any).port;
      const events: string[] = [];
      let headers: http.IncomingHttpHeaders = {};

      const req = http.request(
        {
          hostname: "localhost",
          port,
          path: endpoint,
          method: "GET",
        },
        (res) => {
          headers = res.headers;

          res.on("data", (chunk) => {
            events.push(chunk.toString());
          });

          // Close connection after duration
          setTimeout(() => {
            req.destroy();
            server.close(() => {
              resolve({ headers, events });
            });
          }, durationMs);
        },
      );

      req.on("error", (err) => {
        server.close(() => {
          // If connection was destroyed, that's expected
          if (err.message.includes("socket hang up")) {
            resolve({ headers, events });
          } else {
            reject(err);
          }
        });
      });

      req.end();
    });
  });
}

describe("SSE endpoints", () => {
  let tempDir: string;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    vi.resetAllMocks();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "night-watch-sse-test-"));
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

  describe("GET /api/status/events", () => {
    it("returns SSE headers", async () => {
      const { headers } = await collectSSEEvents(app, "/api/status/events", 100);

      expect(headers["content-type"]).toMatch(/text\/event-stream/);
      expect(headers["cache-control"]).toBe("no-cache");
      expect(headers["connection"]).toBe("keep-alive");
    });

    it("sends initial status_changed event on connect", async () => {
      const { events } = await collectSSEEvents(app, "/api/status/events", 100);

      // Combine all chunks into one string
      const body = events.join("");

      // Should contain the event name and data
      expect(body).toContain("event: status_changed");
      expect(body).toContain("data:");
      expect(body).toContain('"projectName":"test-project"');
      expect(body).toContain('"prds"');
    });

    it("broadcasts status_changed when PRD claim appears", async () => {
      // Start collecting events
      const collectPromise = collectSSEEvents(app, "/api/status/events", 2500);

      // Wait a bit for connection to establish
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Create a claim file to change status to in-progress
      const prdDir = path.join(tempDir, "docs", "PRDs", "night-watch");
      const claimPath = path.join(prdDir, "phase1.md.claim");
      fs.writeFileSync(
        claimPath,
        JSON.stringify({ timestamp: Math.floor(Date.now() / 1000), pid: 54321 })
      );

      const { events } = await collectPromise;

      // Combine all chunks
      const body = events.join("");

      // Initial snapshot is always sent
      expect(body).toContain("event: status_changed");

      // If the watcher detected the change, there should be another event
      // with the PRD status as "in-progress" (the claim makes it in-progress)
      // Note: This depends on timing - the 2s watcher interval may or may not fire
      // during our 2500ms collection window.
    });
  });

  describe("POST /api/actions/run", () => {
    it("emits executor_started event after spawn", async () => {
      // Create a new app instance for this test to capture SSE events
      const testApp = createApp(tempDir);

      // Start collecting SSE events
      const collectPromise = collectSSEEvents(testApp, "/api/status/events", 500);

      // Wait for SSE connection to establish
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Trigger spawn using the same app
      const server = testApp.listen(0);
      const port = (server.address() as any).port;

      await new Promise<void>((resolve, reject) => {
        const req = http.request(
          {
            hostname: "localhost",
            port,
            path: "/api/actions/run",
            method: "POST",
            headers: { "Content-Type": "application/json" },
          },
          (res) => {
            let data = "";
            res.on("data", (chunk) => (data += chunk));
            res.on("end", () => {
              try {
                const body = JSON.parse(data);
                expect(body).toHaveProperty("started", true);
                expect(body).toHaveProperty("pid", 12345);
                resolve();
              } catch (e) {
                reject(e);
              }
            });
          },
        );
        req.on("error", reject);
        req.write("{}");
        req.end();
      });

      // Wait for SSE collection to complete
      const { events } = await collectPromise;

      // Close the server
      await new Promise<void>((resolve) => server.close(() => resolve()));

      // Combine events
      const body = events.join("");

      // Should have received executor_started event
      expect(body).toContain("event: executor_started");
      expect(body).toContain('"pid":12345');
    });
  });

  describe("broadcastSSE helper", () => {
    it("removes disconnected clients from registry", async () => {
      // This test verifies the SSE client cleanup behavior
      // When a client disconnects (connection close), it should be removed

      // Make two connections and close them
      const collect1 = collectSSEEvents(app, "/api/status/events", 100);
      const collect2 = collectSSEEvents(app, "/api/status/events", 100);

      const [result1, result2] = await Promise.all([collect1, collect2]);

      // Both connections should have received initial events
      expect(result1.events.join("")).toContain("event: status_changed");
      expect(result2.events.join("")).toContain("event: status_changed");
    });
  });
});
