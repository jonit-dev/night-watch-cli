import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

vi.mock('@night-watch/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@night-watch/core')>();
  return {
    ...actual,
    createSpinner: vi.fn(() => ({
      fail: vi.fn(),
      start: vi.fn(),
      succeed: vi.fn(),
    })),
    dim: vi.fn(),
    executeScriptWithOutput: vi.fn(),
    getScriptPath: vi.fn((name: string) => `/night-watch/scripts/${name}`),
    header: vi.fn(),
    info: vi.fn(),
    loadConfig: vi.fn(),
  };
});

vi.mock('@/cli/commands/shared/feedback.js', () => ({
  recordJobOutcome: vi.fn(),
}));

vi.mock('../../commands/shared/feedback.js', () => ({
  recordJobOutcome: vi.fn(),
}));

vi.mock('@/cli/commands/shared/env-builder.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/cli/commands/shared/env-builder.js')>();
  return {
    ...actual,
    maybeApplyCronSchedulingDelay: vi.fn(async () => ({})),
  };
});

vi.mock('../../commands/shared/env-builder.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../commands/shared/env-builder.js')>();
  return {
    ...actual,
    maybeApplyCronSchedulingDelay: vi.fn(async () => ({})),
  };
});

import { getDefaultConfig } from '@night-watch/core';
import type { INightWatchConfig } from '@night-watch/core/types.js';
import { executeScriptWithOutput, loadConfig } from '@night-watch/core';
import { recordJobOutcome } from '../../commands/shared/feedback.js';
import {
  applyCliOverrides,
  buildEnvVars,
  optimizeCommand,
  type IOptimizeOptions,
} from '@/cli/commands/optimize.js';

function buildProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.configureOutput({
    writeErr: () => {},
    writeOut: () => {},
  });
  optimizeCommand(program);
  return program;
}

function createConfig(overrides: Partial<INightWatchConfig> = {}): INightWatchConfig {
  const defaults = getDefaultConfig();
  return {
    ...defaults,
    optimizer: {
      ...defaults.optimizer,
      enabled: true,
      maxRuntime: 1800,
      targetScope: 'packages/core',
      verificationCommand: 'yarn verify',
    },
    ...overrides,
  };
}

describe('optimize command helpers', () => {
  let tempDir: string;
  let stdout = '';
  let stderr = '';

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'night-watch-optimize-command-'));
    stdout = '';
    stderr = '';

    vi.clearAllMocks();
    vi.spyOn(process, 'cwd').mockReturnValue(tempDir);
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdout += String(chunk);
      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderr += String(chunk);
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('builds optimizer-specific environment variables', () => {
    const config = createConfig({
      jobProviders: { optimizer: 'codex' },
    });
    const options: IOptimizeOptions = { dryRun: false };

    const env = buildEnvVars(config, options, '/repo');

    expect(env.NW_PROVIDER_CMD).toBe('codex');
    expect(env.NW_OPTIMIZER_MAX_RUNTIME).toBe('1800');
    expect(env.NW_OPTIMIZER_BRANCH_PREFIX).toBe('night-watch/optimizer');
    expect(env.NW_OPTIMIZER_PR_LABEL).toBe('optimization');
    expect(env.NW_OPTIMIZER_TARGET_SCOPE).toBe('packages/core');
    expect(env.NW_OPTIMIZER_MAX_FINDINGS_TO_INSPECT).toBe('5');
    expect(env.NW_OPTIMIZER_VERIFICATION_COMMAND).toBe('yarn verify');
    expect(env.NW_OPTIMIZER_SCANNER_CMD).toContain('night-watch-optimizer-scan.sh');
    expect(env.NW_OPTIMIZER_REPORT_PATH).toBe('/repo/logs/optimizer-report.md');
  });

  it('lets dry-run target scope override config without mutating config', () => {
    const config = createConfig();
    const options: IOptimizeOptions = { dryRun: true, targetScope: 'web' };

    const env = buildEnvVars(config, options, '/repo');

    expect(env.NW_DRY_RUN).toBe('1');
    expect(env.NW_OPTIMIZER_TARGET_SCOPE).toBe('web');
    expect(config.optimizer.targetScope).toBe('packages/core');
  });

  it('applies timeout, provider, and target-scope CLI overrides', () => {
    const config = createConfig();
    const overridden = applyCliOverrides(config, {
      dryRun: false,
      timeout: '2400',
      provider: 'codex',
      targetScope: 'web',
    });

    expect(overridden.optimizer.maxRuntime).toBe(2400);
    expect(overridden.optimizer.targetScope).toBe('web');
    expect(overridden._cliProviderOverride).toBe('codex');
    expect(config.optimizer.maxRuntime).toBe(1800);
    expect(config.optimizer.targetScope).toBe('packages/core');
  });

  it('registers the expected CLI flags in help output', () => {
    const program = buildProgram();
    const help = program.commands
      .find((command) => command.name() === 'optimize')
      ?.helpInformation();

    expect(help).toContain('Run Optimizer to find and prove one performance improvement');
    expect(help).toContain('--dry-run');
    expect(help).toContain('--json');
    expect(help).toContain('--timeout <seconds>');
    expect(help).toContain('--provider <string>');
    expect(help).toContain('--target-scope <scope>');
  });

  it('skips disabled non-dry-run jobs without executing the script', async () => {
    vi.mocked(loadConfig).mockReturnValue(
      createConfig({
        optimizer: {
          ...getDefaultConfig().optimizer,
          enabled: false,
        },
      }),
    );

    await buildProgram().parseAsync(['node', 'night-watch', 'optimize', '--json']);

    expect(stderr).toBe('');
    expect(process.exit).toHaveBeenCalledWith(0);
    expect(JSON.parse(stdout)).toEqual({
      skipped: true,
      reason: 'optimizer-disabled',
    });
    expect(executeScriptWithOutput).not.toHaveBeenCalled();
  });

  it('parses structured script results for JSON output and records the outcome', async () => {
    vi.mocked(loadConfig).mockReturnValue(createConfig());
    vi.mocked(executeScriptWithOutput).mockResolvedValue({
      exitCode: 0,
      stdout:
        'work complete\nNIGHT_WATCH_RESULT:success_pr|branch=night-watch/optimizer/cache|pr=https://github.com/acme/repo/pull/12\n',
      stderr: '',
    });

    await buildProgram().parseAsync(['node', 'night-watch', 'optimize', '--json']);

    expect(stderr).toBe('');
    expect(process.exit).toHaveBeenCalledWith(0);
    expect(JSON.parse(stdout)).toEqual({
      exitCode: 0,
      status: 'success_pr',
      data: {
        branch: 'night-watch/optimizer/cache',
        pr: 'https://github.com/acme/repo/pull/12',
      },
    });
    expect(executeScriptWithOutput).toHaveBeenCalledWith(
      '/night-watch/scripts/night-watch-optimizer-cron.sh',
      [tempDir],
      expect.objectContaining({
        NW_OPTIMIZER_TARGET_SCOPE: 'packages/core',
        NW_OPTIMIZER_VERIFICATION_COMMAND: 'yarn verify',
      }),
    );
    expect(recordJobOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        exitCode: 0,
        jobType: 'optimizer',
        scriptResult: expect.objectContaining({ status: 'success_pr' }),
      }),
    );
    expect(stderr).toBe('');
  });
});
