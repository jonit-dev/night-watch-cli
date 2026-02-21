/**
 * Slack composition root.
 * Wires SlackClient -> DeliberationEngine -> SlackInteractionListener
 * from a single config object.
 */

import { INightWatchConfig } from '@night-watch/core';

import { SlackClient } from './client.js';
import { DeliberationEngine } from './deliberation.js';
import { SlackInteractionListener } from './interaction-listener.js';

export interface ISlackStack {
  slackClient: SlackClient;
  engine: DeliberationEngine;
  listener: SlackInteractionListener;
}

/**
 * Build a fully-wired Slack stack from config.
 * The returned `listener` is ready to `.start()`.
 */
export function createSlackStack(config: INightWatchConfig): ISlackStack {
  const token = config.slack?.botToken ?? '';
  const serverBaseUrl = config.slack?.serverBaseUrl ?? 'http://localhost:7575';
  const slackClient = new SlackClient(token, serverBaseUrl);
  const engine = new DeliberationEngine(slackClient, config);
  const listener = new SlackInteractionListener(slackClient, engine, config);
  return { slackClient, engine, listener };
}
