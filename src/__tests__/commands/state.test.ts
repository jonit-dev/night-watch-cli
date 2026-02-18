/**
 * Integration tests for `night-watch state migrate`
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import Database from "better-sqlite3";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nw-state-cmd-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function runCli(
  args: string,
  timeout = 15000
): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execSync(`npx tsx src/cli.ts ${args}`, {
      encoding: "utf-8",
      cwd: process.cwd(),
      env: { ...process.env, NIGHT_WATCH_HOME: tmpDir },
      stdio: ["pipe", "pipe", "pipe"],
      timeout,
    });
    return { stdout, stderr: "", exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { status: number; stdout: string; stderr: string };
    return {
      stdout: e.stdout || "",
      stderr: e.stderr || "",
      exitCode: e.status,
    };
  }
}

function writeFixtures(): void {
  // projects.json
  const projects = [
    { name: "my-project", path: "/home/user/my-project" },
    { name: "other-project", path: "/home/user/other-project" },
  ];
  fs.writeFileSync(
    path.join(tmpDir, "projects.json"),
    JSON.stringify(projects, null, 2)
  );

  // history.json
  const history = {
    "/home/user/my-project": {
      "docs/PRDs/feature.md": {
        records: [
          { timestamp: 1700000000000, outcome: "success", exitCode: 0, attempt: 1 },
          { timestamp: 1700100000000, outcome: "failure", exitCode: 1, attempt: 2 },
        ],
      },
      "docs/PRDs/other.md": {
        records: [
          { timestamp: 1700200000000, outcome: "timeout", exitCode: 124, attempt: 1 },
        ],
      },
    },
    "/home/user/other-project": {
      "docs/PRDs/thing.md": {
        records: [
          { timestamp: 1700300000000, outcome: "rate_limited", exitCode: 2, attempt: 3 },
        ],
      },
    },
  };
  fs.writeFileSync(
    path.join(tmpDir, "history.json"),
    JSON.stringify(history, null, 2)
  );

  // prd-states.json
  const prdStates = {
    "/home/user/my-project": {
      "feature.md": {
        status: "pending-review",
        branch: "night-watch/feature",
        timestamp: 1700000000000,
      },
    },
    "/home/user/other-project": {
      "thing.md": {
        status: "pending-review",
        branch: "night-watch/thing",
        timestamp: 1700300000000,
      },
    },
  };
  fs.writeFileSync(
    path.join(tmpDir, "prd-states.json"),
    JSON.stringify(prdStates, null, 2)
  );
}

describe("night-watch state migrate", () => {
  it("migrates legacy JSON into SQLite db", () => {
    writeFixtures();

    const { exitCode, stdout } = runCli("state migrate");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Migration complete");

    // Verify the SQLite DB was created
    const dbPath = path.join(tmpDir, "state.db");
    expect(fs.existsSync(dbPath)).toBe(true);

    const db = new Database(dbPath, { readonly: true });

    // projects
    const projectRows = db.prepare("SELECT * FROM projects").all();
    expect(projectRows).toHaveLength(2);

    // execution history — 4 records total across two projects
    const historyRows = db.prepare("SELECT * FROM execution_history").all();
    expect(historyRows).toHaveLength(4);

    // prd states — 2 entries
    const stateRows = db.prepare("SELECT * FROM prd_states").all();
    expect(stateRows).toHaveLength(2);

    db.close();
  });

  it("re-running migration is safe (idempotent)", () => {
    writeFixtures();

    // First run
    const { exitCode: firstExitCode } = runCli("state migrate");
    expect(firstExitCode).toBe(0);

    // Second run — should be a no-op
    const { exitCode: secondExitCode, stdout: secondStdout } = runCli(
      "state migrate"
    );
    expect(secondExitCode).toBe(0);
    expect(secondStdout).toContain("already completed");

    // Verify no duplicates
    const dbPath = path.join(tmpDir, "state.db");
    const db = new Database(dbPath, { readonly: true });

    const projectRows = db.prepare("SELECT * FROM projects").all();
    expect(projectRows).toHaveLength(2);

    const historyRows = db.prepare("SELECT * FROM execution_history").all();
    expect(historyRows).toHaveLength(4);

    const stateRows = db.prepare("SELECT * FROM prd_states").all();
    expect(stateRows).toHaveLength(2);

    db.close();
  });

  it("creates backup files for each legacy JSON that existed", () => {
    writeFixtures();

    const { exitCode } = runCli("state migrate");
    expect(exitCode).toBe(0);

    const backupsDir = path.join(tmpDir, "backups");
    expect(fs.existsSync(backupsDir)).toBe(true);

    // Find the timestamped backup subdirectory
    const entries = fs.readdirSync(backupsDir);
    expect(entries.length).toBeGreaterThan(0);

    const migrationBackupDir = path.join(backupsDir, entries[0]);
    const backedUpFiles = fs.readdirSync(migrationBackupDir);

    expect(backedUpFiles).toContain("projects.json");
    expect(backedUpFiles).toContain("history.json");
    expect(backedUpFiles).toContain("prd-states.json");

    // Verify backup content matches originals
    const originalProjects = JSON.parse(
      fs.readFileSync(path.join(tmpDir, "projects.json"), "utf-8")
    ) as unknown[];
    const backupProjects = JSON.parse(
      fs.readFileSync(
        path.join(migrationBackupDir, "projects.json"),
        "utf-8"
      )
    ) as unknown[];
    expect(backupProjects).toEqual(originalProjects);
  });
});
