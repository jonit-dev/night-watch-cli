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

function runCli(args: string, timeout = 10000): { stdout: string; exitCode: number } {
  try {
    const stdout = execSync(
      `node dist/cli.js ${args}`,
      {
        encoding: "utf-8",
        cwd: process.cwd(),
        env: { ...process.env, NIGHT_WATCH_HOME: tmpDir },
        stdio: ["pipe", "pipe", "pipe"],
        timeout,
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

  it("should record execution via CLI and exit 0 when PRD is in cooldown", () => {
    // Combined test: record + check cooldown in one go to reduce CLI spawns
    const { exitCode: recordExitCode } = runCli(
      `history record /tmp/test-project test.md failure --exit-code 1`
    );
    expect(recordExitCode).toBe(0);

    // Verify the SQLite DB was created (history is now stored in state.db)
    const dbPath = path.join(tmpDir, "state.db");
    expect(fs.existsSync(dbPath)).toBe(true);

    // Check cooldown — should exit 0 (in cooldown), which verifies the record was persisted
    const { exitCode: checkExitCode } = runCli(
      `history check /tmp/test-project test.md --cooldown 7200`
    );
    expect(checkExitCode).toBe(0);
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
