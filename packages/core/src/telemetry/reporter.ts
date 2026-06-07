import { DEFAULT_AMPLITUDE_API_KEY } from '../constants.js';
import { AmplitudeIngestClient, IAmplitudeIngestClient } from './amplitude-ingest-client.js';
import { getTelemetryEffectiveState } from './config.js';
import { sanitizeTelemetryEvent } from './sanitizer.js';

export interface ITelemetryReporterOptions {
  apiKey?: string;
  client?: IAmplitudeIngestClient;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
}

export interface ITelemetryTrackResult {
  sent: boolean;
  reason?: string;
}

function resolveAmplitudeApiKey(env: NodeJS.ProcessEnv, explicit?: string): string {
  return explicit ?? env.NW_AMPLITUDE_API_KEY ?? DEFAULT_AMPLITUDE_API_KEY;
}

export async function trackTelemetryEvent(
  eventName: string,
  properties: Record<string, unknown> = {},
  options: ITelemetryReporterOptions = {},
): Promise<ITelemetryTrackResult> {
  const env = options.env ?? process.env;
  const apiKey = resolveAmplitudeApiKey(env, options.apiKey);
  const state = getTelemetryEffectiveState({ env, apiKey, now: options.now });

  if (!state.enabled) {
    return { sent: false, reason: `disabled:${state.reason}` };
  }

  if (apiKey.trim().length === 0) {
    return { sent: false, reason: 'missing-api-key' };
  }

  const sanitized = sanitizeTelemetryEvent(eventName, properties);
  if (!sanitized) {
    return { sent: false, reason: 'dropped:event-name' };
  }

  try {
    const client = options.client ?? new AmplitudeIngestClient({ apiKey });
    await client.send({
      eventName: sanitized.eventName,
      installId: state.config.installId,
      properties: sanitized.properties,
      time: options.now?.().getTime(),
    });
    return { sent: true };
  } catch {
    return { sent: false, reason: 'network-error' };
  }
}
