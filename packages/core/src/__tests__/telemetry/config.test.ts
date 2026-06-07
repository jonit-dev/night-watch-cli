import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  getTelemetryConfigPath,
  getTelemetryEffectiveState,
  loadOrCreateTelemetryConfig,
  setTelemetryEnabled,
} from '../../telemetry/config.js';

describe('telemetry config', () => {
  let tempDir: string;
  let env: NodeJS.ProcessEnv;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-telemetry-'));
    env = { NIGHT_WATCH_HOME: tempDir };
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('should default telemetry to enabled when config file is missing', () => {
    const config = loadOrCreateTelemetryConfig({ env });

    expect(config.enabled).toBe(true);
    expect(config.installId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(getTelemetryConfigPath(env)).toBe(path.join(tempDir, 'telemetry.json'));
    expect(fs.existsSync(path.join(tempDir, 'telemetry.json'))).toBe(true);
  });

  it('should persist disabled state when telemetry is disabled', () => {
    const initial = loadOrCreateTelemetryConfig({ env });
    const updated = setTelemetryEnabled(false, { env });
    const saved = JSON.parse(
      fs.readFileSync(path.join(tempDir, 'telemetry.json'), 'utf-8'),
    ) as typeof updated;

    expect(updated.enabled).toBe(false);
    expect(saved.enabled).toBe(false);
    expect(saved.installId).toBe(initial.installId);
  });

  it('should report disabled effective state when NW_TELEMETRY_DISABLED is 1', () => {
    env.NW_TELEMETRY_DISABLED = '1';

    const state = getTelemetryEffectiveState({ env });

    expect(state.enabled).toBe(false);
    expect(state.reason).toBe('env:NW_TELEMETRY_DISABLED');
  });

  it('should report disabled effective state when DO_NOT_TRACK is 1', () => {
    env.DO_NOT_TRACK = '1';

    const state = getTelemetryEffectiveState({ env });

    expect(state.enabled).toBe(false);
    expect(state.reason).toBe('env:DO_NOT_TRACK');
  });

  it('should recover from invalid telemetry json without throwing', () => {
    fs.writeFileSync(path.join(tempDir, 'telemetry.json'), '{not-json', 'utf-8');

    const config = loadOrCreateTelemetryConfig({ env });

    expect(config.enabled).toBe(true);
    expect(config.installId).toMatch(/[0-9a-f-]{36}/i);
  });
});
