import { afterEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execSync, spawn, spawnSync } from "child_process";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../../../../");
const executorScript = path.join(repoRoot, "scripts", "night-watch-cron.sh");
const reviewerScript = path.join(repoRoot, "scripts", "night-watch-pr-reviewer-cron.sh");
const qaScript = path.join(repoRoot, "scripts", "night-watch-qa-cron.sh");
const auditScript = path.join(repoRoot, "scripts", "night-watch-audit-cron.sh");

const tempDirs: string[] = [];

function mkTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function runScript(scriptPath: string, projectDir: string, env: NodeJS.ProcessEnv = {}) {
  return spawnSync("bash", [scriptPath, projectDir], {
    cwd: repoRoot,
    env: {
      ...process.env,
      ...env,
    },
    encoding: "utf-8",
  });
}

function runScriptAsync(scriptPath: string, projectDir: string, env: NodeJS.ProcessEnv = {}): Promise<{
  status: number | null;
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolve) => {
    const child = spawn("bash", [scriptPath, projectDir], {
      cwd: repoRoot,
      env: {
        ...process.env,
        ...env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("close", (status) => {
      resolve({ status, stdout, stderr });
    });
  });
}

function initGitRepo(projectDir: string): void {
  execSync("git init", { cwd: projectDir, stdio: "ignore" });
  execSync("git config user.email smoke@test.local", { cwd: projectDir, stdio: "ignore" });
  execSync("git config user.name \"Smoke Test\"", { cwd: projectDir, stdio: "ignore" });

  fs.writeFileSync(path.join(projectDir, "README.md"), "# Smoke\n", "utf-8");
  execSync("git add .", { cwd: projectDir, stdio: "ignore" });
  execSync("git commit -m init", { cwd: projectDir, stdio: "ignore" });

  const currentBranch = execSync("git branch --show-current", {
    cwd: projectDir,
    encoding: "utf-8",
  }).trim();
  if (currentBranch !== "main") {
    execSync("git checkout -b main", { cwd: projectDir, stdio: "ignore" });
  }
}

function createPrd(projectDir: string, name: string): string {
  const prdDir = path.join(projectDir, "docs", "PRDs", "night-watch");
  fs.mkdirSync(path.join(prdDir, "done"), { recursive: true });
  const prdPath = path.join(prdDir, `${name}.md`);
  fs.writeFileSync(prdPath, `# ${name}\n\nsmoke`, "utf-8");
  return prdPath;
}

function commitAll(projectDir: string, message: string): void {
  execSync("git add .", { cwd: projectDir, stdio: "ignore" });
  execSync(`git commit -m "${message.replace(/"/g, "'")}"`, {
    cwd: projectDir,
    stdio: "ignore",
  });
}

afterEach(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tempDirs.length = 0;
});

describe("core flow smoke tests (bash scripts)", () => {
  it("executor should emit skip marker when no eligible PRDs exist", () => {
    const projectDir = mkTempDir("nw-smoke-executor-skip-");
    fs.mkdirSync(path.join(projectDir, "logs"), { recursive: true });
    fs.mkdirSync(path.join(projectDir, "docs", "PRDs", "night-watch", "done"), { recursive: true });

    const result = runScript(executorScript, projectDir);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("NIGHT_WATCH_RESULT:skip_no_eligible_prd");
  });

  it("reviewer should emit skip marker when there are no open PRs", () => {
    const projectDir = mkTempDir("nw-smoke-reviewer-skip-");
    fs.mkdirSync(path.join(projectDir, "logs"), { recursive: true });

    const result = runScript(reviewerScript, projectDir);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("NIGHT_WATCH_RESULT:skip_no_open_prs");
  });

  it("executor should emit success_open_pr and move PRD to done when PR is detected after provider run", () => {
    const projectDir = mkTempDir("nw-smoke-executor-success-");
    initGitRepo(projectDir);
    createPrd(projectDir, "01-smoke-success");
    commitAll(projectDir, "add PRD");

    const fakeBin = mkTempDir("nw-smoke-bin-success-");
    const readyFlag = path.join(projectDir, ".smoke-pr-open");
    const branchName = "night-watch/01-smoke-success";

    fs.writeFileSync(
      path.join(fakeBin, "claude"),
      "#!/usr/bin/env bash\n" +
      "touch \"$NW_SMOKE_PR_READY_FILE\"\n" +
      "exit 0\n",
      { encoding: "utf-8", mode: 0o755 }
    );

    fs.writeFileSync(
      path.join(fakeBin, "gh"),
      "#!/usr/bin/env bash\n" +
      "if [[ \"$1\" == \"pr\" && \"$2\" == \"list\" ]]; then\n" +
      "  state=\"\"\n" +
      "  for ((i=1; i<=$#; i++)); do\n" +
      "    if [[ \"${!i}\" == \"--state\" ]]; then\n" +
      "      j=$((i+1))\n" +
      "      state=\"${!j}\"\n" +
      "    fi\n" +
      "  done\n" +
      "  if [[ \"$state\" == \"open\" && -f \"$NW_SMOKE_PR_READY_FILE\" ]]; then\n" +
      "    echo \"$NW_SMOKE_BRANCH\"\n" +
      "  fi\n" +
      "  exit 0\n" +
      "fi\n" +
      "exit 0\n",
      { encoding: "utf-8", mode: 0o755 }
    );

    const result = runScript(executorScript, projectDir, {
      PATH: `${fakeBin}:${process.env.PATH}`,
      NW_PROVIDER_CMD: "claude",
      NW_PRD_DIR: "docs/PRDs/night-watch",
      NW_DEFAULT_BRANCH: "main",
      NW_SMOKE_PR_READY_FILE: readyFlag,
      NW_SMOKE_BRANCH: branchName,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("NIGHT_WATCH_RESULT:success_open_pr");
    expect(result.stdout).toContain(`branch=${branchName}`);
  });

  it("executor should emit failure_no_pr_after_success and return non-zero when provider exits 0 but no PR exists", () => {
    const projectDir = mkTempDir("nw-smoke-executor-failure-");
    initGitRepo(projectDir);
    createPrd(projectDir, "01-smoke-failure");
    commitAll(projectDir, "add PRD");

    const fakeBin = mkTempDir("nw-smoke-bin-failure-");

    fs.writeFileSync(
      path.join(fakeBin, "claude"),
      "#!/usr/bin/env bash\nexit 0\n",
      { encoding: "utf-8", mode: 0o755 }
    );

    fs.writeFileSync(
      path.join(fakeBin, "gh"),
      "#!/usr/bin/env bash\nif [[ \"$1\" == \"pr\" && \"$2\" == \"list\" ]]; then\n  exit 0\nfi\nexit 0\n",
      { encoding: "utf-8", mode: 0o755 }
    );

    const result = runScript(executorScript, projectDir, {
      PATH: `${fakeBin}:${process.env.PATH}`,
      NW_PROVIDER_CMD: "claude",
      NW_PRD_DIR: "docs/PRDs/night-watch",
      NW_DEFAULT_BRANCH: "main",
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("NIGHT_WATCH_RESULT:failure_no_pr_after_success");
    expect(
      fs.existsSync(path.join(projectDir, "docs", "PRDs", "night-watch", "01-smoke-failure.md"))
    ).toBe(true);
  });

  it("qa should emit skip marker when no open PRs", () => {
    const projectDir = mkTempDir("nw-smoke-qa-skip-");
    fs.mkdirSync(path.join(projectDir, "logs"), { recursive: true });

    const result = runScript(qaScript, projectDir);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("NIGHT_WATCH_RESULT:skip_no_open_prs");
  });

  it("qa should return non-zero when provider fails on a PR", () => {
    const projectDir = mkTempDir("nw-smoke-qa-failure-");
    initGitRepo(projectDir);
    fs.mkdirSync(path.join(projectDir, "logs"), { recursive: true });

    const fakeBin = mkTempDir("nw-smoke-qa-failure-bin-");

    fs.writeFileSync(
      path.join(fakeBin, "claude"),
      "#!/usr/bin/env bash\nexit 42\n",
      { encoding: "utf-8", mode: 0o755 }
    );

    fs.writeFileSync(
      path.join(fakeBin, "gh"),
      "#!/usr/bin/env bash\n" +
      "if [[ \"$1\" == \"pr\" && \"$2\" == \"list\" ]]; then\n" +
      "  echo '[{\"number\":1,\"headRefName\":\"feat/qa-fail\",\"title\":\"QA fail\",\"labels\":[]}]'\n" +
      "  exit 0\n" +
      "fi\n" +
      "if [[ \"$1\" == \"repo\" && \"$2\" == \"view\" ]]; then\n" +
      "  echo 'owner/repo'\n" +
      "  exit 0\n" +
      "fi\n" +
      "if [[ \"$1\" == \"pr\" && \"$2\" == \"view\" ]]; then\n" +
      "  exit 0\n" +
      "fi\n" +
      "if [[ \"$1\" == \"api\" ]]; then\n" +
      "  echo '[]'\n" +
      "  exit 0\n" +
      "fi\n" +
      "if [[ \"$1\" == \"pr\" && \"$2\" == \"checkout\" ]]; then\n" +
      "  exit 0\n" +
      "fi\n" +
      "exit 0\n",
      { encoding: "utf-8", mode: 0o755 }
    );

    const result = runScript(qaScript, projectDir, {
      PATH: `${fakeBin}:${process.env.PATH}`,
      NW_PROVIDER_CMD: "claude",
      NW_DEFAULT_BRANCH: "main",
      NW_BRANCH_PATTERNS: "feat/",
    });

    expect(result.status).toBe(42);
    expect(result.stdout).toContain("NIGHT_WATCH_RESULT:failure");
  });

  it("audit should fail when provider exits 0 without producing a report", () => {
    const projectDir = mkTempDir("nw-smoke-audit-missing-report-");
    initGitRepo(projectDir);
    fs.mkdirSync(path.join(projectDir, "logs"), { recursive: true });

    const fakeBin = mkTempDir("nw-smoke-audit-missing-report-bin-");
    fs.writeFileSync(
      path.join(fakeBin, "claude"),
      "#!/usr/bin/env bash\n" +
      "echo 'Unknown skill: night-watch-audit' >&2\n" +
      "exit 0\n",
      { encoding: "utf-8", mode: 0o755 }
    );

    const result = runScript(auditScript, projectDir, {
      PATH: `${fakeBin}:${process.env.PATH}`,
      NW_PROVIDER_CMD: "claude",
      NW_DEFAULT_BRANCH: "main",
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("NIGHT_WATCH_RESULT:failure_no_report");
    expect(fs.existsSync(path.join(projectDir, "logs", "audit-report.md"))).toBe(false);
  });

  it("audit should emit skip_clean when report contains NO_ISSUES_FOUND", () => {
    const projectDir = mkTempDir("nw-smoke-audit-clean-");
    initGitRepo(projectDir);
    fs.mkdirSync(path.join(projectDir, "logs"), { recursive: true });

    const fakeBin = mkTempDir("nw-smoke-audit-clean-bin-");
    fs.writeFileSync(
      path.join(fakeBin, "claude"),
      "#!/usr/bin/env bash\n" +
      "mkdir -p logs\n" +
      "printf 'NO_ISSUES_FOUND\\n' > logs/audit-report.md\n" +
      "exit 0\n",
      { encoding: "utf-8", mode: 0o755 }
    );

    const result = runScript(auditScript, projectDir, {
      PATH: `${fakeBin}:${process.env.PATH}`,
      NW_PROVIDER_CMD: "claude",
      NW_DEFAULT_BRANCH: "main",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("NIGHT_WATCH_RESULT:skip_clean");
    expect(fs.readFileSync(path.join(projectDir, "logs", "audit-report.md"), "utf-8")).toContain("NO_ISSUES_FOUND");
  });

  it("audit should emit success_audit when provider writes findings report", () => {
    const projectDir = mkTempDir("nw-smoke-audit-success-");
    initGitRepo(projectDir);
    fs.mkdirSync(path.join(projectDir, "logs"), { recursive: true });

    const fakeBin = mkTempDir("nw-smoke-audit-success-bin-");
    fs.writeFileSync(
      path.join(fakeBin, "claude"),
      "#!/usr/bin/env bash\n" +
      "mkdir -p logs\n" +
      "cat <<'EOF' > logs/audit-report.md\n" +
      "# Code Audit Report\n" +
      "\n" +
      "Generated: 2026-02-20T00:00:00.000Z\n" +
      "\n" +
      "## Findings\n" +
      "\n" +
      "### Finding 1\n" +
      "- **Location**: `src/example.ts:1`\n" +
      "- **Severity**: medium\n" +
      "- **Category**: dry_violation\n" +
      "- **Description**: duplicate logic in two services\n" +
      "- **Snippet**: `doWork()`\n" +
      "- **Suggested Fix**: extract helper\n" +
      "EOF\n" +
      "exit 0\n",
      { encoding: "utf-8", mode: 0o755 }
    );

    const result = runScript(auditScript, projectDir, {
      PATH: `${fakeBin}:${process.env.PATH}`,
      NW_PROVIDER_CMD: "claude",
      NW_DEFAULT_BRANCH: "main",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("NIGHT_WATCH_RESULT:success_audit");
    expect(fs.readFileSync(path.join(projectDir, "logs", "audit-report.md"), "utf-8")).toContain("# Code Audit Report");
  });

  it("reviewer worker mode should allow concurrent runs for different target PRs", async () => {
    const projectDir = mkTempDir("nw-smoke-reviewer-worker-parallel-");
    initGitRepo(projectDir);
    fs.mkdirSync(path.join(projectDir, "logs"), { recursive: true });

    const fakeBin = mkTempDir("nw-smoke-reviewer-worker-bin-");

    fs.writeFileSync(
      path.join(fakeBin, "claude"),
      "#!/usr/bin/env bash\nsleep 1\nexit 0\n",
      { encoding: "utf-8", mode: 0o755 }
    );

    fs.writeFileSync(
      path.join(fakeBin, "gh"),
      "#!/usr/bin/env bash\n" +
      "args=\"$*\"\n" +
      "if [[ \"$1\" == \"repo\" && \"$2\" == \"view\" ]]; then\n" +
      "  echo 'owner/repo'\n" +
      "  exit 0\n" +
      "fi\n" +
      "if [[ \"$1\" == \"pr\" && \"$2\" == \"view\" ]]; then\n" +
      "  if [[ \"$args\" == *\"mergeStateStatus\"* ]]; then\n" +
      "    echo 'DIRTY'\n" +
      "  else\n" +
      "    echo '{\"number\":1}'\n" +
      "  fi\n" +
      "  exit 0\n" +
      "fi\n" +
      "if [[ \"$1\" == \"pr\" && \"$2\" == \"list\" ]]; then\n" +
      "  if [[ \"$args\" == *\"number,headRefName\"* ]]; then\n" +
      "    echo -e '25\\tnight-watch/alpha\\n26\\tnight-watch/beta'\n" +
      "  else\n" +
      "    echo -e 'night-watch/alpha\\nnight-watch/beta'\n" +
      "  fi\n" +
      "  exit 0\n" +
      "fi\n" +
      "exit 0\n",
      { encoding: "utf-8", mode: 0o755 }
    );

    const baseEnv = {
      PATH: `${fakeBin}:${process.env.PATH}`,
      NW_PROVIDER_CMD: "claude",
      NW_DEFAULT_BRANCH: "main",
      NW_BRANCH_PATTERNS: "night-watch/",
      NW_AUTO_MERGE: "0",
      NW_REVIEWER_WORKER_MODE: "1",
      NW_REVIEWER_PARALLEL: "0",
    };

    const [worker25, worker26] = await Promise.all([
      runScriptAsync(reviewerScript, projectDir, { ...baseEnv, NW_TARGET_PR: "25" }),
      runScriptAsync(reviewerScript, projectDir, { ...baseEnv, NW_TARGET_PR: "26" }),
    ]);

    expect(worker25.status).toBe(0);
    expect(worker26.status).toBe(0);
    expect(worker25.stdout).toContain("NIGHT_WATCH_RESULT:success_reviewed");
    expect(worker26.stdout).toContain("NIGHT_WATCH_RESULT:success_reviewed");
    expect(worker25.stdout).not.toContain("NIGHT_WATCH_RESULT:skip_locked");
    expect(worker26.stdout).not.toContain("NIGHT_WATCH_RESULT:skip_locked");
  });
});
