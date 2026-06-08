import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../../../../');
const optimizerCronScript = path.join(repoRoot, 'scripts', 'night-watch-optimizer-cron.sh');

let tempRoot: string;
let projectDir: string;
let fakeBinDir: string;

function run(command: string, args: string[], cwd: string, env: Record<string, string> = {}) {
  return spawnSync(command, args, {
    cwd,
    encoding: 'utf-8',
    env: {
      ...process.env,
      ...env,
    },
  });
}

function initProject(): void {
  fs.mkdirSync(projectDir, { recursive: true });
  fs.writeFileSync(
    path.join(projectDir, 'package.json'),
    JSON.stringify({ name: 'optimizer-script-test', scripts: { test: 'node test.js' } }, null, 2),
  );
  fs.writeFileSync(
    path.join(projectDir, 'index.js'),
    'const values = [3, 1, 2];\nvalues.sort();\n',
  );

  expect(run('git', ['init', '-b', 'main'], projectDir).status).toBe(0);
  expect(run('git', ['config', 'user.email', 'test@example.com'], projectDir).status).toBe(0);
  expect(run('git', ['config', 'user.name', 'Night Watch Test'], projectDir).status).toBe(0);
  expect(run('git', ['add', '.'], projectDir).status).toBe(0);
  expect(run('git', ['commit', '-m', 'initial'], projectDir).status).toBe(0);
}

function writeFakeProvider(contents: string): void {
  fs.mkdirSync(fakeBinDir, { recursive: true });
  const providerPath = path.join(fakeBinDir, 'fake-optimizer');
  fs.writeFileSync(providerPath, contents);
  fs.chmodSync(providerPath, 0o755);
}

function writeFakeGh(): void {
  fs.mkdirSync(fakeBinDir, { recursive: true });
  const ghPath = path.join(fakeBinDir, 'gh');
  fs.writeFileSync(
    ghPath,
    `#!/usr/bin/env bash
set -euo pipefail
if [ "$1" = "label" ]; then
  exit 0
fi
if [ "$1" = "pr" ] && [ "$2" = "create" ]; then
  printf '%s\n' "$@" > "$FAKE_GH_ARGS"
  body_file=""
  while [ "$#" -gt 0 ]; do
    if [ "$1" = "--body-file" ]; then
      body_file="$2"
      break
    fi
    shift
  done
  cp "$body_file" "$FAKE_GH_BODY"
  echo "https://github.com/acme/repo/pull/12"
  exit 0
fi
echo "unexpected gh invocation: $*" >&2
exit 1
`,
  );
  fs.chmodSync(ghPath, 0o755);
}

describe('night-watch-optimizer-cron.sh', () => {
  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'night-watch-optimizer-script-'));
    projectDir = path.join(tempRoot, 'project');
    fakeBinDir = path.join(tempRoot, 'bin');
    initProject();
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('runs the bundled scanner first and writes a report without a PR for unproven improvements', () => {
    writeFakeProvider(`#!/usr/bin/env bash
set -euo pipefail
test -s logs/optimizer-scan.md
grep -q "Night Watch Optimizer Scan" logs/optimizer-scan.md
cat > logs/optimizer-report.md <<'REPORT'
# Optimizer Report

No safe proven improvement exists.
REPORT
cat > logs/optimizer-result.json <<'JSON'
{
  "improved": false,
  "verificationPassed": false,
  "targetSlug": "sort-call",
  "bottleneckSummary": "sort call lead was inspected",
  "baselineEvidence": "not enough evidence",
  "changeSummary": "none",
  "afterEvidence": "none",
  "verification": "not run",
  "residualRisk": "none"
}
JSON
`);

    const result = run('bash', [optimizerCronScript, projectDir], projectDir, {
      PATH: `${fakeBinDir}:${process.env.PATH ?? ''}`,
      NW_DEFAULT_BRANCH: 'main',
      NW_OPTIMIZER_MAX_RUNTIME: '0',
      NW_PROVIDER_CMD: 'fake-optimizer',
      NW_PROVIDER_LABEL: 'Fake Optimizer',
      NW_QUEUE_ENABLED: '0',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      'NIGHT_WATCH_RESULT:skip_unproven|reason=no_measurable_improvement',
    );
    expect(
      fs.readFileSync(path.join(projectDir, 'logs', 'optimizer-report.md'), 'utf-8'),
    ).toContain('No safe proven improvement exists.');
    expect(
      JSON.parse(fs.readFileSync(path.join(projectDir, 'logs', 'optimizer-result.json'), 'utf-8')),
    ).toMatchObject({
      improved: false,
      verificationPassed: false,
      targetSlug: 'sort-call',
    });

    const branchList = run('git', ['branch', '--list', 'night-watch/optimizer/*'], projectDir);
    expect(branchList.stdout.trim()).toBe('');
    const status = run('git', ['status', '--porcelain'], projectDir);
    expect(status.stdout.trim()).toBe('?? logs/');
  });

  it('pushes a proven optimizer branch and opens a draft PR with required metadata', () => {
    const originDir = path.join(tempRoot, 'origin.git');
    expect(run('git', ['init', '--bare', originDir], tempRoot).status).toBe(0);
    expect(run('git', ['remote', 'add', 'origin', originDir], projectDir).status).toBe(0);
    expect(run('git', ['push', '-u', 'origin', 'main'], projectDir).status).toBe(0);

    writeFakeProvider(`#!/usr/bin/env bash
set -euo pipefail
test -s logs/optimizer-scan.md
printf '\\nmodule.exports = values;\\n' >> index.js
cat > logs/optimizer-report.md <<'REPORT'
# Optimizer Report

Proven improvement.
REPORT
cat > logs/optimizer-result.json <<'JSON'
{
  "improved": true,
  "verificationPassed": true,
  "targetSlug": "cache-loop",
  "bottleneckSummary": "Repeated loop work in index.js",
  "baselineEvidence": "node bench.js before: 120ms",
  "changeSummary": "Cached the computed values",
  "afterEvidence": "node bench.js after: 80ms",
  "verification": "npm test passed",
  "residualRisk": "Low; focused change"
}
JSON
`);
    writeFakeGh();

    const ghArgs = path.join(tempRoot, 'gh-args.txt');
    const ghBody = path.join(tempRoot, 'gh-body.md');
    const result = run('bash', [optimizerCronScript, projectDir], projectDir, {
      FAKE_GH_ARGS: ghArgs,
      FAKE_GH_BODY: ghBody,
      PATH: `${fakeBinDir}:${process.env.PATH ?? ''}`,
      NW_DEFAULT_BRANCH: 'main',
      NW_OPTIMIZER_BRANCH_PREFIX: 'night-watch/optimizer',
      NW_OPTIMIZER_MAX_RUNTIME: '0',
      NW_OPTIMIZER_PR_LABEL: 'optimization',
      NW_PROVIDER_CMD: 'fake-optimizer',
      NW_PROVIDER_LABEL: 'Fake Optimizer',
      NW_QUEUE_ENABLED: '0',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      'NIGHT_WATCH_RESULT:success_pr|branch=night-watch/optimizer/cache-loop|pr=https://github.com/acme/repo/pull/12',
    );

    const pushedBranch = run(
      'git',
      [
        '--git-dir',
        originDir,
        'show-ref',
        '--verify',
        'refs/heads/night-watch/optimizer/cache-loop',
      ],
      tempRoot,
    );
    expect(pushedBranch.status).toBe(0);

    const args = fs.readFileSync(ghArgs, 'utf-8');
    expect(args).toContain('--draft');
    expect(args).toContain('--base\nmain');
    expect(args).toContain('--head\nnight-watch/optimizer/cache-loop');
    expect(args).toContain('--label\noptimization');
    expect(args).toContain('--title\nperf: optimize cache-loop');

    const body = fs.readFileSync(ghBody, 'utf-8');
    expect(body).toContain('## Bottleneck Summary');
    expect(body).toContain('Repeated loop work in index.js');
    expect(body).toContain('## Baseline Evidence');
    expect(body).toContain('node bench.js before: 120ms');
    expect(body).toContain('## Change Summary');
    expect(body).toContain('## After Evidence');
    expect(body).toContain('## Tests and Verification');
    expect(body).toContain('## Residual Risk');

    const status = run('git', ['status', '--porcelain'], projectDir);
    expect(status.stdout.trim()).toBe('?? logs/');
  });
});
