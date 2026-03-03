import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../../../../");
const helpersScript = path.join(repoRoot, "scripts", "night-watch-helpers.sh");

let tempDir: string;
let prdDir: string;
let logFile: string;

function runBashCommand(command: string, env: Record<string, string> = {}): { status: number; stdout: string; stderr: string } {
  const result = spawnSync("bash", ["-c", command], {
    cwd: repoRoot,
    env: {
      ...process.env,
      LOG_FILE: logFile,
      ...env,
    },
    encoding: "utf-8",
  });

  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function sourceHelpersAndRun(command: string, env: Record<string, string> = {}): { status: number; stdout: string; stderr: string } {
  return runBashCommand(`source "${helpersScript}" && ${command}`, env);
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nw-helpers-test-"));
  prdDir = path.join(tempDir, "prds");
  fs.mkdirSync(prdDir);
  logFile = path.join(tempDir, "test.log");

  // Create test PRD files
  fs.writeFileSync(path.join(prdDir, "01-test-prd.md"), "# Test PRD\n");
  fs.writeFileSync(path.join(prdDir, "02-test-prd.md"), "# Test PRD 2\n");
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("claim_prd", () => {
  it("creates .claim file with JSON", () => {
    const result = sourceHelpersAndRun(`claim_prd "${prdDir}" "01-test-prd.md"`);

    expect(result.status).toBe(0);

    const claimPath = path.join(prdDir, "01-test-prd.md.claim");
    expect(fs.existsSync(claimPath)).toBe(true);

    const content = fs.readFileSync(claimPath, "utf-8");
    const claim = JSON.parse(content);

    expect(claim).toHaveProperty("timestamp");
    expect(claim).toHaveProperty("hostname");
    expect(claim).toHaveProperty("pid");
    expect(typeof claim.timestamp).toBe("number");
    expect(typeof claim.hostname).toBe("string");
    expect(typeof claim.pid).toBe("number");
  });
});

describe("is_claimed", () => {
  it("returns 0 for active claim", () => {
    // Create a fresh claim
    sourceHelpersAndRun(`claim_prd "${prdDir}" "01-test-prd.md"`);

    const result = sourceHelpersAndRun(`is_claimed "${prdDir}" "01-test-prd.md" 7200 && echo "claimed"`);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("claimed");
  });

  it("returns 1 for stale claim", () => {
    // Write a claim with an old timestamp (1 second = epoch 1)
    const claimPath = path.join(prdDir, "01-test-prd.md.claim");
    fs.writeFileSync(
      claimPath,
      '{"timestamp":1000000000,"hostname":"test","pid":1}\n'
    );

    const result = sourceHelpersAndRun(`is_claimed "${prdDir}" "01-test-prd.md" 7200`);

    expect(result.status).toBe(1);
  });

  it("returns 1 for no claim", () => {
    const result = sourceHelpersAndRun(`is_claimed "${prdDir}" "01-test-prd.md" 7200`);

    expect(result.status).toBe(1);
  });
});

describe("release_claim", () => {
  it("removes .claim file", () => {
    // Create a claim first
    sourceHelpersAndRun(`claim_prd "${prdDir}" "01-test-prd.md"`);

    const claimPath = path.join(prdDir, "01-test-prd.md.claim");
    expect(fs.existsSync(claimPath)).toBe(true);

    // Release the claim
    const result = sourceHelpersAndRun(`release_claim "${prdDir}" "01-test-prd.md"`);

    expect(result.status).toBe(0);
    expect(fs.existsSync(claimPath)).toBe(false);
  });
});

describe("find_eligible_prd", () => {
  it("skips claimed PRD and returns next eligible", () => {
    // Claim the first PRD
    sourceHelpersAndRun(`claim_prd "${prdDir}" "01-test-prd.md"`);

    // find_eligible_prd should skip 01 and return 02
    const result = sourceHelpersAndRun(`find_eligible_prd "${prdDir}" 7200`);

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("02-test-prd.md");
  });

  it("returns first PRD when none are claimed", () => {
    const result = sourceHelpersAndRun(`find_eligible_prd "${prdDir}" 7200`);

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("01-test-prd.md");
  });

  it("returns nothing when all PRDs are claimed", () => {
    // Claim both PRDs
    sourceHelpersAndRun(`claim_prd "${prdDir}" "01-test-prd.md"`);
    sourceHelpersAndRun(`claim_prd "${prdDir}" "02-test-prd.md"`);

    const result = sourceHelpersAndRun(`find_eligible_prd "${prdDir}" 7200`);

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("");
  });
});

describe("validate_provider", () => {
  it("returns 0 for claude", () => {
    const result = sourceHelpersAndRun(`validate_provider "claude"`);
    expect(result.status).toBe(0);
  });

  it("returns 0 for codex", () => {
    const result = sourceHelpersAndRun(`validate_provider "codex"`);
    expect(result.status).toBe(0);
  });

  it("returns 1 for unknown provider", () => {
    const result = sourceHelpersAndRun(`validate_provider "unknown"`);
    expect(result.status).toBe(1);
  });
});

describe("log function", () => {
  it("writes timestamped message to LOG_FILE", () => {
    const result = sourceHelpersAndRun(`log "Test message"`);

    expect(result.status).toBe(0);
    expect(fs.existsSync(logFile)).toBe(true);

    const content = fs.readFileSync(logFile, "utf-8");
    expect(content).toContain("Test message");
    // Should have timestamp format [YYYY-MM-DD HH:MM:SS]
    expect(content).toMatch(/\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\]/);
  });
});

describe("rotate_log", () => {
  it("renames log file when size exceeds max", () => {
    // Write content larger than default max (524288 bytes)
    const largeContent = "x".repeat(600000);
    fs.writeFileSync(logFile, largeContent);

    const result = sourceHelpersAndRun(`MAX_LOG_SIZE=524288 rotate_log`);

    expect(result.status).toBe(0);
    expect(fs.existsSync(`${logFile}.old`)).toBe(true);
    expect(fs.existsSync(logFile)).toBe(false);
  });

  it("does nothing when log file is small", () => {
    fs.writeFileSync(logFile, "small content");

    const result = sourceHelpersAndRun(`MAX_LOG_SIZE=524288 rotate_log`);

    expect(result.status).toBe(0);
    expect(fs.existsSync(`${logFile}.old`)).toBe(false);
    expect(fs.existsSync(logFile)).toBe(true);
  });
});

describe("project_runtime_key", () => {
  it("returns project name with hash suffix", () => {
    const result = sourceHelpersAndRun(`project_runtime_key "/path/to/my-project"`);

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/^my-project-[a-f0-9]{12}$/);
  });

  it("produces consistent hashes for same input", () => {
    const result1 = sourceHelpersAndRun(`project_runtime_key "/path/to/my-project"`);
    const result2 = sourceHelpersAndRun(`project_runtime_key "/path/to/my-project"`);

    expect(result1.stdout).toBe(result2.stdout);
  });

  it("produces different hashes for different paths", () => {
    const result1 = sourceHelpersAndRun(`project_runtime_key "/path/to/project-a"`);
    const result2 = sourceHelpersAndRun(`project_runtime_key "/path/to/project-b"`);

    expect(result1.stdout).not.toBe(result2.stdout);
  });
});
