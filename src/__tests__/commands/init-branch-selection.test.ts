import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import { getDefaultBranch } from "../../commands/init.js";

function git(cwd: string, args: string, envOverrides: NodeJS.ProcessEnv = {}): string {
  return execSync(`git ${args}`, {
    cwd,
    encoding: "utf-8",
    stdio: "pipe",
    env: {
      ...process.env,
      ...envOverrides,
    },
  }).trim();
}

function commitWithDate(
  cwd: string,
  fileName: string,
  fileContent: string,
  message: string,
  isoDate: string
): void {
  fs.writeFileSync(path.join(cwd, fileName), fileContent);
  git(cwd, `add ${fileName}`);
  git(cwd, `commit -m "${message}"`, {
    GIT_AUTHOR_DATE: isoDate,
    GIT_COMMITTER_DATE: isoDate,
  });
}

describe("getDefaultBranch", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "night-watch-init-branch-test-"));
    git(tempDir, "init");
    git(tempDir, 'config user.email "test@test.com"');
    git(tempDir, 'config user.name "Test User"');
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("should choose main when main is more recent than master", () => {
    git(tempDir, "checkout -b main");
    commitWithDate(tempDir, "main.txt", "main", "main-commit", "2024-01-01T00:00:00Z");

    git(tempDir, "checkout -b master");
    commitWithDate(tempDir, "master.txt", "master", "master-commit", "2023-01-01T00:00:00Z");

    expect(getDefaultBranch(tempDir)).toBe("main");
  });

  it("should choose master when master is more recent than main", () => {
    git(tempDir, "checkout -b main");
    commitWithDate(tempDir, "main.txt", "main", "main-commit", "2023-01-01T00:00:00Z");

    git(tempDir, "checkout -b master");
    commitWithDate(tempDir, "master.txt", "master", "master-commit", "2024-01-01T00:00:00Z");

    expect(getDefaultBranch(tempDir)).toBe("master");
  });

  it("should choose main when only main exists", () => {
    git(tempDir, "checkout -b main");
    commitWithDate(tempDir, "main.txt", "main", "main-commit", "2024-01-01T00:00:00Z");

    expect(getDefaultBranch(tempDir)).toBe("main");
  });

  it("should choose master when only master exists", () => {
    git(tempDir, "checkout -b master");
    commitWithDate(tempDir, "master.txt", "master", "master-commit", "2024-01-01T00:00:00Z");

    expect(getDefaultBranch(tempDir)).toBe("master");
  });
});
