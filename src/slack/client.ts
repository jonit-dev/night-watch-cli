/**
 * Slack Bot API client for Night Watch.
 * Uses the official @slack/web-api SDK for type-safe API calls.
 */

import { WebClient } from '@slack/web-api';
import { IAgentPersona } from '../../shared/types.js';

export interface ISlackMessage {
  ts: string;
  channel: string;
  text: string;
}

export interface ISlackChannel {
  id: string;
  name: string;
}

export class SlackClient {
  private readonly _client: WebClient;

  constructor(botToken: string) {
    this._client = new WebClient(botToken);
  }

  /**
   * Post a message in Slack as a specific agent persona.
   * Uses chat.postMessage with custom username and icon_url.
   */
  async postAsAgent(
    channel: string,
    text: string,
    persona: IAgentPersona,
    threadTs?: string,
  ): Promise<ISlackMessage> {
    const result = await this._client.chat.postMessage({
      channel,
      text,
      username: persona.name,
      icon_url: persona.avatarUrl ?? undefined,
      thread_ts: threadTs,
    });

    return {
      ts: result.ts as string,
      channel: result.channel as string,
      text,
    };
  }

  /**
   * Post a simple message to Slack using the bot's default identity.
   */
  async postMessage(channel: string, text: string): Promise<void> {
    await this._client.chat.postMessage({
      channel,
      text,
    });
  }

  /**
   * Add an emoji reaction to a message.
   */
  async addReaction(
    channel: string,
    timestamp: string,
    emoji: string,
  ): Promise<void> {
    await this._client.reactions.add({
      channel,
      timestamp,
      name: emoji.replace(/:/g, ''),
    });
  }

  /**
   * Create a new Slack channel. Returns the channel ID.
   */
  async createChannel(name: string): Promise<string> {
    const result = await this._client.conversations.create({
      name: name
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')
        .slice(0, 80),
    });
    return result.channel?.id as string;
  }

  /**
   * Archive a Slack channel.
   */
  async archiveChannel(channelId: string): Promise<void> {
    await this._client.conversations.archive({ channel: channelId });
  }

  /**
   * Get messages in a thread.
   */
  async getChannelHistory(
    channel: string,
    threadTs: string,
    limit = 50,
  ): Promise<ISlackMessage[]> {
    const result = await this._client.conversations.replies({
      channel,
      ts: threadTs,
      limit,
    });

    return (result.messages ?? []).map((m) => ({
      ts: m.ts as string,
      channel,
      text: (m.text ?? '') as string,
    }));
  }

  /**
   * List channels in the workspace.
   */
  async listChannels(): Promise<ISlackChannel[]> {
    const result = await this._client.conversations.list({
      types: 'public_channel',
      limit: 200,
    });

    return (result.channels ?? []).map((ch) => ({
      id: ch.id as string,
      name: ch.name as string,
    }));
  }
}
