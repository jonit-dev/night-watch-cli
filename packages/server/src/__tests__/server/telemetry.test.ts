import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const trackTelemetryEvent = vi.fn();

vi.mock('@night-watch/core', () => ({
  trackTelemetryEvent: (...args: unknown[]) => trackTelemetryEvent(...args),
}));

import { createTelemetryRoutes } from '../../routes/telemetry.routes.js';

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/telemetry', createTelemetryRoutes());
  return app;
}

describe('telemetry routes', () => {
  beforeEach(() => {
    trackTelemetryEvent.mockReset();
    trackTelemetryEvent.mockResolvedValue({ sent: true });
  });

  it('accepts web telemetry and forwards it through the core reporter', async () => {
    const response = await request(createTestApp())
      .post('/api/telemetry/web')
      .send({
        eventName: 'web_ui_action',
        properties: {
          uiArea: 'project_selector',
          action: 'select',
          resource: 'project',
          projectCount: 3,
          projectName: 'must-be-sanitized-by-core',
        },
      });

    expect(response.status).toBe(202);
    expect(response.body).toEqual({ accepted: true });
    expect(trackTelemetryEvent).toHaveBeenCalledWith('web_ui_action', {
      uiArea: 'project_selector',
      action: 'select',
      resource: 'project',
      projectCount: 3,
      projectName: 'must-be-sanitized-by-core',
    });
  });

  it('does not fail the request when telemetry reporting rejects', async () => {
    trackTelemetryEvent.mockRejectedValue(new Error('network failed'));

    const response = await request(createTestApp())
      .post('/api/telemetry/web')
      .send({ eventName: 'web_app_opened', properties: { routeName: 'dashboard' } });

    expect(response.status).toBe(202);
    expect(response.body).toEqual({ accepted: true });
  });

  it('normalizes invalid request bodies before forwarding', async () => {
    const response = await request(createTestApp())
      .post('/api/telemetry/web')
      .send({ eventName: 123, properties: ['not', 'an', 'object'] });

    expect(response.status).toBe(202);
    expect(trackTelemetryEvent).toHaveBeenCalledWith('', {});
  });
});
