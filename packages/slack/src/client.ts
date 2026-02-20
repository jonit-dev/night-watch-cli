/**
 * Slack Bot API client for Night Watch.
 * Uses the official @slack/web-api SDK for type-safe API calls.
 */

import { WebClient } from '@slack/web-api';
import { IAgentPersona } from '@night-watch/core/shared/types.js';

export interface ISlackMessage {
  ts: string;
  channel: string;
  text: string;
  username?: string;
}

export interface ISlackChannel {
  id: string;
  name: string;
}

function roleAvatarColor(role: string): string {
  const normalized = role.toLowerCase();
  if (normalized.includes('security')) return '8b1e2f';
  if (normalized.includes('qa') || normalized.includes('quality')) return '0f766e';
  if (normalized.includes('lead') || normalized.includes('architect')) return '1d4ed8';
  if (normalized.includes('implementer') || normalized.includes('developer')) return '374151';
  return '111827';
}

export function getFallbackAvatarUrl(persona: IAgentPersona): string {
  const background = roleAvatarColor(persona.role);
  const name = encodeURIComponent(persona.name.trim() || 'Night Watch');
  return `https://ui-avatars.com/api/?name=${name}&background=${background}&color=ffffff&size=128&bold=true&format=png`;
}

export class SlackClient {
  private readonly _client: WebClient;
  private readonly _serverBaseUrl: string;

  constructor(botToken: string, serverBaseUrl = 'http://localhost:7575') {
    this._client = new WebClient(botToken);
    this._serverBaseUrl = serverBaseUrl.replace(/\/$/, '');
  }

  /**
   * Resolve an avatar URL for use as Slack icon_url.
   * Relative paths (legacy) are resolved against the server base URL.
   * Absolute HTTP(S) URLs (e.g. GitHub raw CDN) are passed through unchanged.
   */
  private _resolveAvatarUrl(avatarUrl: string | null): string {
    if (!avatarUrl || avatarUrl.startsWith('data:')) return '';
    if (avatarUrl.startsWith('/')) return `${this._serverBaseUrl}${avatarUrl}`;
    return avatarUrl;
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
    // Slack icon_url must be a real HTTP URL — data URIs are not supported
    const resolved = this._resolveAvatarUrl(persona.avatarUrl);
    const iconUrl = resolved || getFallbackAvatarUrl(persona);

    const result = await this._client.chat.postMessage({
      channel,
      text,
      username: persona.name,
      icon_url: iconUrl,
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
  async postMessage(channel: string, text: string, threadTs?: string): Promise<void> {
    await this._client.chat.postMessage({
      channel,
      text,
      thread_ts: threadTs,
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
   * Join an existing Slack channel by ID.
   */
  async joinChannel(channelId: string): Promise<void> {
    await this._client.conversations.join({ channel: channelId });
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
      username: (m as unknown as Record<string, unknown>)['username'] as string | undefined,
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
