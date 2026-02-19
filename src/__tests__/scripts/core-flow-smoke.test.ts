import { afterEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execSync, spawnSync } from "child_process";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../../");
const executorScript = path.join(repoRoot, "scripts", "night-watch-cron.sh");
const reviewerScript = path.join(repoRoot, "scripts", "night-watch-pr-reviewer-cron.sh");

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
});
