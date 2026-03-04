/**
 * Tests for PRD discovery utilities
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { findEligiblePrd, sortPrdsByPriority } from '../../utils/prd-discovery.js';

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
  it('should return null when no PRD files exist', () => {
    expect(
      findEligiblePrd({
        prdDir,
        projectDir,
        maxRuntime: 7200,
      }),
    ).toBeNull();
  });

  it('should return the first eligible PRD', () => {
    fs.writeFileSync(path.join(prdDir, 'phase1.md'), '# Phase 1');

    const result = findEligiblePrd({
      prdDir,
      projectDir,
      maxRuntime: 7200,
    });

    expect(result).toBe('phase1.md');
  });

  it('should skip PRD with unmet dependencies', () => {
    fs.writeFileSync(path.join(prdDir, 'phase1.md'), '# Phase 1');
    fs.writeFileSync(path.join(prdDir, 'phase2.md'), 'Depends on: `phase1`');

    const result = findEligiblePrd({
      prdDir,
      projectDir,
      maxRuntime: 7200,
    });

    // phase2 depends on phase1 which is not done, so phase1 should be returned
    expect(result).toBe('phase1.md');
  });

  it('should return PRD with met dependencies', () => {
    // phase1 is done
    fs.writeFileSync(path.join(prdDir, 'done', 'phase1.md'), '# Phase 1');
    // phase2 depends on phase1
    fs.writeFileSync(path.join(prdDir, 'phase2.md'), 'Depends on: `phase1`');

    const result = findEligiblePrd({
      prdDir,
      projectDir,
      maxRuntime: 7200,
    });

    expect(result).toBe('phase2.md');
  });

  it('should respect priority ordering', () => {
    fs.writeFileSync(path.join(prdDir, 'phase1.md'), '# Phase 1');
    fs.writeFileSync(path.join(prdDir, 'phase2.md'), '# Phase 2');
    fs.writeFileSync(path.join(prdDir, 'phase3.md'), '# Phase 3');

    const result = findEligiblePrd({
      prdDir,
      projectDir,
      maxRuntime: 7200,
      prdPriority: 'phase3:phase2:phase1',
    });

    expect(result).toBe('phase3.md');
  });

  it('should skip PRD if claimed', () => {
    fs.writeFileSync(path.join(prdDir, 'phase1.md'), '# Phase 1');
    // Create a claim file
    fs.writeFileSync(
      path.join(prdDir, 'phase1.md.claim'),
      JSON.stringify({ timestamp: Math.floor(Date.now() / 1000), hostname: 'test', pid: 12345 }),
    );

    const result = findEligiblePrd({
      prdDir,
      projectDir,
      maxRuntime: 7200,
    });

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
