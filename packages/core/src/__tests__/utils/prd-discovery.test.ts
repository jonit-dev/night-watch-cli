/**
 * Tests for PRD discovery utilities
 * Board mode only - filesystem mode has been removed
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFileSync } from 'child_process';
import { findEligibleBoardIssue } from '../../utils/prd-discovery.js';

let tmpDir: string;
let projectDir: string;

// Mock child_process for gh commands
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return {
    ...actual,
    execFileSync: vi.fn((cmd: string, args: string[]) => {
      if (cmd === 'gh' && args.includes('pr') && args.includes('list')) {
        return ''; // No open PRs by default
      }
      if (cmd === 'gh' && args.includes('issue') && args.includes('list')) {
        return ''; // No open issues by default
      }
      return '';
    }),
  };
});

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-prd-discovery-test-'));
  projectDir = path.join(tmpDir, 'project');
  fs.mkdirSync(projectDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('findEligibleBoardIssue', () => {
  beforeEach(() => {
    vi.mocked(execFileSync).mockImplementation((cmd: string, args: string[]) => {
      if (
        cmd === 'gh' &&
        (args as string[]).includes('pr') &&
        (args as string[]).includes('list')
      ) {
        return '';
      }
      if (
        cmd === 'gh' &&
        (args as string[]).includes('issue') &&
        (args as string[]).includes('list')
      ) {
        return '';
      }
      return '';
    });
  });

  afterEach(() => {
    vi.mocked(execFileSync).mockRestore();
  });

  it('returns null when gh issue list returns empty output', () => {
    vi.mocked(execFileSync).mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'gh' && (args as string[]).includes('issue')) {
        return '';
      }
      return '';
    });

    const result = findEligibleBoardIssue({ projectDir });
    expect(result).toBeNull();
  });

  it('returns null when gh command throws', () => {
    vi.mocked(execFileSync).mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'gh' && (args as string[]).includes('issue')) {
        throw new Error('gh: command not found');
      }
      return '';
    });

    const result = findEligibleBoardIssue({ projectDir });
    expect(result).toBeNull();
  });

  it('returns the first issue when available', () => {
    vi.mocked(execFileSync).mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'gh' && (args as string[]).includes('issue')) {
        return '{"number":1,"title":"Do X","body":"details"}';
      }
      return '';
    });

    const result = findEligibleBoardIssue({ projectDir });
    expect(result).toEqual({ number: 1, title: 'Do X', body: 'details' });
  });

  it('returns first issue when multiple issues available', () => {
    vi.mocked(execFileSync).mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'gh' && (args as string[]).includes('issue')) {
        return [
          '{"number":1,"title":"Issue One","body":"first"}',
          '{"number":2,"title":"Issue Two","body":"second"}',
        ].join('\n');
      }
      return '';
    });

    const result = findEligibleBoardIssue({ projectDir });
    // Returns the first issue in the list
    expect(result).toEqual({ number: 1, title: 'Issue One', body: 'first' });
  });

  it('skips malformed JSON lines and returns first valid issue', () => {
    vi.mocked(execFileSync).mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'gh' && (args as string[]).includes('issue')) {
        return ['not valid json {{{', '{"number":3,"title":"Valid Issue","body":"body text"}'].join(
          '\n',
        );
      }
      return '';
    });

    const result = findEligibleBoardIssue({ projectDir });
    expect(result).toEqual({ number: 3, title: 'Valid Issue', body: 'body text' });
  });
});
