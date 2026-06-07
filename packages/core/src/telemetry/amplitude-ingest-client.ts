import { DEFAULT_AMPLITUDE_INGEST_ENDPOINT } from '../constants.js';
import type { ITelemetryEventProperties, TelemetryEventName } from './schema.js';

export interface IAmplitudeTelemetryEvent {
  eventName: TelemetryEventName;
  installId: string;
  properties: ITelemetryEventProperties;
  time?: number;
}

export interface IAmplitudeIngestClientOptions {
  apiKey: string;
  endpoint?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface IAmplitudeIngestClient {
  send(event: IAmplitudeTelemetryEvent): Promise<void>;
}

export class AmplitudeIngestClient implements IAmplitudeIngestClient {
  private readonly apiKey: string;
  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: IAmplitudeIngestClientOptions) {
    this.apiKey = options.apiKey;
    this.endpoint = options.endpoint ?? DEFAULT_AMPLITUDE_INGEST_ENDPOINT;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 1500;
  }

  async send(event: IAmplitudeTelemetryEvent): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          api_key: this.apiKey,
          events: [
            {
              device_id: event.installId,
              event_type: event.eventName,
              event_properties: event.properties,
              time: event.time ?? Date.now(),
            },
          ],
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`Amplitude ingestion failed with ${response.status}`);
      }
    } finally {
      clearTimeout(timeout);
    }
  }
}
