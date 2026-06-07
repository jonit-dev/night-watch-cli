import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { IAmplitudeIngestClient } from '../../telemetry/amplitude-ingest-client.js';
import { trackTelemetryEvent } from '../../telemetry/reporter.js';

describe('telemetry reporter', () => {
  let tempDir: string;
  let env: NodeJS.ProcessEnv;
  let client: IAmplitudeIngestClient;
  let send: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-telemetry-'));
    env = { NIGHT_WATCH_HOME: tempDir };
    send = vi.fn().mockResolvedValue(undefined);
    client = { send };
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('should send an allowed telemetry event with only safe properties', async () => {
    const result = await trackTelemetryEvent(
      'command_completed',
      {
        command: 'run',
        durationMs: 12,
        exitCode: 0,
        success: true,
        unknown: 'drop-me',
      },
      { apiKey: 'test-key', client, env },
    );

    expect(result.sent).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'command_completed',
        properties: {
          command: 'run',
          durationMs: 12,
          exitCode: 0,
          success: true,
        },
      }),
    );
  });

  it('should drop unknown event names', async () => {
    const result = await trackTelemetryEvent('repo_name', { command: 'run' }, { client, env });

    expect(result.sent).toBe(false);
    expect(result.reason).toBe('dropped:event-name');
    expect(send).not.toHaveBeenCalled();
  });

  it('should drop repo paths urls emails and raw text properties', async () => {
    await trackTelemetryEvent(
      'command_started',
      {
        cliVersion: '1.0.0',
        command: 'run now',
        jobType: '/tmp/repo',
        provider: 'https://example.com',
        platform: 'user@example.com',
        errorCategory: 'Error: /tmp/repo/secret failed with token',
      },
      { client, env },
    );

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        properties: {
          cliVersion: '1.0.0',
          errorCategory: 'unknown',
        },
      }),
    );
  });

  it('should not send when local telemetry is disabled', async () => {
    fs.writeFileSync(
      path.join(tempDir, 'telemetry.json'),
      JSON.stringify({
        schemaVersion: 1,
        installId: '00000000-0000-4000-8000-000000000000',
        enabled: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
      'utf-8',
    );

    const result = await trackTelemetryEvent(
      'command_started',
      { command: 'run' },
      { client, env },
    );

    expect(result.sent).toBe(false);
    expect(result.reason).toBe('disabled:config');
    expect(send).not.toHaveBeenCalled();
  });

  it('should not send when env opt out is set', async () => {
    env.DO_NOT_TRACK = '1';

    const result = await trackTelemetryEvent(
      'command_started',
      { command: 'run' },
      { client, env },
    );

    expect(result.sent).toBe(false);
    expect(result.reason).toBe('disabled:env:DO_NOT_TRACK');
    expect(send).not.toHaveBeenCalled();
  });

  it('should not perform network calls in tests', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    await trackTelemetryEvent('command_started', { command: 'run' }, { client, env });

    expect(send).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
