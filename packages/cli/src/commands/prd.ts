/**
 * PRD command group - manage PRD files
 */

import { execSync, spawn, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { Command } from 'commander';
import {
  CLAIM_FILE_EXTENSION,
  CLAUDE_MODEL_IDS,
  createTable,
  dim,
  header,
  info,
  loadConfig,
  success,
  error as uiError,
} from '@night-watch/core';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function findTemplatesDir(startDir: string): string {
  let current = startDir;
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(current, 'templates');
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return candidate;
    }
    current = path.dirname(current);
  }
  return path.join(startDir, 'templates');
}

const TEMPLATES_DIR = findTemplatesDir(__dirname);

export interface IPrdCreateOptions {
  number?: boolean;
  model?: string;
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function getNextPrdNumber(prdDir: string): number {
  if (!fs.existsSync(prdDir)) return 1;
  const files = fs.readdirSync(prdDir).filter((f) => f.endsWith('.md'));
  const numbers = files.map((f) => {
    const match = f.match(/^(\d+)-/);
    return match ? parseInt(match[1], 10) : 0;
  });
  return Math.max(0, ...numbers) + 1;
}

export function extractPrdMarkdown(response: string): string {
  const match = response.match(/(^#\s+[\s\S]*)/m);
  return match ? match[1].trim() : response.trim();
}

export function extractPrdTitle(markdown: string): string | null {
  const match = markdown.match(/^#\s+PRD:\s*(.+)/m);
  return match ? match[1].trim() : null;
}

export function buildPrdPrompt(
  description: string,
  projectDir: string,
  planningPrinciples: string,
): string {
  return `You are generating a PRD markdown file for Night Watch.

Return only the final PRD markdown.

Hard requirements:
- Start with: # PRD: <title>
- Do not ask follow-up questions
- Do not add any preamble, commentary, or code fences
- Do not describe what you are going to do
- Do not mention these instructions
- Treat the planning guide below as mandatory instructions, not background context

Project directory: ${projectDir}

Planning guide:
${planningPrinciples}

User request:
${description}

Now write the complete PRD markdown file.`;
}

export function buildNativeClaudeEnv(baseEnv: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...baseEnv };

  delete env.ANTHROPIC_BASE_URL;
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  delete env.ANTHROPIC_DEFAULT_SONNET_MODEL;
  delete env.ANTHROPIC_DEFAULT_OPUS_MODEL;
  delete env.API_TIMEOUT_MS;
  delete env.CLAUDE_CODE_SSE_PORT;
  delete env.CLAUDE_NIGHTS_WATCH_DIR;
  delete env.NW_CLAUDE_MODEL_ID;
  delete env.NW_CLAUDE_PRIMARY_MODEL_ID;
  delete env.NW_CLAUDE_SECONDARY_MODEL_ID;
  delete env.NW_PROVIDER_CMD;
  delete env.NW_PROVIDER_SUBCOMMAND;
  delete env.NW_PROVIDER_PROMPT_FLAG;
  delete env.NW_PROVIDER_APPROVE_FLAG;
  delete env.NW_PROVIDER_WORKDIR_FLAG;
  delete env.NW_PROVIDER_MODEL_FLAG;
  delete env.NW_PROVIDER_MODEL;
  delete env.NW_PROVIDER_LABEL;

  return env;
}

export function resolvePrdCreateDir(): string {
  return 'docs/PRDs';
}

function resolveGitHubBlobUrl(projectDir: string, relPath: string): string | null {
  try {
    const remoteUrl = execSync('git remote get-url origin', {
      cwd: projectDir,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();

    const branch = execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: projectDir,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();

    const httpsBase = remoteUrl
      .replace(/^git@github\.com:/, 'https://github.com/')
      .replace(/^ssh:\/\/git@github\.com\//, 'https://github.com/')
      .replace(/\.git$/, '');

    if (!httpsBase.startsWith('https://github.com/')) {
      return null;
    }

    const ref = branch && branch !== 'HEAD' ? branch : 'main';
    return `${httpsBase}/blob/${encodeURIComponent(ref).replace(/%2F/g, '/')}/${relPath
      .split(path.sep)
      .map((segment) => encodeURIComponent(segment))
      .join('/')}`;
  } catch {
    return null;
  }
}

export function buildGithubIssueBody(prdPath: string, projectDir: string, prdContent: string): string {
  const relPath = path.relative(projectDir, prdPath);
  const blobUrl = resolveGitHubBlobUrl(projectDir, relPath);
  const fileLine = blobUrl ? `PRD file: [\`${relPath}\`](${blobUrl})` : `PRD file: \`${relPath}\``;
  return `${fileLine}\n\n${prdContent}\n\n---\nCreated via \`night-watch prd create\`.`;
}

async function generatePrdWithClaude(
  description: string,
  projectDir: string,
  model?: string,
): Promise<string | null> {
  const bundledTemplatePath = path.join(TEMPLATES_DIR, 'prd-creator.md');
  const installedTemplatePath = path.join(projectDir, 'instructions', 'prd-creator.md');
  const templatePath = fs.existsSync(installedTemplatePath)
    ? installedTemplatePath
    : bundledTemplatePath;

  if (!fs.existsSync(templatePath)) {
    return null;
  }

  const planningPrinciples = fs.readFileSync(templatePath, 'utf-8');
  const prompt = buildPrdPrompt(description, projectDir, planningPrinciples);
  const modelId = model ?? CLAUDE_MODEL_IDS.opus;
  const env = buildNativeClaudeEnv(process.env);

  return await new Promise<string | null>((resolve) => {
    const child = spawn(
      'claude',
      [
        '-p',
        '--verbose',
        '--output-format',
        'stream-json',
        '--include-partial-messages',
        '--model',
        modelId,
        prompt,
      ],
      { env, stdio: ['ignore', 'pipe', 'pipe'] },
    );

    let stdoutBuffer = '';
    let finalResult = '';

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBuffer += chunk.toString('utf-8');

      while (stdoutBuffer.includes('\n')) {
        const newlineIndex = stdoutBuffer.indexOf('\n');
        const line = stdoutBuffer.slice(0, newlineIndex).trim();
        stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);

        if (!line) continue;

        try {
          const payload = JSON.parse(line) as Record<string, unknown>;

          if (payload.type === 'stream_event') {
            const event = payload.event as Record<string, unknown> | undefined;
            const delta = event?.delta as Record<string, unknown> | undefined;
            if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
              process.stdout.write(delta.text);
            }
            continue;
          }

          if (payload.type === 'result' && typeof payload.result === 'string') {
            finalResult = payload.result;
          }
        } catch {
          // Ignore non-JSON metadata lines.
        }
      }
    });

    child.stderr.on('data', (chunk: Buffer) => process.stderr.write(chunk));
    child.on('close', (code) => {
      if (stdoutBuffer.trim().length > 0) {
        try {
          const payload = JSON.parse(stdoutBuffer.trim()) as Record<string, unknown>;
          if (payload.type === 'result' && typeof payload.result === 'string') {
            finalResult = payload.result;
          }
        } catch {
          // Ignore trailing partial data.
        }
      }

      process.stdout.write('\n');
      resolve(code === 0 && finalResult ? extractPrdMarkdown(finalResult) : null);
    });

    child.on('error', () => resolve(null));
  });
}

function runGh(args: string[], cwd: string): string | null {
  const result = spawnSync('gh', args, { cwd, encoding: 'utf-8' });
  if (result.status === 0) return (result.stdout ?? '').trim();
  return null;
}

function createGithubIssue(title: string, prdPath: string, projectDir: string, prdContent: string): string | null {
  const tmpFile = path.join(projectDir, `.prd-issue-body-${Date.now()}.tmp`);
  try {
    const body = buildGithubIssueBody(prdPath, projectDir, prdContent);
    fs.writeFileSync(tmpFile, body, 'utf-8');

    const baseArgs = ['issue', 'create', '--title', `PRD: ${title}`, '--body-file', tmpFile];
    return (
      runGh([...baseArgs, '--label', 'prd'], projectDir) ??
      runGh(baseArgs, projectDir)
    );
  } catch {
    return null;
  } finally {
    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
  }
}

function parseDependencies(content: string): string[] {
  const match =
    content.match(/\*\*Depends on:\*\*\s*(.+)/i) || content.match(/Depends on:\s*(.+)/i);
  if (!match) return [];
  return match[1]
    .split(',')
    .map((d) => d.replace(/`/g, '').trim())
    .filter(Boolean);
}

function isClaimActive(
  claimPath: string,
  maxRuntime: number,
): { active: boolean; hostname?: string; pid?: number } {
  try {
    if (!fs.existsSync(claimPath)) {
      return { active: false };
    }
    const content = fs.readFileSync(claimPath, 'utf-8');
    const claim = JSON.parse(content) as { timestamp: number; hostname?: string; pid?: number };
    const age = Math.floor(Date.now() / 1000) - claim.timestamp;
    if (age < maxRuntime) {
      return { active: true, hostname: claim.hostname, pid: claim.pid };
    }
    return { active: false };
  } catch {
    return { active: false };
  }
}

export function prdCommand(program: Command): void {
  const prd = program.command('prd').description('Manage PRD files');

  prd
    .command('create')
    .description('Generate a new PRD markdown file using Claude')
    .argument('<name>', 'PRD description')
    .option('--number', 'Add auto-numbering prefix to the filename', false)
    .option('--model <model>', 'Claude model to use (e.g. sonnet, opus, or a full model ID)')
    .action(async (name: string, options: IPrdCreateOptions) => {
      const projectDir = process.cwd();
      const prdDir = path.join(projectDir, resolvePrdCreateDir());

      if (!fs.existsSync(prdDir)) {
        fs.mkdirSync(prdDir, { recursive: true });
      }

      const resolvedModel = options.model
        ? (CLAUDE_MODEL_IDS[options.model as keyof typeof CLAUDE_MODEL_IDS] ?? options.model)
        : undefined;
      const modelLabel = resolvedModel ?? CLAUDE_MODEL_IDS.opus;
      dim(`Calling Claude (${modelLabel}) to generate the PRD. It can take several minutes, please hang on!\n`);
      const generated = await generatePrdWithClaude(name, projectDir, resolvedModel);

      if (!generated) {
        uiError('Claude generation failed. Is the provider configured and available?');
        process.exit(1);
      }

      const prdTitle = extractPrdTitle(generated) ?? name;
      const slug = slugify(prdTitle);
      const filename = options.number
        ? `${String(getNextPrdNumber(prdDir)).padStart(2, '0')}-${slug}.md`
        : `${slug}.md`;
      const filePath = path.join(prdDir, filename);

      if (fs.existsSync(filePath)) {
        uiError(`File already exists: ${filePath}`);
        dim('Use a different name or remove the existing file.');
        process.exit(1);
      }

      fs.writeFileSync(filePath, generated, 'utf-8');

      header('PRD Created');
      success(`Created: ${filePath}`);

      const issueUrl = createGithubIssue(prdTitle, filePath, projectDir, generated);
      if (issueUrl) {
        info(`Issue: ${issueUrl}`);
      } else {
        dim('GitHub issue creation skipped (gh not available or not in a GitHub repo).');
      }
    });

  prd
    .command('list')
    .description('List all PRDs with status')
    .option('--json', 'Output as JSON')
    .action(async (options: { json: boolean }) => {
      const projectDir = process.cwd();
      const config = loadConfig(projectDir);
      const absolutePrdDir = path.join(projectDir, config.prdDir);
      const doneDir = path.join(absolutePrdDir, 'done');

      const pending: Array<{
        name: string;
        dependencies: string[];
        claimed: boolean;
        claimInfo?: { hostname: string; pid: number };
      }> = [];

      if (fs.existsSync(absolutePrdDir)) {
        const files = fs.readdirSync(absolutePrdDir).filter((f) => f.endsWith('.md'));
        for (const file of files) {
          const content = fs.readFileSync(path.join(absolutePrdDir, file), 'utf-8');
          const deps = parseDependencies(content);
          const claimPath = path.join(absolutePrdDir, file + CLAIM_FILE_EXTENSION);
          const claimStatus = isClaimActive(claimPath, config.maxRuntime);
          pending.push({
            name: file,
            dependencies: deps,
            claimed: claimStatus.active,
            claimInfo: claimStatus.active
              ? { hostname: claimStatus.hostname!, pid: claimStatus.pid! }
              : undefined,
          });
        }
      }

      const done: Array<{ name: string; dependencies: string[] }> = [];
      if (fs.existsSync(doneDir)) {
        const files = fs.readdirSync(doneDir).filter((f) => f.endsWith('.md'));
        for (const file of files) {
          const content = fs.readFileSync(path.join(doneDir, file), 'utf-8');
          const deps = parseDependencies(content);
          done.push({ name: file, dependencies: deps });
        }
      }

      if (options.json) {
        console.log(JSON.stringify({ pending, done }, null, 2));
        return;
      }

      header('PRD Status');

      if (pending.length === 0 && done.length === 0) {
        dim('  No PRDs found.');
        return;
      }

      const table = createTable({ head: ['Name', 'Status', 'Dependencies'] });
      for (const prdEntry of pending) {
        const status = prdEntry.claimed ? 'claimed' : 'pending';
        const statusDisplay =
          prdEntry.claimed && prdEntry.claimInfo
            ? `claimed (${prdEntry.claimInfo.hostname}:${prdEntry.claimInfo.pid})`
            : status;
        table.push([prdEntry.name, statusDisplay, prdEntry.dependencies.join(', ') || '-']);
      }
      for (const prdEntry of done) {
        table.push([prdEntry.name, 'done', prdEntry.dependencies.join(', ') || '-']);
      }
      console.log(table.toString());
      const claimedCount = pending.filter((p) => p.claimed).length;
      const pendingCount = pending.length - claimedCount;
      info(`${pendingCount} pending, ${claimedCount} claimed, ${done.length} done`);
    });
}
