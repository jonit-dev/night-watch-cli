import { describe, expect, it } from 'vitest';

import { sanitizeTelemetryEvent } from '../../telemetry/sanitizer.js';

describe('telemetry sanitizer', () => {
  it('allows web telemetry with only safe enum and count properties', () => {
    const event = sanitizeTelemetryEvent('web_ui_action', {
      uiArea: 'project_selector',
      action: 'select',
      resource: 'project',
      selectedProjectIndex: 2,
      projectCount: 5,
      globalMode: true,
    });

    expect(event).toEqual({
      eventName: 'web_ui_action',
      properties: {
        uiArea: 'project_selector',
        action: 'select',
        resource: 'project',
        selectedProjectIndex: 2,
        projectCount: 5,
        globalMode: true,
      },
    });
  });

  it('drops forbidden web strings, identifiers, paths, URLs, prompts, and unknown keys', () => {
    const event = sanitizeTelemetryEvent('web_route_viewed', {
      routeName: '/projects/acme-secret',
      uiArea: 'settings/user@example.com',
      action: 'clicked-delete-button',
      resource: 'https://github.com/org/repo/issues/123',
      result: 'success',
      projectName: 'secret-repo',
      projectPath: '/Users/alice/work/secret-repo',
      branch: 'feature/customer-123',
      prNumber: 123,
      prompt: 'please inspect this private diff',
      providerOutput: 'raw model output',
      stack: 'Error: token failed at /tmp/private.ts:12',
      durationMs: 10,
    });

    expect(event).toEqual({
      eventName: 'web_route_viewed',
      properties: {
        result: 'success',
        durationMs: 10,
      },
    });
  });

  it('drops unknown web event names', () => {
    expect(sanitizeTelemetryEvent('web_clicked_raw_dom_id', { action: 'open' })).toBeNull();
  });
});
