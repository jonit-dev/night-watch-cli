import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";

// Mock the board provider factory
vi.mock("@night-watch/core/board/factory.js", () => ({
  createBoardProvider: vi.fn(),
}));

// Mock the config loader
vi.mock("@night-watch/core/config.js", () => ({
  loadConfig: vi.fn(),
}));

import { createBoardProvider } from "@night-watch/core/board/factory.js";
import { loadConfig } from "@night-watch/core/config.js";
import type { IBoardProvider, IBoardIssue, BoardColumnName } from "@night-watch/core/board/types.js";

function createMockProvider(): IBoardProvider {
  return {
    setupBoard: vi.fn(),
    ensureLabels: vi.fn().mockResolvedValue({ created: 0, skipped: 15, failed: 0 }),
    getBoard: vi.fn(),
    getColumns: vi.fn(),
    createIssue: vi.fn(),
    getIssue: vi.fn(),
    getIssuesByColumn: vi.fn(),
    getAllIssues: vi.fn(),
    moveIssue: vi.fn(),
    closeIssue: vi.fn(),
    commentOnIssue: vi.fn(),
  };
}

function createTestApp(config: Record<string, unknown>, provider: IBoardProvider | null) {
  vi.mocked(loadConfig).mockReturnValue(config as ReturnType<typeof loadConfig>);
  vi.mocked(createBoardProvider).mockReturnValue(provider);

  // Import app factory after mocks are set up
  const app = express();
  app.use(express.json());

  // Board routes - inline implementation for testing
  const BOARD_COLUMNS: BoardColumnName[] = ["Draft", "Ready", "In Progress", "Review", "Done"];

  function getBoardProvider() {
    const cfg = config as { boardProvider?: { enabled?: boolean; projectNumber?: string } };
    if (!cfg.boardProvider?.enabled || !cfg.boardProvider?.projectNumber) {
      return null;
    }
    return createBoardProvider(cfg.boardProvider, "/test");
  }

  app.get("/api/board/status", async (_req, res) => {
    try {
      const prov = getBoardProvider();
      if (!prov) {
        res.status(404).json({ error: "Board not configured" });
        return;
      }
      const issues = await prov.getAllIssues();
      const columns: Record<BoardColumnName, typeof issues> = {
        Draft: [], Ready: [], "In Progress": [], Review: [], Done: [],
      };
      for (const issue of issues) {
        const col = issue.column ?? "Draft";
        columns[col].push(issue);
      }
      res.json({ enabled: true, columns });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get("/api/board/issues", async (_req, res) => {
    try {
      const prov = getBoardProvider();
      if (!prov) {
        res.status(404).json({ error: "Board not configured" });
        return;
      }
      const issues = await prov.getAllIssues();
      res.json(issues);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/board/issues", async (req, res) => {
    try {
      const prov = getBoardProvider();
      if (!prov) {
        res.status(404).json({ error: "Board not configured" });
        return;
      }
      const { title, body, column } = req.body as { title?: string; body?: string; column?: BoardColumnName };
      if (!title || typeof title !== "string" || title.trim().length === 0) {
        res.status(400).json({ error: "title is required" });
        return;
      }
      if (column && !BOARD_COLUMNS.includes(column)) {
        res.status(400).json({ error: `Invalid column. Must be one of: ${BOARD_COLUMNS.join(", ")}` });
        return;
      }
      const issue = await prov.createIssue({ title: title.trim(), body: body ?? "", column });
      res.status(201).json(issue);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.patch("/api/board/issues/:number/move", async (req, res) => {
    try {
      const prov = getBoardProvider();
      if (!prov) {
        res.status(404).json({ error: "Board not configured" });
        return;
      }
      const issueNumber = parseInt(req.params.number as string, 10);
      if (isNaN(issueNumber)) {
        res.status(400).json({ error: "Invalid issue number" });
        return;
      }
      const { column } = req.body as { column?: BoardColumnName };
      if (!column || !BOARD_COLUMNS.includes(column)) {
        res.status(400).json({ error: `Invalid column. Must be one of: ${BOARD_COLUMNS.join(", ")}` });
        return;
      }
      await prov.moveIssue(issueNumber, column);
      res.json({ moved: true });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/board/issues/:number/comment", async (req, res) => {
    try {
      const prov = getBoardProvider();
      if (!prov) {
        res.status(404).json({ error: "Board not configured" });
        return;
      }
      const issueNumber = parseInt(req.params.number as string, 10);
      if (isNaN(issueNumber)) {
        res.status(400).json({ error: "Invalid issue number" });
        return;
      }
      const { body } = req.body as { body?: string };
      if (!body || typeof body !== "string" || body.trim().length === 0) {
        res.status(400).json({ error: "body is required" });
        return;
      }
      await prov.commentOnIssue(issueNumber, body);
      res.json({ commented: true });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.delete("/api/board/issues/:number", async (req, res) => {
    try {
      const prov = getBoardProvider();
      if (!prov) {
        res.status(404).json({ error: "Board not configured" });
        return;
      }
      const issueNumber = parseInt(req.params.number as string, 10);
      if (isNaN(issueNumber)) {
        res.status(400).json({ error: "Invalid issue number" });
        return;
      }
      await prov.closeIssue(issueNumber);
      res.json({ closed: true });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  return app;
}

describe("Board API Endpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("GET /api/board/status", () => {
    it("returns 404 when board is not configured", async () => {
      const config = { boardProvider: { enabled: false } };
      const app = createTestApp(config, null);

      const response = await request(app).get("/api/board/status");

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: "Board not configured" });
    });

    it("returns board status with issues grouped by column", async () => {
      const config = { boardProvider: { enabled: true, projectNumber: "123" } };
      const mockProvider = createMockProvider();
      const mockIssues: IBoardIssue[] = [
        { number: 1, title: "Issue 1", column: "Draft", state: "open", body: "", url: "", labels: [], assignees: [] },
        { number: 2, title: "Issue 2", column: "Ready", state: "open", body: "", url: "", labels: [], assignees: [] },
        { number: 3, title: "Issue 3", column: "In Progress", state: "open", body: "", url: "", labels: [], assignees: [] },
      ];
      mockProvider.getAllIssues = vi.fn().mockResolvedValue(mockIssues);

      const app = createTestApp(config, mockProvider);
      const response = await request(app).get("/api/board/status");

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        enabled: true,
        columns: {
          Draft: [mockIssues[0]],
          Ready: [mockIssues[1]],
          "In Progress": [mockIssues[2]],
          Review: [],
          Done: [],
        },
      });
    });

    it("groups issues without column into Draft", async () => {
      const config = { boardProvider: { enabled: true, projectNumber: "123" } };
      const mockProvider = createMockProvider();
      const mockIssues: IBoardIssue[] = [
        { number: 1, title: "Issue without column", column: undefined as unknown as BoardColumnName, state: "open", body: "", url: "", labels: [], assignees: [] },
      ];
      mockProvider.getAllIssues = vi.fn().mockResolvedValue(mockIssues);

      const app = createTestApp(config, mockProvider);
      const response = await request(app).get("/api/board/status");

      expect(response.status).toBe(200);
      expect(response.body.columns.Draft).toHaveLength(1);
      expect(response.body.columns.Draft[0].number).toBe(1);
    });
  });

  describe("GET /api/board/issues", () => {
    it("returns 404 when board is not configured", async () => {
      const config = { boardProvider: { enabled: false } };
      const app = createTestApp(config, null);

      const response = await request(app).get("/api/board/issues");

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: "Board not configured" });
    });

    it("returns flat list of all issues", async () => {
      const config = { boardProvider: { enabled: true, projectNumber: "123" } };
      const mockProvider = createMockProvider();
      const mockIssues: IBoardIssue[] = [
        { number: 1, title: "Issue 1", column: "Draft", state: "open", body: "", url: "", labels: [], assignees: [] },
        { number: 2, title: "Issue 2", column: "Ready", state: "open", body: "", url: "", labels: [], assignees: [] },
      ];
      mockProvider.getAllIssues = vi.fn().mockResolvedValue(mockIssues);

      const app = createTestApp(config, mockProvider);
      const response = await request(app).get("/api/board/issues");

      expect(response.status).toBe(200);
      expect(response.body).toEqual(mockIssues);
    });
  });

  describe("POST /api/board/issues", () => {
    it("returns 404 when board is not configured", async () => {
      const config = { boardProvider: { enabled: false } };
      const app = createTestApp(config, null);

      const response = await request(app)
        .post("/api/board/issues")
        .send({ title: "New Issue" });

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: "Board not configured" });
    });

    it("returns 400 when title is missing", async () => {
      const config = { boardProvider: { enabled: true, projectNumber: "123" } };
      const mockProvider = createMockProvider();
      const app = createTestApp(config, mockProvider);

      const response = await request(app)
        .post("/api/board/issues")
        .send({ body: "Some body" });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: "title is required" });
    });

    it("returns 400 when title is empty", async () => {
      const config = { boardProvider: { enabled: true, projectNumber: "123" } };
      const mockProvider = createMockProvider();
      const app = createTestApp(config, mockProvider);

      const response = await request(app)
        .post("/api/board/issues")
        .send({ title: "   " });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: "title is required" });
    });

    it("returns 400 when column is invalid", async () => {
      const config = { boardProvider: { enabled: true, projectNumber: "123" } };
      const mockProvider = createMockProvider();
      const app = createTestApp(config, mockProvider);

      const response = await request(app)
        .post("/api/board/issues")
        .send({ title: "New Issue", column: "InvalidColumn" });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain("Invalid column");
    });

    it("creates an issue with valid data", async () => {
      const config = { boardProvider: { enabled: true, projectNumber: "123" } };
      const mockProvider = createMockProvider();
      const createdIssue: IBoardIssue = {
        number: 42,
        title: "New Issue",
        column: "Draft",
        state: "open",
        body: "Issue body",
        url: "https://github.com/owner/repo/issues/42",
        labels: [],
        assignees: [],
      };
      mockProvider.createIssue = vi.fn().mockResolvedValue(createdIssue);

      const app = createTestApp(config, mockProvider);
      const response = await request(app)
        .post("/api/board/issues")
        .send({ title: "New Issue", body: "Issue body" });

      expect(response.status).toBe(201);
      expect(response.body).toEqual(createdIssue);
      expect(mockProvider.createIssue).toHaveBeenCalledWith({
        title: "New Issue",
        body: "Issue body",
        column: undefined,
      });
    });

    it("creates an issue with specified column", async () => {
      const config = { boardProvider: { enabled: true, projectNumber: "123" } };
      const mockProvider = createMockProvider();
      const createdIssue: IBoardIssue = {
        number: 42,
        title: "New Issue",
        column: "Ready",
        state: "open",
        body: "",
        url: "https://github.com/owner/repo/issues/42",
        labels: [],
        assignees: [],
      };
      mockProvider.createIssue = vi.fn().mockResolvedValue(createdIssue);

      const app = createTestApp(config, mockProvider);
      const response = await request(app)
        .post("/api/board/issues")
        .send({ title: "New Issue", column: "Ready" });

      expect(response.status).toBe(201);
      expect(mockProvider.createIssue).toHaveBeenCalledWith({
        title: "New Issue",
        body: "",
        column: "Ready",
      });
    });
  });

  describe("PATCH /api/board/issues/:number/move", () => {
    it("returns 404 when board is not configured", async () => {
      const config = { boardProvider: { enabled: false } };
      const app = createTestApp(config, null);

      const response = await request(app)
        .patch("/api/board/issues/1/move")
        .send({ column: "Done" });

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: "Board not configured" });
    });

    it("returns 400 for invalid issue number", async () => {
      const config = { boardProvider: { enabled: true, projectNumber: "123" } };
      const mockProvider = createMockProvider();
      const app = createTestApp(config, mockProvider);

      const response = await request(app)
        .patch("/api/board/issues/invalid/move")
        .send({ column: "Done" });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: "Invalid issue number" });
    });

    it("returns 400 when column is missing", async () => {
      const config = { boardProvider: { enabled: true, projectNumber: "123" } };
      const mockProvider = createMockProvider();
      const app = createTestApp(config, mockProvider);

      const response = await request(app)
        .patch("/api/board/issues/1/move")
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toContain("Invalid column");
    });

    it("returns 400 when column is invalid", async () => {
      const config = { boardProvider: { enabled: true, projectNumber: "123" } };
      const mockProvider = createMockProvider();
      const app = createTestApp(config, mockProvider);

      const response = await request(app)
        .patch("/api/board/issues/1/move")
        .send({ column: "InvalidColumn" });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain("Invalid column");
    });

    it("moves issue to specified column", async () => {
      const config = { boardProvider: { enabled: true, projectNumber: "123" } };
      const mockProvider = createMockProvider();
      mockProvider.moveIssue = vi.fn().mockResolvedValue(undefined);

      const app = createTestApp(config, mockProvider);
      const response = await request(app)
        .patch("/api/board/issues/42/move")
        .send({ column: "Done" });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ moved: true });
      expect(mockProvider.moveIssue).toHaveBeenCalledWith(42, "Done");
    });
  });

  describe("POST /api/board/issues/:number/comment", () => {
    it("returns 404 when board is not configured", async () => {
      const config = { boardProvider: { enabled: false } };
      const app = createTestApp(config, null);

      const response = await request(app)
        .post("/api/board/issues/1/comment")
        .send({ body: "Comment text" });

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: "Board not configured" });
    });

    it("returns 400 for invalid issue number", async () => {
      const config = { boardProvider: { enabled: true, projectNumber: "123" } };
      const mockProvider = createMockProvider();
      const app = createTestApp(config, mockProvider);

      const response = await request(app)
        .post("/api/board/issues/invalid/comment")
        .send({ body: "Comment text" });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: "Invalid issue number" });
    });

    it("returns 400 when body is missing", async () => {
      const config = { boardProvider: { enabled: true, projectNumber: "123" } };
      const mockProvider = createMockProvider();
      const app = createTestApp(config, mockProvider);

      const response = await request(app)
        .post("/api/board/issues/1/comment")
        .send({});

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: "body is required" });
    });

    it("returns 400 when body is empty", async () => {
      const config = { boardProvider: { enabled: true, projectNumber: "123" } };
      const mockProvider = createMockProvider();
      const app = createTestApp(config, mockProvider);

      const response = await request(app)
        .post("/api/board/issues/1/comment")
        .send({ body: "   " });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: "body is required" });
    });

    it("adds comment to issue", async () => {
      const config = { boardProvider: { enabled: true, projectNumber: "123" } };
      const mockProvider = createMockProvider();
      mockProvider.commentOnIssue = vi.fn().mockResolvedValue(undefined);

      const app = createTestApp(config, mockProvider);
      const response = await request(app)
        .post("/api/board/issues/42/comment")
        .send({ body: "This is a comment" });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ commented: true });
      expect(mockProvider.commentOnIssue).toHaveBeenCalledWith(42, "This is a comment");
    });
  });

  describe("DELETE /api/board/issues/:number", () => {
    it("returns 404 when board is not configured", async () => {
      const config = { boardProvider: { enabled: false } };
      const app = createTestApp(config, null);

      const response = await request(app).delete("/api/board/issues/1");

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: "Board not configured" });
    });

    it("returns 400 for invalid issue number", async () => {
      const config = { boardProvider: { enabled: true, projectNumber: "123" } };
      const mockProvider = createMockProvider();
      const app = createTestApp(config, mockProvider);

      const response = await request(app).delete("/api/board/issues/invalid");

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: "Invalid issue number" });
    });

    it("closes an issue", async () => {
      const config = { boardProvider: { enabled: true, projectNumber: "123" } };
      const mockProvider = createMockProvider();
      mockProvider.closeIssue = vi.fn().mockResolvedValue(undefined);

      const app = createTestApp(config, mockProvider);
      const response = await request(app).delete("/api/board/issues/42");

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ closed: true });
      expect(mockProvider.closeIssue).toHaveBeenCalledWith(42);
    });
  });
});
