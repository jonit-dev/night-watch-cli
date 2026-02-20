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

    if (!result.ts || !result.channel) {
      throw new Error(`Slack postMessage returned no timestamp (channel=${channel})`);
    }

    return {
      ts: result.ts,
      channel: result.channel,
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
   * Resolve the bot user id for mention detection/filtering.
   */
  async getBotUserId(): Promise<string | null> {
    const result = await this._client.auth.test();
    const userId = result.user_id;
    return typeof userId === 'string' && userId.length > 0 ? userId : null;
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

  /**
   * List all users in the workspace.
   */
  async listUsers(): Promise<{ id: string; name: string }[]> {
    const users = new Map<string, { id: string; name: string }>();
    let cursor: string | undefined;

    do {
      const result = await this._client.users.list({
        limit: 200,
        ...(cursor ? { cursor } : {}),
      });

      for (const member of result.members ?? []) {
        const id = member.id;
        if (!id || member.is_bot || member.deleted || id === 'USLACKBOT') {
          continue;
        }

        users.set(id, {
          id,
          name: (member.real_name || member.name || id) as string,
        });
      }

      const nextCursor = result.response_metadata?.next_cursor;
      cursor = nextCursor && nextCursor.length > 0 ? nextCursor : undefined;
    } while (cursor);

    return Array.from(users.values());
  }

  /**
   * Invite multiple users to a channel.
   */
  async inviteUsers(channelId: string, userIds: string[]): Promise<number> {
    const uniqueUserIds = Array.from(new Set(userIds.filter((id) => id.length > 0)));
    if (uniqueUserIds.length === 0) return 0;

    let invitedCount = 0;
    // Slack allows up to 1000 users per invite call.
    for (let i = 0; i < uniqueUserIds.length; i += 1000) {
      const batch = uniqueUserIds.slice(i, i + 1000);
      await this._client.conversations.invite({
        channel: channelId,
        users: batch.join(','),
      });
      invitedCount += batch.length;
    }

    return invitedCount;
  }
}
