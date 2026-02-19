/**
 * Tests for global-mode project-scoped agent routes.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import request from "supertest";

import { createGlobalApp } from "../server/index.js";
import { closeDb, registerProject, resetRepositories } from "../utils/registry.js";

function encodeProjectId(projectPath: string): string {
  return encodeURIComponent(projectPath.replace(/\//g, "~"));
}

describe("global server agent routes", () => {
  let tempDir: string;
  let projectDir: string;
  let app: ReturnType<typeof createGlobalApp>;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "night-watch-global-agents-test-"));
    process.env.NIGHT_WATCH_HOME = path.join(tempDir, ".night-watch-home");

    projectDir = path.join(tempDir, "project-a");
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(path.join(projectDir, "package.json"), JSON.stringify({ name: "project-a" }));
    fs.writeFileSync(
      path.join(projectDir, "night-watch.config.json"),
      JSON.stringify({
        projectName: "project-a",
        defaultBranch: "main",
        provider: "claude",
        reviewerEnabled: true,
        prdDirectory: "docs/PRDs/night-watch",
      }),
    );
    fs.mkdirSync(path.join(projectDir, "docs", "PRDs", "night-watch", "done"), { recursive: true });

    closeDb();
    resetRepositories();
    registerProject(projectDir);
    app = createGlobalApp();
  });

  afterEach(() => {
    closeDb();
    resetRepositories();
    delete process.env.NIGHT_WATCH_HOME;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("serves /api/projects/:projectId/agents and /seed-defaults", async () => {
    const projects = await request(app).get("/api/projects");
    expect(projects.status).toBe(200);
    expect(Array.isArray(projects.body)).toBe(true);
    const projectName = projects.body[0]?.name as string;
    expect(projectName).toBeTruthy();

    const projectId = encodeProjectId(projectName);

    const list = await request(app).get(`/api/projects/${projectId}/agents`);
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body)).toBe(true);

    const seed = await request(app).post(`/api/projects/${projectId}/agents/seed-defaults`);
    expect(seed.status).toBe(200);
    expect(seed.body.message).toContain("seeded");
  });
});
