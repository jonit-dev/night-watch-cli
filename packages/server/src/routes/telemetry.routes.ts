import { Request, Response, Router } from 'express';

import { trackTelemetryEvent } from '@night-watch/core';

interface IWebTelemetryBody {
  eventName?: unknown;
  properties?: unknown;
}

function readProperties(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

export function createTelemetryRoutes(): Router {
  const router = Router();

  router.post('/web', (req: Request, res: Response): void => {
    const body = req.body as IWebTelemetryBody | undefined;
    const eventName = typeof body?.eventName === 'string' ? body.eventName : '';
    const properties = readProperties(body?.properties);

    void trackTelemetryEvent(eventName, properties).catch(() => {
      // Telemetry is best-effort and must not affect web UI requests.
    });

    res.status(202).json({ accepted: true });
  });

  return router;
}
