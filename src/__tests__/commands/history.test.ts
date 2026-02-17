/**
 * Tests for history CLI command
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nw-history-cmd-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function runCli(args: string): { stdout: string; exitCode: number } {
  try {
    const stdout = execSync(
      `npx tsx src/cli.ts ${args}`,
      {
        encoding: "utf-8",
        cwd: process.cwd(),
        env: { ...process.env, NIGHT_WATCH_HOME: tmpDir },
        stdio: ["pipe", "pipe", "pipe"],
      }
    );
    return { stdout, exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { status: number; stdout: string };
    return { stdout: e.stdout || "", exitCode: e.status };
  }
}

describe("night-watch history", () => {
  it("should show help for history command", () => {
    const { stdout } = runCli("history --help");
    expect(stdout).toContain("record");
    expect(stdout).toContain("check");
  });

  it("should record execution via CLI", () => {
    const { exitCode } = runCli(
      `history record /tmp/test-project test.md failure --exit-code 1`
    );
    expect(exitCode).toBe(0);

    // Verify history file was written
    const historyPath = path.join(tmpDir, "history.json");
    expect(fs.existsSync(historyPath)).toBe(true);
    const history = JSON.parse(fs.readFileSync(historyPath, "utf-8"));
    const resolved = path.resolve("/tmp/test-project");
    expect(history[resolved]["test.md"].records).toHaveLength(1);
    expect(history[resolved]["test.md"].records[0].outcome).toBe("failure");
  });

  it("should exit 0 when PRD is in cooldown", () => {
    // Record a recent failure first
    runCli(`history record /tmp/test-project test.md failure --exit-code 1`);
    // Check cooldown — should exit 0 (in cooldown)
    const { exitCode } = runCli(
      `history check /tmp/test-project test.md --cooldown 7200`
    );
    expect(exitCode).toBe(0);
  });

  it("should exit 1 when PRD is eligible (no history)", () => {
    const { exitCode } = runCli(
      `history check /tmp/test-project none.md --cooldown 7200`
    );
    expect(exitCode).toBe(1);
  });

  it("should exit 1 when last record is success", () => {
    runCli(`history record /tmp/test-project test.md success --exit-code 0`);
    const { exitCode } = runCli(
      `history check /tmp/test-project test.md --cooldown 7200`
    );
    expect(exitCode).toBe(1);
  });

  it("should reject invalid outcome", () => {
    const { exitCode } = runCli(
      `history record /tmp/test-project test.md invalid_outcome`
    );
    expect(exitCode).toBe(2);
  });
});
