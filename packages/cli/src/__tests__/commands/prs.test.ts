/**
 * Tests for prs command
 */

import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

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

import { execSync } from "child_process";

// Mock process.cwd before importing prs module
const originalCwd = process.cwd;
process.cwd = () => mockProjectDir;

// Import after mocking
import { prsCommand } from "@/cli/commands/prs.js";
import { Command } from "commander";

describe("prs command", () => {
  let tempDir: string;

  beforeEach(() => {
    vi.resetAllMocks();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "night-watch-prs-test-"));
    mockProjectDir = tempDir;

    // Create basic package.json
    fs.writeFileSync(
      path.join(tempDir, "package.json"),
      JSON.stringify({ name: "test-project" })
    );

    // Create config file
    fs.writeFileSync(
      path.join(tempDir, "night-watch.config.json"),
      JSON.stringify({
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
      }, null, 2)
    );

    // Mock execSync for most operations
    vi.mocked(execSync).mockImplementation((cmd: string) => {
      if (cmd.includes("git rev-parse")) {
        return ".git";
      }
      if (cmd.includes("which gh")) {
        return "/usr/bin/gh";
      }
      if (cmd.includes("gh pr list")) {
        return JSON.stringify([]);
      }
      return "";
    });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  afterAll(() => {
    process.cwd = originalCwd;
  });

  describe("help text", () => {
    it("should show help text", async () => {
      const program = new Command();
      prsCommand(program);

      // Use exitOverride to capture help output without exiting
      program.exitOverride();
      program.configureOutput({
        writeOut: (str: string) => {
          // Capture help output
          capturedOutput += str;
        },
      });

      let capturedOutput = "";

      try {
        await program.parseAsync(["node", "test", "prs", "--help"]);
      } catch (e) {
        // Help throws by default in commander, that's expected
      }

      expect(capturedOutput).toContain("--json");
      expect(capturedOutput).toContain("Output PRs as JSON");
    });
  });

  describe("no PRs found", () => {
    it("should handle no open PRs", async () => {
      const program = new Command();
      prsCommand(program);

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await program.parseAsync(["node", "test", "prs"]);

      const output = consoleSpy.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(output).toContain("No open PRs matching configured branch patterns found");

      consoleSpy.mockRestore();
    });

    it("should show branch patterns when no PRs found", async () => {
      const program = new Command();
      prsCommand(program);

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await program.parseAsync(["node", "test", "prs"]);

      const output = consoleSpy.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(output).toContain("Branch patterns:");

      consoleSpy.mockRestore();
    });
  });

  describe("JSON output", () => {
    it("should output JSON with --json flag", async () => {
      // Mock PR data
      vi.mocked(execSync).mockImplementation((cmd: string) => {
        if (cmd.includes("git rev-parse")) {
          return ".git";
        }
        if (cmd.includes("which gh")) {
          return "/usr/bin/gh";
        }
        if (cmd.includes("gh pr list")) {
          return JSON.stringify([
            {
              number: 42,
              title: "Test PR",
              headRefName: "feat/test-feature",
              url: "https://github.com/test/repo/pull/42",
              statusCheckRollup: [
                { conclusion: "SUCCESS", state: "COMPLETED" }
              ],
              reviewDecision: "APPROVED"
            }
          ]);
        }
        return "";
      });

      const program = new Command();
      prsCommand(program);

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await program.parseAsync(["node", "test", "prs", "--json"]);

      const jsonOutput = JSON.parse(consoleSpy.mock.calls[0][0]);

      expect(jsonOutput).toHaveProperty("prs");
      expect(jsonOutput).toHaveProperty("count");
      expect(jsonOutput.count).toBe(1);
      expect(jsonOutput.prs).toHaveLength(1);
      expect(jsonOutput.prs[0]).toHaveProperty("number", 42);
      expect(jsonOutput.prs[0]).toHaveProperty("title", "Test PR");
      expect(jsonOutput.prs[0]).toHaveProperty("branch", "feat/test-feature");
      expect(jsonOutput.prs[0]).toHaveProperty("url", "https://github.com/test/repo/pull/42");
      expect(jsonOutput.prs[0]).toHaveProperty("ciStatus", "pass");
      expect(jsonOutput.prs[0]).toHaveProperty("reviewScore", 100);

      consoleSpy.mockRestore();
    });

    it("should validate JSON structure for empty PR list", async () => {
      const program = new Command();
      prsCommand(program);

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await program.parseAsync(["node", "test", "prs", "--json"]);

      const jsonOutput = JSON.parse(consoleSpy.mock.calls[0][0]);

      expect(jsonOutput).toHaveProperty("prs");
      expect(jsonOutput).toHaveProperty("count");
      expect(jsonOutput.prs).toEqual([]);
      expect(jsonOutput.count).toBe(0);

      consoleSpy.mockRestore();
    });
  });

  describe("PR filtering", () => {
    it("should only include PRs matching branch patterns", async () => {
      vi.mocked(execSync).mockImplementation((cmd: string) => {
        if (cmd.includes("git rev-parse")) {
          return ".git";
        }
        if (cmd.includes("which gh")) {
          return "/usr/bin/gh";
        }
        if (cmd.includes("gh pr list")) {
          return JSON.stringify([
            {
              number: 1,
              title: "Feature PR",
              headRefName: "feat/feature-1",
              url: "https://github.com/test/repo/pull/1",
              statusCheckRollup: [],
              reviewDecision: null
            },
            {
              number: 2,
              title: "Night Watch PR",
              headRefName: "night-watch/prd-123",
              url: "https://github.com/test/repo/pull/2",
              statusCheckRollup: [],
              reviewDecision: null
            },
            {
              number: 3,
              title: "Other PR",
              headRefName: "other/some-branch",
              url: "https://github.com/test/repo/pull/3",
              statusCheckRollup: [],
              reviewDecision: null
            }
          ]);
        }
        return "";
      });

      const program = new Command();
      prsCommand(program);

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await program.parseAsync(["node", "test", "prs", "--json"]);

      const jsonOutput = JSON.parse(consoleSpy.mock.calls[0][0]);

      expect(jsonOutput.count).toBe(2);
      expect(jsonOutput.prs[0].number).toBe(1);
      expect(jsonOutput.prs[1].number).toBe(2);

      consoleSpy.mockRestore();
    });
  });

  describe("CI status formatting", () => {
    it("should report pass when all checks pass", async () => {
      vi.mocked(execSync).mockImplementation((cmd: string) => {
        if (cmd.includes("git rev-parse")) {
          return ".git";
        }
        if (cmd.includes("which gh")) {
          return "/usr/bin/gh";
        }
        if (cmd.includes("gh pr list")) {
          return JSON.stringify([
            {
              number: 1,
              title: "Passing PR",
              headRefName: "feat/test",
              url: "https://github.com/test/repo/pull/1",
              statusCheckRollup: [
                { conclusion: "SUCCESS", state: "COMPLETED" }
              ],
              reviewDecision: null
            }
          ]);
        }
        return "";
      });

      const program = new Command();
      prsCommand(program);

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await program.parseAsync(["node", "test", "prs", "--json"]);

      const jsonOutput = JSON.parse(consoleSpy.mock.calls[0][0]);
      expect(jsonOutput.prs[0].ciStatus).toBe("pass");

      consoleSpy.mockRestore();
    });

    it("should report fail when any check fails", async () => {
      vi.mocked(execSync).mockImplementation((cmd: string) => {
        if (cmd.includes("git rev-parse")) {
          return ".git";
        }
        if (cmd.includes("which gh")) {
          return "/usr/bin/gh";
        }
        if (cmd.includes("gh pr list")) {
          return JSON.stringify([
            {
              number: 1,
              title: "Failing PR",
              headRefName: "feat/test",
              url: "https://github.com/test/repo/pull/1",
              statusCheckRollup: [
                { conclusion: "FAILURE", state: "COMPLETED" }
              ],
              reviewDecision: null
            }
          ]);
        }
        return "";
      });

      const program = new Command();
      prsCommand(program);

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await program.parseAsync(["node", "test", "prs", "--json"]);

      const jsonOutput = JSON.parse(consoleSpy.mock.calls[0][0]);
      expect(jsonOutput.prs[0].ciStatus).toBe("fail");

      consoleSpy.mockRestore();
    });

    it("should report pending when checks are in progress", async () => {
      vi.mocked(execSync).mockImplementation((cmd: string) => {
        if (cmd.includes("git rev-parse")) {
          return ".git";
        }
        if (cmd.includes("which gh")) {
          return "/usr/bin/gh";
        }
        if (cmd.includes("gh pr list")) {
          return JSON.stringify([
            {
              number: 1,
              title: "Pending PR",
              headRefName: "feat/test",
              url: "https://github.com/test/repo/pull/1",
              statusCheckRollup: [
                { conclusion: null, state: "IN_PROGRESS" }
              ],
              reviewDecision: null
            }
          ]);
        }
        return "";
      });

      const program = new Command();
      prsCommand(program);

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await program.parseAsync(["node", "test", "prs", "--json"]);

      const jsonOutput = JSON.parse(consoleSpy.mock.calls[0][0]);
      expect(jsonOutput.prs[0].ciStatus).toBe("pending");

      consoleSpy.mockRestore();
    });
  });

  describe("review score formatting", () => {
    it("should return 100 for APPROVED review decision", async () => {
      vi.mocked(execSync).mockImplementation((cmd: string) => {
        if (cmd.includes("git rev-parse")) {
          return ".git";
        }
        if (cmd.includes("which gh")) {
          return "/usr/bin/gh";
        }
        if (cmd.includes("gh pr list")) {
          return JSON.stringify([
            {
              number: 1,
              title: "Approved PR",
              headRefName: "feat/test",
              url: "https://github.com/test/repo/pull/1",
              statusCheckRollup: [],
              reviewDecision: "APPROVED"
            }
          ]);
        }
        return "";
      });

      const program = new Command();
      prsCommand(program);

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await program.parseAsync(["node", "test", "prs", "--json"]);

      const jsonOutput = JSON.parse(consoleSpy.mock.calls[0][0]);
      expect(jsonOutput.prs[0].reviewScore).toBe(100);

      consoleSpy.mockRestore();
    });

    it("should return 0 for CHANGES_REQUESTED review decision", async () => {
      vi.mocked(execSync).mockImplementation((cmd: string) => {
        if (cmd.includes("git rev-parse")) {
          return ".git";
        }
        if (cmd.includes("which gh")) {
          return "/usr/bin/gh";
        }
        if (cmd.includes("gh pr list")) {
          return JSON.stringify([
            {
              number: 1,
              title: "Changes Requested PR",
              headRefName: "feat/test",
              url: "https://github.com/test/repo/pull/1",
              statusCheckRollup: [],
              reviewDecision: "CHANGES_REQUESTED"
            }
          ]);
        }
        return "";
      });

      const program = new Command();
      prsCommand(program);

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await program.parseAsync(["node", "test", "prs", "--json"]);

      const jsonOutput = JSON.parse(consoleSpy.mock.calls[0][0]);
      expect(jsonOutput.prs[0].reviewScore).toBe(0);

      consoleSpy.mockRestore();
    });

    it("should return null when no review decision", async () => {
      vi.mocked(execSync).mockImplementation((cmd: string) => {
        if (cmd.includes("git rev-parse")) {
          return ".git";
        }
        if (cmd.includes("which gh")) {
          return "/usr/bin/gh";
        }
        if (cmd.includes("gh pr list")) {
          return JSON.stringify([
            {
              number: 1,
              title: "No Review PR",
              headRefName: "feat/test",
              url: "https://github.com/test/repo/pull/1",
              statusCheckRollup: [],
              reviewDecision: null
            }
          ]);
        }
        return "";
      });

      const program = new Command();
      prsCommand(program);

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await program.parseAsync(["node", "test", "prs", "--json"]);

      const jsonOutput = JSON.parse(consoleSpy.mock.calls[0][0]);
      expect(jsonOutput.prs[0].reviewScore).toBeNull();

      consoleSpy.mockRestore();
    });

    it("should return null for REVIEW_REQUIRED review decision", async () => {
      vi.mocked(execSync).mockImplementation((cmd: string) => {
        if (cmd.includes("git rev-parse")) {
          return ".git";
        }
        if (cmd.includes("which gh")) {
          return "/usr/bin/gh";
        }
        if (cmd.includes("gh pr list")) {
          return JSON.stringify([
            {
              number: 1,
              title: "Review Required PR",
              headRefName: "feat/test",
              url: "https://github.com/test/repo/pull/1",
              statusCheckRollup: [],
              reviewDecision: "REVIEW_REQUIRED"
            }
          ]);
        }
        return "";
      });

      const program = new Command();
      prsCommand(program);

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await program.parseAsync(["node", "test", "prs", "--json"]);

      const jsonOutput = JSON.parse(consoleSpy.mock.calls[0][0]);
      expect(jsonOutput.prs[0].reviewScore).toBeNull();

      consoleSpy.mockRestore();
    });
  });

  describe("CI status edge cases", () => {
    it("should report unknown when statusCheckRollup is null", async () => {
      vi.mocked(execSync).mockImplementation((cmd: string) => {
        if (cmd.includes("git rev-parse")) {
          return ".git";
        }
        if (cmd.includes("which gh")) {
          return "/usr/bin/gh";
        }
        if (cmd.includes("gh pr list")) {
          return JSON.stringify([
            {
              number: 1,
              title: "Null Checks PR",
              headRefName: "feat/test",
              url: "https://github.com/test/repo/pull/1",
              statusCheckRollup: null,
              reviewDecision: null
            }
          ]);
        }
        return "";
      });

      const program = new Command();
      prsCommand(program);

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await program.parseAsync(["node", "test", "prs", "--json"]);

      const jsonOutput = JSON.parse(consoleSpy.mock.calls[0][0]);
      expect(jsonOutput.prs[0].ciStatus).toBe("unknown");

      consoleSpy.mockRestore();
    });

    it("should report pass for NEUTRAL conclusion", async () => {
      vi.mocked(execSync).mockImplementation((cmd: string) => {
        if (cmd.includes("git rev-parse")) {
          return ".git";
        }
        if (cmd.includes("which gh")) {
          return "/usr/bin/gh";
        }
        if (cmd.includes("gh pr list")) {
          return JSON.stringify([
            {
              number: 1,
              title: "Neutral PR",
              headRefName: "feat/test",
              url: "https://github.com/test/repo/pull/1",
              statusCheckRollup: [{ conclusion: "NEUTRAL", status: "COMPLETED" }],
              reviewDecision: null
            }
          ]);
        }
        return "";
      });

      const program = new Command();
      prsCommand(program);

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await program.parseAsync(["node", "test", "prs", "--json"]);

      const jsonOutput = JSON.parse(consoleSpy.mock.calls[0][0]);
      expect(jsonOutput.prs[0].ciStatus).toBe("pass");

      consoleSpy.mockRestore();
    });

    it("should handle nested contexts array structure", async () => {
      vi.mocked(execSync).mockImplementation((cmd: string) => {
        if (cmd.includes("git rev-parse")) {
          return ".git";
        }
        if (cmd.includes("which gh")) {
          return "/usr/bin/gh";
        }
        if (cmd.includes("gh pr list")) {
          return JSON.stringify([
            {
              number: 1,
              title: "Nested Contexts PR",
              headRefName: "feat/test",
              url: "https://github.com/test/repo/pull/1",
              statusCheckRollup: [
                {
                  contexts: [
                    { conclusion: "SUCCESS", status: "COMPLETED" }
                  ]
                }
              ],
              reviewDecision: null
            }
          ]);
        }
        return "";
      });

      const program = new Command();
      prsCommand(program);

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await program.parseAsync(["node", "test", "prs", "--json"]);

      const jsonOutput = JSON.parse(consoleSpy.mock.calls[0][0]);
      expect(jsonOutput.prs[0].ciStatus).toBe("pass");

      consoleSpy.mockRestore();
    });

    it("should handle StatusContext state field", async () => {
      vi.mocked(execSync).mockImplementation((cmd: string) => {
        if (cmd.includes("git rev-parse")) {
          return ".git";
        }
        if (cmd.includes("which gh")) {
          return "/usr/bin/gh";
        }
        if (cmd.includes("gh pr list")) {
          return JSON.stringify([
            {
              number: 1,
              title: "StatusContext PR",
              headRefName: "feat/test",
              url: "https://github.com/test/repo/pull/1",
              statusCheckRollup: [{ state: "SUCCESS" }],
              reviewDecision: null
            }
          ]);
        }
        return "";
      });

      const program = new Command();
      prsCommand(program);

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await program.parseAsync(["node", "test", "prs", "--json"]);

      const jsonOutput = JSON.parse(consoleSpy.mock.calls[0][0]);
      expect(jsonOutput.prs[0].ciStatus).toBe("pass");

      consoleSpy.mockRestore();
    });

    it("should report fail for ERROR conclusion", async () => {
      vi.mocked(execSync).mockImplementation((cmd: string) => {
        if (cmd.includes("git rev-parse")) {
          return ".git";
        }
        if (cmd.includes("which gh")) {
          return "/usr/bin/gh";
        }
        if (cmd.includes("gh pr list")) {
          return JSON.stringify([
            {
              number: 1,
              title: "Error PR",
              headRefName: "feat/test",
              url: "https://github.com/test/repo/pull/1",
              statusCheckRollup: [{ conclusion: "ERROR", status: "COMPLETED" }],
              reviewDecision: null
            }
          ]);
        }
        return "";
      });

      const program = new Command();
      prsCommand(program);

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await program.parseAsync(["node", "test", "prs", "--json"]);

      const jsonOutput = JSON.parse(consoleSpy.mock.calls[0][0]);
      expect(jsonOutput.prs[0].ciStatus).toBe("fail");

      consoleSpy.mockRestore();
    });

    it("should report fail for TIMED_OUT conclusion", async () => {
      vi.mocked(execSync).mockImplementation((cmd: string) => {
        if (cmd.includes("git rev-parse")) {
          return ".git";
        }
        if (cmd.includes("which gh")) {
          return "/usr/bin/gh";
        }
        if (cmd.includes("gh pr list")) {
          return JSON.stringify([
            {
              number: 1,
              title: "Timed Out PR",
              headRefName: "feat/test",
              url: "https://github.com/test/repo/pull/1",
              statusCheckRollup: [{ conclusion: "TIMED_OUT", status: "COMPLETED" }],
              reviewDecision: null
            }
          ]);
        }
        return "";
      });

      const program = new Command();
      prsCommand(program);

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await program.parseAsync(["node", "test", "prs", "--json"]);

      const jsonOutput = JSON.parse(consoleSpy.mock.calls[0][0]);
      expect(jsonOutput.prs[0].ciStatus).toBe("fail");

      consoleSpy.mockRestore();
    });
  });

  describe("error handling", () => {
    it("should handle not being in a git repo", async () => {
      vi.mocked(execSync).mockImplementation((cmd: string) => {
        if (cmd.includes("git rev-parse")) {
          throw new Error("not a git repo");
        }
        return "";
      });

      const program = new Command();
      prsCommand(program);

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await program.parseAsync(["node", "test", "prs", "--json"]);

      const jsonOutput = JSON.parse(consoleSpy.mock.calls[0][0]);
      expect(jsonOutput.prs).toEqual([]);
      expect(jsonOutput.count).toBe(0);

      consoleSpy.mockRestore();
    });

    it("should handle gh CLI not being available", async () => {
      vi.mocked(execSync).mockImplementation((cmd: string) => {
        if (cmd.includes("git rev-parse")) {
          return ".git";
        }
        if (cmd.includes("which gh")) {
          throw new Error("gh not found");
        }
        return "";
      });

      const program = new Command();
      prsCommand(program);

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await program.parseAsync(["node", "test", "prs", "--json"]);

      const jsonOutput = JSON.parse(consoleSpy.mock.calls[0][0]);
      expect(jsonOutput.prs).toEqual([]);
      expect(jsonOutput.count).toBe(0);

      consoleSpy.mockRestore();
    });
  });
});
