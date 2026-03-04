/**
 * Tests for worktree management utilities
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFileSync } from 'child_process';
import {
  prepareBranchWorktree,
  prepareDetachedWorktree,
  cleanupWorktrees,
} from '../../utils/worktree-manager.js';

let tmpDir: string;
let projectDir: string;
let remoteDir: string;

// Check if git is available at runtime (not module load time)
function isGitAvailable(): boolean {
  try {
    execFileSync('git', ['--version'], { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    return true;
  } catch {
    return false;
  }
}

function git(args: string[], cwd: string = projectDir): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim();
}

function makeCommit(message: string, repoDir: string = projectDir): void {
  const filePath = path.join(repoDir, `file-${Date.now()}.txt`);
  fs.writeFileSync(filePath, `content-${Date.now()}`);
  git(['add', filePath], repoDir);
  git(['commit', '-m', message], repoDir);
}

// Skip all tests if git is not available
describe.skipIf(!isGitAvailable())('worktree-manager', () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-worktree-test-'));
    projectDir = path.join(tmpDir, 'project');
    remoteDir = path.join(tmpDir, 'remote');

    // Create bare remote repo
    git(['init', '--bare', remoteDir]);

    // Create local repo with remote
    fs.mkdirSync(projectDir);
    git(['init', '-b', 'main']);
    git(['config', 'user.email', 'test@test.com']);
    git(['config', 'user.name', 'Test']);
    git(['remote', 'add', 'origin', remoteDir]);

    // Make initial commit and push
    makeCommit('Initial commit');
    git(['push', '-u', 'origin', 'main']);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('prepareBranchWorktree', () => {
    it('should create a worktree for an existing local branch', () => {
      // Create a local branch
      git(['checkout', '-b', 'feature-test']);
      makeCommit('Feature commit');
      git(['checkout', 'main']);

      const worktreeDir = path.join(tmpDir, 'worktree-1');
      const result = prepareBranchWorktree({
        projectDir,
        worktreeDir,
        branchName: 'feature-test',
        defaultBranch: 'main',
      });

      expect(result.success).toBe(true);
      expect(result.worktreePath).toBe(worktreeDir);
      expect(fs.existsSync(worktreeDir)).toBe(true);
    });

    it('should create a new branch from base ref when branch does not exist', () => {
      const worktreeDir = path.join(tmpDir, 'worktree-2');
      const result = prepareBranchWorktree({
        projectDir,
        worktreeDir,
        branchName: 'new-feature',
        defaultBranch: 'main',
      });

      expect(result.success).toBe(true);
      expect(fs.existsSync(worktreeDir)).toBe(true);

      // Verify branch was created
      const branches = git(['branch', '--list', 'new-feature']);
      expect(branches).toContain('new-feature');
    });

    it('should return error when no valid base ref exists', () => {
      // Create a fresh repo with no commits
      const emptyDir = path.join(tmpDir, 'empty');
      fs.mkdirSync(emptyDir);
      git(['init'], emptyDir);

      const worktreeDir = path.join(tmpDir, 'worktree-empty');
      const result = prepareBranchWorktree({
        projectDir: emptyDir,
        worktreeDir,
        branchName: 'new-branch',
        defaultBranch: 'main',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('No valid base ref');
    });

    it('should track remote branch when it exists', () => {
      // Push a branch to remote
      git(['checkout', '-b', 'remote-feature']);
      makeCommit('Remote feature commit');
      git(['push', '-u', 'origin', 'remote-feature']);
      git(['checkout', 'main']);

      // Delete local branch so only remote exists
      git(['branch', '-D', 'remote-feature']);

      const worktreeDir = path.join(tmpDir, 'worktree-3');
      const result = prepareBranchWorktree({
        projectDir,
        worktreeDir,
        branchName: 'remote-feature',
        defaultBranch: 'main',
      });

      expect(result.success).toBe(true);
      expect(fs.existsSync(worktreeDir)).toBe(true);
    });
  });

  describe('prepareDetachedWorktree', () => {
    it('should create a detached worktree', () => {
      const worktreeDir = path.join(tmpDir, 'worktree-detached');
      const result = prepareDetachedWorktree({
        projectDir,
        worktreeDir,
        defaultBranch: 'main',
      });

      expect(result.success).toBe(true);
      expect(fs.existsSync(worktreeDir)).toBe(true);

      // Verify it's detached
      const headRef = git(['rev-parse', '--abbrev-ref', 'HEAD'], worktreeDir);
      expect(headRef).toBe('HEAD');
    });

    it('should remove unregistered stale directory', () => {
      const worktreeDir = path.join(tmpDir, 'worktree-stale');

      // Create a directory that looks like a stale worktree
      fs.mkdirSync(worktreeDir, { recursive: true });
      fs.writeFileSync(path.join(worktreeDir, 'stale-file.txt'), 'stale content');

      const result = prepareDetachedWorktree({
        projectDir,
        worktreeDir,
        defaultBranch: 'main',
      });

      expect(result.success).toBe(true);
      // Stale file should be gone
      expect(fs.existsSync(path.join(worktreeDir, 'stale-file.txt'))).toBe(false);
    });

    it('should return error when no valid base ref exists', () => {
      const emptyDir = path.join(tmpDir, 'empty');
      fs.mkdirSync(emptyDir);
      git(['init'], emptyDir);

      const worktreeDir = path.join(tmpDir, 'worktree-empty-detached');
      const result = prepareDetachedWorktree({
        projectDir: emptyDir,
        worktreeDir,
        defaultBranch: 'main',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('No valid base ref');
    });
  });

  describe('cleanupWorktrees', () => {
    it('should remove matching worktrees', () => {
      // Create some worktrees
      const wt1 = path.join(tmpDir, 'project-nw-worker1');
      const wt2 = path.join(tmpDir, 'project-nw-worker2');

      prepareBranchWorktree({
        projectDir,
        worktreeDir: wt1,
        branchName: 'nw-worker1',
        defaultBranch: 'main',
      });
      prepareBranchWorktree({
        projectDir,
        worktreeDir: wt2,
        branchName: 'nw-worker2',
        defaultBranch: 'main',
      });

      const removed = cleanupWorktrees(projectDir);

      expect(removed.length).toBe(2);
      expect(removed).toContain(wt1);
      expect(removed).toContain(wt2);
    });

    it('should only remove worktrees matching scope', () => {
      const wt1 = path.join(tmpDir, 'project-nw-scope1');
      const wt2 = path.join(tmpDir, 'project-nw-scope2');
      const wt3 = path.join(tmpDir, 'project-other');

      prepareBranchWorktree({
        projectDir,
        worktreeDir: wt1,
        branchName: 'nw-scope1',
        defaultBranch: 'main',
      });
      prepareBranchWorktree({
        projectDir,
        worktreeDir: wt2,
        branchName: 'nw-scope2',
        defaultBranch: 'main',
      });
      prepareBranchWorktree({
        projectDir,
        worktreeDir: wt3,
        branchName: 'other-branch',
        defaultBranch: 'main',
      });

      // Only clean up with specific scope
      const removed = cleanupWorktrees(projectDir, 'scope');

      expect(removed.length).toBe(1);
      expect(removed).toContain(wt1);
      expect(removed).not.toContain(wt3);
    });

    it('should return empty array when no matching worktrees', () => {
      const removed = cleanupWorktrees(projectDir, 'nonexistent');
      expect(removed).toEqual([]);
    });
  });
});
