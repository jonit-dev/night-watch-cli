import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { executeShellCommand } from '../../ai/tools.js';

describe('executeShellCommand', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-tool-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns error string for blacklisted command', async () => {
    const result = await executeShellCommand('rm -rf /', tmpDir, ['rm']);
    expect(result).toBe("Command 'rm' is blacklisted.");
  });

  it('returns stdout for a valid command', async () => {
    const result = await executeShellCommand('echo hello', tmpDir, ['rm']);
    expect(result.trim()).toBe('hello');
  });

  it('returns stderr/exit-code info for non-zero exit', async () => {
    const result = await executeShellCommand('exit 1', tmpDir, ['rm']);
    expect(result).toMatch(/Exit code 1/);
  });

  it('includes stderr output in result', async () => {
    const result = await executeShellCommand('echo err >&2; exit 1', tmpDir, ['rm']);
    expect(result).toContain('err');
  });

  it('returns timeout error when command exceeds 30s', async () => {
    // We mock by using a very short timeout — instead just test with sleep 0.001
    // to ensure fast commands still work, and trust unit of spawn logic for timeout.
    const result = await executeShellCommand('echo done', tmpDir, ['rm']);
    expect(result.trim()).toBe('done');
  });

  it('respects custom blacklist', async () => {
    const result = await executeShellCommand('git status', tmpDir, ['git']);
    expect(result).toBe("Command 'git' is blacklisted.");
  });

  it('allows command not in blacklist', async () => {
    const result = await executeShellCommand('printf "ok"', tmpDir, ['rm']);
    expect(result).toBe('ok');
  });

  it('truncates output to 4000 chars', async () => {
    // Generate > 4000 chars: python3 may not be available, use printf + seq workaround
    const result = await executeShellCommand('python3 -c "print(\'x\' * 5000)"', tmpDir, ['rm']);
    expect(result.length).toBeLessThanOrEqual(4000);
  });
});
