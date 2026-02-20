/**
 * Tests for web API client URL integration.
 * Verifies that agent endpoints are called with correct paths in
 * single-project and global mode.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  deleteAgent,
  fetchAgentPrompt,
  fetchAgents,
  seedDefaultAgents,
  setCurrentProject,
  setGlobalMode,
} from "../../../web/api.js";

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("web/api agent URL integration", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setGlobalMode(false);
    setCurrentProject(null);
  });

  afterEach(() => {
    setGlobalMode(false);
    setCurrentProject(null);
  });

  it("calls single-project agent endpoints under /api", async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => [] });

    await fetchAgents();
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/agents",
      expect.objectContaining({ headers: expect.objectContaining({ "Content-Type": "application/json" }) }),
    );

    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ prompt: "test" }) });
    await fetchAgentPrompt("abc");
    expect(mockFetch).toHaveBeenLastCalledWith(
      "/api/agents/abc/prompt",
      expect.objectContaining({ headers: expect.objectContaining({ "Content-Type": "application/json" }) }),
    );
  });

  it("calls project-scoped agent endpoints in global mode", async () => {
    setGlobalMode(true);
    setCurrentProject("night-watch-project");
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ message: "ok" }) });

    await seedDefaultAgents();

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/projects/night-watch-project/agents/seed-defaults",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "Content-Type": "application/json" }),
      }),
    );
  });

  it("handles 204 response for deleteAgent without parsing JSON", async () => {
    const json = vi.fn(async () => ({}));
    mockFetch.mockResolvedValue({ ok: true, status: 204, json });

    await expect(deleteAgent("agent-1")).resolves.toBeUndefined();
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/agents/agent-1",
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(json).not.toHaveBeenCalled();
  });
});
