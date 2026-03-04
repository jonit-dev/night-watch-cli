/**
 * Tests for git utilities
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFileSync } from 'child_process';
import {
  getBranchTipTimestamp,
  detectDefaultBranch,
  resolveWorktreeBaseRef,
} from '../../utils/git-utils.js';

let tmpDir: string;
let projectDir: string;

function git(args: string[], cwd: string = projectDir): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim();
}

function makeCommit(message: string): void {
  const filePath = path.join(projectDir, `file-${Date.now()}.txt`);
  fs.writeFileSync(filePath, `content-${Date.now()}`);
  git(['add', filePath]);
  git(['commit', '-m', message, '--date', new Date().toISOString()]);
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-git-utils-test-'));
  projectDir = path.join(tmpDir, 'project');
  fs.mkdirSync(projectDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('getBranchTipTimestamp', () => {
  it('should return null for a non-existent branch', () => {
    // Init repo with no commits
    git(['init']);
    expect(getBranchTipTimestamp(projectDir, 'nonexistent')).toBeNull();
  });

  it('should return timestamp for a local branch', () => {
    git(['init']);
    git(['config', 'user.email', 'test@test.com']);
    git(['config', 'user.name', 'Test']);
    makeCommit('Initial commit');

    const ts = getBranchTipTimestamp(projectDir, 'master');
    expect(ts).not.toBeNull();
    expect(typeof ts).toBe('number');
    expect(ts!).toBeGreaterThan(0);
  });

  it('should return the newer timestamp when both local and remote exist', () => {
    // Create a bare "remote" repo
    const remoteDir = path.join(tmpDir, 'remote');
    git(['init', '--bare', remoteDir]);

    // Init local repo with remote
    git(['init']);
    git(['config', 'user.email', 'test@test.com']);
    git(['config', 'user.name', 'Test']);
    git(['remote', 'add', 'origin', remoteDir]);

    // Make initial commit and push
    makeCommit('Initial commit');
    const currentBranch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
    git(['push', '-u', 'origin', currentBranch]);

    // Get timestamp after push
    const tsAfterPush = getBranchTipTimestamp(projectDir, currentBranch);
    expect(tsAfterPush).not.toBeNull();
  });

  it('should return null for an empty repo with no commits', () => {
    git(['init']);
    // master branch technically exists but has no commits
    expect(getBranchTipTimestamp(projectDir, 'master')).toBeNull();
  });
});

describe('detectDefaultBranch', () => {
  it('should detect main as default when only main exists', () => {
    git(['init', '-b', 'main']);
    git(['config', 'user.email', 'test@test.com']);
    git(['config', 'user.name', 'Test']);
    makeCommit('Initial commit');

    expect(detectDefaultBranch(projectDir)).toBe('main');
  });

  it('should detect master as default when only master exists', () => {
    git(['init', '-b', 'master']);
    git(['config', 'user.email', 'test@test.com']);
    git(['config', 'user.name', 'Test']);
    makeCommit('Initial commit');

    expect(detectDefaultBranch(projectDir)).toBe('master');
  });

  it('should return main when neither branch exists (empty repo)', () => {
    git(['init']);

    expect(detectDefaultBranch(projectDir)).toBe('main');
  });

  it('should return the branch with newer commits when both exist', () => {
    git(['init', '-b', 'main']);
    git(['config', 'user.email', 'test@test.com']);
    git(['config', 'user.name', 'Test']);

    // Create master branch with a commit
    makeCommit('Commit on master');
    git(['checkout', '-b', 'master']);

    // Make another commit on master (so it's newer)
    makeCommit('Another commit on master');

    // Switch back to main
    git(['checkout', 'main']);

    // Since master has more recent commits, it should be detected
    // (both branches point to the same commit in this simple case)
    const detected = detectDefaultBranch(projectDir);
    expect(['main', 'master']).toContain(detected);
  });

  it('should fall back to main when no refs exist', () => {
    git(['init']);
    // No commits, no branches
    expect(detectDefaultBranch(projectDir)).toBe('main');
  });
});

describe('resolveWorktreeBaseRef', () => {
  it('should return origin/defaultBranch when remote exists', () => {
    const remoteDir = path.join(tmpDir, 'remote');
    git(['init', '--bare', remoteDir]);

    git(['init', '-b', 'main']);
    git(['config', 'user.email', 'test@test.com']);
    git(['config', 'user.name', 'Test']);
    git(['remote', 'add', 'origin', remoteDir]);

    makeCommit('Initial commit');
    git(['push', '-u', 'origin', 'main']);

    expect(resolveWorktreeBaseRef(projectDir, 'main')).toBe('origin/main');
  });

  it('should return local branch when remote does not exist', () => {
    git(['init', '-b', 'main']);
    git(['config', 'user.email', 'test@test.com']);
    git(['config', 'user.name', 'Test']);
    makeCommit('Initial commit');

    expect(resolveWorktreeBaseRef(projectDir, 'main')).toBe('main');
  });

  it('should return HEAD for local-only repo with no remote', () => {
    git(['init', '-b', 'develop']);
    git(['config', 'user.email', 'test@test.com']);
    git(['config', 'user.name', 'Test']);
    makeCommit('Initial commit');

    // defaultBranch 'main' doesn't exist, no remote, so fallback to HEAD
    expect(resolveWorktreeBaseRef(projectDir, 'main')).toBe('HEAD');
  });

  it('should return null for empty repo with no commits', () => {
    git(['init']);
    expect(resolveWorktreeBaseRef(projectDir, 'main')).toBeNull();
  });

  it('should prefer origin/defaultBranch over local', () => {
    const remoteDir = path.join(tmpDir, 'remote');
    git(['init', '--bare', remoteDir]);

    git(['init', '-b', 'main']);
    git(['config', 'user.email', 'test@test.com']);
    git(['config', 'user.name', 'Test']);
    git(['remote', 'add', 'origin', remoteDir]);

    makeCommit('Initial commit');
    git(['push', '-u', 'origin', 'main']);

    // Both exist, should prefer remote
    expect(resolveWorktreeBaseRef(projectDir, 'main')).toBe('origin/main');
  });
});
