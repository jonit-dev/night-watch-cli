/**
 * Board tool definitions for AI provider calls.
 */

import {
  CATEGORY_LABELS,
  HORIZON_LABELS,
  PRIORITY_LABELS,
  createBoardProvider,
  createLogger,
  isValidCategory,
  isValidHorizon,
  isValidPriority,
} from '@night-watch/core';
import type { BoardColumnName, IBoardProviderConfig } from '@night-watch/core';

const log = createLogger('tools');
import { execFileSync, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { buildSubprocessEnv } from '../utils.js';

/**
 * Return the names of all labels that currently exist in the repo.
 * Falls back to an empty array on any error (e.g. gh not authenticated, no repo).
 */
export function fetchRepoLabels(projectPath: string): string[] {
  try {
    const out = execFileSync('gh', ['label', 'list', '--json', 'name', '--limit', '200'], {
      cwd: projectPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 10_000,
    });
    return (JSON.parse(out) as Array<{ name: string }>).map((l) => l.name);
  } catch {
    return [];
  }
}

export interface IAnthropicTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

/** A single tool executor: takes parsed input, returns a result string. */
export type ToolHandler = (input: Record<string, unknown>) => Promise<string>;

/** Maps tool names to their executor functions. Built at the call site. */
export type ToolRegistry = Map<string, ToolHandler>;

/**
 * Returns Anthropic tool definitions for board operations.
 * Pass `repoLabels` (from `fetchRepoLabels`) to constrain label enums to what actually
 * exists in the repo — prevents the agent from picking labels that don't exist yet.
 */
export function buildBoardTools(repoLabels?: string[]): IAnthropicTool[] {
  const columnEnum = ['Draft', 'Ready', 'In Progress', 'Review', 'Done'];

  // Filter a label group to the subset that exists in the repo.
  // Falls back to the full group if repo labels are unknown or none match.
  const intersect = (group: readonly string[]): string[] => {
    if (!repoLabels?.length) return [...group];
    const hit = group.filter((l) => repoLabels.includes(l));
    return hit.length > 0 ? hit : [...group];
  };

  return [
    {
      name: 'open_github_issue',
      description:
        'Create a new GitHub issue on the project board. Always infer and set priority, category, and horizon based on the issue content and context.',
      input_schema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Short, descriptive issue title.' },
          body: { type: 'string', description: 'Detailed issue description in Markdown.' },
          column: {
            type: 'string',
            enum: columnEnum,
            description: "Board column to place the issue in. Defaults to 'Draft'.",
          },
          priority: {
            type: 'string',
            enum: intersect(PRIORITY_LABELS),
            description:
              'Priority label: P0 (Critical), P1 (High), P2 (Normal). Infer from urgency and impact.',
          },
          category: {
            type: 'string',
            enum: intersect(CATEGORY_LABELS),
            description:
              'Category label aligned with roadmap theme (e.g. reliability, quality, product, ux, provider, team, platform, intelligence, ecosystem).',
          },
          horizon: {
            type: 'string',
            enum: intersect(HORIZON_LABELS),
            description:
              'Delivery horizon: short-term (0-6w), medium-term (6w-4m), long-term (4-12m).',
          },
        },
        required: ['title', 'body', 'priority', 'category', 'horizon'],
      },
    },
    {
      name: 'list_issues',
      description: 'List issues on the project board, optionally filtered by column.',
      input_schema: {
        type: 'object',
        properties: {
          column: {
            type: 'string',
            enum: columnEnum,
            description: 'Filter by column. Omit to list all issues.',
          },
        },
      },
    },
    {
      name: 'move_issue',
      description: 'Move a GitHub issue to a different column on the board.',
      input_schema: {
        type: 'object',
        properties: {
          issue_number: { type: 'number', description: 'The GitHub issue number.' },
          column: { type: 'string', enum: columnEnum, description: 'Target column.' },
        },
        required: ['issue_number', 'column'],
      },
    },
    {
      name: 'comment_on_issue',
      description: 'Add a comment to an existing GitHub issue.',
      input_schema: {
        type: 'object',
        properties: {
          issue_number: { type: 'number', description: 'The GitHub issue number.' },
          body: { type: 'string', description: 'Comment text in Markdown.' },
        },
        required: ['issue_number', 'body'],
      },
    },
    {
      name: 'close_issue',
      description: 'Close a GitHub issue.',
      input_schema: {
        type: 'object',
        properties: {
          issue_number: { type: 'number', description: 'The GitHub issue number.' },
        },
        required: ['issue_number'],
      },
    },
  ];
}

/**
 * Returns tool definitions for direct filesystem access within the project.
 * read_roadmap: read ROADMAP.md without needing a path.
 * read_file: read any file by relative path.
 * These are synchronous and cheap — no subprocess needed.
 */
export function buildFilesystemTools(): IAnthropicTool[] {
  return [
    {
      name: 'read_roadmap',
      description:
        'Read the ROADMAP.md file for this project. Use this when asked about roadmap items, priorities, task status, or what has been done vs pending.',
      input_schema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'read_file',
      description:
        'Read any file in the project by relative path. Use this to read a specific file by name or path — it is instant and does NOT spawn an AI subprocess. ' +
        'Prefer this over query_codebase whenever you want to see the contents of a known file.',
      input_schema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description:
              'Relative path from the project root (e.g. "packages/slack/src/deliberation.ts") or just a filename (e.g. "deliberation.ts") for fuzzy lookup.',
          },
        },
        required: ['path'],
      },
    },
  ];
}

/**
 * Execute a read_roadmap tool call. Returns raw file content or a not-found message.
 */
export function executeReadRoadmap(projectPath: string, roadmapFilename = 'ROADMAP.md'): string {
  const fullPath = path.join(projectPath, roadmapFilename);
  if (!fs.existsSync(fullPath)) return `ROADMAP.md not found at ${fullPath}`;
  return fs.readFileSync(fullPath, 'utf-8');
}

/**
 * Execute a read_file tool call. Validates the path stays within the project.
 * If the path is just a filename (no directory separator) and is not found at the exact
 * relative path, fall back to a recursive search of the project tree.
 */
export function executeReadFile(relPath: string, projectPath: string): string {
  const resolved = path.resolve(projectPath, relPath);
  if (!resolved.startsWith(path.resolve(projectPath))) {
    return 'Error: path outside project directory.';
  }

  // Exact path lookup
  if (fs.existsSync(resolved)) {
    const stat = fs.statSync(resolved);
    if (stat.isDirectory()) return `${relPath} is a directory, not a file.`;
    const content = fs.readFileSync(resolved, 'utf-8');
    const MAX = 10_000;
    return content.length > MAX ? content.slice(0, MAX) + `\n\n[truncated — ${content.length} chars total]` : content;
  }

  // Fuzzy fallback: if the caller passed just a filename, search the tree
  if (!relPath.includes('/') && !relPath.includes('\\')) {
    const matches = findFilesInProject(relPath, projectPath);
    if (matches.length === 1) {
      const rel = path.relative(projectPath, matches[0]);
      const content = fs.readFileSync(matches[0], 'utf-8');
      const MAX = 10_000;
      const body = content.length > MAX ? content.slice(0, MAX) + `\n\n[truncated — ${content.length} chars total]` : content;
      return `// Found at: ${rel}\n${body}`;
    }
    if (matches.length > 1) {
      const rels = matches.map((m) => path.relative(projectPath, m));
      return `Multiple files named "${relPath}" found — please specify the full path:\n${rels.map((r) => `  ${r}`).join('\n')}`;
    }
  }

  return `File not found: ${relPath}`;
}

/**
 * Recursively find all files with the given filename under `dir`.
 * Skips node_modules, .git, and dist to keep it fast.
 */
function findFilesInProject(filename: string, dir: string, depth = 0): string[] {
  const SKIP = new Set(['node_modules', '.git', 'dist', '.turbo', 'coverage', '.next']);
  const MAX_DEPTH = 8;
  if (depth > MAX_DEPTH) return [];
  const results: string[] = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (SKIP.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isFile() && entry.name === filename) {
        results.push(full);
      } else if (entry.isDirectory()) {
        results.push(...findFilesInProject(filename, full, depth + 1));
      }
    }
  } catch {
    // ignore permission errors
  }
  return results;
}

/**
 * Returns an Anthropic tool definition that lets an agent query the project codebase
 * by spawning the configured AI provider (claude/codex) in the project directory.
 * Use this instead of rolling custom file-read/grep tools.
 */
export function buildCodebaseQueryTool(provider: 'claude' | 'codex' = 'claude'): IAnthropicTool {
  return {
    name: 'query_codebase',
    description:
      `Run an AI-powered analysis of the project codebase using ${provider}. ` +
      'Use this for open-ended searches: finding all usages of a function, tracing a flow across multiple files, or answering "how does X work". ' +
      'Do NOT use this just to read a specific file by path — use read_file for that (it is instant). ' +
      'query_codebase spawns a subprocess and takes 30-120 seconds; only call it when read_file is insufficient.',
    input_schema: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description:
            'What you want to know about the codebase. Be specific: "show me the aggregation route handler and any pagination/limit logic" is better than "find the aggregation file".',
        },
      },
      required: ['prompt'],
    },
  };
}

/**
 * Execute a query_codebase tool call by spawning the AI provider synchronously.
 * Returns the provider output (code snippets, explanations) as a string.
 */
export function executeCodebaseQuery(
  prompt: string,
  projectPath: string,
  provider: 'claude' | 'codex' = 'claude',
  providerEnv?: Record<string, string>,
): Promise<string> {
  const args =
    provider === 'claude'
      ? ['-p', prompt, '--dangerously-skip-permissions']
      : ['--quiet', '--yolo', '--prompt', prompt];

  const TIMEOUT_MS = 120_000;
  const MAX_OUTPUT = 512 * 1024;

  return new Promise((resolve) => {
    const child = spawn(provider, args, {
      cwd: projectPath,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: buildSubprocessEnv(providerEnv ?? {}),
    });

    let stdout = '';
    let stderr = '';
    let killed = false;

    child.stdout.setEncoding('utf-8');
    child.stderr.setEncoding('utf-8');

    child.stdout.on('data', (chunk: string) => {
      if (stdout.length < MAX_OUTPUT) stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      if (stderr.length < MAX_OUTPUT) stderr += chunk;
    });

    const timer = setTimeout(() => {
      killed = true;
      child.kill('SIGTERM');
    }, TIMEOUT_MS);

    child.on('error', (err) => {
      clearTimeout(timer);
      log.error('query_codebase spawn failed', { provider, error: String(err) });
      resolve(`Provider query failed: ${String(err)}`);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (killed) {
        log.error('query_codebase timed out', {
          provider,
          projectPath,
          timeoutMs: TIMEOUT_MS,
          stdoutChars: stdout.length,
          stderrPreview: stderr.trim().slice(0, 300),
        });
        resolve(`Provider query failed: timed out after ${TIMEOUT_MS / 1000}s`);
        return;
      }
      if (code !== 0) {
        const detail = stderr.trim() ? ` | stderr: ${stderr.trim().slice(0, 300)}` : '';
        log.error('query_codebase subprocess failed', {
          provider,
          projectPath,
          exitCode: String(code),
          stderrPreview: stderr.trim().slice(0, 300),
        });
        resolve(`Provider query failed: exit code ${code}${detail}`);
        return;
      }
      resolve(stdout.trim().slice(0, 6000) || '(no output)');
    });
  });
}

/**
 * Execute a single board tool call and return a human-readable result string.
 */
export async function executeBoardTool(
  name: string,
  input: Record<string, unknown>,
  boardConfig: IBoardProviderConfig,
  projectPath: string,
): Promise<string> {
  const provider = createBoardProvider(boardConfig, projectPath);

  switch (name) {
    case 'open_github_issue': {
      const labels: string[] = [];
      const priority = String(input.priority ?? '');
      const category = String(input.category ?? '');
      const horizon = String(input.horizon ?? '');
      if (isValidPriority(priority)) labels.push(priority);
      if (isValidCategory(category)) labels.push(category);
      if (isValidHorizon(horizon)) labels.push(horizon);
      const issue = await provider.createIssue({
        title: String(input.title ?? ''),
        body: String(input.body ?? ''),
        column: (input.column as BoardColumnName | undefined) ?? 'Draft',
        labels: labels.length > 0 ? labels : undefined,
      });
      return JSON.stringify({ number: issue.number, url: issue.url, title: issue.title, labels });
    }
    case 'list_issues': {
      const issues = input.column
        ? await provider.getIssuesByColumn(input.column as BoardColumnName)
        : await provider.getAllIssues();
      return JSON.stringify(
        issues.map((i) => ({ number: i.number, title: i.title, column: i.column, url: i.url })),
      );
    }
    case 'move_issue': {
      await provider.moveIssue(Number(input.issue_number), input.column as BoardColumnName);
      return `Issue #${input.issue_number} moved to ${String(input.column)}.`;
    }
    case 'comment_on_issue': {
      await provider.commentOnIssue(Number(input.issue_number), String(input.body ?? ''));
      return `Comment added to issue #${input.issue_number}.`;
    }
    case 'close_issue': {
      await provider.closeIssue(Number(input.issue_number));
      return `Issue #${input.issue_number} closed.`;
    }
    default:
      return `Unknown tool: ${name}`;
  }
}
