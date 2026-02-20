/**
 * Tests for agent/discussion API routes and persona seeding behavior.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import request from "supertest";

import { createApp } from "../server/index.js";
import { closeDb, resetRepositories } from "../utils/registry.js";

describe("server agent routes", () => {
  let tempDir: string;
  let nightWatchHome: string;
  let app: ReturnType<typeof createApp>;

  const buildConfig = {
    projectName: "agent-test-project",
    defaultBranch: "main",
    provider: "claude",
    reviewerEnabled: true,
    prdDirectory: "docs/PRDs/night-watch",
    maxRuntime: 7200,
    reviewerMaxRuntime: 3600,
    cron: {
      executorSchedule: "0 0-21 * * *",
      reviewerSchedule: "0 0,3,6,9,12,15,18,21 * * *",
    },
    review: {
      minScore: 80,
      branchPatterns: ["feat/", "night-watch/"],
    },
    logging: {
      maxLogSize: 524288,
    },
  };

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "night-watch-agents-test-"));
    nightWatchHome = path.join(tempDir, ".night-watch-home");
    process.env.NIGHT_WATCH_HOME = nightWatchHome;

    fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ name: "agent-test-project" }));
    fs.writeFileSync(
      path.join(tempDir, "night-watch.config.json"),
      JSON.stringify(buildConfig, null, 2),
    );
    fs.mkdirSync(path.join(tempDir, "docs", "PRDs", "night-watch", "done"), { recursive: true });

    closeDb();
    resetRepositories();
    app = createApp(tempDir);
  });

  afterEach(() => {
    closeDb();
    resetRepositories();
    delete process.env.NIGHT_WATCH_HOME;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("seeds default personas once and does not reseed after delete+restart", async () => {
    const initial = await request(app).get("/api/agents");
    expect(initial.status).toBe(200);
    expect(initial.body.length).toBeGreaterThanOrEqual(4);

    for (const persona of initial.body as Array<{ id: string }>) {
      const deleted = await request(app).delete(`/api/agents/${persona.id}`);
      expect(deleted.status).toBe(204);
    }

    const empty = await request(app).get("/api/agents");
    expect(empty.status).toBe(200);
    expect(empty.body).toHaveLength(0);

    closeDb();
    resetRepositories();
    app = createApp(tempDir);

    const afterRestart = await request(app).get("/api/agents");
    expect(afterRestart.status).toBe(200);
    expect(afterRestart.body).toHaveLength(0);
  });

  it("masks model env vars on create/read responses", async () => {
    const created = await request(app).post("/api/agents").send({
      name: "Custom Agent",
      role: "Security Reviewer",
      modelConfig: {
        provider: "openai",
        model: "gpt-4o",
        envVars: {
          OPENAI_API_KEY: "sk-real-secret",
        },
      },
    });

    expect(created.status).toBe(201);
    expect(created.body.modelConfig.envVars.OPENAI_API_KEY).toBe("***");

    const fetched = await request(app).get(`/api/agents/${created.body.id}`);
    expect(fetched.status).toBe(200);
    expect(fetched.body.modelConfig.envVars.OPENAI_API_KEY).toBe("***");

    const prompt = await request(app).get(`/api/agents/${created.body.id}/prompt`);
    expect(prompt.status).toBe(200);
    expect(typeof prompt.body.prompt).toBe("string");
    expect(prompt.body.prompt.length).toBeGreaterThan(0);
  });

  it("exposes discussion endpoints with project-scoped filtering", async () => {
    const list = await request(app).get("/api/discussions");
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body)).toBe(true);
  });
});
