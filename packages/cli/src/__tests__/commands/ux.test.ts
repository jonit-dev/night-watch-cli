import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getDefaultConfig } from '@night-watch/core/config.js';

import { applyUxCliOverrides, uxCommand } from '@/cli/commands/ux.js';

describe('ux command', () => {
  let tempDir: string;
  let mockCwd: ReturnType<typeof vi.spyOn>;
  let mockExit: ReturnType<typeof vi.spyOn>;
  let mockStdoutWrite: ReturnType<typeof vi.spyOn>;
  let stdout = '';

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'night-watch-ux-command-'));
    stdout = '';
    mockCwd = vi.spyOn(process, 'cwd').mockReturnValue(tempDir);
    mockExit = vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });
    mockStdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdout += String(chunk);
      return true;
    });
  });

  afterEach(() => {
    mockCwd.mockRestore();
    mockExit.mockRestore();
    mockStdoutWrite.mockRestore();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('applies timeout and provider overrides', () => {
    const config = getDefaultConfig();
    const overridden = applyUxCliOverrides(config, { timeout: '1200', provider: 'codex' });

    expect(overridden.ux.maxRuntime).toBe(1200);
    expect(overridden._cliProviderOverride).toBe('codex');
    expect(config.provider).toBe('claude');
  });

  it('supports dry-run JSON while disabled', async () => {
    const program = new Command();
    program.exitOverride();
    uxCommand(program);

    await expect(program.parseAsync(['node', 'test', 'ux', '--dry-run', '--json'])).rejects.toThrow(
      'process.exit(0)',
    );

    const output = JSON.parse(stdout) as { dryRun: boolean; config: { enabled: boolean } };
    expect(output.dryRun).toBe(true);
    expect(output.config.enabled).toBe(false);
  });
});
