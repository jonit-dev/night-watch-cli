/**
 * Board tool definitions for AI provider calls.
 */

import {
  CATEGORY_LABELS,
  HORIZON_LABELS,
  PRIORITY_LABELS,
  createBoardProvider,
  isValidCategory,
  isValidHorizon,
  isValidPriority,
} from '@night-watch/core';
import type { BoardColumnName, IBoardProviderConfig } from '@night-watch/core';
import { execFileSync } from 'child_process';

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
 */
export function buildBoardTools(): IAnthropicTool[] {
  const columnEnum = ['Draft', 'Ready', 'In Progress', 'Review', 'Done'];
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
            enum: [...PRIORITY_LABELS],
            description:
              'Priority label: P0 (Critical), P1 (High), P2 (Normal). Infer from urgency and impact.',
          },
          category: {
            type: 'string',
            enum: [...CATEGORY_LABELS],
            description:
              'Category label aligned with roadmap theme (e.g. reliability, quality, product, ux, provider, team, platform, intelligence, ecosystem).',
          },
          horizon: {
            type: 'string',
            enum: [...HORIZON_LABELS],
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
 * Returns an Anthropic tool definition that lets an agent query the project codebase
 * by spawning the configured AI provider (claude/codex) in the project directory.
 * Use this instead of rolling custom file-read/grep tools.
 */
export function buildCodebaseQueryTool(provider: 'claude' | 'codex' = 'claude'): IAnthropicTool {
  return {
    name: 'query_codebase',
    description:
      `Run a one-shot question against the project codebase using ${provider}. ` +
      'Use this whenever you need to reference actual code — find a function, read a file, check an endpoint, etc. ' +
      'The result will contain real code snippets you can quote directly in your reply. ' +
      'Always call this before making a specific code claim or pointing at a file.',
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
): string {
  const args =
    provider === 'claude'
      ? ['-p', prompt, '--dangerously-skip-permissions']
      : ['--quiet', '--yolo', '--prompt', prompt];

  try {
    const output = execFileSync(provider, args, {
      cwd: projectPath,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60_000,
      maxBuffer: 256 * 1024,
      env: { ...process.env, ...(providerEnv ?? {}) },
    });
    return output.trim().slice(0, 6000) || '(no output)';
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `Provider query failed: ${msg}`;
  }
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
