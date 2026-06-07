import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { telemetryCommand } from '@/cli/commands/telemetry.js';
import {
  resetTelemetryReporterForTests,
  setTelemetryReporterForTests,
} from '@/cli/commands/shared/telemetry.js';

describe('telemetry command', () => {
  let tempDir: string;
  let originalEnv: NodeJS.ProcessEnv;
  let logs: string[];

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-cli-telemetry-'));
    originalEnv = { ...process.env };
    process.env.NIGHT_WATCH_HOME = tempDir;
    delete process.env.NW_TELEMETRY_DISABLED;
    delete process.env.DO_NOT_TRACK;
    logs = [];
    vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
      logs.push(String(message));
    });
    setTelemetryReporterForTests(vi.fn().mockResolvedValue(undefined));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetTelemetryReporterForTests();
    process.env = originalEnv;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  async function runTelemetry(args: string[]): Promise<void> {
    const program = new Command();
    program.exitOverride();
    telemetryCommand(program);
    await program.parseAsync(['telemetry', ...args], { from: 'user' });
  }

  it('should show enabled status when telemetry is enabled by default', async () => {
    await runTelemetry(['status']);

    const output = logs.join('\n');
    expect(output).toContain('Telemetry: enabled');
    expect(output).toContain(path.join(tempDir, 'telemetry.json'));
  });

  it('should disable telemetry when telemetry disable is run', async () => {
    await runTelemetry(['disable']);

    const saved = JSON.parse(fs.readFileSync(path.join(tempDir, 'telemetry.json'), 'utf-8')) as {
      enabled: boolean;
    };
    expect(saved.enabled).toBe(false);
    expect(logs.join('\n')).toContain('Telemetry disabled.');
  });

  it('should enable telemetry when telemetry enable is run', async () => {
    await runTelemetry(['disable']);
    await runTelemetry(['enable']);

    const saved = JSON.parse(fs.readFileSync(path.join(tempDir, 'telemetry.json'), 'utf-8')) as {
      enabled: boolean;
    };
    expect(saved.enabled).toBe(true);
  });

  it('should show env override when DO_NOT_TRACK is 1', async () => {
    process.env.DO_NOT_TRACK = '1';

    await runTelemetry(['status']);

    const output = logs.join('\n');
    expect(output).toContain('Telemetry: disabled');
    expect(output).toContain('env:DO_NOT_TRACK');
  });

  it('should mention privacy docs and opt-out commands in status output', async () => {
    await runTelemetry(['status']);

    const output = logs.join('\n');
    expect(output).toContain('docs/privacy.md');
    expect(output).toContain('night-watch telemetry disable');
    expect(output).toContain('NW_TELEMETRY_DISABLED=1 or DO_NOT_TRACK=1');
  });
});
