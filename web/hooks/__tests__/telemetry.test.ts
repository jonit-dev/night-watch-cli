import { afterEach, describe, expect, it, vi } from 'vitest';

import { getSafeRouteName, trackWebTelemetry } from '../../telemetry';

describe('web telemetry helper', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('maps browser paths to safe route names only', () => {
    expect(getSafeRouteName('/')).toBe('dashboard');
    expect(getSafeRouteName('/settings')).toBe('settings');
    expect(getSafeRouteName('/projects/secret-repo/settings')).toBe('unknown');
  });

  it('posts telemetry with fetch when sendBeacon is unavailable', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    Object.defineProperty(window.navigator, 'sendBeacon', {
      configurable: true,
      value: undefined,
    });

    trackWebTelemetry('web_ui_action', {
      uiArea: 'logs',
      action: 'refresh',
      resource: 'logs',
      itemCount: 10,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/telemetry/web',
      expect.objectContaining({
        method: 'POST',
        keepalive: true,
        body: JSON.stringify({
          eventName: 'web_ui_action',
          properties: {
            uiArea: 'logs',
            action: 'refresh',
            resource: 'logs',
            itemCount: 10,
          },
        }),
      }),
    );
  });

  it('uses sendBeacon when available and does not call fetch', () => {
    const fetchMock = vi.fn();
    const sendBeaconMock = vi.fn().mockReturnValue(true);
    vi.stubGlobal('fetch', fetchMock);
    Object.defineProperty(window.navigator, 'sendBeacon', {
      configurable: true,
      value: sendBeaconMock,
    });

    trackWebTelemetry('web_app_opened', {
      uiArea: 'app',
      action: 'open',
      resource: 'app',
      routeName: 'dashboard',
    });

    expect(sendBeaconMock).toHaveBeenCalledTimes(1);
    expect(sendBeaconMock).toHaveBeenCalledWith('/api/telemetry/web', expect.any(Blob));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
