/**
 * Amplitude REST API client for fetching product analytics data.
 */

import { createLogger } from '../utils/logger.js';

const logger = createLogger('amplitude-client');

export interface IAmplitudeData {
  activeUsers: unknown;
  eventSegmentation: unknown;
  retention: unknown;
  userSessions: unknown;
  fetchedAt: string;
  lookbackDays: number;
}

function buildAuthHeader(apiKey: string, secretKey: string): string {
  return `Basic ${Buffer.from(`${apiKey}:${secretKey}`).toString('base64')}`;
}

function buildDateRange(lookbackDays: number): { start: string; end: string } {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - lookbackDays);

  const fmt = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');
  return { start: fmt(start), end: fmt(end) };
}

async function amplitudeFetch(url: string, authHeader: string, label: string): Promise<unknown> {
  logger.debug(`Fetching ${label}`, { url });

  const response = await fetch(url, {
    headers: { Authorization: authHeader },
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error(`Amplitude authentication failed (401). Check your API Key and Secret Key.`);
    }
    if (response.status === 429) {
      throw new Error(`Amplitude rate limit exceeded (429). Try again later.`);
    }
    throw new Error(`Amplitude API error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

export async function fetchAmplitudeData(
  apiKey: string,
  secretKey: string,
  lookbackDays: number,
): Promise<IAmplitudeData> {
  const authHeader = buildAuthHeader(apiKey, secretKey);
  const { start, end } = buildDateRange(lookbackDays);

  logger.info('Fetching Amplitude data', { lookbackDays, start, end });

  const baseUrl = 'https://amplitude.com/api/2';

  const [activeUsers, eventSegmentation, retention, userSessions] = await Promise.allSettled([
    amplitudeFetch(`${baseUrl}/users/active?start=${start}&end=${end}`, authHeader, 'active users'),
    amplitudeFetch(
      `${baseUrl}/events/segmentation?start=${start}&end=${end}&e={"event_type":"_all"}`,
      authHeader,
      'event segmentation',
    ),
    amplitudeFetch(
      `${baseUrl}/retention?se={"event_type":"_all"}&re={"event_type":"_all"}&start=${start}&end=${end}`,
      authHeader,
      'retention',
    ),
    amplitudeFetch(
      `${baseUrl}/sessions/average?start=${start}&end=${end}`,
      authHeader,
      'user sessions',
    ),
  ]);

  const extract = (result: PromiseSettledResult<unknown>, label: string): unknown => {
    if (result.status === 'fulfilled') return result.value;
    logger.warn(`Failed to fetch ${label}`, { error: String(result.reason) });
    return null;
  };

  return {
    activeUsers: extract(activeUsers, 'active users'),
    eventSegmentation: extract(eventSegmentation, 'event segmentation'),
    retention: extract(retention, 'retention'),
    userSessions: extract(userSessions, 'user sessions'),
    fetchedAt: new Date().toISOString(),
    lookbackDays,
  };
}

export { buildAuthHeader, buildDateRange };
