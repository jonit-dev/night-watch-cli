import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execSync, spawn, spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../../../../');
const executorScript = path.join(repoRoot, 'scripts', 'night-watch-cron.sh');
const reviewerScript = path.join(repoRoot, 'scripts', 'night-watch-pr-reviewer-cron.sh');
const qaScript = path.join(repoRoot, 'scripts', 'night-watch-qa-cron.sh');
const auditScript = path.join(repoRoot, 'scripts', 'night-watch-audit-cron.sh');

const tempDirs: string[] = [];

function mkTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function runScript(scriptPath: string, projectDir: string, env: NodeJS.ProcessEnv = {}) {
  return spawnSync('bash', [scriptPath, projectDir], {
    cwd: repoRoot,
    env: {
      ...process.env,
      ...env,
    },
    encoding: 'utf-8',
  });
}

function runScriptAsync(
  scriptPath: string,
  projectDir: string,
  env: NodeJS.ProcessEnv = {},
): Promise<{
  status: number | null;
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolve) => {
    const child = spawn('bash', [scriptPath, projectDir], {
      cwd: repoRoot,
      env: {
        ...process.env,
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('close', (status) => {
      resolve({ status, stdout, stderr });
    });
  });
}

function initGitRepo(projectDir: string): void {
  execSync('git init', { cwd: projectDir, stdio: 'ignore' });
  execSync('git config user.email smoke@test.local', { cwd: projectDir, stdio: 'ignore' });
  execSync('git config user.name "Smoke Test"', { cwd: projectDir, stdio: 'ignore' });

  fs.writeFileSync(path.join(projectDir, 'README.md'), '# Smoke\n', 'utf-8');
  execSync('git add .', { cwd: projectDir, stdio: 'ignore' });
  execSync('git commit -m init', { cwd: projectDir, stdio: 'ignore' });

  const currentBranch = execSync('git branch --show-current', {
    cwd: projectDir,
    encoding: 'utf-8',
  }).trim();
  if (currentBranch !== 'main') {
    execSync('git checkout -b main', { cwd: projectDir, stdio: 'ignore' });
  }
}

function createPrd(projectDir: string, name: string): string {
  const prdDir = path.join(projectDir, 'docs', 'PRDs', 'night-watch');
  fs.mkdirSync(path.join(prdDir, 'done'), { recursive: true });
  const prdPath = path.join(prdDir, `${name}.md`);
  fs.writeFileSync(prdPath, `# ${name}\n\nsmoke`, 'utf-8');
  return prdPath;
}

function commitAll(projectDir: string, message: string): void {
  execSync('git add .', { cwd: projectDir, stdio: 'ignore' });
  execSync(`git commit -m "${message.replace(/"/g, "'")}"`, {
    cwd: projectDir,
    stdio: 'ignore',
  });
}

afterEach(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tempDirs.length = 0;
});

describe('core flow smoke tests (bash scripts)', () => {
  it('executor should emit skip marker when no eligible PRDs exist', () => {
    const projectDir = mkTempDir('nw-smoke-executor-skip-');
    fs.mkdirSync(path.join(projectDir, 'logs'), { recursive: true });
    fs.mkdirSync(path.join(projectDir, 'docs', 'PRDs', 'night-watch', 'done'), { recursive: true });

    const result = runScript(executorScript, projectDir);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('NIGHT_WATCH_RESULT:skip_no_eligible_prd');
  });

  it('reviewer should emit skip marker when there are no open PRs', () => {
    const projectDir = mkTempDir('nw-smoke-reviewer-skip-');
    fs.mkdirSync(path.join(projectDir, 'logs'), { recursive: true });

    const result = runScript(reviewerScript, projectDir);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('NIGHT_WATCH_RESULT:skip_no_open_prs');
  });

  it('executor should emit success_open_pr and move PRD to done when PR is detected after provider run', () => {
    const projectDir = mkTempDir('nw-smoke-executor-success-');
    initGitRepo(projectDir);
    createPrd(projectDir, '01-smoke-success');
    commitAll(projectDir, 'add PRD');

    const fakeBin = mkTempDir('nw-smoke-bin-success-');
    const readyFlag = path.join(projectDir, '.smoke-pr-open');
    const branchName = 'night-watch/01-smoke-success';

    fs.writeFileSync(
      path.join(fakeBin, 'claude'),
      '#!/usr/bin/env bash\n' + 'touch "$NW_SMOKE_PR_READY_FILE"\n' + 'exit 0\n',
      { encoding: 'utf-8', mode: 0o755 },
    );

    fs.writeFileSync(
      path.join(fakeBin, 'gh'),
      '#!/usr/bin/env bash\n' +
        'if [[ "$1" == "pr" && "$2" == "list" ]]; then\n' +
        '  state=""\n' +
        '  for ((i=1; i<=$#; i++)); do\n' +
        '    if [[ "${!i}" == "--state" ]]; then\n' +
        '      j=$((i+1))\n' +
        '      state="${!j}"\n' +
        '    fi\n' +
        '  done\n' +
        '  if [[ "$state" == "open" && -f "$NW_SMOKE_PR_READY_FILE" ]]; then\n' +
        '    echo "$NW_SMOKE_BRANCH"\n' +
        '  fi\n' +
        '  exit 0\n' +
        'fi\n' +
        'exit 0\n',
      { encoding: 'utf-8', mode: 0o755 },
    );

    const result = runScript(executorScript, projectDir, {
      PATH: `${fakeBin}:${process.env.PATH}`,
      NW_PROVIDER_CMD: 'claude',
      NW_PRD_DIR: 'docs/PRDs/night-watch',
      NW_DEFAULT_BRANCH: 'main',
      NW_SMOKE_PR_READY_FILE: readyFlag,
      NW_SMOKE_BRANCH: branchName,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('NIGHT_WATCH_RESULT:success_open_pr');
    expect(result.stdout).toContain(`branch=${branchName}`);
  });

  it('executor should emit failure_no_pr_after_success and return non-zero when provider exits 0 but no PR exists', () => {
    const projectDir = mkTempDir('nw-smoke-executor-failure-');
    initGitRepo(projectDir);
    createPrd(projectDir, '01-smoke-failure');
    commitAll(projectDir, 'add PRD');

    const fakeBin = mkTempDir('nw-smoke-bin-failure-');

    fs.writeFileSync(path.join(fakeBin, 'claude'), '#!/usr/bin/env bash\nexit 0\n', {
      encoding: 'utf-8',
      mode: 0o755,
    });

    fs.writeFileSync(
      path.join(fakeBin, 'gh'),
      '#!/usr/bin/env bash\nif [[ "$1" == "pr" && "$2" == "list" ]]; then\n  exit 0\nfi\nexit 0\n',
      { encoding: 'utf-8', mode: 0o755 },
    );

    const result = runScript(executorScript, projectDir, {
      PATH: `${fakeBin}:${process.env.PATH}`,
      NW_PROVIDER_CMD: 'claude',
      NW_PRD_DIR: 'docs/PRDs/night-watch',
      NW_DEFAULT_BRANCH: 'main',
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('NIGHT_WATCH_RESULT:failure_no_pr_after_success');
    expect(
      fs.existsSync(path.join(projectDir, 'docs', 'PRDs', 'night-watch', '01-smoke-failure.md')),
    ).toBe(true);
  });

  it('qa should emit skip marker when no open PRs', () => {
    const projectDir = mkTempDir('nw-smoke-qa-skip-');
    fs.mkdirSync(path.join(projectDir, 'logs'), { recursive: true });

    const result = runScript(qaScript, projectDir);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('NIGHT_WATCH_RESULT:skip_no_open_prs');
  });

  it('qa should emit skip_all_qa_done when all PRs already have QA comments', () => {
    const projectDir = mkTempDir('nw-smoke-qa-all-done-');
    initGitRepo(projectDir);
    fs.mkdirSync(path.join(projectDir, 'logs'), { recursive: true });

    const fakeBin = mkTempDir('nw-smoke-qa-all-done-bin-');

    fs.writeFileSync(
      path.join(fakeBin, 'gh'),
      '#!/usr/bin/env bash\n' +
        'if [[ "$1" == "pr" && "$2" == "list" ]]; then\n' +
        '  echo \'[{"number":1,"headRefName":"feat/qa-done","title":"QA done","labels":[]}]\'\n' +
        '  exit 0\n' +
        'fi\n' +
        'if [[ "$1" == "repo" && "$2" == "view" ]]; then\n' +
        "  echo 'owner/repo'\n" +
        '  exit 0\n' +
        'fi\n' +
        'if [[ "$1" == "pr" && "$2" == "view" ]]; then\n' +
        "  # Return a comment with the QA marker (already QA'd)\n" +
        "  echo '<!-- night-watch-qa-marker -->\\nQA completed successfully'\n" +
        '  exit 0\n' +
        'fi\n' +
        'if [[ "$1" == "api" ]]; then\n' +
        '  # Return empty array for issue comments\n' +
        "  echo '[]'\n" +
        '  exit 0\n' +
        'fi\n' +
        'exit 0\n',
      { encoding: 'utf-8', mode: 0o755 },
    );

    const result = runScript(qaScript, projectDir, {
      PATH: `${fakeBin}:${process.env.PATH}`,
      NW_PROVIDER_CMD: 'claude',
      NW_DEFAULT_BRANCH: 'main',
      NW_BRANCH_PATTERNS: 'feat/',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('NIGHT_WATCH_RESULT:skip_all_qa_done');
  });

  it('qa should emit success_qa when provider completes successfully on all PRs', () => {
    const projectDir = mkTempDir('nw-smoke-qa-success-');
    initGitRepo(projectDir);
    fs.mkdirSync(path.join(projectDir, 'logs'), { recursive: true });

    const fakeBin = mkTempDir('nw-smoke-qa-success-bin-');
    const qaReadyFlag = path.join(projectDir, '.smoke-qa-ready');

    fs.writeFileSync(
      path.join(fakeBin, 'claude'),
      '#!/usr/bin/env bash\n' + 'touch "${NW_SMOKE_QA_READY_FILE}"\n' + 'exit 0\n',
      { encoding: 'utf-8', mode: 0o755 },
    );

    fs.writeFileSync(
      path.join(fakeBin, 'gh'),
      '#!/usr/bin/env bash\n' +
        'args="$*"\n' +
        'qa_comment="<!-- night-watch-qa-marker -->\n' +
        '## Night Watch QA Report\n' +
        '**QA: No tests needed for this PR**"\n' +
        'if [[ "$1" == "pr" && "$2" == "list" ]]; then\n' +
        '  echo \'[{"number":1,"headRefName":"feat/qa-success","title":"QA success","labels":[]}]\'\n' +
        '  exit 0\n' +
        'fi\n' +
        'if [[ "$1" == "repo" && "$2" == "view" ]]; then\n' +
        "  echo 'owner/repo'\n" +
        '  exit 0\n' +
        'fi\n' +
        'if [[ "$1" == "pr" && "$2" == "view" ]]; then\n' +
        '  if [[ -f "${NW_SMOKE_QA_READY_FILE}" && "$args" == *"--json comments"* ]]; then\n' +
        '    printf "%s" "${qa_comment}" | base64 | tr -d "\\n"\n' +
        '    printf "\\n"\n' +
        '    exit 0\n' +
        '  fi\n' +
        '  if [[ "$args" == *"--json files"* ]]; then\n' +
        '    exit 0\n' +
        '  fi\n' +
        '  exit 0\n' +
        'fi\n' +
        'if [[ "$1" == "api" ]]; then\n' +
        '  if [[ -f "${NW_SMOKE_QA_READY_FILE}" ]]; then\n' +
        '    printf "%s" "${qa_comment}" | base64 | tr -d "\\n"\n' +
        '    printf "\\n"\n' +
        '  fi\n' +
        '  exit 0\n' +
        'fi\n' +
        'if [[ "$1" == "pr" && "$2" == "checkout" ]]; then\n' +
        '  exit 0\n' +
        'fi\n' +
        'exit 0\n',
      { encoding: 'utf-8', mode: 0o755 },
    );

    const result = runScript(qaScript, projectDir, {
      PATH: `${fakeBin}:${process.env.PATH}`,
      NW_PROVIDER_CMD: 'claude',
      NW_DEFAULT_BRANCH: 'main',
      NW_BRANCH_PATTERNS: 'feat/',
      NW_SMOKE_QA_READY_FILE: qaReadyFlag,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('NIGHT_WATCH_RESULT:success_qa');
    expect(result.stdout).toContain('prs=#1');
    expect(result.stdout).toContain('repo=owner/repo');
  });

  it('qa should fail when provider exits 0 but does not leave verifiable QA evidence', () => {
    const projectDir = mkTempDir('nw-smoke-qa-missing-evidence-');
    initGitRepo(projectDir);
    fs.mkdirSync(path.join(projectDir, 'logs'), { recursive: true });

    const fakeBin = mkTempDir('nw-smoke-qa-missing-evidence-bin-');

    fs.writeFileSync(path.join(fakeBin, 'claude'), '#!/usr/bin/env bash\nexit 0\n', {
      encoding: 'utf-8',
      mode: 0o755,
    });

    fs.writeFileSync(
      path.join(fakeBin, 'gh'),
      '#!/usr/bin/env bash\n' +
        'if [[ "$1" == "pr" && "$2" == "list" ]]; then\n' +
        '  echo \'[{"number":1,"headRefName":"feat/qa-no-evidence","title":"QA no evidence","labels":[]}]\'\n' +
        '  exit 0\n' +
        'fi\n' +
        'if [[ "$1" == "repo" && "$2" == "view" ]]; then\n' +
        "  echo 'owner/repo'\n" +
        '  exit 0\n' +
        'fi\n' +
        'if [[ "$1" == "pr" && "$2" == "view" ]]; then\n' +
        '  exit 0\n' +
        'fi\n' +
        'if [[ "$1" == "api" ]]; then\n' +
        '  exit 0\n' +
        'fi\n' +
        'if [[ "$1" == "pr" && "$2" == "checkout" ]]; then\n' +
        '  exit 0\n' +
        'fi\n' +
        'exit 0\n',
      { encoding: 'utf-8', mode: 0o755 },
    );

    const result = runScript(qaScript, projectDir, {
      PATH: `${fakeBin}:${process.env.PATH}`,
      NW_PROVIDER_CMD: 'claude',
      NW_DEFAULT_BRANCH: 'main',
      NW_BRANCH_PATTERNS: 'feat/',
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('NIGHT_WATCH_RESULT:failure');
  });

  it('qa should return non-zero when provider fails on a PR', () => {
    const projectDir = mkTempDir('nw-smoke-qa-failure-');
    initGitRepo(projectDir);
    fs.mkdirSync(path.join(projectDir, 'logs'), { recursive: true });

    const fakeBin = mkTempDir('nw-smoke-qa-failure-bin-');

    fs.writeFileSync(path.join(fakeBin, 'claude'), '#!/usr/bin/env bash\nexit 42\n', {
      encoding: 'utf-8',
      mode: 0o755,
    });

    fs.writeFileSync(
      path.join(fakeBin, 'gh'),
      '#!/usr/bin/env bash\n' +
        'if [[ "$1" == "pr" && "$2" == "list" ]]; then\n' +
        '  echo \'[{"number":1,"headRefName":"feat/qa-fail","title":"QA fail","labels":[]}]\'\n' +
        '  exit 0\n' +
        'fi\n' +
        'if [[ "$1" == "repo" && "$2" == "view" ]]; then\n' +
        "  echo 'owner/repo'\n" +
        '  exit 0\n' +
        'fi\n' +
        'if [[ "$1" == "pr" && "$2" == "view" ]]; then\n' +
        '  exit 0\n' +
        'fi\n' +
        'if [[ "$1" == "api" ]]; then\n' +
        "  echo '[]'\n" +
        '  exit 0\n' +
        'fi\n' +
        'if [[ "$1" == "pr" && "$2" == "checkout" ]]; then\n' +
        '  exit 0\n' +
        'fi\n' +
        'exit 0\n',
      { encoding: 'utf-8', mode: 0o755 },
    );

    const result = runScript(qaScript, projectDir, {
      PATH: `${fakeBin}:${process.env.PATH}`,
      NW_PROVIDER_CMD: 'claude',
      NW_DEFAULT_BRANCH: 'main',
      NW_BRANCH_PATTERNS: 'feat/',
    });

    expect(result.status).toBe(42);
    expect(result.stdout).toContain('NIGHT_WATCH_RESULT:failure');
  });

  it('audit should fail when provider exits 0 without producing a report', () => {
    const projectDir = mkTempDir('nw-smoke-audit-missing-report-');
    initGitRepo(projectDir);
    fs.mkdirSync(path.join(projectDir, 'logs'), { recursive: true });

    const fakeBin = mkTempDir('nw-smoke-audit-missing-report-bin-');
    fs.writeFileSync(
      path.join(fakeBin, 'claude'),
      '#!/usr/bin/env bash\n' + "echo 'Unknown skill: night-watch-audit' >&2\n" + 'exit 0\n',
      { encoding: 'utf-8', mode: 0o755 },
    );

    const result = runScript(auditScript, projectDir, {
      PATH: `${fakeBin}:${process.env.PATH}`,
      NW_PROVIDER_CMD: 'claude',
      NW_DEFAULT_BRANCH: 'main',
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('NIGHT_WATCH_RESULT:failure_no_report');
    expect(fs.existsSync(path.join(projectDir, 'logs', 'audit-report.md'))).toBe(false);
  });

  it('audit should emit skip_clean when report contains NO_ISSUES_FOUND', () => {
    const projectDir = mkTempDir('nw-smoke-audit-clean-');
    initGitRepo(projectDir);
    fs.mkdirSync(path.join(projectDir, 'logs'), { recursive: true });

    const fakeBin = mkTempDir('nw-smoke-audit-clean-bin-');
    fs.writeFileSync(
      path.join(fakeBin, 'claude'),
      '#!/usr/bin/env bash\n' +
        'mkdir -p logs\n' +
        "printf 'NO_ISSUES_FOUND\\n' > logs/audit-report.md\n" +
        'exit 0\n',
      { encoding: 'utf-8', mode: 0o755 },
    );

    const result = runScript(auditScript, projectDir, {
      PATH: `${fakeBin}:${process.env.PATH}`,
      NW_PROVIDER_CMD: 'claude',
      NW_DEFAULT_BRANCH: 'main',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('NIGHT_WATCH_RESULT:skip_clean');
    expect(fs.readFileSync(path.join(projectDir, 'logs', 'audit-report.md'), 'utf-8')).toContain(
      'NO_ISSUES_FOUND',
    );
  });

  it('audit should emit success_audit when provider writes findings report', () => {
    const projectDir = mkTempDir('nw-smoke-audit-success-');
    initGitRepo(projectDir);
    fs.mkdirSync(path.join(projectDir, 'logs'), { recursive: true });

    const fakeBin = mkTempDir('nw-smoke-audit-success-bin-');
    fs.writeFileSync(
      path.join(fakeBin, 'claude'),
      '#!/usr/bin/env bash\n' +
        'mkdir -p logs\n' +
        "cat <<'EOF' > logs/audit-report.md\n" +
        '# Code Audit Report\n' +
        '\n' +
        'Generated: 2026-02-20T00:00:00.000Z\n' +
        '\n' +
        '## Findings\n' +
        '\n' +
        '### Finding 1\n' +
        '- **Location**: `src/example.ts:1`\n' +
        '- **Severity**: medium\n' +
        '- **Category**: dry_violation\n' +
        '- **Description**: duplicate logic in two services\n' +
        '- **Snippet**: `doWork()`\n' +
        '- **Suggested Fix**: extract helper\n' +
        'EOF\n' +
        'exit 0\n',
      { encoding: 'utf-8', mode: 0o755 },
    );

    const result = runScript(auditScript, projectDir, {
      PATH: `${fakeBin}:${process.env.PATH}`,
      NW_PROVIDER_CMD: 'claude',
      NW_DEFAULT_BRANCH: 'main',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('NIGHT_WATCH_RESULT:success_audit');
    expect(fs.readFileSync(path.join(projectDir, 'logs', 'audit-report.md'), 'utf-8')).toContain(
      '# Code Audit Report',
    );
  });

  it('reviewer worker mode should allow concurrent runs for different target PRs', async () => {
    const projectDir = mkTempDir('nw-smoke-reviewer-worker-parallel-');
    initGitRepo(projectDir);
    fs.mkdirSync(path.join(projectDir, 'logs'), { recursive: true });

    const fakeBin = mkTempDir('nw-smoke-reviewer-worker-bin-');

    fs.writeFileSync(path.join(fakeBin, 'claude'), '#!/usr/bin/env bash\nsleep 1\nexit 0\n', {
      encoding: 'utf-8',
      mode: 0o755,
    });

    fs.writeFileSync(
      path.join(fakeBin, 'gh'),
      '#!/usr/bin/env bash\n' +
        'args="$*"\n' +
        'if [[ "$1" == "repo" && "$2" == "view" ]]; then\n' +
        "  echo 'owner/repo'\n" +
        '  exit 0\n' +
        'fi\n' +
        'if [[ "$1" == "pr" && "$2" == "view" ]]; then\n' +
        '  if [[ "$args" == *"mergeStateStatus"* ]]; then\n' +
        "    echo 'DIRTY'\n" +
        '  else\n' +
        '    echo \'{"number":1}\'\n' +
        '  fi\n' +
        '  exit 0\n' +
        'fi\n' +
        'if [[ "$1" == "pr" && "$2" == "list" ]]; then\n' +
        '  if [[ "$args" == *"number,headRefName"* ]]; then\n' +
        "    echo -e '25\\tnight-watch/alpha\\n26\\tnight-watch/beta'\n" +
        '  else\n' +
        "    echo -e 'night-watch/alpha\\nnight-watch/beta'\n" +
        '  fi\n' +
        '  exit 0\n' +
        'fi\n' +
        'exit 0\n',
      { encoding: 'utf-8', mode: 0o755 },
    );

    const baseEnv = {
      PATH: `${fakeBin}:${process.env.PATH}`,
      NW_PROVIDER_CMD: 'claude',
      NW_DEFAULT_BRANCH: 'main',
      NW_BRANCH_PATTERNS: 'night-watch/',
      NW_AUTO_MERGE: '0',
      NW_REVIEWER_WORKER_MODE: '1',
      NW_REVIEWER_PARALLEL: '0',
    };

    const [worker25, worker26] = await Promise.all([
      runScriptAsync(reviewerScript, projectDir, { ...baseEnv, NW_TARGET_PR: '25' }),
      runScriptAsync(reviewerScript, projectDir, { ...baseEnv, NW_TARGET_PR: '26' }),
    ]);

    expect(worker25.status).toBe(0);
    expect(worker26.status).toBe(0);
    expect(worker25.stdout).toContain('NIGHT_WATCH_RESULT:success_reviewed');
    expect(worker26.stdout).toContain('NIGHT_WATCH_RESULT:success_reviewed');
    expect(worker25.stdout).not.toContain('NIGHT_WATCH_RESULT:skip_locked');
    expect(worker26.stdout).not.toContain('NIGHT_WATCH_RESULT:skip_locked');
  });

  it('executor should emit success_already_merged when PR is already merged before execution', () => {
    const projectDir = mkTempDir('nw-smoke-executor-already-merged-');
    initGitRepo(projectDir);
    createPrd(projectDir, '01-smoke-already-merged');
    commitAll(projectDir, 'add PRD');

    const fakeBin = mkTempDir('nw-smoke-bin-already-merged-');
    const branchName = 'night-watch/01-smoke-already-merged';

    fs.writeFileSync(path.join(fakeBin, 'claude'), '#!/usr/bin/env bash\nexit 0\n', {
      encoding: 'utf-8',
      mode: 0o755,
    });

    fs.writeFileSync(
      path.join(fakeBin, 'gh'),
      '#!/usr/bin/env bash\n' +
        'args="$*"\n' +
        'if [[ "$1" == "pr" && "$2" == "list" ]]; then\n' +
        '  # Check for merged PRs first (before execution check at line 285)\n' +
        '  if [[ "$args" == *"--state"*"merged"* ]]; then\n' +
        '    echo "${NW_SMOKE_BRANCH}"\n' +
        '    exit 0\n' +
        '  fi\n' +
        '  exit 0\n' +
        'fi\n' +
        'exit 0\n',
      { encoding: 'utf-8', mode: 0o755 },
    );

    const result = runScript(executorScript, projectDir, {
      PATH: `${fakeBin}:${process.env.PATH}`,
      NW_PROVIDER_CMD: 'claude',
      NW_PRD_DIR: 'docs/PRDs/night-watch',
      NW_DEFAULT_BRANCH: 'main',
      NW_SMOKE_BRANCH: branchName,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('NIGHT_WATCH_RESULT:success_already_merged');
    expect(result.stdout).toContain(`branch=${branchName}`);
  });

  it('executor should emit failure_finalize when finalize_prd_done fails after provider success', () => {
    const projectDir = mkTempDir('nw-smoke-executor-finalize-fail-');
    initGitRepo(projectDir);
    createPrd(projectDir, '01-smoke-finalize-fail');
    commitAll(projectDir, 'add PRD');

    const fakeBin = mkTempDir('nw-smoke-bin-finalize-fail-');
    const branchName = 'night-watch/01-smoke-finalize-fail';
    const readyFlag = path.join(projectDir, '.smoke-pr-open');

    // Mock claude to succeed and create PR
    fs.writeFileSync(
      path.join(fakeBin, 'claude'),
      '#!/usr/bin/env bash\n' + 'touch "$NW_SMOKE_PR_READY_FILE"\n' + 'exit 0\n',
      { encoding: 'utf-8', mode: 0o755 },
    );

    // Mock gh to report an open PR
    fs.writeFileSync(
      path.join(fakeBin, 'gh'),
      '#!/usr/bin/env bash\n' +
        'args="$*"\n' +
        'if [[ "$1" == "pr" && "$2" == "list" ]]; then\n' +
        '  state=""\n' +
        '  for ((i=1; i<=$#; i++)); do\n' +
        '    if [[ "${!i}" == "--state" ]]; then\n' +
        '      j=$((i+1))\n' +
        '      state="${!j}"\n' +
        '    fi\n' +
        '  done\n' +
        '  # Return open PR after provider success\n' +
        '  if [[ "$state" == "open" && -f "$NW_SMOKE_PR_READY_FILE" ]]; then\n' +
        '    echo "$NW_SMOKE_BRANCH"\n' +
        '    exit 0\n' +
        '  fi\n' +
        '  exit 0\n' +
        'fi\n' +
        'exit 0\n',
      { encoding: 'utf-8', mode: 0o755 },
    );

    // Mock git to fail on worktree add for bookkeeping operations
    // The bookkeeping worktree uses --detach flag
    fs.writeFileSync(
      path.join(fakeBin, 'git'),
      '#!/usr/bin/env bash\n' +
        'REAL_GIT="/usr/bin/git"\n' +
        'args="$*"\n' +
        '# Fail on worktree add for bookkeeping (detached) worktrees\n' +
        'if [[ "$1" == "-C" && "$3" == "worktree" && "$4" == "add" && "$args" == *"--detach"* ]]; then\n' +
        '  echo "error: mock git worktree add failed" >&2\n' +
        '  exit 1\n' +
        'fi\n' +
        '# Delegate to real git for everything else\n' +
        'exec "$REAL_GIT" "$@"\n',
      { encoding: 'utf-8', mode: 0o755 },
    );

    const result = runScript(executorScript, projectDir, {
      PATH: `${fakeBin}:${process.env.PATH}`,
      NW_PROVIDER_CMD: 'claude',
      NW_PRD_DIR: 'docs/PRDs/night-watch',
      NW_DEFAULT_BRANCH: 'main',
      NW_SMOKE_PR_READY_FILE: readyFlag,
      NW_SMOKE_BRANCH: branchName,
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('NIGHT_WATCH_RESULT:failure_finalize');
    expect(result.stdout).toContain(`branch=${branchName}`);
  });

  it('executor should emit failure when provider exits with non-zero code', () => {
    const projectDir = mkTempDir('nw-smoke-executor-provider-fail-');
    initGitRepo(projectDir);
    createPrd(projectDir, '01-smoke-provider-fail');
    commitAll(projectDir, 'add PRD');

    const fakeBin = mkTempDir('nw-smoke-bin-provider-fail-');
    const branchName = 'night-watch/01-smoke-provider-fail';

    fs.writeFileSync(
      path.join(fakeBin, 'claude'),
      '#!/usr/bin/env bash\n' + "echo 'Error: provider failed' >&2\n" + 'exit 1\n',
      { encoding: 'utf-8', mode: 0o755 },
    );

    fs.writeFileSync(path.join(fakeBin, 'gh'), '#!/usr/bin/env bash\nexit 0\n', {
      encoding: 'utf-8',
      mode: 0o755,
    });

    const result = runScript(executorScript, projectDir, {
      PATH: `${fakeBin}:${process.env.PATH}`,
      NW_PROVIDER_CMD: 'claude',
      NW_PRD_DIR: 'docs/PRDs/night-watch',
      NW_DEFAULT_BRANCH: 'main',
      NW_SMOKE_BRANCH: branchName,
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('NIGHT_WATCH_RESULT:failure');
    expect(result.stdout).toContain(`prd=01-smoke-provider-fail.md`);
    expect(result.stdout).toContain(`branch=${branchName}`);
  });

  it('executor should emit timeout when provider exceeds NW_MAX_RUNTIME', () => {
    const projectDir = mkTempDir('nw-smoke-executor-timeout-');
    initGitRepo(projectDir);
    createPrd(projectDir, '01-smoke-timeout');
    commitAll(projectDir, 'add PRD');

    const fakeBin = mkTempDir('nw-smoke-bin-executor-timeout-');
    const branchName = 'night-watch/01-smoke-timeout';

    // Mock provider that sleeps longer than the timeout (2 seconds vs 1 second timeout)
    fs.writeFileSync(path.join(fakeBin, 'claude'), '#!/usr/bin/env bash\nsleep 2\nexit 0\n', {
      encoding: 'utf-8',
      mode: 0o755,
    });

    fs.writeFileSync(path.join(fakeBin, 'gh'), '#!/usr/bin/env bash\nexit 0\n', {
      encoding: 'utf-8',
      mode: 0o755,
    });

    const result = runScript(executorScript, projectDir, {
      PATH: `${fakeBin}:${process.env.PATH}`,
      NW_PROVIDER_CMD: 'claude',
      NW_PRD_DIR: 'docs/PRDs/night-watch',
      NW_DEFAULT_BRANCH: 'main',
      NW_MAX_RUNTIME: '1',
      NW_SMOKE_BRANCH: branchName,
    });

    expect(result.status).toBe(124);
    expect(result.stdout).toContain('NIGHT_WATCH_RESULT:timeout');
    expect(result.stdout).toContain(`prd=01-smoke-timeout.md`);
    expect(result.stdout).toContain(`branch=${branchName}`);
  });

  it('reviewer should emit timeout when provider exceeds NW_REVIEWER_MAX_RUNTIME', () => {
    const projectDir = mkTempDir('nw-smoke-reviewer-timeout-');
    initGitRepo(projectDir);
    fs.mkdirSync(path.join(projectDir, 'logs'), { recursive: true });

    const fakeBin = mkTempDir('nw-smoke-reviewer-timeout-bin-');

    // Mock provider that sleeps longer than the timeout (2 seconds vs 1 second timeout)
    fs.writeFileSync(path.join(fakeBin, 'claude'), '#!/usr/bin/env bash\nsleep 2\nexit 0\n', {
      encoding: 'utf-8',
      mode: 0o755,
    });

    // Mock gh CLI - returns TSV for pr list with --jq flag (as if jq transformation already applied)
    fs.writeFileSync(
      path.join(fakeBin, 'gh'),
      '#!/usr/bin/env bash\n' +
        'args="$*"\n' +
        'if [[ "$1" == "repo" && "$2" == "view" ]]; then\n' +
        "  echo 'owner/repo'\n" +
        '  exit 0\n' +
        'fi\n' +
        'if [[ "$1" == "pr" && "$2" == "view" ]]; then\n' +
        '  if [[ "$args" == *"mergeStateStatus"* ]]; then\n' +
        "    echo 'DIRTY'\n" +
        '  else\n' +
        '    echo \'{"number":1}\'\n' +
        '  fi\n' +
        '  exit 0\n' +
        'fi\n' +
        'if [[ "$1" == "pr" && "$2" == "list" ]]; then\n' +
        '  if [[ "$args" == *"number,headRefName"* ]]; then\n' +
        '    # Return TSV format since the script uses --jq to transform JSON to TSV\n' +
        "    printf '1\\tnight-watch/timeout-test\\n'\n" +
        '  else\n' +
        "    echo 'night-watch/timeout-test'\n" +
        '  fi\n' +
        '  exit 0\n' +
        'fi\n' +
        'if [[ "$1" == "pr" && "$2" == "checks" ]]; then\n' +
        "  echo 'fail 1/1 checks'\n" +
        '  exit 1\n' +
        'fi\n' +
        'exit 0\n',
      { encoding: 'utf-8', mode: 0o755 },
    );

    const result = runScript(reviewerScript, projectDir, {
      PATH: `${fakeBin}:${process.env.PATH}`,
      NW_PROVIDER_CMD: 'claude',
      NW_DEFAULT_BRANCH: 'main',
      NW_BRANCH_PATTERNS: 'night-watch/',
      NW_REVIEWER_MAX_RUNTIME: '1',
      NW_REVIEWER_WORKER_MODE: '0',
      NW_REVIEWER_PARALLEL: '0',
      NW_AUTO_MERGE: '0',
    });

    // Note: Reviewer script currently exits 0 on timeout (missing explicit exit code)
    // The timeout is still emitted in stdout
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('NIGHT_WATCH_RESULT:timeout');
  });

  it('qa should emit timeout when provider exceeds NW_QA_MAX_RUNTIME', () => {
    const projectDir = mkTempDir('nw-smoke-qa-timeout-');
    initGitRepo(projectDir);
    fs.mkdirSync(path.join(projectDir, 'logs'), { recursive: true });

    const fakeBin = mkTempDir('nw-smoke-qa-timeout-bin-');

    // Mock provider that sleeps longer than the timeout (2 seconds vs 1 second timeout)
    fs.writeFileSync(path.join(fakeBin, 'claude'), '#!/usr/bin/env bash\nsleep 2\nexit 0\n', {
      encoding: 'utf-8',
      mode: 0o755,
    });

    fs.writeFileSync(
      path.join(fakeBin, 'gh'),
      '#!/usr/bin/env bash\n' +
        'if [[ "$1" == "pr" && "$2" == "list" ]]; then\n' +
        '  echo \'[{"number":1,"headRefName":"feat/qa-timeout","title":"QA timeout","labels":[]}]\'\n' +
        '  exit 0\n' +
        'fi\n' +
        'if [[ "$1" == "repo" && "$2" == "view" ]]; then\n' +
        "  echo 'owner/repo'\n" +
        '  exit 0\n' +
        'fi\n' +
        'if [[ "$1" == "pr" && "$2" == "view" ]]; then\n' +
        '  echo \'{"number":1}\'\n' +
        '  exit 0\n' +
        'fi\n' +
        'if [[ "$1" == "api" ]]; then\n' +
        "  echo '[]'\n" +
        '  exit 0\n' +
        'fi\n' +
        'if [[ "$1" == "pr" && "$2" == "checkout" ]]; then\n' +
        '  exit 0\n' +
        'fi\n' +
        'exit 0\n',
      { encoding: 'utf-8', mode: 0o755 },
    );

    const result = runScript(qaScript, projectDir, {
      PATH: `${fakeBin}:${process.env.PATH}`,
      NW_PROVIDER_CMD: 'claude',
      NW_DEFAULT_BRANCH: 'main',
      NW_BRANCH_PATTERNS: 'feat/',
      NW_QA_MAX_RUNTIME: '1',
    });

    expect(result.status).toBe(124);
    expect(result.stdout).toContain('NIGHT_WATCH_RESULT:timeout');
  });

  it('audit should emit timeout when provider exceeds NW_AUDIT_MAX_RUNTIME', () => {
    const projectDir = mkTempDir('nw-smoke-audit-timeout-');
    initGitRepo(projectDir);
    fs.mkdirSync(path.join(projectDir, 'logs'), { recursive: true });

    const fakeBin = mkTempDir('nw-smoke-audit-timeout-bin-');

    // Mock provider that sleeps longer than the timeout (2 seconds vs 1 second timeout)
    fs.writeFileSync(path.join(fakeBin, 'claude'), '#!/usr/bin/env bash\nsleep 2\nexit 0\n', {
      encoding: 'utf-8',
      mode: 0o755,
    });

    const result = runScript(auditScript, projectDir, {
      PATH: `${fakeBin}:${process.env.PATH}`,
      NW_PROVIDER_CMD: 'claude',
      NW_DEFAULT_BRANCH: 'main',
      NW_AUDIT_MAX_RUNTIME: '1',
    });

    expect(result.status).toBe(124);
    expect(result.stdout).toContain('NIGHT_WATCH_RESULT:timeout');
  });

  it('executor should emit skip_locked when lock file exists with active process', () => {
    const projectDir = mkTempDir('nw-smoke-executor-locked-');
    fs.mkdirSync(path.join(projectDir, 'logs'), { recursive: true });

    // Calculate the lock file path the same way the script does
    // project_runtime_key uses: projectname-sha1hash (first 12 chars of hash)
    const projectName = path.basename(projectDir);
    const crypto = require('crypto');
    const projectHash = crypto.createHash('sha1').update(projectDir).digest('hex').slice(0, 12);
    const runtimeKey = `${projectName}-${projectHash}`;
    const lockFile = `/tmp/night-watch-${runtimeKey}.lock`;

    // Start a long-running process to hold the lock
    const holder = spawn('sleep', ['infinity'], { detached: true, stdio: 'ignore' });
    fs.writeFileSync(lockFile, String(holder.pid), 'utf-8');

    try {
      const result = runScript(executorScript, projectDir);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('NIGHT_WATCH_RESULT:skip_locked');
    } finally {
      // Clean up: kill the holder process and remove lock file
      holder.kill();
      fs.rmSync(lockFile, { force: true });
    }
  });

  it('reviewer should emit skip_locked when lock file exists with active process', () => {
    const projectDir = mkTempDir('nw-smoke-reviewer-locked-');
    fs.mkdirSync(path.join(projectDir, 'logs'), { recursive: true });

    // Calculate the lock file path
    const projectName = path.basename(projectDir);
    const crypto = require('crypto');
    const projectHash = crypto.createHash('sha1').update(projectDir).digest('hex').slice(0, 12);
    const runtimeKey = `${projectName}-${projectHash}`;
    const lockFile = `/tmp/night-watch-pr-reviewer-${runtimeKey}.lock`;

    // Start a long-running process to hold the lock
    const holder = spawn('sleep', ['infinity'], { detached: true, stdio: 'ignore' });
    fs.writeFileSync(lockFile, String(holder.pid), 'utf-8');

    try {
      const result = runScript(reviewerScript, projectDir);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('NIGHT_WATCH_RESULT:skip_locked');
    } finally {
      // Clean up: kill the holder process and remove lock file
      holder.kill();
      fs.rmSync(lockFile, { force: true });
    }
  });

  it('qa should emit skip_locked when lock file exists with active process', () => {
    const projectDir = mkTempDir('nw-smoke-qa-locked-');
    fs.mkdirSync(path.join(projectDir, 'logs'), { recursive: true });

    // Calculate the lock file path
    const projectName = path.basename(projectDir);
    const crypto = require('crypto');
    const projectHash = crypto.createHash('sha1').update(projectDir).digest('hex').slice(0, 12);
    const runtimeKey = `${projectName}-${projectHash}`;
    const lockFile = `/tmp/night-watch-qa-${runtimeKey}.lock`;

    // Start a long-running process to hold the lock
    const holder = spawn('sleep', ['infinity'], { detached: true, stdio: 'ignore' });
    fs.writeFileSync(lockFile, String(holder.pid), 'utf-8');

    try {
      const result = runScript(qaScript, projectDir);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('NIGHT_WATCH_RESULT:skip_locked');
    } finally {
      // Clean up: kill the holder process and remove lock file
      holder.kill();
      fs.rmSync(lockFile, { force: true });
    }
  });

  it('audit should emit skip_locked when lock file exists with active process', () => {
    const projectDir = mkTempDir('nw-smoke-audit-locked-');
    initGitRepo(projectDir);
    fs.mkdirSync(path.join(projectDir, 'logs'), { recursive: true });

    // Calculate the lock file path
    const projectName = path.basename(projectDir);
    const crypto = require('crypto');
    const projectHash = crypto.createHash('sha1').update(projectDir).digest('hex').slice(0, 12);
    const runtimeKey = `${projectName}-${projectHash}`;
    const lockFile = `/tmp/night-watch-audit-${runtimeKey}.lock`;

    // Start a long-running process to hold the lock
    const holder = spawn('sleep', ['infinity'], { detached: true, stdio: 'ignore' });
    fs.writeFileSync(lockFile, String(holder.pid), 'utf-8');

    try {
      const result = runScript(auditScript, projectDir);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('NIGHT_WATCH_RESULT:skip_locked');
    } finally {
      // Clean up: kill the holder process and remove lock file
      holder.kill();
      fs.rmSync(lockFile, { force: true });
    }
  });

  it('reviewer should emit skip_all_passing when all PRs have passing CI and review scores', () => {
    const projectDir = mkTempDir('nw-smoke-reviewer-all-passing-');
    initGitRepo(projectDir);
    fs.mkdirSync(path.join(projectDir, 'logs'), { recursive: true });

    const fakeBin = mkTempDir('nw-smoke-reviewer-all-passing-bin-');

    fs.writeFileSync(
      path.join(fakeBin, 'gh'),
      '#!/usr/bin/env bash\n' +
        'args="$*"\n' +
        'if [[ "$1" == "repo" && "$2" == "view" ]]; then\n' +
        "  echo 'owner/repo'\n" +
        '  exit 0\n' +
        'fi\n' +
        'if [[ "$1" == "pr" && "$2" == "view" ]]; then\n' +
        '  # Return CLEAN merge state (no conflicts)\n' +
        '  if [[ "$args" == *"mergeStateStatus"* ]]; then\n' +
        "    echo 'CLEAN'\n" +
        '  else\n' +
        '    echo \'{"number":1}\'\n' +
        '  fi\n' +
        '  exit 0\n' +
        'fi\n' +
        'if [[ "$1" == "pr" && "$2" == "list" ]]; then\n' +
        '  if [[ "$args" == *"number,headRefName"* ]]; then\n' +
        '    # Return TSV format for PR list\n' +
        "    printf '1\\tnight-watch/passing-pr\\n'\n" +
        '  else\n' +
        "    echo 'night-watch/passing-pr'\n" +
        '  fi\n' +
        '  exit 0\n' +
        'fi\n' +
        'if [[ "$1" == "pr" && "$2" == "checks" ]]; then\n' +
        '  # All checks passing (exit 0)\n' +
        '  exit 0\n' +
        'fi\n' +
        'if [[ "$1" == "api" ]]; then\n' +
        '  # Return a comment with a passing review score (>=80)\n' +
        '  echo \'[{"body": "Overall Score: 85/100"}]\'\n' +
        '  exit 0\n' +
        'fi\n' +
        'exit 0\n',
      { encoding: 'utf-8', mode: 0o755 },
    );

    const result = runScript(reviewerScript, projectDir, {
      PATH: `${fakeBin}:${process.env.PATH}`,
      NW_PROVIDER_CMD: 'claude',
      NW_DEFAULT_BRANCH: 'main',
      NW_BRANCH_PATTERNS: 'night-watch/',
      NW_MIN_REVIEW_SCORE: '80',
      NW_AUTO_MERGE: '0',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('NIGHT_WATCH_RESULT:skip_all_passing');
  });

  it('reviewer should treat failed executor/qa/audit checks as needing work', () => {
    const projectDir = mkTempDir('nw-smoke-reviewer-nonstandard-ci-fail-');
    initGitRepo(projectDir);
    fs.mkdirSync(path.join(projectDir, 'logs'), { recursive: true });

    const fakeBin = mkTempDir('nw-smoke-reviewer-nonstandard-ci-fail-bin-');

    fs.writeFileSync(
      path.join(fakeBin, 'gh'),
      '#!/usr/bin/env bash\n' +
        'args="$*"\n' +
        'if [[ "$1" == "repo" && "$2" == "view" ]]; then\n' +
        "  echo 'owner/repo'\n" +
        '  exit 0\n' +
        'fi\n' +
        'if [[ "$1" == "pr" && "$2" == "view" ]]; then\n' +
        '  # No merge conflicts for this PR\n' +
        '  if [[ "$args" == *"mergeStateStatus"* ]]; then\n' +
        "    echo 'CLEAN'\n" +
        '  else\n' +
        '    echo \'{"number":1}\'\n' +
        '  fi\n' +
        '  exit 0\n' +
        'fi\n' +
        'if [[ "$1" == "pr" && "$2" == "list" ]]; then\n' +
        '  if [[ "$args" == *"number,headRefName"* ]]; then\n' +
        "    printf '1\\tnight-watch/nonstandard-check-failure\\n'\n" +
        '  else\n' +
        "    echo 'night-watch/nonstandard-check-failure'\n" +
        '  fi\n' +
        '  exit 0\n' +
        'fi\n' +
        'if [[ "$1" == "pr" && "$2" == "checks" ]]; then\n' +
        '  if [[ "$args" == *"--json bucket,state,conclusion"* ]]; then\n' +
        '    # Simulate three failed non-standard checks (executor/qa/audit)\n' +
        "    echo '3'\n" +
        '    exit 0\n' +
        '  fi\n' +
        '  if [[ "$args" == *"--json name,bucket,state,conclusion"* ]]; then\n' +
        "    echo 'executor [state=completed, conclusion=failure]; qa [state=completed, conclusion=failure]; audit [state=completed, conclusion=failure]'\n" +
        '    exit 0\n' +
        '  fi\n' +
        '  # Legacy plain-text output intentionally avoids the word "fail" to\n' +
        '  # ensure JSON-based detection is the deciding path.\n' +
        "  echo 'executor/qa/audit checks red'\n" +
        '  exit 1\n' +
        'fi\n' +
        'if [[ "$1" == "api" ]]; then\n' +
        "  echo '[]'\n" +
        '  exit 0\n' +
        'fi\n' +
        'exit 0\n',
      { encoding: 'utf-8', mode: 0o755 },
    );

    const result = runScript(reviewerScript, projectDir, {
      PATH: `${fakeBin}:${process.env.PATH}`,
      NW_PROVIDER_CMD: 'claude',
      NW_DEFAULT_BRANCH: 'main',
      NW_BRANCH_PATTERNS: 'night-watch/',
      NW_MIN_REVIEW_SCORE: '80',
      NW_AUTO_MERGE: '0',
      NW_DRY_RUN: '1',
      NW_REVIEWER_PARALLEL: '0',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('=== Dry Run: PR Reviewer ===');
    expect(result.stdout).toContain('Open PRs needing work:#1');
    expect(result.stdout).not.toContain('NIGHT_WATCH_RESULT:skip_all_passing');
  });

  it('reviewer should emit failure when provider exits with non-zero code', () => {
    const projectDir = mkTempDir('nw-smoke-reviewer-failure-');
    initGitRepo(projectDir);
    fs.mkdirSync(path.join(projectDir, 'logs'), { recursive: true });

    const fakeBin = mkTempDir('nw-smoke-reviewer-failure-bin-');

    // Mock provider that exits with non-zero code
    fs.writeFileSync(
      path.join(fakeBin, 'claude'),
      '#!/usr/bin/env bash\n' + "echo 'Error: provider failed' >&2\n" + 'exit 1\n',
      { encoding: 'utf-8', mode: 0o755 },
    );

    // Mock gh CLI - returns PRs that need work (DIRTY merge state)
    fs.writeFileSync(
      path.join(fakeBin, 'gh'),
      '#!/usr/bin/env bash\n' +
        'args="$*"\n' +
        'if [[ "$1" == "repo" && "$2" == "view" ]]; then\n' +
        "  echo 'owner/repo'\n" +
        '  exit 0\n' +
        'fi\n' +
        'if [[ "$1" == "pr" && "$2" == "view" ]]; then\n' +
        '  if [[ "$args" == *"mergeStateStatus"* ]]; then\n' +
        "    echo 'DIRTY'\n" +
        '  else\n' +
        '    echo \'{"number":1}\'\n' +
        '  fi\n' +
        '  exit 0\n' +
        'fi\n' +
        'if [[ "$1" == "pr" && "$2" == "list" ]]; then\n' +
        '  if [[ "$args" == *"number,headRefName"* ]]; then\n' +
        "    printf '1\\tnight-watch/failure-test\\n'\n" +
        '  else\n' +
        "    echo 'night-watch/failure-test'\n" +
        '  fi\n' +
        '  exit 0\n' +
        'fi\n' +
        'if [[ "$1" == "pr" && "$2" == "checks" ]]; then\n' +
        "  echo 'fail 1/1 checks'\n" +
        '  exit 1\n' +
        'fi\n' +
        'exit 0\n',
      { encoding: 'utf-8', mode: 0o755 },
    );

    const result = runScript(reviewerScript, projectDir, {
      PATH: `${fakeBin}:${process.env.PATH}`,
      NW_PROVIDER_CMD: 'claude',
      NW_DEFAULT_BRANCH: 'main',
      NW_BRANCH_PATTERNS: 'night-watch/',
      NW_REVIEWER_WORKER_MODE: '0',
      NW_REVIEWER_PARALLEL: '0',
      NW_AUTO_MERGE: '0',
    });

    // Note: Reviewer script currently exits 0 on failure (missing explicit exit code propagation)
    // The failure is still emitted in stdout via emit_final_status
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('NIGHT_WATCH_RESULT:failure');
  });

  it('reviewer should invoke codex with exec syntax when reviewer provider is codex', () => {
    const projectDir = mkTempDir('nw-smoke-reviewer-codex-argv-');
    initGitRepo(projectDir);
    fs.mkdirSync(path.join(projectDir, 'logs'), { recursive: true });

    const fakeBin = mkTempDir('nw-smoke-reviewer-codex-argv-bin-');
    const argsFile = path.join(projectDir, '.codex-argv');

    fs.writeFileSync(
      path.join(fakeBin, 'codex'),
      '#!/usr/bin/env bash\n' +
        'printf \'%s\\0\' "$@" > "$NW_SMOKE_ARGS_FILE"\n' +
        'echo "codex stub invoked" >&2\n' +
        'exit 1\n',
      { encoding: 'utf-8', mode: 0o755 },
    );

    fs.writeFileSync(
      path.join(fakeBin, 'gh'),
      '#!/usr/bin/env bash\n' +
        'args="$*"\n' +
        'if [[ "$1" == "repo" && "$2" == "view" ]]; then\n' +
        "  echo 'owner/repo'\n" +
        '  exit 0\n' +
        'fi\n' +
        'if [[ "$1" == "pr" && "$2" == "view" ]]; then\n' +
        '  if [[ "$args" == *"mergeStateStatus"* ]]; then\n' +
        "    echo 'DIRTY'\n" +
        '  else\n' +
        '    echo \'{"number":1}\'\n' +
        '  fi\n' +
        '  exit 0\n' +
        'fi\n' +
        'if [[ "$1" == "pr" && "$2" == "list" ]]; then\n' +
        '  if [[ "$args" == *"number,headRefName"* ]]; then\n' +
        "    printf '1\\tnight-watch/codex-argv-test\\n'\n" +
        '  else\n' +
        "    echo 'night-watch/codex-argv-test'\n" +
        '  fi\n' +
        '  exit 0\n' +
        'fi\n' +
        'if [[ "$1" == "pr" && "$2" == "checks" ]]; then\n' +
        "  echo 'fail 1/1 checks'\n" +
        '  exit 1\n' +
        'fi\n' +
        'exit 0\n',
      { encoding: 'utf-8', mode: 0o755 },
    );

    const result = runScript(reviewerScript, projectDir, {
      PATH: `${fakeBin}:${process.env.PATH}`,
      NW_PROVIDER_CMD: 'codex',
      NW_DEFAULT_BRANCH: 'main',
      NW_BRANCH_PATTERNS: 'night-watch/',
      NW_REVIEWER_WORKER_MODE: '0',
      NW_REVIEWER_PARALLEL: '0',
      NW_AUTO_MERGE: '0',
      NW_SMOKE_ARGS_FILE: argsFile,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('NIGHT_WATCH_RESULT:failure');

    const argv = fs.readFileSync(argsFile, 'utf-8').split('\0').filter(Boolean);
    expect(argv[0]).toBe('exec');
    expect(argv).toContain('--yolo');
    expect(argv).not.toContain('--quiet');
    expect(argv).not.toContain('--prompt');
  });

  it('reviewer parallel mode should aggregate results when one worker times out and one succeeds', async () => {
    const projectDir = mkTempDir('nw-smoke-reviewer-parallel-mixed-');
    initGitRepo(projectDir);
    fs.mkdirSync(path.join(projectDir, 'logs'), { recursive: true });

    const fakeBin = mkTempDir('nw-smoke-reviewer-parallel-mixed-bin-');

    // Create a state file to track which PR is being processed
    const stateDir = mkTempDir('nw-smoke-reviewer-parallel-state-');

    // Mock provider that times out for PR 31 and succeeds for PR 32
    fs.writeFileSync(
      path.join(fakeBin, 'claude'),
      '#!/usr/bin/env bash\n' +
        '# Determine behavior based on TARGET_PR env var\n' +
        'if [[ "${NW_TARGET_PR}" == "31" ]]; then\n' +
        '  # Timeout case: sleep longer than the timeout\n' +
        '  sleep 2\n' +
        '  exit 0\n' +
        'elif [[ "${NW_TARGET_PR}" == "32" ]]; then\n' +
        '  # Success case: exit immediately\n' +
        '  exit 0\n' +
        'fi\n' +
        'exit 0\n',
      { encoding: 'utf-8', mode: 0o755 },
    );

    // Mock gh CLI - returns two PRs that need work
    fs.writeFileSync(
      path.join(fakeBin, 'gh'),
      '#!/usr/bin/env bash\n' +
        'args="$*"\n' +
        'if [[ "$1" == "repo" && "$2" == "view" ]]; then\n' +
        "  echo 'owner/repo'\n" +
        '  exit 0\n' +
        'fi\n' +
        'if [[ "$1" == "pr" && "$2" == "view" ]]; then\n' +
        '  if [[ "$args" == *"mergeStateStatus"* ]]; then\n' +
        "    echo 'DIRTY'\n" +
        '  else\n' +
        '    echo \'{"number":1}\'\n' +
        '  fi\n' +
        '  exit 0\n' +
        'fi\n' +
        'if [[ "$1" == "pr" && "$2" == "list" ]]; then\n' +
        '  if [[ "$args" == *"number,headRefName"* ]]; then\n' +
        "    printf '31\\tnight-watch/parallel-timeout\\n32\\tnight-watch/parallel-success\\n'\n" +
        '  else\n' +
        "    printf 'night-watch/parallel-timeout\\nnight-watch/parallel-success\\n'\n" +
        '  fi\n' +
        '  exit 0\n' +
        'fi\n' +
        'if [[ "$1" == "pr" && "$2" == "checks" ]]; then\n' +
        "  echo 'fail 1/1 checks'\n" +
        '  exit 1\n' +
        'fi\n' +
        'exit 0\n',
      { encoding: 'utf-8', mode: 0o755 },
    );

    // Run the reviewer script with parallel mode enabled and a short timeout
    // This will trigger parallel worker mode since there are 2 PRs needing work
    const result = await runScriptAsync(reviewerScript, projectDir, {
      PATH: `${fakeBin}:${process.env.PATH}`,
      NW_PROVIDER_CMD: 'claude',
      NW_DEFAULT_BRANCH: 'main',
      NW_BRANCH_PATTERNS: 'night-watch/',
      NW_REVIEWER_MAX_RUNTIME: '1', // 1 second timeout per worker
      NW_REVIEWER_WORKER_MODE: '0', // Not in worker mode - this is the main orchestrator
      NW_REVIEWER_PARALLEL: '1', // Enable parallel mode
      NW_REVIEWER_WORKER_STAGGER: '0', // No stagger delay in tests
      NW_AUTO_MERGE: '0',
    });

    // Note: Parallel mode calls `exit 0` at line 378 regardless of worker results
    // The aggregation logic sets EXIT_CODE but emit_final_status doesn't propagate it
    // The timeout is still emitted in stdout
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('NIGHT_WATCH_RESULT:timeout');
  });

  // ── Board mode smoke tests ─────────────────────────────────────────────────────

  it('executor board mode should emit success_open_pr when targeted issue is implemented with PR', () => {
    const projectDir = mkTempDir('nw-smoke-executor-board-targeted-');
    initGitRepo(projectDir);
    fs.mkdirSync(path.join(projectDir, 'logs'), { recursive: true });

    const fakeBin = mkTempDir('nw-smoke-bin-board-targeted-');
    const readyFlag = path.join(projectDir, '.smoke-pr-open');
    const branchName = 'night-watch/123-test-targeted-issue';
    const issueNumber = '123';

    // Mock claude to succeed
    fs.writeFileSync(
      path.join(fakeBin, 'claude'),
      '#!/usr/bin/env bash\n' + 'touch "$NW_SMOKE_PR_READY_FILE"\n' + 'exit 0\n',
      { encoding: 'utf-8', mode: 0o755 },
    );

    // Mock gh to return issue details and PR list
    fs.writeFileSync(
      path.join(fakeBin, 'gh'),
      '#!/usr/bin/env bash\n' +
        'args="$*"\n' +
        'if [[ "$1" == "issue" && "$2" == "view" ]]; then\n' +
        '  # Return issue JSON for targeted issue\n' +
        '  echo \'{"number":123,"title":"Test Targeted Issue","body":"## Description\\n\\nImplement feature X."}\'\n' +
        '  exit 0\n' +
        'fi\n' +
        'if [[ "$1" == "pr" && "$2" == "list" ]]; then\n' +
        '  state=""\n' +
        '  for ((i=1; i<=$#; i++)); do\n' +
        '    if [[ "${!i}" == "--state" ]]; then\n' +
        '      j=$((i+1))\n' +
        '      state="${!j}"\n' +
        '    fi\n' +
        '  done\n' +
        '  if [[ "$state" == "open" && -f "$NW_SMOKE_PR_READY_FILE" ]]; then\n' +
        '    echo "$NW_SMOKE_BRANCH"\n' +
        '  fi\n' +
        '  exit 0\n' +
        'fi\n' +
        'exit 0\n',
      { encoding: 'utf-8', mode: 0o755 },
    );

    // Mock night-watch CLI for board operations
    const nwCli = path.join(fakeBin, 'night-watch');
    fs.writeFileSync(
      nwCli,
      '#!/usr/bin/env bash\n' +
        'if [[ "$1" == "board" && "$2" == "close-issue" ]]; then\n' +
        '  exit 0\n' +
        'fi\n' +
        'if [[ "$1" == "board" && "$2" == "move-issue" ]]; then\n' +
        '  exit 0\n' +
        'fi\n' +
        'if [[ "$1" == "board" && "$2" == "comment" ]]; then\n' +
        '  exit 0\n' +
        'fi\n' +
        'exit 0\n',
      { encoding: 'utf-8', mode: 0o755 },
    );

    const result = runScript(executorScript, projectDir, {
      PATH: `${fakeBin}:${process.env.PATH}`,
      NW_PROVIDER_CMD: 'claude',
      NW_DEFAULT_BRANCH: 'main',
      NW_BOARD_ENABLED: 'true',
      NW_TARGET_ISSUE: issueNumber,
      NW_CLI_BIN: nwCli,
      NW_SMOKE_PR_READY_FILE: readyFlag,
      NW_SMOKE_BRANCH: branchName,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('NIGHT_WATCH_RESULT:success_open_pr');
    expect(result.stdout).toContain(`branch=${branchName}`);
  });

  it('executor board mode should emit skip_no_eligible_prd when no issues in Ready column', () => {
    const projectDir = mkTempDir('nw-smoke-executor-board-empty-');
    initGitRepo(projectDir);
    fs.mkdirSync(path.join(projectDir, 'logs'), { recursive: true });

    const fakeBin = mkTempDir('nw-smoke-bin-board-empty-');

    // Mock night-watch CLI to return empty array (no Ready issues)
    const nwCli = path.join(fakeBin, 'night-watch');
    fs.writeFileSync(
      nwCli,
      '#!/usr/bin/env bash\n' +
        'if [[ "$1" == "board" && "$2" == "next-issue" ]]; then\n' +
        "  echo '[]'\n" +
        '  exit 0\n' +
        'fi\n' +
        'exit 0\n',
      { encoding: 'utf-8', mode: 0o755 },
    );

    const result = runScript(executorScript, projectDir, {
      PATH: `${fakeBin}:${process.env.PATH}`,
      NW_PROVIDER_CMD: 'claude',
      NW_DEFAULT_BRANCH: 'main',
      NW_BOARD_ENABLED: 'true',
      NW_CLI_BIN: nwCli,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('NIGHT_WATCH_RESULT:skip_no_eligible_prd');
  });

  it('executor board mode should move issue back to Ready when provider fails', () => {
    const projectDir = mkTempDir('nw-smoke-executor-board-fail-');
    initGitRepo(projectDir);
    fs.mkdirSync(path.join(projectDir, 'logs'), { recursive: true });

    const fakeBin = mkTempDir('nw-smoke-bin-board-fail-');
    const branchName = 'night-watch/456-test-fail-issue';
    const issueNumber = '456';
    const moveIssueLog = path.join(projectDir, '.smoke-move-issue-calls');

    // Mock claude to fail
    fs.writeFileSync(
      path.join(fakeBin, 'claude'),
      '#!/usr/bin/env bash\n' + "echo 'Error: provider failed' >&2\n" + 'exit 1\n',
      { encoding: 'utf-8', mode: 0o755 },
    );

    // Mock gh to return issue details
    fs.writeFileSync(
      path.join(fakeBin, 'gh'),
      '#!/usr/bin/env bash\n' +
        'if [[ "$1" == "issue" && "$2" == "view" ]]; then\n' +
        '  echo \'{"number":456,"title":"Test Fail Issue","body":"## Description\\n\\nThis should fail."}\'\n' +
        '  exit 0\n' +
        'fi\n' +
        'if [[ "$1" == "pr" && "$2" == "list" ]]; then\n' +
        '  exit 0\n' +
        'fi\n' +
        'exit 0\n',
      { encoding: 'utf-8', mode: 0o755 },
    );

    // Mock night-watch CLI for board operations - logs move-issue calls
    const nwCli = path.join(fakeBin, 'night-watch');
    fs.writeFileSync(
      nwCli,
      '#!/usr/bin/env bash\n' +
        'if [[ "$1" == "board" && "$2" == "move-issue" ]]; then\n' +
        '  # Log the move-issue call for verification\n' +
        '  echo "$*" >> "$NW_SMOKE_MOVE_LOG"\n' +
        '  exit 0\n' +
        'fi\n' +
        'if [[ "$1" == "board" && "$2" == "comment" ]]; then\n' +
        '  exit 0\n' +
        'fi\n' +
        'if [[ "$1" == "board" && "$2" == "close-issue" ]]; then\n' +
        '  exit 0\n' +
        'fi\n' +
        'exit 0\n',
      { encoding: 'utf-8', mode: 0o755 },
    );

    const result = runScript(executorScript, projectDir, {
      PATH: `${fakeBin}:${process.env.PATH}`,
      NW_PROVIDER_CMD: 'claude',
      NW_DEFAULT_BRANCH: 'main',
      NW_BOARD_ENABLED: 'true',
      NW_TARGET_ISSUE: issueNumber,
      NW_CLI_BIN: nwCli,
      NW_SMOKE_BRANCH: branchName,
      NW_SMOKE_MOVE_LOG: moveIssueLog,
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('NIGHT_WATCH_RESULT:failure');
    // Verify move-issue was called with Ready column (issue moved back)
    expect(fs.existsSync(moveIssueLog)).toBe(true);
    const moveLog = fs.readFileSync(moveIssueLog, 'utf-8');
    expect(moveLog).toContain('move-issue');
    expect(moveLog).toContain(issueNumber);
    expect(moveLog).toContain('Ready');
  });

  it('executor board mode timeout should post a follow-up comment with resume + slice suggestions', () => {
    const projectDir = mkTempDir('nw-smoke-executor-board-timeout-');
    initGitRepo(projectDir);
    fs.mkdirSync(path.join(projectDir, 'logs'), { recursive: true });

    const fakeBin = mkTempDir('nw-smoke-bin-board-timeout-');
    const issueNumber = '789';
    const commentLog = path.join(projectDir, '.smoke-timeout-comments');

    fs.writeFileSync(path.join(fakeBin, 'claude'), '#!/usr/bin/env bash\nsleep 2\nexit 0\n', {
      encoding: 'utf-8',
      mode: 0o755,
    });

    fs.writeFileSync(
      path.join(fakeBin, 'gh'),
      '#!/usr/bin/env bash\n' +
        'if [[ "$1" == "issue" && "$2" == "view" ]]; then\n' +
        '  echo \'{"number":789,"title":"Large Migration","body":"## Phases\\n\\n### Phase 1: Git Utilities\\n\\n### Phase 2: Worktree Management\\n\\n### Phase 3: Lock and Claim Management"}\'\n' +
        '  exit 0\n' +
        'fi\n' +
        'if [[ "$1" == "pr" && "$2" == "list" ]]; then\n' +
        '  exit 0\n' +
        'fi\n' +
        'exit 0\n',
      { encoding: 'utf-8', mode: 0o755 },
    );

    const nwCli = path.join(fakeBin, 'night-watch');
    fs.writeFileSync(
      nwCli,
      '#!/usr/bin/env bash\n' +
        'if [[ "$1" == "board" && "$2" == "move-issue" ]]; then\n' +
        '  exit 0\n' +
        'fi\n' +
        'if [[ "$1" == "board" && "$2" == "comment" ]]; then\n' +
        "  body=''\n" +
        '  for ((i=1; i<=$#; i++)); do\n' +
        '    if [[ "${!i}" == "--body" ]]; then\n' +
        '      j=$((i+1))\n' +
        '      body="${!j}"\n' +
        '      break\n' +
        '    fi\n' +
        '  done\n' +
        '  {\n' +
        "    echo '---'\n" +
        '    printf \'%s\\n\' "$body"\n' +
        '  } >> "$NW_SMOKE_COMMENT_LOG"\n' +
        '  exit 0\n' +
        'fi\n' +
        'if [[ "$1" == "board" && "$2" == "close-issue" ]]; then\n' +
        '  exit 0\n' +
        'fi\n' +
        'exit 0\n',
      { encoding: 'utf-8', mode: 0o755 },
    );

    const result = runScript(executorScript, projectDir, {
      PATH: `${fakeBin}:${process.env.PATH}`,
      NW_PROVIDER_CMD: 'claude',
      NW_DEFAULT_BRANCH: 'main',
      NW_BOARD_ENABLED: 'true',
      NW_TARGET_ISSUE: issueNumber,
      NW_CLI_BIN: nwCli,
      NW_MAX_RUNTIME: '1',
      NW_SMOKE_COMMENT_LOG: commentLog,
    });

    expect(result.status).toBe(124);
    expect(result.stdout).toContain('NIGHT_WATCH_RESULT:timeout');
    expect(fs.existsSync(commentLog)).toBe(true);

    const comments = fs.readFileSync(commentLog, 'utf-8');
    expect(comments).toContain('Timeout follow-up:');
    expect(comments).toContain('will resume from the latest checkpoint');
    expect(comments).toContain('Suggested slices for the next runs:');
    expect(comments).toContain('Phase 1: Git Utilities');
    expect(comments).toContain('Phase 2: Worktree Management');
    expect(comments).toContain('Phase 3: Lock and Claim Management');
    expect(comments).toContain('avoid huge PRDs');
    expect(comments).toContain('Slice large work into smaller PRDs/phases');
  });

  it('executor should trigger native Claude fallback and include rate_limit_fallback marker when proxy returns 429', () => {
    const projectDir = mkTempDir('nw-smoke-executor-rate-limit-fallback-');
    initGitRepo(projectDir);
    createPrd(projectDir, '01-smoke-rate-limit-fallback');
    commitAll(projectDir, 'add PRD');

    const fakeBin = mkTempDir('nw-smoke-bin-rate-limit-fallback-');
    const branchName = 'night-watch/01-smoke-rate-limit-fallback';
    const readyFlag = path.join(projectDir, '.smoke-pr-open');

    // Mock claude that:
    // 1. First call: outputs "429" to simulate rate limit, exits with non-zero
    // 2. Second call (native fallback): succeeds and creates PR marker
    fs.writeFileSync(
      path.join(fakeBin, 'claude'),
      '#!/usr/bin/env bash\n' +
        '# Check if ANTHROPIC_BASE_URL is set (proxy mode)\n' +
        'if [[ -n "${ANTHROPIC_BASE_URL:-}" ]]; then\n' +
        '  # Proxy mode: simulate rate limit error\n' +
        "  echo 'Error: HTTP 429 Too Many Requests' >&2\n" +
        "  echo 'Rate limit exceeded' >&2\n" +
        '  exit 1\n' +
        'else\n' +
        '  # Native mode (fallback): succeed and create PR\n' +
        '  touch "$NW_SMOKE_PR_READY_FILE"\n' +
        '  exit 0\n' +
        'fi\n',
      { encoding: 'utf-8', mode: 0o755 },
    );

    // Mock gh CLI - reports open PR after native fallback succeeds
    fs.writeFileSync(
      path.join(fakeBin, 'gh'),
      '#!/usr/bin/env bash\n' +
        'args="$*"\n' +
        'if [[ "$1" == "pr" && "$2" == "list" ]]; then\n' +
        '  state=""\n' +
        '  for ((i=1; i<=$#; i++)); do\n' +
        '    if [[ "${!i}" == "--state" ]]; then\n' +
        '      j=$((i+1))\n' +
        '      state="${!j}"\n' +
        '    fi\n' +
        '  done\n' +
        '  # Return open PR after native fallback succeeds\n' +
        '  if [[ "$state" == "open" && -f "$NW_SMOKE_PR_READY_FILE" ]]; then\n' +
        '    echo "$NW_SMOKE_BRANCH"\n' +
        '    exit 0\n' +
        '  fi\n' +
        '  exit 0\n' +
        'fi\n' +
        'exit 0\n',
      { encoding: 'utf-8', mode: 0o755 },
    );

    const result = runScript(executorScript, projectDir, {
      PATH: `${fakeBin}:${process.env.PATH}`,
      NW_PROVIDER_CMD: 'claude',
      NW_PRD_DIR: 'docs/PRDs/night-watch',
      NW_DEFAULT_BRANCH: 'main',
      NW_FALLBACK_ON_RATE_LIMIT: 'true',
      ANTHROPIC_BASE_URL: 'https://proxy.example.com', // Simulate proxy mode
      NW_SMOKE_PR_READY_FILE: readyFlag,
      NW_SMOKE_BRANCH: branchName,
    });

    expect(result.status).toBe(0);
    // Should emit success_open_pr with rate_limit_fallback=1 marker
    expect(result.stdout).toContain('NIGHT_WATCH_RESULT:success_open_pr');
    expect(result.stdout).toContain('rate_limit_fallback=1');
    expect(result.stdout).toContain(`branch=${branchName}`);
  });

  it('executor should emit rate_limited when 429 occurs and fallback is disabled', () => {
    const projectDir = mkTempDir('nw-smoke-executor-rate-limited-no-fallback-');
    initGitRepo(projectDir);
    createPrd(projectDir, '01-smoke-rate-limited');
    commitAll(projectDir, 'add PRD');

    const fakeBin = mkTempDir('nw-smoke-bin-rate-limited-');
    const branchName = 'night-watch/01-smoke-rate-limited';

    // Mock claude that simulates rate limit error
    fs.writeFileSync(
      path.join(fakeBin, 'claude'),
      '#!/usr/bin/env bash\n' +
        "echo 'Error: HTTP 429 Too Many Requests' >&2\n" +
        "echo 'Rate limit exceeded' >&2\n" +
        'exit 1\n',
      { encoding: 'utf-8', mode: 0o755 },
    );

    fs.writeFileSync(path.join(fakeBin, 'gh'), '#!/usr/bin/env bash\nexit 0\n', {
      encoding: 'utf-8',
      mode: 0o755,
    });

    const result = runScript(executorScript, projectDir, {
      PATH: `${fakeBin}:${process.env.PATH}`,
      NW_PROVIDER_CMD: 'claude',
      NW_PRD_DIR: 'docs/PRDs/night-watch',
      NW_DEFAULT_BRANCH: 'main',
      NW_FALLBACK_ON_RATE_LIMIT: 'false', // Fallback disabled
      NW_MAX_RETRIES: '1', // Only 1 attempt to avoid long test
      NW_SMOKE_BRANCH: branchName,
    });

    // Should emit failure (rate limited without fallback)
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('NIGHT_WATCH_RESULT:failure');
    // Should NOT have the rate_limit_fallback marker since fallback didn't happen
    expect(result.stdout).not.toContain('rate_limit_fallback=1');
  });

  // Audit negative-path tests (P2D)

  it('audit should emit failure with reason=unknown_provider when provider command is invalid', () => {
    const projectDir = mkTempDir('nw-smoke-audit-unknown-provider-');
    initGitRepo(projectDir);
    fs.mkdirSync(path.join(projectDir, 'logs'), { recursive: true });

    const result = runScript(auditScript, projectDir, {
      NW_PROVIDER_CMD: 'invalid-provider',
      NW_DEFAULT_BRANCH: 'main',
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('NIGHT_WATCH_RESULT:failure|reason=unknown_provider');
  });

  it('audit should emit skip_dry_run when NW_DRY_RUN is set to 1', () => {
    const projectDir = mkTempDir('nw-smoke-audit-dry-run-');
    initGitRepo(projectDir);
    fs.mkdirSync(path.join(projectDir, 'logs'), { recursive: true });

    const result = runScript(auditScript, projectDir, {
      NW_PROVIDER_CMD: 'claude',
      NW_DEFAULT_BRANCH: 'main',
      NW_DRY_RUN: '1',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('NIGHT_WATCH_RESULT:skip_dry_run');
  });

  it('audit should emit failure_missing_prompt when prompt template does not exist', () => {
    const projectDir = mkTempDir('nw-smoke-audit-missing-prompt-');
    initGitRepo(projectDir);
    fs.mkdirSync(path.join(projectDir, 'logs'), { recursive: true });

    // Audit prompt filename differs across template migrations.
    // Temporarily move all known audit prompt candidates to force missing-prompt path.
    const templatePaths = [
      path.join(repoRoot, 'templates', 'audit.md'),
      path.join(repoRoot, 'templates', 'night-watch-audit.md'),
    ].filter((p) => fs.existsSync(p));

    if (templatePaths.length === 0) {
      return;
    }
    const tempTemplatePaths = templatePaths.map((p) => `${p}.bak`);

    try {
      for (let i = 0; i < templatePaths.length; i += 1) {
        fs.renameSync(templatePaths[i], tempTemplatePaths[i]);
      }

      const result = runScript(auditScript, projectDir, {
        NW_PROVIDER_CMD: 'claude',
        NW_DEFAULT_BRANCH: 'main',
      });

      expect(result.status).toBe(1);
      expect(result.stdout).toContain('NIGHT_WATCH_RESULT:failure_missing_prompt');
    } finally {
      for (let i = 0; i < tempTemplatePaths.length; i += 1) {
        if (fs.existsSync(tempTemplatePaths[i])) {
          fs.renameSync(tempTemplatePaths[i], templatePaths[i]);
        }
      }
    }
  });

  it('audit should emit failure with reason=worktree_setup_failed when git worktree add fails', () => {
    const projectDir = mkTempDir('nw-smoke-audit-worktree-fail-');
    initGitRepo(projectDir);
    fs.mkdirSync(path.join(projectDir, 'logs'), { recursive: true });

    const fakeBin = mkTempDir('nw-smoke-audit-worktree-fail-bin-');

    // Mock git to fail on worktree add
    fs.writeFileSync(
      path.join(fakeBin, 'git'),
      '#!/usr/bin/env bash\n' +
        'REAL_GIT="/usr/bin/git"\n' +
        'args="$*"\n' +
        '# Fail on worktree add operations\n' +
        'if [[ "$1" == "-C" && "$3" == "worktree" && "$4" == "add" ]]; then\n' +
        '  echo "error: mock git worktree add failed" >&2\n' +
        '  exit 1\n' +
        'fi\n' +
        '# Delegate to real git for everything else\n' +
        'exec "$REAL_GIT" "$@"\n',
      { encoding: 'utf-8', mode: 0o755 },
    );

    const result = runScript(auditScript, projectDir, {
      PATH: `${fakeBin}:${process.env.PATH}`,
      NW_PROVIDER_CMD: 'claude',
      NW_DEFAULT_BRANCH: 'main',
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('NIGHT_WATCH_RESULT:failure|reason=worktree_setup_failed');
  });

  it('audit should emit failure with provider_exit when provider exits with non-zero code', () => {
    const projectDir = mkTempDir('nw-smoke-audit-provider-exit-');
    initGitRepo(projectDir);
    fs.mkdirSync(path.join(projectDir, 'logs'), { recursive: true });

    const fakeBin = mkTempDir('nw-smoke-audit-provider-exit-bin-');

    // Mock provider that exits with a specific non-zero code (not 124 which is timeout)
    fs.writeFileSync(
      path.join(fakeBin, 'claude'),
      '#!/usr/bin/env bash\n' +
        "echo 'Error: provider failed with exit code 42' >&2\n" +
        'exit 42\n',
      { encoding: 'utf-8', mode: 0o755 },
    );

    const result = runScript(auditScript, projectDir, {
      PATH: `${fakeBin}:${process.env.PATH}`,
      NW_PROVIDER_CMD: 'claude',
      NW_DEFAULT_BRANCH: 'main',
    });

    expect(result.status).toBe(42);
    expect(result.stdout).toContain('NIGHT_WATCH_RESULT:failure|provider_exit=42');
  });
});
