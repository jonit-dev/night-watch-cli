/**
 * Tests for PRD discovery utilities
 * Board mode only - filesystem mode has been removed
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFileSync } from 'child_process';
import {
  findEligibleBoardIssue,
  findEligiblePrd,
  sortPrdsByPriority,
} from '../../utils/prd-discovery.js';

let tmpDir: string;
let prdDir: string;
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
  prdDir = path.join(projectDir, 'docs', 'prds');
  fs.mkdirSync(prdDir, { recursive: true });
  fs.mkdirSync(path.join(prdDir, 'done'), { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('sortPrdsByPriority', () => {
  it('should return files in original order when no priority list', () => {
    const files = ['a.md', 'b.md', 'c.md'];
    expect(sortPrdsByPriority(files, [])).toEqual(files);
  });

  it('should prioritize files matching priority list', () => {
    const files = ['c.md', 'a.md', 'b.md'];
    const priority = ['a', 'b'];
    expect(sortPrdsByPriority(files, priority)).toEqual(['a.md', 'b.md', 'c.md']);
  });

  it('should handle priority items not in files', () => {
    const files = ['a.md', 'c.md'];
    const priority = ['b', 'a'];
    expect(sortPrdsByPriority(files, priority)).toEqual(['a.md', 'c.md']);
  });

  it('should preserve order of non-priority files', () => {
    const files = ['z.md', 'a.md', 'm.md'];
    const priority = ['a'];
    expect(sortPrdsByPriority(files, priority)).toEqual(['a.md', 'z.md', 'm.md']);
  });
});

describe('findEligiblePrd', () => {
  // Filesystem mode is deprecated - function always returns null
  it('should return null (filesystem mode deprecated)', () => {
    fs.writeFileSync(path.join(prdDir, 'phase1.md'), '# Phase 1');

    const result = findEligiblePrd({
      prdDir,
      projectDir,
      maxRuntime: 7200,
    });

    // Filesystem mode removed - always returns null
    expect(result).toBeNull();
  });

  it('should return null even with priority ordering (deprecated)', () => {
    fs.writeFileSync(path.join(prdDir, 'phase1.md'), '# Phase 1');
    fs.writeFileSync(path.join(prdDir, 'phase2.md'), '# Phase 2');
    fs.writeFileSync(path.join(prdDir, 'phase3.md'), '# Phase 3');

    const result = findEligiblePrd({
      prdDir,
      projectDir,
      maxRuntime: 7200,
      prdPriority: 'phase3:phase2:phase1',
    });

    // Filesystem mode removed - always returns null
    expect(result).toBeNull();
  });

  it('should return null when PRD dir does not exist', () => {
    fs.rmSync(prdDir, { recursive: true, force: true });

    const result = findEligiblePrd({
      prdDir,
      projectDir,
      maxRuntime: 7200,
    });

    expect(result).toBeNull();
  });
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
